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
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

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

function getDb(): Database {
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
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_name_game_month
        ON scores(name, game, month)
    `);
  }
  return db;
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
  name: string;
  game: Game;
  score: number;
}

interface RankedRow {
  rank: number;
  name: string;
  game: Game;
  score: number;
}

/**
 * One row per player for a month: the SUM of every score they banked that month
 * (every completed round adds — the board is cumulative points, not a best).
 * `game` is the game they earned the most points in that month, used purely as a
 * label (deterministic tie-break by game name); the UI does not render it.
 * `game` narrows the sum to a single game when one is requested.
 */
function cumulativeTotals(month: string, game: Game | "all"): ScoreRow[] {
  const rows =
    game === "all"
      ? getDb()
          .query<ScoreRow, [string]>(
            "SELECT name, game, score FROM scores WHERE month = ?",
          )
          .all(month)
      : getDb()
          .query<ScoreRow, [string, string]>(
            "SELECT name, game, score FROM scores WHERE month = ? AND game = ?",
          )
          .all(month, game);

  // Rows are unique per (name, game, month), so fold them into one row per
  // player: the running total plus the label of their biggest-earning game.
  const totals = new Map<string, ScoreRow & { topScore: number }>();
  for (const row of rows) {
    const seen = totals.get(row.name);
    if (!seen) {
      totals.set(row.name, {
        name: row.name,
        game: row.game,
        score: row.score,
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
  return [...totals.values()].map(({ name, game, score }) => ({
    name,
    game,
    score,
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
    return { rank, name: row.name, game: row.game, score: row.score };
  });
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
  const entries = ranked.slice(0, BOARD_LIMIT);

  // Optional `?player=<name>`: the caller's OWN row, ranked against the FULL
  // board (not just the visible top 5) so someone outside the top 5 still learns
  // their place. null when they have no score this month. The client compares
  // case-insensitively, so the lookup does too. An unusable name is ignored
  // (never fails the board request) — the board must render for everyone.
  const player = validName(requestUrl.searchParams.get("player"));
  const you = player
    ? (ranked.find(
        (row) => row.name.toLowerCase() === player.toLowerCase(),
      ) ?? null)
    : null;

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

  // Merge prevName rows into `name` FIRST (in a transaction with the delete):
  // the guest's points are ADDED to the destination name's rows so nothing the
  // guest earned is lost, then the guest rows are removed. Then the normal
  // cumulative upsert below banks this POST's own score.
  if (trimmedPrevName) {
    const mergeRows = getDb().transaction(
      (prev: string) => {
        getDb()
          .query(
            `INSERT INTO scores (name, game, score, month, created_at)
             SELECT ?, game, score, month, created_at FROM scores WHERE name = ?
             ON CONFLICT(name, game, month) DO UPDATE SET
               score = scores.score + excluded.score`,
          )
          .run(trimmedName, prev);
        getDb().query("DELETE FROM scores WHERE name = ?").run(prev);
      },
    );
    mergeRows(trimmedPrevName);
  }

  // Cumulative: every completed round adds to the player's (name, game, month)
  // row. Nothing is compared or replaced — a lower score adds just as much.
  getDb()
    .query(
      `INSERT INTO scores (name, game, score, month) VALUES (?, ?, ?, ?)
       ON CONFLICT(name, game, month) DO UPDATE SET
         score = scores.score + excluded.score,
         created_at = excluded.created_at`,
    )
    .run(trimmedName, game, score, month);

  // The player's monthly total across ALL games — that's what places them on the
  // `all` board (SUM of every row they banked this month).
  const totalRow = getDb()
    .query<{ total: number | null }, [string, string]>(
      "SELECT SUM(score) AS total FROM scores WHERE name = ? AND month = ?",
    )
    .get(trimmedName, month);
  const total = totalRow?.total ?? 0;

  // Rank on the month's `all` board: 1 + count of players whose cumulative
  // monthly total is strictly higher than this player's.
  const rankRow = getDb()
    .query<{ rank: number }, [string, number]>(
      `WITH totals AS (
         SELECT name, SUM(score) AS total FROM scores WHERE month = ? GROUP BY name
       )
       SELECT 1 + COUNT(*) AS rank FROM totals WHERE total > ?`,
    )
    .get(month, total);

  return json({
    ok: true,
    rank: rankRow?.rank ?? 1,
    name: trimmedName,
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
