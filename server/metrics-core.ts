/**
 * First-party usage analytics — the pure, database-free half.
 *
 * WHY FIRST-PARTY: the owner needs per-day page visits, bounce rate, games
 * chosen and how long games are played, but the product's IT self-check claims
 * "no analytics service / no third-party disclosure". So nothing here talks to
 * anybody: events are written to our own SQLite file by our own server
 * (`server/metrics.ts`) and read back by our own passcode-protected dashboard
 * (`/admin`).
 *
 * PRIVACY RULES (deliberate, do not relax without the owner):
 *   * The only identifier is `session`, a random UUID the browser generates and
 *     keeps in sessionStorage — per TAB and ephemeral, gone when the tab closes.
 *     No cookie, no localStorage, no fingerprint, no IP, no user agent: a session
 *     cannot be tied back to a person or followed across visits. The existing
 *     `lightboxPlayerId` cookie is identity for the leaderboard and is untouched
 *     by (and unused in) this module.
 *   * What is stored per event: session id, type, page, game, duration and the
 *     server's own UTC timestamp. Nothing else.
 *
 * This file holds the parts that are worth unit-testing on their own: event
 * validation, UTC day bucketing, bounce rate and duration averaging. The SQL and
 * the HTTP handlers live in `server/metrics.ts`.
 */

/** The only event types we accept. */
export const EVENT_TYPES = ["visit", "game_start", "game_end"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** A client-supplied session id: random, opaque, 8–64 url-safe characters. */
export const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Sanity caps so a rogue client cannot write junk of unbounded size. */
export const MAX_PAGE_LENGTH = 64;
export const MAX_GAME_LENGTH = 32;
export const MAX_DURATION_SEC = 4 * 60 * 60; // a 4-hour "round" is not a round

/** A validated, ready-to-insert event. `null` = "not recorded". */
export interface MetricsEvent {
  session: string;
  type: EventType;
  page: string | null;
  game: string | null;
  duration_sec: number | null;
}

export function isEventType(value: unknown): value is EventType {
  return (
    typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Validate a beacon body. Returns null only when the event is unusable (bad
 * session, unknown type, not an object) — an optional field that is missing or
 * malformed is stored as null instead, because a page visit with a slightly odd
 * page name is still a page visit and dropping it would make the numbers lie.
 */
export function coerceEvent(body: unknown): MetricsEvent | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const raw = body as Record<string, unknown>;

  const session = typeof raw.session === "string" ? raw.session.trim() : "";
  if (!SESSION_RE.test(session)) return null;
  if (!isEventType(raw.type)) return null;

  // Page paths are app paths only ("/leaderboard", "/play/scan-rush").
  let page: string | null = null;
  if (typeof raw.page === "string") {
    const trimmed = raw.page.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_PAGE_LENGTH && /^\/[A-Za-z0-9/_.-]*$/.test(trimmed)) {
      page = trimmed;
    }
  }

  let game: string | null = null;
  if (typeof raw.game === "string") {
    const trimmed = raw.game.trim().toLowerCase();
    if (trimmed.length > 0 && trimmed.length <= MAX_GAME_LENGTH && /^[a-z0-9-]+$/.test(trimmed)) {
      game = trimmed;
    }
  }

  let duration: number | null = null;
  const rawDuration = raw.duration_sec;
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
    const seconds = Math.round(rawDuration);
    if (seconds >= 0 && seconds <= MAX_DURATION_SEC) duration = seconds;
  }

  return { session, type: raw.type, page, game, duration_sec: duration };
}

/** UTC "YYYY-MM-DD" — the day bucket. Matches the DB's UTC month convention. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Day bucket for a value that may be a Date or a SQLite `datetime('now')`
 * string ("YYYY-MM-DD HH:MM:SS", already UTC). Garbage yields "".
 */
export function dayKey(value: string | Date): string {
  if (value instanceof Date) return utcDayKey(value);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match ? match[1] : "";
}

/** The last `n` UTC days as keys, OLDEST first, ending with `now`'s day. */
export function lastNDays(n: number, now: Date = new Date()): string[] {
  const count = Math.max(0, Math.floor(n));
  const endOfTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    days.push(new Date(endOfTodayUtc - i * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

/** Round to one decimal place (rates and averages read better than 12.333333). */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Bounce rate as a percentage, one decimal: of the sessions that opened at least
 * one page in the window, the share that never started a game. Sessions with no
 * visit at all (a stray beacon) are not eligible and cannot move the number;
 * with nothing eligible the rate is 0.
 */
export function bounceRate(
  sessions: readonly { visits: number; gameStarts: number }[],
): number {
  const eligible = sessions.filter((s) => s.visits > 0);
  if (eligible.length === 0) return 0;
  const bounced = eligible.filter((s) => s.gameStarts === 0).length;
  return round1((bounced / eligible.length) * 100);
}

/** Mean of the given durations in seconds (one decimal), or null when empty. */
export function averageDuration(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return round1(total / values.length);
}

/** All-time style "what got played": most chosen game first, ties alphabetical. */
export function sortGamesChosen(
  rows: readonly { game: string; count: number }[],
): { game: string; count: number }[] {
  return [...rows].sort(
    (a, b) => b.count - a.count || a.game.localeCompare(b.game),
  );
}

export interface DailyCounts {
  day: string;
  visits: number;
  sessions: number;
  gameStarts: number;
  completedRounds: number;
}

/**
 * Zero-fill a sparse per-day result into exactly `days` buckets, oldest first —
 * so "visits per day" is a complete list rather than a list of the days that
 * happened to have traffic (a gap must read as 0, not as a missing row).
 */
export function fillDaily(
  days: readonly string[],
  rows: readonly Partial<DailyCounts>[],
): DailyCounts[] {
  const byDay = new Map<string, Partial<DailyCounts>>();
  for (const row of rows) {
    const key = dayKey(String(row.day ?? ""));
    if (key) byDay.set(key, row);
  }
  return days.map((day) => {
    const row = byDay.get(day);
    return {
      day,
      visits: Number(row?.visits ?? 0) || 0,
      sessions: Number(row?.sessions ?? 0) || 0,
      gameStarts: Number(row?.gameStarts ?? 0) || 0,
      completedRounds: Number(row?.completedRounds ?? 0) || 0,
    };
  });
}

/** Averages per game, biggest sample first, ties alphabetical. */
export function sortAverages(
  rows: readonly { game: string; rounds: number; avgSec: number }[],
): { game: string; rounds: number; avgSec: number }[] {
  return [...rows]
    .map((row) => ({ ...row, avgSec: round1(row.avgSec) }))
    .sort((a, b) => b.rounds - a.rounds || a.game.localeCompare(b.game));
}
