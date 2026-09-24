// Shared monthly leaderboard backend.
//
// Storage is a local SQLite database via bun:sqlite (Bun builtin — no new
// dependency). Wired into serve.ts's fetch handler: every `/api/*` request is
// delegated here before the static-file/SSR logic runs. The client page fetches
// these endpoints same-origin, so no CORS is needed.
//
// Database lives at `<repo>/data/leaderboard.db`. The DB is opened lazily on the
// first request and the `data/` directory is created on demand (gitignored — the
// DB is runtime state, never committed).
//
// Scoring: the board is a MONTHLY CUMULATIVE POINTS board. Every completed round
// POSTs the score it earned and the player's (name, game, month) row accumulates
// it (`score = scores.score + excluded.score`) — nothing is replaced, compared or
// kept as a "best". A player's board total is SUM(score) over their rows for the
// month, so a round played in several games adds everything up. A new calendar
// month simply starts new rows: there is no reset code anywhere.
//
// Backups: `startLeaderboardBackups()` (called from serve.ts at startup) takes a
// snapshot into `<repo>/data/backups/leaderboard-<YYYYMMDD-HHMMSS>.db` on boot
// and every 24h, keeping the ~10 most recent. Copies are made with SQLite's
// `VACUUM INTO`, which produces a consistent single-file snapshot even in WAL
// mode (it includes uncheckpointed frames) without blocking normal reads or
// writes. `GET /api/leaderboard/export` (passcode-protected) streams the same
// kind of copy to the caller as a downloadable .db file.
//
// Player identity (added with the server-side player profile):
//
//   A first name alone cannot survive a device change: an "Add to Home Screen"
//   installed PWA starts with EMPTY local storage, so the browser profile — name,
//   lifetime totals, personal bests, badges — looks like a brand-new player even
//   though the monthly board still holds their banked rounds.
//
//   So every real first name gets a hidden, server-issued player id:
//
//   * `players(id, name, name_key, created_at, updated_at)` — one row per
//     identity. `name` is what the board displays (still a plain first name, no
//     suffixes; two people may share one), `name_key` is the lowercased name used
//     only to look an identity up when a client has lost its id.
//   * `scores.pid` — nullable-in-spirit attribution column. Rows written before
//     this feature (and rows written by anonymous "Guest NNNN" players) carry
//     `''`, which means "name pool": the pre-identity behaviour, grouped by name
//     exactly as it always was. The unique index is now
//     (name, game, month, pid), so two identities that display the SAME name
//     accumulate into their own rows instead of pooling.
//   * `player_profiles(player_id, bests, stats, badges, updated_at)` — the
//     client-side profile, mirrored server-side: per-game personal bests by
//     storage key, the achievement inputs, and the badges earned (with unlockedAt
//     so a restored profile looks the same as it did before).
//   * `player_progress(pid, badges_json, bests_json, updated_at)` — the SURVIVOR
//     half of the same data: badge unlocks and per-game personal bests, in a
//     table the monthly purge never deletes (owner decision 2026-09-24). It is
//     what lets a returning player still see their badges and their best-that-
//     must-be-beaten in a new month, while their name, scores and profile are
//     gone. No name is stored here, so it can never resurrect one.
//
//   Read the `/api/player/*` block below for the endpoints and the exact
//   identity-resolution rules (including how pre-identity legacy rows are adopted
//   without their values ever being touched).
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ACHIEVEMENTS,
  EMPTY_ACHIEVEMENT_STATS,
  coerceAchievementStats,
  evaluateUnlockedBadgeIds,
  mergeAchievementStats,
  type AchievementState,
  type AchievementStats,
} from "./achievement-core.ts";

// The instance's one SQLite file. LEADERBOARD_DB_PATH exists so a test can point
// the real handler at a scratch database (see `player-delete.test.ts`); unset in
// every deployment, where the path is the mounted volume's data/leaderboard.db.
const DB_PATH =
  process.env.LEADERBOARD_DB_PATH ?? join(import.meta.dir, "..", "data", "leaderboard.db");
const DATA_DIR = dirname(DB_PATH);
const BACKUPS_DIR = join(DATA_DIR, "backups");
const SNAPSHOT_KEEP = 10;
const SNAPSHOT_RE = /^leaderboard-\d{8}-\d{6}\.db$/;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

const GAMES = [
  "scan-rush",
  "bone-buster",
  "scan-search",
  "memory-scan",
  "mri-mixup",
  "ecg-rhythm",
  "colour-rex",
  "film-stack",
] as const;
const GAME_ALLOWLIST = ["all", ...GAMES] as const;
type Game = (typeof GAMES)[number];

// Trimmed name rules: 1–20 chars, letters/numbers/space/dot/hyphen/apostrophe.
const NAME_CHARSET = /^[A-Za-z0-9 .'-]+$/;
const NAME_MAX_LENGTH = 20;
const NAME_ERROR =
  "Name must be 1-20 characters (letters, numbers, space, dot, hyphen, apostrophe)";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_SCORE = 1_000_000;
// How many players the board shows (Top 5). The full ranking is still computed
// internally: competition ranks and the caller's own position need it.
const BOARD_LIMIT = 5;

// To change the admin passcode, set LEADERBOARD_ADMIN_PASSCODE in `.env`
// (bun auto-loads it; `.env` is gitignored).
const PASSCODE = process.env.LEADERBOARD_ADMIN_PASSCODE ?? "clear2026";

let db: Database | null = null;

/**
 * The one handle to the instance's SQLite file (opened lazily, schema migrated on
 * first use). Exported so the first-party usage analytics (`server/metrics.ts`)
 * writes its `events` table into the SAME database — one file per brand, one
 * backup/export story, no second datastore to run or secure.
 */
export function getDb(): Database {
  if (!db) {
    mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        game TEXT NOT NULL,
        score INTEGER NOT NULL,
        month TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    migrate(db);
  }
  return db;
}

/**
 * Idempotent schema migration. Runs on every boot and is a no-op once applied.
 *
 * All of it is additive: no existing `scores` VALUE is ever rewritten (the only
 * UPDATE on that table is the legacy-pool adoption below, which sets the new
 * attribution column and leaves name/game/score/month/created_at untouched).
 */
function migrate(database: Database): void {
  // 1. scores.pid — who a row belongs to ('' = name pool: legacy + guests).
  const scoreColumns = database
    .query<{ name: string }, []>("PRAGMA table_info(scores)")
    .all() as { name: string }[];
  if (!scoreColumns.some((c) => c.name === "pid")) {
    database.exec("ALTER TABLE scores ADD COLUMN pid TEXT NOT NULL DEFAULT ''");
  }

  // 2. The uniqueness key gains pid. The old (name, game, month) index would
  //    force two identities that share a display name to pool into one row, so
  //    it is replaced — a schema-only change: every key that used to be unique
  //    still is (pid is a 4th column), so no row can violate the new index and
  //    the board's numbers cannot move.
  const pidIndex = database
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_scores_name_game_month_pid'",
    )
    .get();
  if (!pidIndex) {
    database.exec("DROP INDEX IF EXISTS idx_scores_name_game_month");
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_name_game_month_pid
        ON scores(name, game, month, pid)
    `);
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_scores_pid ON scores(pid, month)",
  );

  // 3. Player identities + the mirrored client profile.
  database.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_players_name_key ON players(name_key)",
  );
  database.exec(`
    CREATE TABLE IF NOT EXISTS player_profiles (
      player_id TEXT PRIMARY KEY,
      bests TEXT NOT NULL DEFAULT '{}',
      stats TEXT NOT NULL DEFAULT '{}',
      badges TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    )
  `);

  // 3b. Survivor progress (`player_progress`) — the part of a player that is
  //     OURS, not the month's (owner decision 2026-09-24). Badge unlocks and
  //     per-game personal bests live here as well as in the profile above, and
  //     the monthly purge does NOT delete this table (see runMonthlyRollover):
  //     a returning player still sees the badges they earned and still knows
  //     the personal best they are chasing, while their name, their scores and
  //     their profile are gone for good.
  //
  //     Keyed by the same hidden pid as scores.pid / players.id /
  //     player_profiles.player_id (the id mirrored into the device's
  //     `lightboxPlayerId` cookie), so a device that keeps its cookie — an
  //     installed PWA with empty local storage, or a phone that comes back next
  //     month — is recognised and gets its progress back. Deliberately NO name
  //     column: nothing in this table can resurrect a stale "is this you?" name.
  //     Additive like everything else, and a no-op once applied.
  database.exec(`
    CREATE TABLE IF NOT EXISTS player_progress (
      pid TEXT PRIMARY KEY,
      badges_json TEXT NOT NULL DEFAULT '{}',
      bests_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    )
  `);

  // 4. First-party usage analytics (see server/metrics.ts and metrics-core.ts).
  //    Additive-only, like everything above: one append-only event log that
  //    records no personal data and no persistent identifier — `session` is a
  //    browser-generated random id kept in sessionStorage for the lifetime of a
  //    tab. A board wipe never touches it, and it never touches the board.
  database.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL,
      type TEXT NOT NULL,
      page TEXT,
      game TEXT NULL,
      duration_sec INTEGER NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Serves the dashboard's window scans; the session index serves bounce rate.
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(type, created_at)",
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_session ON events(session, type)",
  );

  // 5. Server bookkeeping. One row today: `active_month`, the calendar month the
  //    board currently belongs to. It is what makes the monthly purge below fire
  //    exactly once, at the month boundary and nowhere else.
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function currentMonthUtc(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

// ── Month rollover: no NAME or SCORE survives the boundary ─────────────────
//
// The board is monthly: the 1st of the month (UTC) starts a new month. At the
// owner's request (IDX raised stale matches during the IT self-check) a rollover
// also purges identity data, so no score, name, identity or profile crosses
// into the next month. Without it a player typing a nickname in October could be
// offered a "is this you?" profile left behind by a stranger in September.
//
// What DOES survive (owner decision 2026-09-24): the player's own progress —
// their badge unlocks and their per-game personal bests, in `player_progress`.
// Those are personal achievements, not the month's ranking: a player coming back
// in October should still see the badges they earned and still know the best
// they are trying to beat. Everything identifying still goes — no name, no
// score, no profile, so the stale-match problem stays solved (the survivor table
// stores no name at all).
//
// The boundary is a moment, not a scheduled job: the server can be idle over
// midnight on the 1st, so the purge runs on the next request instead, driven by
// the `meta.active_month` marker. Exactly four cases, and only one of them
// deletes anything:
//
//   * no marker yet (a fresh database, or one restored from a snapshot): the
//     marker is written and NOTHING is deleted. A deployment must never mistake
//     itself for a month boundary and wipe the board it inherited.
//   * marker === the current month: nothing to do, which is every normal request
//     and is what keeps the purge off the mid-month path.
//   * marker < current month: the boundary was crossed. Scores, players and
//     player_profiles are deleted and the marker moves forward in ONE
//     transaction, so a crash can never leave the board half-purged. Running it
//     again is harmless: the marker has already moved, so the deletes are not
//     repeated, and the deletes themselves are idempotent. `player_progress` is
//     NOT in that transaction — badge unlocks and personal bests are the one
//     thing that crosses the boundary on purpose (owner decision 2026-09-24).
//   * marker > current month: the clock went backwards (a restore, a test rig).
//     The month has not rolled over, so nothing is deleted.
//
// The first-party `events` log is deliberately untouched. It holds no name, no
// id and no persistent identifier, and it is the pilot's own reporting history:
// it is also how the dashboard can still show what happened last month.
export interface RolloverResult {
  /** The month the marker named before this call (null when there was none). */
  from: string | null;
  /** The month the board belongs to after this call. */
  to: string;
  /** True only when THIS call performed the purge. */
  rolled: boolean;
  deleted: { scores: number; players: number; profiles: number };
}

const ACTIVE_MONTH_KEY = "active_month";

/** The month the board belongs to, or null when it has never been recorded. */
function readActiveMonth(): string | null {
  const row = getDb()
    .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
    .get(ACTIVE_MONTH_KEY);
  return row && MONTH_RE.test(row.value) ? row.value : null;
}

function writeActiveMonth(month: string): void {
  getDb()
    .query(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(ACTIVE_MONTH_KEY, month);
}

/**
 * Enforce the month boundary. `month` is injectable so a test can drive the
 * calendar; every real caller uses the current UTC month.
 */
export function runMonthlyRollover(month: string = currentMonthUtc()): RolloverResult {
  const database = getDb();
  const from = readActiveMonth();
  const nothing = { scores: 0, players: 0, profiles: 0 };

  if (from === null) {
    writeActiveMonth(month);
    return { from: null, to: month, rolled: false, deleted: nothing };
  }
  if (from >= month) return { from, to: from, rolled: false, deleted: nothing };

  const purge = database.transaction((next: string) => {
    const scores = Number(database.query("DELETE FROM scores").run().changes);
    const players = Number(database.query("DELETE FROM players").run().changes);
    const profiles = Number(database.query("DELETE FROM player_profiles").run().changes);
    // `player_progress` is deliberately NOT deleted: badge unlocks and per-game
    // personal bests are the player's own progress and survive every month
    // (owner decision 2026-09-24). It holds no name, so nothing here can be
    // matched against a nickname in the new month.
    writeActiveMonth(next);
    return { scores, players, profiles };
  });

  const deleted = purge(month);
  const keptProgress = Number(
    getDb().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM player_progress").get()?.n ?? 0,
  );
  console.log(
    `[leaderboard] month rollover ${from} -> ${month}: purged ${String(deleted.scores)} scores, ` +
      `${String(deleted.players)} players, ${String(deleted.profiles)} profiles ` +
      `(kept ${String(keptProgress)} player_progress rows)`,
  );
  return { from, to: month, rolled: true, deleted };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isGame(value: unknown): value is Game {
  return typeof value === "string" && (GAMES as readonly string[]).includes(value);
}

/** Trimmed name that passes the POST rules (shared by POST and `?player=`). */
function validName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > NAME_MAX_LENGTH ||
    !NAME_CHARSET.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

interface ScoreRow {
  /** Display name of the identity this row adds up to. */
  name: string;
  game: Game;
  score: number;
  /**
   * Identity this row adds up to, for `?pid=` lookups and the "You" highlight:
   * `p:<playerId>` for a claimed identity, `n:<exact name>` for a name pool
   * (legacy + guest rows, which is exactly how the board grouped before player
   * ids existed). Two identities that display the same first name keep separate
   * keys — and so separate rows and separate totals.
   */
  key: string;
}

interface RankedRow {
  rank: number;
  name: string;
  game: Game;
  score: number;
  key: string;
}

/** Grouping key for a score row: the identity it belongs to. */
function identityKey(pid: string, name: string): string {
  return pid ? `p:${pid}` : `n:${name}`;
}

/**
 * One row per identity for a month: the SUM of every score they banked that
 * month (every completed round adds — the board is cumulative points, not a
 * best). `game` is the game they earned the most points in that month, used
 * purely as a label (deterministic tie-break by game name); the UI does not
 * render it. `game` narrows the sum to a single game when one is requested.
 *
 * Rows written before player ids (pid = '') still fold by exact name, so the
 * pre-identity board is reproduced byte for byte.
 */
function cumulativeTotals(month: string, game: Game | "all"): ScoreRow[] {
  interface RawRow {
    name: string;
    game: Game;
    score: number;
    pid: string;
    display_name: string;
  }
  const sql = `SELECT s.name AS name, s.game AS game, s.score AS score, s.pid AS pid,
                      COALESCE(p.name, s.name) AS display_name
                 FROM scores s LEFT JOIN players p ON p.id = s.pid
                WHERE s.month = ?${game === "all" ? "" : " AND s.game = ?"}`;
  const rows =
    game === "all"
      ? getDb().query<RawRow, [string]>(sql).all(month)
      : getDb().query<RawRow, [string, string]>(sql).all(month, game);

  // Rows are unique per (name, game, month, pid), so fold them into one row per
  // identity: the running total plus the label of their biggest-earning game.
  const totals = new Map<string, ScoreRow & { topScore: number }>();
  for (const row of rows) {
    const key = identityKey(row.pid, row.display_name);
    const seen = totals.get(key);
    if (!seen) {
      totals.set(key, {
        name: row.display_name,
        game: row.game,
        score: row.score,
        key,
        topScore: row.score,
      });
      continue;
    }
    seen.score += row.score;
    if (
      row.score > seen.topScore ||
      (row.score === seen.topScore && row.game < seen.game)
    ) {
      seen.game = row.game;
      seen.topScore = row.score;
    }
  }
  return [...totals.values()].map(({ name, game, score, key }) => ({
    name,
    game,
    score,
    key,
  }));
}

/** Competition ranking over a score-desc ordered list: ties share a rank, the
 * next distinct score gets rank = position in the list (1, 2, 2, 4, ...). */
function withRanks(rows: ScoreRow[]): RankedRow[] {
  let rank = 0;
  let prevScore: number | null = null;
  return rows.map((row, i) => {
    if (prevScore === null || row.score < prevScore) rank = i + 1;
    prevScore = row.score;
    return {
      rank,
      name: row.name,
      game: row.game,
      score: row.score,
      key: row.key,
    };
  });
}

// ── Player identity ────────────────────────────────────────────────────────
//
// A hidden id per identity. It is opaque, client-held and not a credential (the
// board is a waiting-room game — there is no auth to protect), so the only rules
// are that it is unguessable and never shown on the board.

const PLAYER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Anonymous auto-created identities ("Guest 4823") — never given a player id. */
const GUEST_NAME_RE = /^Guest \d{4}$/;

function newPlayerId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isGuestName(name: string): boolean {
  return GUEST_NAME_RE.test(name);
}

/** `?pid=` / body `playerId`, or null when absent/unusable (never fails a request). */
function validPlayerId(value: unknown): string | null {
  return typeof value === "string" && PLAYER_ID_RE.test(value) ? value : null;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

interface PlayerRow {
  id: string;
  name: string;
  name_key: string;
  created_at: string;
  updated_at: string;
}

function playerById(id: string): PlayerRow | null {
  return (
    getDb()
      .query<PlayerRow, [string]>(
        "SELECT id, name, name_key, created_at, updated_at FROM players WHERE id = ?",
      )
      .get(id) ?? null
  );
}

function playersByName(name: string): PlayerRow[] {
  return getDb()
    .query<PlayerRow, [string]>(
      "SELECT id, name, name_key, created_at, updated_at FROM players WHERE name_key = ? ORDER BY created_at, id",
    )
    .all(nameKey(name));
}

function insertPlayer(id: string, name: string, now: string): void {
  getDb()
    .query(
      `INSERT INTO players (id, name, name_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                     name_key = excluded.name_key,
                                     updated_at = excluded.updated_at`,
    )
    .run(id, name, nameKey(name), now, now);
}

function renamePlayer(id: string, name: string, now: string): void {
  getDb()
    .query("UPDATE players SET name = ?, name_key = ?, updated_at = ? WHERE id = ?")
    .run(name, nameKey(name), now, id);
}

/**
 * Attach the pre-identity ("legacy") rows for a name to an identity.
 *
 * This is the ONLY write to existing `scores` rows anywhere in this file, and it
 * sets the new attribution column alone: name, game, score, month and created_at
 * are untouched, so no board total, rank or displayed name can move (the rows
 * were already grouped by exactly that name). It runs at most once per name —
 * the moment the name is first claimed — which is what lets a player who has
 * been on the board for months keep their history and lifetime totals after the
 * id feature ships. Anonymous guest rows are never adopted (the guess name is
 * never a real first name), and a claim on a name that already has an identity
 * never adopts anything (see resolveIdentity).
 */
function adoptLegacyPool(playerId: string, name: string): number {
  return Number(
    getDb()
      .query("UPDATE scores SET pid = ? WHERE pid = '' AND name = ?")
      .run(playerId, name).changes,
  );
}

interface ResolvedIdentity {
  /** '' = the anonymous name pool (guest / pre-identity rows). */
  id: string;
  name: string;
  /** The caller's existing history was found and attached to. */
  restored: boolean;
  /** A brand-new identity row was created for this request. */
  created: boolean;
  /** Why a restore was refused: 'ambiguous' (several identities share the name). */
  lost?: "ambiguous";
}

/**
 * Decide which identity a (name, optional id) pair belongs to. Used by both
 * `/api/player/claim` and every score POST, so a game round and a name entry can
 * never disagree.
 *
 * `mode` matters, because the two callers mean different things:
 *
 *   * "submit" — a finished ROUND. The client usually sends its id; when it has
 *     none (a cached pre-feature client, or a claim whose response was lost) the
 *     round must still land somewhere sane and STABLE, never mint a new identity
 *     per round:
 *       - exactly one identity owns the name → attach to it (this is the old
 *         name-based behaviour, and the caller gets the id back for next time);
 *       - nobody owns the name → create one and adopt the name's pre-identity
 *         rows (the legacy migration: a player who has been on the board for
 *         months keeps their history);
 *       - two or more identities own the name → the round goes to the anonymous
 *         name pool (pid = ''), which is a separate row: never merged into
 *         either player, and no new identity either.
 *
 *   * "claim" — a NAME ENTRY, the moment a device with empty local storage (an
 *     installed PWA) has nothing left but the typed first name:
 *       - `restore` is the EXPLICIT user gesture ("that's me — restore my
 *         progress"). Only then is an existing identity with that name adopted,
 *         and only when it is unambiguous: with two or more identities sharing
 *         the name the restore is refused (`lost: 'ambiguous'`) and a fresh
 *         identity is handed out instead.
 *       - without that gesture a name entry NEVER inherits an existing profile:
 *         a name nobody owns yet creates a fresh identity (and adopts the
 *         name's pre-identity rows), and a name somebody already owns creates
 *         another fresh identity. Quietly pooling two people called "Sarah" is
 *         exactly the bug this feature exists to avoid.
 *
 * A known id always wins (and renames the identity if the client changed the
 * name) — the id is what makes a player recognisable across devices. An id the
 * server does not know (brand-new DB / restored snapshot) is re-established
 * as-is, so the client keeps its identity instead of silently starting over. A
 * guest name ("Guest NNNN") never gets an identity: those rows stay anonymous in
 * the name pool, exactly the pre-identity behaviour.
 */
function resolveIdentity(
  trimmedName: string,
  requestedId: string | null,
  mode: "submit" | "claim",
  restore = false,
): ResolvedIdentity {
  const now = new Date().toISOString();

  if (requestedId) {
    const existing = playerById(requestedId);
    if (existing) {
      if (existing.name !== trimmedName) renamePlayer(requestedId, trimmedName, now);
      return { id: requestedId, name: trimmedName, restored: true, created: false };
    }
    insertPlayer(requestedId, trimmedName, now);
    return { id: requestedId, name: trimmedName, restored: false, created: true };
  }

  if (isGuestName(trimmedName)) {
    return { id: "", name: trimmedName, restored: false, created: false };
  }

  const sameName = playersByName(trimmedName);

  if (mode === "submit") {
    if (sameName.length === 1) {
      return { id: sameName[0].id, name: sameName[0].name, restored: true, created: false };
    }
    if (sameName.length > 1) {
      // Ambiguous sender: bank the round under the anonymous name pool rather
      // than guessing which of the same-named players it belongs to.
      return { id: "", name: trimmedName, restored: false, created: false };
    }
  } else {
    if (restore && sameName.length === 1) {
      const player = sameName[0];
      adoptLegacyPool(player.id, trimmedName);
      return { id: player.id, name: player.name, restored: true, created: false };
    }
    if (restore && sameName.length > 1) {
      // Several identities use this name: never guess between them.
      const id = newPlayerId();
      insertPlayer(id, trimmedName, now);
      return { id, name: trimmedName, restored: false, created: true, lost: "ambiguous" };
    }
  }

  const id = newPlayerId();
  insertPlayer(id, trimmedName, now);
  if (sameName.length === 0) {
    // Nobody owns the name yet — the rows under it are this player's own
    // pre-identity history, so attach them (values untouched).
    adoptLegacyPool(id, trimmedName);
  }
  return { id, name: trimmedName, restored: false, created: true };
}

// ── Server-side player profile ─────────────────────────────────────────────
//
// The durable half of the client profile: per-game personal bests (by the
// client's own storage key), the achievement inputs and the badges earned.
// Everything here is monotone — a later, weaker snapshot can never take a badge
// or a personal best away.

const BEST_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const MAX_BEST_VALUE = 100_000_000;
const MAX_BEST_KEYS = 32;

interface PlayerProfileResponse {
  playerId: string;
  name: string;
  createdAt: string;
  /** Sum of the player's per-game personal bests (the client's "lifetime total"). */
  lifetimeTotal: number;
  /** Personal best per client storage key, so a fresh device can restore them. */
  bests: Record<string, number>;
  /** Lifetime per-game facts derived from the banked rounds (never reset). */
  perGame: { game: Game; best: number; total: number; rounds: number }[];
  stats: AchievementStats;
  /** Badges earned, with the moment they were first earned. */
  badges: { id: string; unlockedAt: string }[];
  month: string;
  monthlyTotal: number;
}

interface ProfileBlob {
  bests: Record<string, number>;
  stats: AchievementStats;
  badges: Record<string, string>;
}

function emptyProfileBlob(): ProfileBlob {
  return { bests: {}, stats: { ...EMPTY_ACHIEVEMENT_STATS }, badges: {} };
}

function readJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
// NOTE: keep this name distinct from `readJsonBody` below. Two function
// declarations cannot share a name in one module — the later one silently wins
// module-wide — and a body reader shadowing this blob parser makes every stored
// profile read as empty (that is exactly the bug PR #66 introduced and this
// comment prevents from coming back).

/** Personal bests from a stored JSON blob (unknown keys/values dropped). */
function parseBests(raw: string): Record<string, number> {
  const bests: Record<string, number> = {};
  for (const [key, value] of Object.entries(readJsonObject(raw))) {
    if (BEST_KEY_RE.test(key) && typeof value === "number" && Number.isFinite(value)) {
      bests[key] = Math.max(0, Math.floor(value));
    }
  }
  return bests;
}

/** Badge unlocks (id → unlockedAt ISO) from a stored JSON blob. */
function parseBadges(raw: string): Record<string, string> {
  const badges: Record<string, string> = {};
  for (const [key, value] of Object.entries(readJsonObject(raw))) {
    if (typeof value === "string") badges[key] = value;
  }
  return badges;
}

/**
 * The survivor row for one identity: the badge unlocks and personal bests that
 * cross the month boundary. Absent (all-empty) for a player who has never
 * synced a snapshot — that is not an error, every reader treats it as "nothing
 * to restore".
 */
function readProgressRow(
  playerId: string,
): { badges: Record<string, string>; bests: Record<string, number>; updatedAt: string | null } {
  const row = getDb()
    .query<{ badges_json: string; bests_json: string; updated_at: string }, [string]>(
      "SELECT badges_json, bests_json, updated_at FROM player_progress WHERE pid = ?",
    )
    .get(playerId);
  if (!row) return { badges: {}, bests: {}, updatedAt: null };
  return {
    badges: parseBadges(row.badges_json),
    bests: parseBests(row.bests_json),
    updatedAt: row.updated_at,
  };
}

/**
 * Write the survivor row. MONOTONE by construction: what is already stored is
 * merged in first, so a later, weaker snapshot can never take a badge or a
 * personal best away — the exact guarantee `player_profiles` gives, held for the
 * one table the monthly purge leaves alone.
 */
function writeProgress(
  playerId: string,
  badges: Record<string, string>,
  bests: Record<string, number>,
  now: string,
): void {
  const existing = readProgressRow(playerId);
  getDb()
    .query(
      `INSERT INTO player_progress (pid, badges_json, bests_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pid) DO UPDATE SET badges_json = excluded.badges_json,
                                      bests_json = excluded.bests_json,
                                      updated_at = excluded.updated_at`,
    )
    .run(
      playerId,
      JSON.stringify(mergeBadges(existing.badges, badges)),
      JSON.stringify(mergeBests(existing.bests, bests)),
      now,
    );
}

function readProfileBlob(playerId: string): ProfileBlob {
  const row = getDb()
    .query<{ bests: string; stats: string; badges: string }, [string]>(
      "SELECT bests, stats, badges FROM player_profiles WHERE player_id = ?",
    )
    .get(playerId);
  // The survivor row is the FLOOR of the profile, and it is the only thing left
  // after a monthly purge: merging it in here (monotone, both ways) is what makes
  // badges and personal bests readable for a player whose `players` and
  // `player_profiles` rows are gone.
  const progress = readProgressRow(playerId);
  return {
    bests: mergeBests(progress.bests, row ? parseBests(row.bests) : {}),
    stats: mergeAchievementStats(
      EMPTY_ACHIEVEMENT_STATS,
      coerceAchievementStats(row ? readJsonObject(row.stats) : {}),
    ),
    badges: mergeBadges(progress.badges, row ? parseBadges(row.badges) : {}),
  };
}

function writeProfileBlob(playerId: string, blob: ProfileBlob): void {
  const now = new Date().toISOString();
  getDb()
    .query(
      `INSERT INTO player_profiles (player_id, bests, stats, badges, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET bests = excluded.bests,
                                           stats = excluded.stats,
                                           badges = excluded.badges,
                                           updated_at = excluded.updated_at`,
    )
    .run(playerId, JSON.stringify(blob.bests), JSON.stringify(blob.stats), JSON.stringify(blob.badges), now);
  // Every writer of the profile is also a writer of the survivor row: badge
  // unlocks and personal bests are what must outlive the monthly purge, so they
  // are persisted in both places from the one call site.
  writeProgress(playerId, blob.badges, blob.bests, now);
}

/**
 * The survivor progress for an identity, in the shape the client restores from:
 * badges (in ACHIEVEMENTS order) and personal bests. `null` when this pid has
 * never recorded any progress. Reads `player_progress` ALONE — it answers even
 * when the player's identity and profile rows were purged at a month boundary.
 *
 * A name is deliberately absent: after a purge there is no name to send, and
 * sending the old one would re-create exactly the stale-match problem the purge
 * exists to prevent.
 */
function survivorProgress(playerId: string): {
  badges: { id: string; unlockedAt: string }[];
  bests: Record<string, number>;
  updatedAt: string | null;
} | null {
  const row = readProgressRow(playerId);
  const badges = mergeBadges({}, row.badges);
  const bests = mergeBests({}, row.bests);
  if (Object.keys(badges).length === 0 && Object.keys(bests).length === 0) return null;
  return {
    badges: ACHIEVEMENTS.filter((a) => badges[a.id]).map((a) => ({
      id: a.id,
      unlockedAt: badges[a.id],
    })),
    bests,
    updatedAt: row.updatedAt,
  };
}

/** Higher-is-better personal bests, keyed by the client's storage key. */
function mergeBests(
  stored: Record<string, number>,
  incoming: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...stored };
  for (const [key, value] of Object.entries(incoming)) {
    if (!BEST_KEY_RE.test(key)) continue;
    const best = Math.min(MAX_BEST_VALUE, Math.max(0, Math.floor(value)));
    merged[key] = Math.max(merged[key] ?? 0, best);
  }
  const keys = Object.keys(merged).sort(
    (a, b) => (merged[b] ?? 0) - (merged[a] ?? 0) || a.localeCompare(b),
  );
  const capped: Record<string, number> = {};
  for (const key of keys.slice(0, MAX_BEST_KEYS)) capped[key] = merged[key];
  return capped;
}

/** Badge unlocks, keeping the EARLIEST moment each badge was seen. */
function mergeBadges(
  stored: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...stored };
  for (const [id, at] of Object.entries(incoming)) {
    if (!ACHIEVEMENTS.some((a) => a.id === id)) continue; // ignore unknown ids
    const previous = merged[id];
    if (!previous || (at && at < previous)) merged[id] = at || previous;
  }
  return merged;
}

/** Untrusted `bests` from a request body. */
function coerceBests(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!BEST_KEY_RE.test(key)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[key] = Math.min(MAX_BEST_VALUE, Math.max(0, Math.floor(raw)));
  }
  return out;
}

/** Untrusted `badges` from a request body: id → unlockedAt ISO string. */
function coerceBadges(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ACHIEVEMENTS.some((a) => a.id === id)) continue;
    out[id] = typeof raw === "string" && raw.length > 0 ? raw : new Date().toISOString();
  }
  return out;
}

/**
 * What the player's BANKED ROUNDS prove on their own — independent of anything
 * the client reports. It keeps the profile honest for a device that has never
 * synced: kept in the DB forever (across months), so games played, play days,
 * Scan Search completions and lifetime points survive a wiped client.
 */
function derivedStats(playerId: string): { perGame: PlayerProfileResponse["perGame"]; stats: AchievementStats } {
  interface PerGameRow {
    game: Game;
    best: number;
    total: number;
    rounds: number;
  }
  const perGame = getDb()
    .query<PerGameRow, [string]>(
      `SELECT game, MAX(score) AS best, SUM(score) AS total, COUNT(*) AS rounds
         FROM scores WHERE pid = ? GROUP BY game`,
    )
    .all(playerId) as PerGameRow[];
  const days = (
    getDb()
      .query<{ day: string }, [string]>(
        "SELECT DISTINCT substr(created_at, 1, 10) AS day FROM scores WHERE pid = ? ORDER BY day",
      )
      .all(playerId) as { day: string }[]
  ).map((r) => r.day);
  const games = perGame.map((r) => r.game);
  const scanSearchRounds = perGame.find((r) => r.game === "scan-search")?.rounds ?? 0;
  const lifetimePoints = perGame.reduce((sum, r) => sum + Number(r.total), 0);
  return {
    perGame: perGame.map((r) => ({
      game: r.game,
      best: Number(r.best),
      total: Number(r.total),
      rounds: Number(r.rounds),
    })),
    stats: {
      ...EMPTY_ACHIEVEMENT_STATS,
      gamesPlayed: games,
      playDays: days,
      scanSearchCompletions: scanSearchRounds,
      accumulatedPoints: Math.max(0, lifetimePoints),
    },
  };
}

/**
 * Fold a client snapshot (bests / achievement stats / badge unlocks) into the
 * stored profile. Called by every claim and every score POST, so the mirror stays
 * current without any extra round trip.
 */
function mergeClientSnapshot(
  playerId: string,
  snapshot: { bests?: unknown; stats?: unknown; badges?: unknown },
): ProfileBlob {
  const stored = readProfileBlob(playerId);
  const merged: ProfileBlob = {
    bests: mergeBests(stored.bests, coerceBests(snapshot.bests)),
    stats: mergeAchievementStats(stored.stats, coerceAchievementStats(snapshot.stats)),
    badges: mergeBadges(stored.badges, coerceBadges(snapshot.badges)),
  };
  writeProfileBlob(playerId, merged);
  return merged;
}

/**
 * The full profile a fresh device can rehydrate from: name, lifetime total,
 * per-game bests, achievement inputs and badges.
 *
 * Badges are computed here from the SAME definitions and thresholds the client
 * uses (`server/achievement-core.ts`, imported by both sides), over
 * server-derived facts plus everything the client has reported. Unlocks are
 * permanent, so an unlocked badge is recorded with the moment it was first
 * proven and is never recomputed away — not even after an admin board wipe, and
 * not if a later snapshot looks weaker.
 */
function buildProfile(playerId: string): PlayerProfileResponse | null {
  const player = playerById(playerId);
  if (!player) return null;

  const stored = readProfileBlob(playerId);
  const derived = derivedStats(playerId);
  // Banked rounds + the client's report, merged monotonically.
  const stats = mergeAchievementStats(stored.stats, derived.stats);

  const now = new Date().toISOString();
  const badges: Record<string, string> = { ...stored.badges };
  for (const id of evaluateUnlockedBadgeIds(stats)) {
    if (!badges[id]) badges[id] = now;
  }

  const month = currentMonthUtc();
  const monthlyTotal = Number(
    getDb()
      .query<{ total: number | null }, [string, string]>(
        "SELECT SUM(score) AS total FROM scores WHERE pid = ? AND month = ?",
      )
      .get(playerId, month)?.total ?? 0,
  );

  const bestsValues = Object.values(stored.bests);
  const lifetimeTotal = bestsValues.length
    ? bestsValues.reduce((sum, v) => sum + v, 0)
    : derived.perGame.reduce((sum, g) => sum + g.best, 0);

  if (
    JSON.stringify(badges) !== JSON.stringify(stored.badges) ||
    JSON.stringify(stats) !== JSON.stringify(stored.stats)
  ) {
    writeProfileBlob(playerId, { bests: stored.bests, stats, badges });
  }

  return {
    playerId,
    name: player.name,
    createdAt: player.created_at,
    lifetimeTotal,
    bests: stored.bests,
    perGame: derived.perGame,
    stats,
    badges: ACHIEVEMENTS.filter((a) => badges[a.id]).map((a) => ({
      id: a.id,
      unlockedAt: badges[a.id],
    })),
    month,
    monthlyTotal,
  };
}

/**
 * POST /api/player/claim — resolve the identity behind a first name.
 *
 * Body: { name, playerId?, bests?, stats?, badges? }. Returns
 * { ok, playerId, name, restored, created, profile }. A name entry is the only
 * moment a lost id can be recovered, so the client calls this whenever a player
 * types their name (see src/lib/leaderboard.ts) — and the same resolution runs
 * inside every score POST, so a game round never lands on the wrong identity.
 * Guest identities ("Guest NNNN") get no id: they resolve to the anonymous name
 * pool and are upgraded (merged) into a real name the usual way.
 */
async function handlePlayerClaim(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const raw = body as Record<string, unknown>;
  const trimmedName = validName(raw.name);
  if (trimmedName === null) {
    return json({ ok: false, error: NAME_ERROR }, 400);
  }
  const requestedId =
    raw.playerId === undefined || raw.playerId === null
      ? null
      : validPlayerId(raw.playerId);
  if (raw.playerId !== undefined && raw.playerId !== null && requestedId === null) {
    return json({ ok: false, error: "Invalid playerId" }, 400);
  }

  const identity = resolveIdentity(trimmedName, requestedId, "claim", raw.restore === true);
  if (!identity.id) {
    return json({
      ok: true,
      playerId: null,
      name: identity.name,
      restored: false,
      created: false,
      profile: null,
    });
  }

  mergeClientSnapshot(identity.id, raw);
  return json({
    ok: true,
    playerId: identity.id,
    name: identity.name,
    restored: identity.restored,
    created: identity.created,
    lost: identity.lost ?? null,
    profile: buildProfile(identity.id),
    // Badges and personal bests that outlived the monthly purge, readable even
    // before this claim created the fresh identity/profile rows. Contains no
    // name: the nickname above is the one this player just typed, never a
    // remembered one.
    progress: survivorProgress(identity.id),
  });
}

/**
 * GET /api/player/profile?id=<playerId> — the rehydration read for a client that
 * has its id. `?name=<first name>` is the read-only probe for a client that lost
 * its id: it answers only when EXACTLY ONE identity uses that name (`profile`
 * null with `reason: "ambiguous"` otherwise). Neither form creates, adopts or
 * renames anything.
 *
 * `progress` is the survivor half: badge unlocks and personal bests from
 * `player_progress`, which the monthly purge leaves alone. It is returned even
 * when `profile` is null (the caller's identity rows were purged, or this pid
 * never had any), so a device that keeps its `lightboxPlayerId` cookie gets its
 * badges and bests back in a brand-new month without a name coming back with
 * them.
 */
function handlePlayerProfile(requestUrl: URL): Response {
  const idParam = requestUrl.searchParams.get("id");
  if (idParam !== null) {
    const playerId = validPlayerId(idParam);
    if (!playerId) return json({ ok: false, error: "Invalid playerId" }, 400);
    const profile = buildProfile(playerId);
    return json({
      ok: true,
      profile,
      reason: profile ? "found" : "unknown-id",
      progress: survivorProgress(playerId),
    });
  }

  const name = validName(requestUrl.searchParams.get("name"));
  if (name === null) {
    return json({ ok: false, error: "id or name required" }, 400);
  }
  const matches = playersByName(name);
  if (matches.length === 1) {
    return json({ ok: true, profile: buildProfile(matches[0].id), reason: "found" });
  }
  return json({
    ok: true,
    profile: null,
    reason: matches.length === 0 ? "no-identity" : "ambiguous",
    matches: matches.length,
  });
}

/**
 * Where one identity currently stands on the month's combined board (rank, name
 * and cumulative total), or null when they have no score this month. Runs the
 * exact same aggregation + ranking as GET, so a game's "you placed #N" and the
 * leaderboard page can never disagree.
 */
function positionOnBoard(month: string, key: string): RankedRow | null {
  const ordered = [...cumulativeTotals(month, "all")].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
  return withRanks(ordered).find((row) => row.key === key) ?? null;
}

async function handleGet(requestUrl: URL): Promise<Response> {
  const month = requestUrl.searchParams.get("month") ?? currentMonthUtc();
  if (!MONTH_RE.test(month)) {
    return json({ ok: false, error: "Invalid month; expected YYYY-MM" }, 400);
  }

  const gameParam = requestUrl.searchParams.get("game") ?? "all";
  if (!(GAME_ALLOWLIST as readonly string[]).includes(gameParam)) {
    return json({ ok: false, error: "Invalid game" }, 400);
  }

  const totals = cumulativeTotals(
    month,
    gameParam === "all" ? "all" : (gameParam as Game),
  );
  const ordered = [...totals].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
  const ranked = withRanks(ordered);

  // Optional `?player=<name>` (legacy) or `?pid=<playerId>` (identity-aware):
  // the caller's OWN row, ranked against the FULL board (not just the visible
  // top 5) so someone outside the top 5 still learns their place. null when they
  // have no score this month. A pid matches one identity EXACTLY — that is what
  // keeps two players called "Sarah" from highlighting each other's row — while
  // the name form keeps the old case-insensitive behaviour for clients that have
  // no pid yet. An unusable value is ignored (never fails the board request) —
  // the board must render for everyone.
  const player = validName(requestUrl.searchParams.get("player"));
  const pid = validPlayerId(requestUrl.searchParams.get("pid"));
  const you = pid
    ? (ranked.find((row) => row.key === `p:${pid}`) ?? null)
    : player
      ? (ranked.find(
          (row) => row.name.toLowerCase() === player.toLowerCase(),
        ) ?? null)
      : null;

  // The "You" badge is decided HERE, from the caller's identity, and shipped per
  // row: the client no longer has to guess from the displayed name. The internal
  // identity key is NOT shipped — it would leak other players' ids — so the
  // boolean is the only thing the board reveals about who is asking.
  const entries = ranked.slice(0, BOARD_LIMIT).map((row) => ({
    rank: row.rank,
    name: row.name,
    game: row.game,
    score: row.score,
    isYou: you !== null && row.key === you.key,
  }));

  return json({
    ok: true,
    month,
    game: gameParam,
    entries,
    you: you ? { rank: you.rank, name: you.name, score: you.score } : null,
  });
}

async function handlePost(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { name, game, score } = body as Record<string, unknown>;

  if (typeof name !== "string") {
    return json({ ok: false, error: "Name must be a string" }, 400);
  }
  const trimmedName = validName(name);
  if (trimmedName === null) {
    return json({ ok: false, error: NAME_ERROR }, 400);
  }
  if (!isGame(game)) {
    return json({ ok: false, error: "Invalid game" }, 400);
  }
  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > MAX_SCORE
  ) {
    return json({ ok: false, error: "Score must be an integer between 0 and 1000000" }, 400);
  }

  // Optional player id: the identity the client believes it is (stored in its
  // local storage). Malformed values are rejected rather than silently ignored,
  // so a client bug cannot quietly split one player into many.
  const playerIdRaw = (body as Record<string, unknown>).playerId;
  let requestedId: string | null = null;
  if (playerIdRaw !== undefined && playerIdRaw !== null) {
    requestedId = validPlayerId(playerIdRaw);
    if (requestedId === null) {
      return json({ ok: false, error: "Invalid playerId" }, 400);
    }
  }

  // Optional previous name: when a guest identity was upgraded to a real name,
  // the client sends the guest name here so we can merge its rows into the real
  // name's rows before this POST's own upsert. Must be a valid name, present,
  // and different from the submitted name.
  const prevNameRaw = (body as Record<string, unknown>).prevName;
  let trimmedPrevName: string | null = null;
  if (prevNameRaw !== undefined) {
    if (typeof prevNameRaw !== "string") {
      return json({ ok: false, error: "prevName must be a string" }, 400);
    }
    const prev = validName(prevNameRaw);
    if (prev === null || prev === trimmedName) {
      return json(
        { ok: false, error: "prevName must be a valid name different from name" },
        400,
      );
    }
    trimmedPrevName = prev;
  }

  const month = currentMonthUtc();

  // Resolve WHOSE round this is before anything is written: a known player id
  // attaches the row to that identity (and renames it if the client changed the
  // name), a real name with no id creates/restores an identity, and a guest name
  // stays anonymous in the name pool. See resolveIdentity for the exact rules.
  // The resolved id comes back in the response so a client that had none can
  // start sending it from the next round on.
  const identity = resolveIdentity(trimmedName, requestedId, "submit");
  const pid = identity.id;

  // Merge prevName rows into the caller's identity FIRST (in a transaction with
  // the delete): the guest's points are ADDED to the destination rows so nothing
  // the guest earned is lost, then the guest rows are removed. Then the normal
  // cumulative upsert below banks this POST's own score.
  if (trimmedPrevName) {
    const mergeRows = getDb().transaction(
      (prev: string, target: string) => {
        getDb()
          .query(
            `INSERT INTO scores (name, game, score, month, created_at, pid)
             SELECT ?, game, score, month, created_at, ? FROM scores WHERE name = ?
             ON CONFLICT(name, game, month, pid) DO UPDATE SET
               score = scores.score + excluded.score`,
          )
          .run(trimmedName, target, prev);
        getDb().query("DELETE FROM scores WHERE name = ?").run(prev);
      },
    );
    mergeRows(trimmedPrevName, pid);
  }

  // Cumulative: every completed round adds to the caller's (name, game, month,
  // pid) row. Nothing is compared or replaced — a lower score adds just as much.
  getDb()
    .query(
      `INSERT INTO scores (name, game, score, month, pid) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name, game, month, pid) DO UPDATE SET
         score = scores.score + excluded.score,
         created_at = excluded.created_at`,
    )
    .run(trimmedName, game, score, month, pid);

  // Mirror the client's profile snapshot (personal bests, achievement inputs,
  // badge unlocks) onto the identity while we are already talking to the client:
  // it is what a fresh device rehydrates from later. Unknown/extra fields are
  // ignored, nothing here can fail the round's own bookkeeping.
  if (pid) {
    try {
      mergeClientSnapshot(pid, body as Record<string, unknown>);
    } catch (err) {
      console.error("[leaderboard] profile snapshot merge failed:", err);
    }
  }

  // Place the caller on the month's `all` board: the same computation the GET
  // performs, so a game's "you placed #N" can never disagree with the page.
  const position = positionOnBoard(month, identityKey(pid, identity.name));
  const total = position?.score ?? 0;

  return json({
    ok: true,
    rank: position?.rank ?? 1,
    name: identity.name,
    playerId: pid || null,
    game,
    score: total,
    month,
  });
}

async function handleClear(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const passcode = (body as Record<string, unknown> | null)?.passcode;
  if (typeof passcode !== "string" || passcode !== PASSCODE) {
    return json({ ok: false, error: "Wrong passcode" }, 403);
  }
  const result = getDb().query("DELETE FROM scores").run();
  return json({ ok: true, cleared: Number(result.changes) });
}

// --- Backups / export ------------------------------------------------------

// UTC "YYYYMMDD-HHMMSS" stamp for snapshot filenames (matches the DB's
// UTC month convention).
function snapshotStamp(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

// Quote a filesystem path as a SQLite string literal (VACUUM INTO takes a
// path expression, not a bound parameter).
function sqlitePathLiteral(path: string): string {
  return `"${path.replace(/"/g, '""')}"`;
}

// Keep only the newest SNAPSHOT_KEEP leaderboard-*.db files. Filenames are
// fixed-width UTC stamps, so plain lexical sort == chronological order.
function pruneSnapshots(): void {
  let files: string[];
  try {
    files = readdirSync(BACKUPS_DIR).filter((f) => SNAPSHOT_RE.test(f));
  } catch {
    return; // dir missing/unreadable — nothing to prune
  }
  files.sort().reverse(); // newest first
  for (const file of files.slice(SNAPSHOT_KEEP)) {
    try {
      rmSync(join(BACKUPS_DIR, file));
    } catch {
      // best-effort pruning; ignore failures
    }
  }
}

/**
 * Copy the live DB to `data/backups/leaderboard-<YYYYMMDD-HHMMSS>.db` and
 * prune to the newest ~10 snapshots. `VACUUM INTO` builds a consistent
 * single-file snapshot that includes uncheckpointed WAL frames, so it is safe
 * to run while the server is serving reads/writes. Returns the snapshot path,
 * or null on failure (errors are logged, never thrown).
 */
export function takeSnapshot(): string | null {
  try {
    mkdirSync(BACKUPS_DIR, { recursive: true });
    const target = join(BACKUPS_DIR, `leaderboard-${snapshotStamp()}.db`);
    if (existsSync(target)) rmSync(target); // same-second retry
    getDb().exec(`VACUUM INTO ${sqlitePathLiteral(target)}`);
    pruneSnapshots();
    console.log(`[leaderboard] snapshot saved: ${target}`);
    return target;
  } catch (err) {
    console.error("[leaderboard] snapshot failed:", err);
    return null;
  }
}

/**
 * Take a snapshot immediately, then every 24h. Called once from serve.ts at
 * server startup. The interval is unref'd so it never keeps the process alive
 * on its own (the HTTP server already does).
 */
export function startLeaderboardBackups(): void {
  takeSnapshot(); // boot snapshot (VACUUM INTO is fast for a small board)
  const timer = setInterval(takeSnapshot, BACKUP_INTERVAL_MS);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  console.log(`[leaderboard] backups: daily snapshots into ${BACKUPS_DIR} (keeping ${SNAPSHOT_KEEP})`);
}

/**
 * GET /api/leaderboard/export — admin-only download of the full board as a
 * restorable SQLite file. Auth matches the clear endpoint: the same passcode
 * (env LEADERBOARD_ADMIN_PASSCODE, default clear2026), sent as a `passcode`
 * query parameter or an `x-admin-passcode` header. 401 when missing, 403 when
 * wrong. No frontend uses this — it is owner/admin tooling:
 *
 *   curl -o leaderboard-backup.db \
 *     "https://<host>/api/leaderboard/export?passcode=clear2026"
 */
async function handleExport(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const passcode = url.searchParams.get("passcode") ?? req.headers.get("x-admin-passcode");
  if (!passcode) {
    return json({ ok: false, error: "Passcode required" }, 401);
  }
  if (passcode !== PASSCODE) {
    return json({ ok: false, error: "Wrong passcode" }, 403);
  }
  const tmp = join(BACKUPS_DIR, `export-${snapshotStamp()}-${Date.now()}.db`);
  try {
    mkdirSync(BACKUPS_DIR, { recursive: true });
    if (existsSync(tmp)) rmSync(tmp); // VACUUM INTO fails if target exists
    getDb().exec(`VACUUM INTO ${sqlitePathLiteral(tmp)}`);
    const bytes = await Bun.file(tmp).arrayBuffer();
    const stamp = snapshotStamp();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="leaderboard-${stamp}.db"`,
      },
    });
  } catch (err) {
    console.error("[leaderboard] export failed:", err);
    return json({ ok: false, error: "Export failed" }, 500);
  } finally {
    rmSync(tmp, { force: true }); // never leave temp copies around
  }
}

// ── Player self-service erasure (Settings → "Clear All Data") ───────────────
//
// The player's own delete. There is no passcode: the proof of ownership is the
// identity the caller already holds, exactly as with every other player
// endpoint (a round is banked under a `playerId` on the same trust basis).
//
// Two shapes, and the difference matters:
//
//   * WITH a player id (the `lightboxPlayerId` cookie the client mirrors its id
//     into, falling back to the body's `playerId` for a device whose cookie is
//     missing): that id's scores rows, its `players` row, its `player_profiles`
//     row and its `player_progress` row go, in one transaction. A `name` in the
//     same request is IGNORED — a name is not proof of anything, so it can never
//     widen the delete beyond the caller's own id.
//   * WITHOUT any id: the caller is a GUEST ("Guest NNNN") or a pre-identity
//     player whose rows sit in the anonymous name pool (`pid = ''`). Only that
//     pool row for exactly the name supplied is deleted. Rows owned by a real id
//     are never touched by a name-only request, so naming somebody else deletes
//     nothing of theirs beyond the shared name pool they were never attributed
//     to.
//
// The first-party `events` table is NOT touched and cannot be: it stores no
// name, no id and no persistent identifier (its `session` is a random token that
// lives in sessionStorage for one tab), so there is nothing there that belongs
// to this player. Guest-upgrade merges copy rows, so deleting by id can never
// leave a duplicate behind.
const PLAYER_ID_COOKIE = "lightboxPlayerId";
/** One cookie's value from a request's `Cookie` header, or null when absent. */
function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    if (raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
interface DeleteCounts {
  scores: number;
  players: number;
  profiles: number;
  /** Survivor rows (`player_progress`) erased with the rest of the player. */
  progress: number;
}
const NOTHING_DELETED: DeleteCounts = { scores: 0, players: 0, profiles: 0, progress: 0 };
/**
 * A body that may be absent, empty, malformed or JSON — never throws.
 *
 * Named `readJsonBody`, NOT `readJsonObject`: the stored-blob parser above holds
 * that name, and a duplicate function declaration would shadow it module-wide.
 */
async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
/**
 * POST /api/player/delete — erase the caller's own rows from the board.
 *
 * Body: `{ name?, playerId? }` (both optional). Returns
 * `{ ok: true, deleted: { scores, players, profiles } }` so the caller can report
 * honestly what went; a caller with no identity to erase gets `ok: true` and
 * zeros, which is the truth (nothing of theirs was on the board) and lets the
 * device-side wipe proceed.
 */
async function handlePlayerDelete(req: Request): Promise<Response> {
  const raw = await readJsonBody(req);
  // The cookie is the identity this device proved; the body id is the same
  // client's own fallback for a browser that dropped the cookie.
  const playerId =
    validPlayerId(cookieValue(req, PLAYER_ID_COOKIE)) ?? validPlayerId(raw.playerId);
  if (!playerId) {
    const name = validName(raw.name);
    if (name === null) return json({ ok: true, deleted: NOTHING_DELETED });
    const database = getDb();
    const scores = Number(
      database.query("DELETE FROM scores WHERE name = ? AND pid = ''").run(name).changes,
    );
    // Nothing else to remove: an anonymous pool row has no `players` row and no
    // profile (both are keyed by an id this caller does not have).
    return json({ ok: true, deleted: { scores, players: 0, profiles: 0, progress: 0 } });
  }
  const database = getDb();
  const erase = database.transaction((id: string): DeleteCounts => {
    const scores = Number(database.query("DELETE FROM scores WHERE pid = ?").run(id).changes);
    const players = Number(database.query("DELETE FROM players WHERE id = ?").run(id).changes);
    const profiles = Number(
      database.query("DELETE FROM player_profiles WHERE player_id = ?").run(id).changes,
    );
    // "Clear All Data" is the player asking for EVERYTHING of theirs to go, so
    // the survivor row goes too — it is their badges and their bests. (The
    // monthly purge is the one path that keeps it; see runMonthlyRollover.)
    const progress = Number(
      database.query("DELETE FROM player_progress WHERE pid = ?").run(id).changes,
    );
    return { scores, players, profiles, progress };
  });
  return json({ ok: true, deleted: erase(playerId) });
}
export async function handleLeaderboardApi(req: Request, pathname: string): Promise<Response> {
  // The month boundary is checked before any route is served: a board request is
  // the moment the server learns time has moved on, and the purge has to happen
  // BEFORE a nickname is claimed, or a player could still be offered the previous
  // month's profile. It is a no-op on every other request. A failure here must not
  // take the API down: the board keeps working and the next request retries.
  try {
    runMonthlyRollover();
  } catch (err) {
    console.error("[leaderboard] monthly rollover failed:", err);
  }
  if (pathname === "/api/leaderboard") {
    if (req.method === "GET") return handleGet(new URL(req.url));
    if (req.method === "POST") return handlePost(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  // Player profile: the durable identity that survives a device's local storage
  // being wiped (installed PWA) or a different device entirely.
  if (pathname === "/api/player/claim") {
    if (req.method === "POST") return handlePlayerClaim(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (pathname === "/api/player/profile") {
    if (req.method === "GET") return handlePlayerProfile(new URL(req.url));
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  // Self-service erasure (Settings → "Clear All Data"): the caller's OWN rows,
  // authenticated by the identity it already holds. No passcode, and it never
  // touches the admin whole-board wipe below.
  if (pathname === "/api/player/delete") {
    if (req.method === "POST") return handlePlayerDelete(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (pathname === "/api/leaderboard/clear") {
    if (req.method === "POST") return handleClear(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (pathname === "/api/leaderboard/export") {
    if (req.method === "GET") return handleExport(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  return json({ ok: false, error: "Not found" }, 404);
}
