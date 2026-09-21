/**
 * Dashboard export — the pure, database-free half of
 * `GET /api/admin/stats/export`.
 *
 * WHY: the owner wants the /admin numbers in Excel or Sheets for the pilot
 * reporting, so the dashboard needs a download. This module turns the SAME
 * per-day rows the dashboard draws (`collectStats().daily`, see
 * `server/metrics.ts`) into a CSV a spreadsheet opens with correct columns, plus
 * the two per-day numbers the dashboard itself does not carry (bounce rate and
 * average time played, which the page only shows for the 7- and 30-day windows).
 *
 * RULES:
 *   * Read-only. Nothing here writes to the database, and nothing here touches
 *     the leaderboard's own backup export (`GET /api/leaderboard/export`), which
 *     exists for restores and is deliberately a separate concern.
 *   * The CSV mirrors the dashboard: the same 30 zero-filled UTC days, the same
 *     identity folding behind activePlayers, the same bounce-rate rule and the
 *     same one-decimal rounding — so a number quoted from the file matches the
 *     number on the page.
 *   * `roundsPlayed` is the ONE rounds column (owner decision, 21 Sep): finished
 *     rounds from the event log, one per completed round. The board's scoring rows
 *     are deliberately NOT exported as a rounds number, because the board keeps one
 *     cumulative row per player, game and month, so a replay grows a row rather
 *     than adding one. The event log starts mid-September, so `roundsPlayed` is 0
 *     on earlier days; no earlier value is invented.
 *   * Plain ASCII in the output: game names are joined with "; ", never an em
 *     dash (house rule: no em dashes anywhere in the product's copy).
 */
import type { MetricsDailyRow } from "../src/lib/metrics-types.ts";
import { averageDuration, bounceRate } from "./metrics-core.ts";

/** The two per-day numbers the dashboard does not carry in its daily table. */
export interface DailyTelemetry {
  /** Share (0-100) of that day's sessions that never started a game. */
  bounceRate: number;
  /** Mean seconds played per finished round that day, or null when none. */
  avgDurationSec: number | null;
}

/**
 * Column order of the CSV, exactly as a spreadsheet should read it. One rounds
 * column only, `roundsPlayed` (the event log's count of finished rounds), matching
 * the dashboard.
 */
export const CSV_COLUMNS = [
  "date",
  "visits",
  "sessions",
  "gameStarts",
  "roundsPlayed",
  "activePlayers",
  "bounceRate",
  "avgDurationSec",
  "gamesPlayed",
] as const;

/** Per-session page/start counts for one UTC day (the bounce-rate input). */
export interface SessionDayRow {
  day: string;
  session: string;
  visits: number;
  gameStarts: number;
}

/** One finished round's duration, tagged with its UTC day. */
export interface DurationDayRow {
  day: string;
  duration_sec: number | null;
}

/**
 * Fold the event log's per-session and per-round rows into one telemetry entry
 * per UTC day, using the very same `bounceRate` / `averageDuration` helpers the
 * dashboard's windows use (so the file and the page cannot drift apart).
 */
export function telemetryByDay(
  sessions: readonly SessionDayRow[],
  durations: readonly DurationDayRow[],
): Map<string, DailyTelemetry> {
  const perDay = new Map<string, { sessions: SessionDayRow[]; durations: number[] }>();
  const bucket = (day: string) => {
    const existing = perDay.get(day);
    if (existing) return existing;
    const fresh = { sessions: [] as SessionDayRow[], durations: [] as number[] };
    perDay.set(day, fresh);
    return fresh;
  };
  for (const row of sessions) bucket(row.day).sessions.push(row);
  for (const row of durations) {
    if (row.duration_sec === null || row.duration_sec === undefined) continue;
    bucket(row.day).durations.push(Number(row.duration_sec));
  }
  const out = new Map<string, DailyTelemetry>();
  for (const [day, entry] of perDay) {
    out.set(day, {
      bounceRate: bounceRate(entry.sessions),
      avgDurationSec: averageDuration(entry.durations),
    });
  }
  return out;
}

/**
 * RFC 4180 field escaping: quote a field only when it holds a comma, a quote or a
 * line break, and double any quote inside it. Everything else is written bare, so
 * the file stays readable (and Excel keeps numbers numeric).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * "scan-rush 19; ecg-rhythm 3": which games that day's board rows name, in the
 * dashboard's own order (most played first, ties alphabetical), empty when the
 * day has no board rows.
 */
export function gamesPlayedText(games: readonly { game: string; rounds: number }[]): string {
  return games.map((entry) => `${entry.game} ${String(entry.rounds)}`).join("; ");
}

/**
 * The whole file: a header row plus one row per day, oldest first, using the
 * dashboard's zero-filled daily table so every day appears even with no traffic.
 * CRLF line endings — what Excel expects — and a trailing newline.
 */
export function statsCsv(
  daily: readonly MetricsDailyRow[],
  telemetry: ReadonlyMap<string, DailyTelemetry>,
): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const row of daily) {
    const extra = telemetry.get(row.day);
    lines.push(
      [
        csvCell(row.day),
        csvCell(row.visits),
        csvCell(row.sessions),
        csvCell(row.gameStarts),
        csvCell(row.roundsPlayed),
        csvCell(row.activePlayers),
        csvCell(extra?.bounceRate ?? 0),
        csvCell(extra?.avgDurationSec ?? null),
        csvCell(gamesPlayedText(row.gamesPlayed)),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** `stats-2026-09-21.csv` — the UTC day, matching the dashboard's day bucketing. */
export function exportFilename(format: "csv" | "json", now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `stats-${day}.${format}`;
}
