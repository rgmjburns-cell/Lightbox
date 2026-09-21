/**
 * First-party usage analytics — storage and HTTP.
 *
 * Three endpoints, all served by this app's own Bun server (wired in `serve.ts`,
 * alongside the leaderboard API):
 *
 *   POST /api/metrics              fire-and-forget ingest, the only writer.
 *   GET  /api/admin/stats          passcode-protected read for the /admin dashboard.
 *   GET  /api/admin/stats/export   the same numbers as a CSV or JSON download, so
 *                                  the owner can pull them into Excel or Sheets.
 *
 * The export is READ-ONLY and is the dashboard's own data, nothing else: it never
 * touches the leaderboard's restore export (`GET /api/leaderboard/export`), which
 * stays the separate, full-database backup path.
 *
 * PRIVACY: no third-party analytics service exists anywhere in this codebase and
 * none is used here. Events land in our own SQLite file (`data/leaderboard.db`
 * via `getDb()`), alongside the leaderboard we already run — same Railway
 * instance, same volume, same backup/export path, nothing new to operate, and no
 * data leaves the instance. The only identifier is a per-tab random session id
 * the browser keeps in sessionStorage; it is not a cookie, not localStorage and
 * not a fingerprint, so a session cannot follow a person around or be tied to a
 * player identity. See `metrics-core.ts` for the rules and `src/lib/metrics.ts`
 * for the client side.
 *
 * The dashboard is built from TWO sources, and its UI says which is which:
 *
 *   * our own event log (`events`) for visits, sessions, games started, bounce
 *     rate, time played and rounds played. It only exists from the day this
 *     shipped, so it has no history before that date (`countingSince`).
 *   * the leaderboard's own `scores` table for players and games chosen. That
 *     table holds every round ever banked, so it is the honest record of the
 *     September play that happened before the event log existed. Caveat, repeated
 *     in the UI: `scores` keeps ONE cumulative row per (name, game, month, pid),
 *     so those rows are not a rounds tally. Rounds played is therefore counted
 *     from the event log alone (owner decision, 21 Sep) and the board's scoring
 *     rows are never reported as a rounds figure.
 *
 * All queries are read-only EXCEPT the single INSERT in the ingest handler; the
 * board tables are never written by this module.
 */
import { getDb } from "./leaderboard.ts";
import {
  boardByDay,
  bounceRate,
  coerceEvent,
  fillDaily,
  lastNDays,
  mergeDaily,
  sortAverages,
  summariseBoard,
  utcDayKey,
  type DailyCounts,
} from "./metrics-core.ts";
import {
  exportFilename,
  statsCsv,
  telemetryByDay,
  type DurationDayRow,
  type SessionDayRow,
} from "./metrics-export.ts";
import type {
  MetricsBoardTotals,
  MetricsDailyRow,
  MetricsEventTotals,
  MetricsStats,
  MetricsToday,
  MetricsWindow,
} from "../src/lib/metrics-types.ts";

// Same passcode as the board's clear/export tooling: LEADERBOARD_ADMIN_PASSCODE
// (default clear2026). One admin secret for the instance, no new one to manage.
const PASSCODE = process.env.LEADERBOARD_ADMIN_PASSCODE ?? "clear2026";

const WINDOW_DAYS = { last7: 7, last30: 30 } as const;
const DAILY_DAYS = 30;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** `date(created_at)` is UTC, matching the DB's month convention. */
const TODAY_WHERE = "date(created_at) = date('now')";

function windowWhere(days: number): string {
  const span = Math.max(0, Math.floor(days) - 1);
  return `date(created_at) >= date('now', '-${String(span)} days')`;
}

/**
 * One finished round, as SQL. Exactly the rows "time played" is averaged over
 * (see `avgDuration`) and the rows "rounds played" counts, so the two numbers can
 * never disagree about what a round is: a `game_end` event carrying a game and a
 * duration (the client only sends one for a completed round, and drops rounds
 * under 5 seconds before sending).
 */
const COUNTED_ROUND_SQL =
  "type = 'game_end' AND game IS NOT NULL AND duration_sec IS NOT NULL";

// ── Ingest ─────────────────────────────────────────────────────────────────

/**
 * POST /api/metrics — record one event. The client never waits for, retries or
 * reports on this call, so the handler's only jobs are: validate, insert, and
 * stay cheap. 400 for an unusable body (the client ignores it either way), 500
 * if SQLite is unhappy — again, invisible to the player.
 */
async function handleIngest(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const event = coerceEvent(body);
  if (!event) return json({ ok: false, error: "Invalid event" }, 400);
  try {
    getDb()
      .query(
        `INSERT INTO events (session, type, page, game, duration_sec)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(event.session, event.type, event.page, event.game, event.duration_sec);
  } catch (err) {
    console.error("[metrics] event insert failed:", err);
    return json({ ok: false, error: "Store failed" }, 500);
  }
  return json({ ok: true });
}

// ── Reads ──────────────────────────────────────────────────────────────────

interface EventTotalsRow {
  visits: number | null;
  sessions: number | null;
  gameStarts: number | null;
  roundsPlayed: number | null;
}

/**
 * Visits, sessions, games started and rounds played — our event log, from the day
 * it went on. `roundsPlayed` counts finished rounds (one row per completed round),
 * which is the one thing the board's own record cannot answer: it keeps a single
 * cumulative row per player, game and month, so a replay grows that row instead of
 * adding one.
 */
function eventTotals(where: string): MetricsEventTotals {
  const row = getDb()
    .query<EventTotalsRow, []>(
      `SELECT COALESCE(SUM(type = 'visit'), 0)        AS visits,
              COUNT(DISTINCT CASE WHEN type = 'visit' THEN session END) AS sessions,
              COALESCE(SUM(type = 'game_start'), 0)   AS gameStarts,
              COALESCE(SUM(${COUNTED_ROUND_SQL}), 0)  AS roundsPlayed
         FROM events
        WHERE ${where}`,
    )
    .get();
  return {
    visits: Number(row?.visits ?? 0),
    sessions: Number(row?.sessions ?? 0),
    gameStarts: Number(row?.gameStarts ?? 0),
    roundsPlayed: Number(row?.roundsPlayed ?? 0),
  };
}

/**
 * Players and games chosen — the leaderboard's own record, which reaches back far
 * enough to cover the September play that happened before our event log existed.
 * Reading the rows and folding them in `metrics-core.ts` (rather than doing the
 * whole thing in SQL) keeps the counting rules unit-tested and identical to the
 * way the board folds identities. The window keeps this to at most one month of
 * (name, game, month, pid) rows, so it stays a tiny query. Deliberately no rounds
 * count: see the note at the top of this file.
 */
function boardTotals(where: string): MetricsBoardTotals {
  const rows = getDb()
    .query<{ name: string; pid: string | null; game: string; created_at: string }, []>(
      `SELECT name, pid, game, created_at
         FROM scores
        WHERE ${where}`,
    )
    .all();
  return summariseBoard(rows);
}

/** Per-session visit/start counts in a window — the bounce-rate input. */
function sessionCounts(
  where: string,
): { session: string; visits: number; gameStarts: number }[] {
  return getDb()
    .query<{ session: string; visits: number; gameStarts: number }, []>(
      `SELECT session,
              COALESCE(SUM(type = 'visit'), 0)      AS visits,
              COALESCE(SUM(type = 'game_start'), 0) AS gameStarts
         FROM events
        WHERE ${where}
        GROUP BY session`,
    )
    .all();
}

function avgDuration(where: string): { game: string; rounds: number; avgSec: number }[] {
  const rows = getDb()
    .query<{ game: string; rounds: number; avgSec: number | null }, []>(
      `SELECT game, COUNT(*) AS rounds, AVG(duration_sec) AS avgSec
         FROM events
        WHERE ${COUNTED_ROUND_SQL}
          AND ${where}
        GROUP BY game`,
    )
    .all();
  return sortAverages(
    rows.map((r) => ({
      game: r.game,
      rounds: Number(r.rounds),
      avgSec: Number(r.avgSec ?? 0),
    })),
  );
}

function windowStats(days: number): MetricsWindow {
  const where = windowWhere(days);
  return {
    days,
    ...eventTotals(where),
    ...boardTotals(where),
    bounceRate: bounceRate(sessionCounts(where)),
    avgDuration: avgDuration(where),
  };
}

function dailyRows(days: number): MetricsDailyRow[] {
  const where = windowWhere(days);
  const events = getDb()
    .query<Partial<DailyCounts> & { day: string }, []>(
      `SELECT date(created_at) AS day,
              COALESCE(SUM(type = 'visit'), 0)      AS visits,
              COUNT(DISTINCT CASE WHEN type = 'visit' THEN session END) AS sessions,
              COALESCE(SUM(type = 'game_start'), 0) AS gameStarts,
              COALESCE(SUM(${COUNTED_ROUND_SQL}), 0) AS roundsPlayed
         FROM events
        WHERE ${where}
        GROUP BY day`,
    )
    .all();
  const scores = getDb()
    .query<{ name: string; pid: string | null; game: string; created_at: string }, []>(
      `SELECT name, pid, game, created_at
         FROM scores
        WHERE ${where}`,
    )
    .all();
  // One row per day, carrying the event log's page numbers AND the board's own
  // players and games, so a September day still says who played and what rather
  // than nothing. Rounds played comes from the event log side only.
  return fillDaily(lastNDays(days), mergeDaily(events, boardByDay(scores)));
}

/** Distinct identities on the month's board — the same folding the board uses. */
function boardContext(month: string) {
  const players = getDb()
    .query<{ players: number | null }, [string]>(
      `SELECT COUNT(DISTINCT CASE WHEN pid <> '' THEN 'p:' || pid ELSE 'n:' || name END)
                AS players
         FROM scores
        WHERE month = ?`,
    )
    .get(month);
  const games = getDb()
    .query<{ game: string; players: number; points: number | null }, [string]>(
      `SELECT game, COUNT(*) AS players, COALESCE(SUM(score), 0) AS points
         FROM scores
        WHERE month = ?
        GROUP BY game
        ORDER BY points DESC, game`,
    )
    .all(month);
  return {
    month,
    monthlyActivePlayers: Number(players?.players ?? 0),
    games: games.map((g) => ({
      game: g.game,
      players: Number(g.players),
      points: Number(g.points ?? 0),
    })),
  };
}

/**
 * Today's numbers: the event log for the day's pages and rounds played, plus the
 * board's own count of who banked a round today (the board is the source that
 * reaches back before the event log existed, and today it still says the most
 * about who played).
 */
function todayStats(): MetricsToday {
  return {
    date: utcDayKey(new Date()),
    ...eventTotals(TODAY_WHERE),
    ...boardTotals(TODAY_WHERE),
    bounceRate: bounceRate(sessionCounts(TODAY_WHERE)),
  };
}

function monthUtc(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Build the whole dashboard payload. Read-only, one pass of small queries. */
export function collectStats(): MetricsStats {
  const bounds = getDb()
    .query<{ first: string | null }, []>("SELECT MIN(created_at) AS first FROM events")
    .get();
  return {
    ok: true,
    generatedAt: `${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
    countingSince: bounds?.first ?? null,
    today: todayStats(),
    last7: windowStats(WINDOW_DAYS.last7),
    last30: windowStats(WINDOW_DAYS.last30),
    daily: dailyRows(DAILY_DAYS),
    board: boardContext(monthUtc()),
  };
}

/**
 * The two per-day numbers the dashboard's daily table does not carry: bounce rate
 * and average time played. Same window, same rules as the 7- and 30-day blocks
 * above (see `metrics-export.ts`, which folds them with the very same helpers), so
 * an exported day cannot disagree with the page. Read-only.
 */
function dailyTelemetry(days: number) {
  const where = windowWhere(days);
  const sessions = getDb()
    .query<SessionDayRow, []>(
      `SELECT date(created_at) AS day,
              session,
              COALESCE(SUM(type = 'visit'), 0)      AS visits,
              COALESCE(SUM(type = 'game_start'), 0) AS gameStarts
         FROM events
        WHERE ${where}
        GROUP BY day, session`,
    )
    .all();
  const durations = getDb()
    .query<DurationDayRow, []>(
      `SELECT date(created_at) AS day, duration_sec
         FROM events
        WHERE type = 'game_end' AND duration_sec IS NOT NULL
          AND ${where}`,
    )
    .all();
  return telemetryByDay(sessions, durations);
}

// ── Auth ───────────────────────────────────────────────────────────────────

type AuthResult = "ok" | "missing" | "wrong";

/**
 * Passcode check, identical to `GET /api/leaderboard/export`: the header
 * `x-admin-passcode` (what the dashboard sends, so the passcode never lands in a
 * URL) or a `?passcode=` query parameter (handy for curl). 401 when absent, 403
 * when wrong — the dashboard shows "Wrong passcode" only for a 403.
 */
function authorise(req: Request): AuthResult {
  const url = new URL(req.url);
  const passcode = req.headers.get("x-admin-passcode") ?? url.searchParams.get("passcode");
  if (!passcode) return "missing";
  return passcode === PASSCODE ? "ok" : "wrong";
}

async function handleStats(req: Request): Promise<Response> {
  const auth = authorise(req);
  if (auth === "missing") return json({ ok: false, error: "Passcode required" }, 401);
  if (auth === "wrong") return json({ ok: false, error: "Wrong passcode" }, 403);
  try {
    return json(collectStats());
  } catch (err) {
    console.error("[metrics] stats query failed:", err);
    return json({ ok: false, error: "Stats unavailable" }, 500);
  }
}

/**
 * GET /api/admin/stats/export — the dashboard's own numbers as a file, for the
 * pilot reporting (Excel / Sheets). Same passcode gate and the same 401/403/500
 * behaviour as the dashboard read; `?format=csv` (the default) or `?format=json`,
 * where json is exactly the payload `/api/admin/stats` returns. Strictly
 * read-only: it reads the events log and the board, and writes nothing.
 */
async function handleExport(req: Request): Promise<Response> {
  const auth = authorise(req);
  if (auth === "missing") return json({ ok: false, error: "Passcode required" }, 401);
  if (auth === "wrong") return json({ ok: false, error: "Wrong passcode" }, 403);
  const format =
    new URL(req.url).searchParams.get("format")?.toLowerCase() === "json" ? "json" : "csv";
  try {
    if (format === "json") {
      return new Response(JSON.stringify(collectStats()), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${exportFilename("json")}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    // The same zero-filled 30-day table the dashboard's per-day section draws,
    // plus that table's own bounce rate and average time played per day.
    const csv = statsCsv(dailyRows(DAILY_DAYS), dailyTelemetry(DAILY_DAYS));
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename("csv")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[metrics] stats export failed:", err);
    return json({ ok: false, error: "Stats unavailable" }, 500);
  }
}

/** Dispatcher for the endpoints this module owns (see `serve.ts`). */
export async function handleMetricsApi(req: Request, pathname: string): Promise<Response> {
  if (pathname === "/api/metrics") {
    if (req.method === "POST") return handleIngest(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (pathname === "/api/admin/stats" || pathname === "/api/admin/stats/export") {
    if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
    return pathname === "/api/admin/stats" ? handleStats(req) : handleExport(req);
  }
  return json({ ok: false, error: "Not found" }, 404);
}
