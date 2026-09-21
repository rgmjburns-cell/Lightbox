/**
 * First-party usage analytics — storage and HTTP.
 *
 * Two endpoints, both served by this app's own Bun server (wired in `serve.ts`,
 * alongside the leaderboard API):
 *
 *   POST /api/metrics         fire-and-forget ingest, the only writer.
 *   GET  /api/admin/stats     passcode-protected read for the /admin dashboard.
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
 * The dashboard's own numbers are computed here from the event log
 * (visits/starts/ends/bounce/durations) plus `scores` for context. Because
 * `scores` keeps ONE cumulative row per (name, game, month, pid), it cannot be
 * used to count individual rounds — completed rounds therefore come from our
 * `game_end` events, which is stated in the UI.
 *
 * All queries are read-only EXCEPT the single INSERT in the ingest handler; the
 * board tables are never written by this module.
 */
import { getDb } from "./leaderboard.ts";
import {
  averageDuration,
  bounceRate,
  coerceEvent,
  fillDaily,
  lastNDays,
  sortAverages,
  sortGamesChosen,
  utcDayKey,
  type DailyCounts,
} from "./metrics-core.ts";
import type {
  MetricsDailyRow,
  MetricsStats,
  MetricsToday,
  MetricsTotals,
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

interface TotalsRow {
  visits: number | null;
  sessions: number | null;
  gameStarts: number | null;
  completedRounds: number | null;
}

function totals(where: string): MetricsTotals {
  const row = getDb()
    .query<TotalsRow, []>(
      `SELECT COALESCE(SUM(type = 'visit'), 0)        AS visits,
              COUNT(DISTINCT CASE WHEN type = 'visit' THEN session END) AS sessions,
              COALESCE(SUM(type = 'game_start'), 0)   AS gameStarts,
              COALESCE(SUM(type = 'game_end'), 0)     AS completedRounds
         FROM events
        WHERE ${where}`,
    )
    .get();
  return {
    visits: Number(row?.visits ?? 0),
    sessions: Number(row?.sessions ?? 0),
    gameStarts: Number(row?.gameStarts ?? 0),
    completedRounds: Number(row?.completedRounds ?? 0),
  };
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

function gamesChosen(where: string): { game: string; count: number }[] {
  const rows = getDb()
    .query<{ game: string; count: number }, []>(
      `SELECT game, COUNT(*) AS count
         FROM events
        WHERE type = 'game_start' AND game IS NOT NULL AND ${where}
        GROUP BY game`,
    )
    .all();
  return sortGamesChosen(rows.map((r) => ({ game: r.game, count: Number(r.count) })));
}

function avgDuration(where: string): { game: string; rounds: number; avgSec: number }[] {
  const rows = getDb()
    .query<{ game: string; rounds: number; avgSec: number | null }, []>(
      `SELECT game, COUNT(*) AS rounds, AVG(duration_sec) AS avgSec
         FROM events
        WHERE type = 'game_end' AND game IS NOT NULL AND duration_sec IS NOT NULL
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
    ...totals(where),
    bounceRate: bounceRate(sessionCounts(where)),
    gamesChosen: gamesChosen(where),
    avgDuration: avgDuration(where),
  };
}

function dailyRows(days: number): MetricsDailyRow[] {
  const rows = getDb()
    .query<Partial<DailyCounts> & { day: string }, []>(
      `SELECT date(created_at) AS day,
              COALESCE(SUM(type = 'visit'), 0)      AS visits,
              COUNT(DISTINCT CASE WHEN type = 'visit' THEN session END) AS sessions,
              COALESCE(SUM(type = 'game_start'), 0) AS gameStarts,
              COALESCE(SUM(type = 'game_end'), 0)   AS completedRounds
         FROM events
        WHERE ${windowWhere(days)}
        GROUP BY day`,
    )
    .all();
  return fillDaily(lastNDays(days), rows);
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

/** Today's numbers: events for the day plus the board's own "who played" count. */
function todayStats(): MetricsToday {
  const active = getDb()
    .query<{ activePlayers: number | null }, []>(
      `SELECT COUNT(DISTINCT name) AS activePlayers
         FROM scores
        WHERE ${TODAY_WHERE}`,
    )
    .get();
  return {
    date: utcDayKey(new Date()),
    ...totals(TODAY_WHERE),
    bounceRate: bounceRate(sessionCounts(TODAY_WHERE)),
    activePlayers: Number(active?.activePlayers ?? 0),
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

/** Dispatcher for the two endpoints this module owns (see `serve.ts`). */
export async function handleMetricsApi(req: Request, pathname: string): Promise<Response> {
  if (pathname === "/api/metrics") {
    if (req.method === "POST") return handleIngest(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (pathname === "/api/admin/stats") {
    if (req.method === "GET") return handleStats(req);
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  return json({ ok: false, error: "Not found" }, 404);
}
