/**
 * Shape of the first-party usage dashboard payload (GET /api/admin/stats).
 *
 * Types only — no runtime code — so the server (`server/metrics.ts`) and the
 * dashboard page (`src/routes/admin.tsx`) stay in step without either bundling
 * the other.
 *
 * There are TWO sources, and the dashboard labels every number with the one it
 * came from, because they cover different periods:
 *
 *   * the event log (`events`, written by `src/lib/metrics.ts`) — visits,
 *     sessions, games started, bounce rate, time played and rounds played. It
 *     starts the day the analytics shipped, so it has no history before that.
 *     Rounds played is the ONE rounds figure the dashboard reports.
 *   * the leaderboard (`scores`) — players and games chosen, back as far as the
 *     board goes, so it is the only source that reaches back into September.
 */

/** The numbers our own event log can answer, from the day it was switched on. */
export interface MetricsEventTotals {
  /** Page opens logged in the window. */
  visits: number;
  /** Distinct browser sessions (tabs) that opened at least one page. */
  sessions: number;
  /** Games launched (a game's page mounted). */
  gameStarts: number;
  /**
   * The rounds metric: completed rounds the event log recorded, one `game_end`
   * event per finished round, over exactly the rows "time played" is averaged
   * from. The board cannot answer this — it keeps ONE cumulative row per player,
   * game and month, so a replay grows an existing row instead of adding one.
   * Counted from the day the event log was switched on (21 Sep), so earlier days
   * read 0 rather than a guess.
   */
  roundsPlayed: number;
}

/**
 * The numbers the leaderboard's own `scores` table answers — real play, back as
 * far as the board goes. One caveat, repeated in the UI: the board keeps ONE
 * cumulative row per player, game and month, so a player who plays the same game
 * three times in a month has one row, not three. That is why the board is not
 * asked for a rounds count anywhere: "rounds played" comes from the event log.
 */
export interface MetricsBoardTotals {
  /** Distinct identities behind those rows (`pid` when present, else the name). */
  activePlayers: number;
  /** Submissions per game in the window, most first. */
  gamesChosen: { game: string; count: number }[];
}

export interface MetricsToday extends MetricsEventTotals, MetricsBoardTotals {
  /** UTC day the numbers cover. */
  date: string;
  /** % of today's sessions that opened a page but never started a game. */
  bounceRate: number;
}

export interface MetricsWindow extends MetricsEventTotals, MetricsBoardTotals {
  days: number;
  /** % of the window's sessions that opened a page but never started a game. */
  bounceRate: number;
  /** Mean seconds played per finished round in the window (event log only). */
  avgDuration: { game: string; rounds: number; avgSec: number }[];
}

export interface MetricsDailyRow extends MetricsEventTotals {
  day: string;
  /**
   * Rounds played that day (event log): the day's rounds figure, and the only
   * one the dashboard and the CSV carry. 0 for every day before the log existed
   * (21 Sep), which is honest: nothing was counted then, not nothing happened.
   */
  roundsPlayed: number;
  /** Distinct identities that banked a row that day (board history). */
  activePlayers: number;
  /**
   * WHICH games were played that day, from the board's own rows: scoring rows
   * per game, most played first, ties alphabetical. Empty on a day with no score
   * rows (so a 0-row day carries `[]`, not a missing field).
   */
  gamesPlayed: { game: string; rounds: number }[];
}

export interface MetricsBoardContext {
  /** UTC month the board currently covers ("YYYY-MM"). */
  month: string;
  /** Distinct identities on the month's board (how the leaderboard folds rows). */
  monthlyActivePlayers: number;
  /** Board totals per game this month (the leaderboard's own numbers). */
  games: { game: string; players: number; points: number }[];
}

export interface MetricsStats {
  ok: true;
  /** Server UTC timestamp this payload was built at. */
  generatedAt: string;
  /**
   * First event we ever recorded, or null while there is none. Every number that
   * comes from the event log (visits, sessions, bounce rate, time played, rounds
   * played) only exists from this date on; players and games chosen come from the
   * board and go back further. The dashboard says both plainly.
   */
  countingSince: string | null;
  today: MetricsToday;
  last7: MetricsWindow;
  last30: MetricsWindow;
  /** Per day for the last 30 days, oldest first, gaps filled with 0. */
  daily: MetricsDailyRow[];
  board: MetricsBoardContext;
}
