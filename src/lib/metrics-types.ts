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
 *   * the leaderboard (`scores`) — rounds banked, players, games chosen. It holds
 *     every round ever banked, so it is the only source that reaches back into
 *     September. See `MetricsRoundTotals` for the one caveat.
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
   * Completed rounds the event log recorded: one `game_end` event per finished
   * round, over exactly the rows "time played" is averaged from. This is the
   * true count of individual rounds, which `completedRounds` (rounds banked)
   * cannot be: the board keeps ONE cumulative row per player, game and month, so
   * replaying the same game grows an existing row instead of adding a new one.
   * Counted from the day the event log was switched on (21 Sep), so earlier days
   * read 0 rather than a guess.
   */
  roundsPlayed: number;
}

/**
 * The numbers the leaderboard's own `scores` table answers — real play, back as
 * far as the board goes. One caveat, repeated in the UI: the board keeps ONE
 * cumulative row per player, game and month, so these counts are scoring rows
 * banked (the board's own record), not a tally of every individual round.
 */
export interface MetricsRoundTotals {
  /** Scoring rows the board banked in the window. */
  completedRounds: number;
  /** Distinct identities behind those rows (`pid` when present, else the name). */
  activePlayers: number;
  /** Submissions per game in the window, most first. */
  gamesChosen: { game: string; count: number }[];
}

export interface MetricsToday extends MetricsEventTotals, MetricsRoundTotals {
  /** UTC day the numbers cover. */
  date: string;
  /** % of today's sessions that opened a page but never started a game. */
  bounceRate: number;
}

export interface MetricsWindow extends MetricsEventTotals, MetricsRoundTotals {
  days: number;
  /** % of the window's sessions that opened a page but never started a game. */
  bounceRate: number;
  /** Mean seconds played per finished round in the window (event log only). */
  avgDuration: { game: string; rounds: number; avgSec: number }[];
}

export interface MetricsDailyRow extends MetricsEventTotals {
  day: string;
  /**
   * Rounds played that day (event log). 0 for every day before the log existed
   * (21 Sep), which is honest: nothing was counted then, not nothing happened.
   */
  roundsPlayed: number;
  /** Scoring rows the board banked that day (board history). */
  completedRounds: number;
  /** Distinct identities that banked a row that day (board history). */
  activePlayers: number;
  /**
   * WHICH games were played that day, from the board's own rows: rounds banked
   * per game, most played first, ties alphabetical. Empty on a day with no score
   * rows (so a 0-round day carries `[]`, not a missing field).
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
   * comes from the event log (visits, sessions, bounce rate, time played) only
   * exists from this date on; rounds, players and games come from the board and
   * go back further. The dashboard says both plainly.
   */
  countingSince: string | null;
  today: MetricsToday;
  last7: MetricsWindow;
  last30: MetricsWindow;
  /** Per day for the last 30 days, oldest first, gaps filled with 0. */
  daily: MetricsDailyRow[];
  board: MetricsBoardContext;
}
