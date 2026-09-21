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
 * validation, UTC day bucketing, bounce rate, duration averaging, and the
 * players / games-chosen folding of the leaderboard's own `scores` rows (the
 * only source that reaches back before the event log existed). The SQL and the
 * HTTP handlers live in `server/metrics.ts`.
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

// ── Day ranges (the export's from/to window) ────────────────────────────────
//
// The dashboard's own day table is always "the last 30 days". The export can be
// asked for any window instead (owner request, 21 Sep: a pilot runs 21 Sep to 21
// Oct, and a fixed 30-day file does not fit it). The parsing and the sanity rules
// live here so they are unit-tested without a database; `server/metrics.ts` only
// turns the resolved days into SQL.

/** A UTC day key as `utcDayKey` writes one: exactly `YYYY-MM-DD`. */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The default window when no from/to is asked for: the last 30 UTC days. */
export const DEFAULT_RANGE_DAYS = 30;

/** The widest window we will build: a year and a day, enough for any pilot. */
export const MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 86_400_000;

/** Midnight UTC of a `YYYY-MM-DD` key, or NaN when the key is not a real day. */
export function dayKeyTime(key: string): number {
  if (!DAY_RE.test(key)) return Number.NaN;
  const time = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(time)) return Number.NaN;
  // Catches days that parse but do not exist (2026-02-30 rolls into March).
  return utcDayKey(new Date(time)) === key ? time : Number.NaN;
}

/** Is this exactly a real UTC calendar day? (`2026-9-1` is not.) */
export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(dayKeyTime(value));
}

/** Every UTC day from `from` to `to`, inclusive, oldest first. */
export function dayKeysBetween(from: string, to: string): string[] {
  const start = dayKeyTime(from);
  const end = dayKeyTime(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days: string[] = [];
  for (let time = start; time <= end; time += MS_PER_DAY) {
    days.push(utcDayKey(new Date(time)));
  }
  return days;
}

/** A resolved, valid export window. */
export interface DayRange {
  from: string;
  to: string;
  /** Every UTC day of the window, inclusive and oldest first. */
  days: string[];
}

export type DayRangeResult = { ok: true; range: DayRange } | { ok: false; error: string };

/**
 * Resolve the export's `?from=` / `?to=` parameters into a concrete day window.
 *
 *   * neither given: the last 30 UTC days including today (the dashboard's own
 *     table, so an export with no parameters is exactly what it always was);
 *   * both given: those days, inclusive;
 *   * `from` only: from that day up to today (a campaign starting on a date);
 *   * `to` only: the 30 days ending on that day (the same shape as the default).
 *
 * Rejections are deliberate and are reported in plain words for the dashboard:
 * a value that is not a real `YYYY-MM-DD` UTC day, `from` after `to`, a window
 * wider than `MAX_RANGE_DAYS`, or an end later than tomorrow UTC (tomorrow is
 * allowed so a pilot ending "today" in a UTC+10 clinic still fits).
 */
export function resolveDayRange(
  from: string | null | undefined,
  to: string | null | undefined,
  now: Date = new Date(),
): DayRangeResult {
  const hasFrom = typeof from === "string" && from.trim() !== "";
  const hasTo = typeof to === "string" && to.trim() !== "";
  if (!hasFrom && !hasTo) {
    const days = lastNDays(DEFAULT_RANGE_DAYS, now);
    return { ok: true, range: { from: days[0] ?? "", to: days[days.length - 1] ?? "", days } };
  }
  const today = utcDayKey(now);
  const cleanFrom = hasFrom ? String(from).trim() : "";
  const cleanTo = hasTo ? String(to).trim() : "";
  if (hasFrom && !isDayKey(cleanFrom)) {
    return { ok: false, error: "Invalid from date: use YYYY-MM-DD (UTC)" };
  }
  if (hasTo && !isDayKey(cleanTo)) {
    return { ok: false, error: "Invalid to date: use YYYY-MM-DD (UTC)" };
  }
  const start = hasFrom ? dayKeyTime(cleanFrom) : Number.NaN;
  const end = hasTo ? dayKeyTime(cleanTo) : dayKeyTime(today);
  const newest = dayKeyTime(today) + MS_PER_DAY; // tomorrow UTC
  const toKey = hasTo ? cleanTo : today;
  if (end > newest) {
    return { ok: false, error: "Invalid to date: must not be later than tomorrow (UTC)" };
  }
  const fromTime = hasFrom ? start : end - (DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY;
  if (fromTime > end) {
    return { ok: false, error: "Invalid range: from must not be after to" };
  }
  const span = Math.round((end - fromTime) / MS_PER_DAY) + 1;
  if (span > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Range too wide: ${String(span)} days requested, the maximum is ${String(MAX_RANGE_DAYS)}`,
    };
  }
  const fromKey = utcDayKey(new Date(fromTime));
  return { ok: true, range: { from: fromKey, to: toKey, days: dayKeysBetween(fromKey, toKey) } };
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
  /** Page opens logged that day (event log only, so only days it was on). */
  visits: number;
  /** Distinct sessions that opened a page that day (event log only). */
  sessions: number;
  /** Games launched that day (event log only). */
  gameStarts: number;
  /**
   * Rounds played that day: finished rounds the event log recorded (one
   * `game_end` event each). 0 on any day before the log was switched on. This is
   * the only rounds figure the dashboard and the CSV carry.
   */
  roundsPlayed: number;
  /** Distinct identities behind those rows that day. */
  activePlayers: number;
  /**
   * WHICH games those rows were, that day: scoring rows per game, most played
   * first, ties alphabetical. Empty for a day with no score rows. The same board
   * rows activePlayers is folded from, grouped by game instead of by player.
   */
  gamesPlayed: { game: string; rounds: number }[];
}

// ── The board side: who played, and which games ─────────────────────────────
//
// The event log only starts the day it was switched on, so it cannot answer
// "who played before that, and what?". The leaderboard's own `scores` table can:
// it holds every round any player has ever banked, with a UTC timestamp. These
// helpers turn those rows into the dashboard's players and games numbers.
//
// NO ROUNDS COUNT COMES FROM HERE (owner decision, 21 Sep): the board keeps ONE
// cumulative row per (name, game, month, pid), so a player who plays the same game
// three times in a month has one row, not three. That is why the board's scoring
// rows are not a rounds tally, and why "rounds played" is counted from the event
// log alone. The rows below are still the right source for players and for which
// games were played.

/** A banked scoring row, as far as the dashboard cares. */
export interface ScoreRow {
  name: string;
  /** Player id; '' (or missing) means the row sits in the name pool. */
  pid?: string | null;
  game: string;
  /** SQLite `datetime('now')` string (UTC) or a Date. */
  created_at: string | Date;
}

/**
 * The identity a scoring row adds up to, folded exactly the way the board folds
 * its rows (`server/leaderboard.ts`): the player id when there is one, otherwise
 * the name. Two same-named players with ids are two players; two legacy rows with
 * the same name are one.
 */
export function identityKey(row: { name: string; pid?: string | null }): string {
  const pid = typeof row.pid === "string" ? row.pid.trim() : "";
  return pid === "" ? `n:${row.name}` : `p:${pid}`;
}

/** What a set of scoring rows adds up to, the board's way. */
export interface BoardTotals {
  /** Distinct identities behind those rows. */
  activePlayers: number;
  /** Submissions per game, most first, ties alphabetical. */
  gamesChosen: { game: string; count: number }[];
}

/** Scoring rows per game, most rows first, ties alphabetical. */
function countGames(
  rows: readonly ScoreRow[],
): { game: string; count: number }[] {
  const games = new Map<string, number>();
  for (const row of rows) {
    const game = String(row.game ?? "").trim();
    if (game) games.set(game, (games.get(game) ?? 0) + 1);
  }
  return sortGamesChosen([...games].map(([game, count]) => ({ game, count })));
}

/** Fold scoring rows into players and games chosen (never into a rounds count). */
export function summariseBoard(rows: readonly ScoreRow[]): BoardTotals {
  const players = new Set<string>();
  for (const row of rows) players.add(identityKey(row));
  return { activePlayers: players.size, gamesChosen: countGames(rows) };
}

/**
 * The same rows as "which games were played": scoring rows per game, most played
 * first, ties alphabetical. A row with no usable game id is skipped (the board
 * still holds it, it just cannot be attributed to a game).
 */
export function perGameRounds(
  rows: readonly ScoreRow[],
): { game: string; rounds: number }[] {
  return countGames(rows).map(({ game, count }) => ({ game, rounds: count }));
}

/**
 * The same rows, bucketed per UTC day (the day the row was last written, which
 * is when the board last banked that player's play): how many identities, and
 * which games. Rows with an unusable timestamp are dropped; days with no rows
 * are simply absent here and zero-filled later by `fillDaily`.
 */
export function boardByDay(
  rows: readonly ScoreRow[],
): {
  day: string;
  activePlayers: number;
  gamesPlayed: { game: string; rounds: number }[];
}[] {
  const byDay = new Map<string, ScoreRow[]>();
  for (const row of rows) {
    const key = dayKey(row.created_at);
    if (!key) continue;
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({
      day,
      activePlayers: summariseBoard(list).activePlayers,
      gamesPlayed: perGameRounds(list),
    }));
}

/**
 * Fold per-day partials from more than one source (the event log, the board) into
 * one row per calendar day. Sources are applied in order and a source only writes
 * the fields it actually measured, so the event log's visits and the board's
 * rounds end up in the same row. (Plain concatenation would not do: `fillDaily`
 * keeps the last row per day, which would drop the other source's numbers.)
 */
export function mergeDaily(
  ...sources: readonly (readonly Partial<DailyCounts>[])[]
): Partial<DailyCounts>[] {
  const byDay = new Map<string, Partial<DailyCounts>>();
  for (const rows of sources) {
    for (const row of rows) {
      const key = dayKey(String(row.day ?? ""));
      if (!key) continue;
      const merged: Record<string, unknown> = { ...(byDay.get(key) ?? { day: key }) };
      for (const [field, value] of Object.entries(row)) {
        if (field === "day" || value === undefined || value === null) continue;
        merged[field] = value;
      }
      byDay.set(key, merged as unknown as Partial<DailyCounts>);
    }
  }
  return [...byDay.values()];
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
      roundsPlayed: Number(row?.roundsPlayed ?? 0) || 0,
      activePlayers: Number(row?.activePlayers ?? 0) || 0,
      gamesPlayed: Array.isArray(row?.gamesPlayed) ? row.gamesPlayed : [],
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
