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
//
//   Read the `/api/player/*` block below for the endpoints and the exact
//   identity-resolution rules (including how pre-identity legacy rows are adopted
//   without their values ever being touched).
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  ACHIEVEMENTS,
  EMPTY_ACHIEVEMENT_STATS,
  coerceAchievementStats,
  evaluateUnlockedBadgeIds,
  mergeAchievementStats,
  type AchievementState,
  type AchievementStats,
} from "./achievement-core.ts";

const DB_PATH = join(import.meta.dir, "..", "data", "leaderboard.db");
const DATA_DIR = join(import.meta.dir, "..", "data");
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
}

function currentMonthUtc(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
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

function readProfileBlob(playerId: string): ProfileBlob {
  const row = getDb()
    .query<{ bests: string; stats: string; badges: string }, [string]>(
      "SELECT bests, stats, badges FROM player_profiles WHERE player_id = ?",
    )
    .get(playerId);
  if (!row) return emptyProfileBlob();

  const bests: Record<string, number> = {};
  for (const [key, value] of Object.entries(readJsonObject(row.bests))) {
    if (BEST_KEY_RE.test(key) && typeof value === "number" && Number.isFinite(value)) {
      bests[key] = Math.max(0, Math.floor(value));
    }
  }
  const badges: Record<string, string> = {};
  for (const [key, value] of Object.entries(readJsonObject(row.badges))) {
    if (typeof value === "string") badges[key] = value;
  }
  return {
    bests,
    stats: mergeAchievementStats(
      EMPTY_ACHIEVEMENT_STATS,
      coerceAchievementStats(readJsonObject(row.stats)),
    ),
    badges,
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
  });
}

/**
 * GET /api/player/profile?id=<playerId> — the rehydration read for a client that
 * has its id. `?name=<first name>` is the read-only probe for a client that lost
 * its id: it answers only when EXACTLY ONE identity uses that name (`profile`
 * null with `reason: "ambiguous"` otherwise). Neither form creates, adopts or
 * renames anything.
 */
function handlePlayerProfile(requestUrl: URL): Response {
  const idParam = requestUrl.searchParams.get("id");
  if (idParam !== null) {
    const playerId = validPlayerId(idParam);
    if (!playerId) return json({ ok: false, error: "Invalid playerId" }, 400);
    const profile = buildProfile(playerId);
    return json({ ok: true, profile, reason: profile ? "found" : "unknown-id" });
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

export async function handleLeaderboardApi(req: Request, pathname: string): Promise<Response> {
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
