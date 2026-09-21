/**
 * Shape of the first-party usage dashboard payload (GET /api/admin/stats).
 *
 * Types only — no runtime code — so the server (`server/metrics.ts`) and the
 * dashboard page (`src/routes/admin.tsx`) stay in step without either bundling
 * the other. The numbers come from our own `events` table (page visits, game
 * starts and finished rounds, written by `src/lib/metrics.ts`) plus the
 * leaderboard's `scores` table for context.
 */

export interface MetricsTotals {
  /** Page opens logged in the window. */
  visits: number;
  /** Distinct browser sessions (tabs) that opened at least one page. */
  sessions: number;
  /** Games launched (a game's page mounted). */
  gameStarts: number;
  /** Rounds that reached a result screen, with a measured duration. */
  completedRounds: number;
}

export interface MetricsToday extends MetricsTotals {
  /** UTC day the numbers cover. */
  date: string;
  /** % of today's sessions that opened a page but never started a game. */
  bounceRate: number;
  /**
   * Distinct names that banked a round today — the people actually playing
   * (read from `scores`, so it counts finishers only).
   */
  activePlayers: number;
}

export interface MetricsWindow extends MetricsTotals {
  days: number;
  /** % of the window's sessions that opened a page but never started a game. */
  bounceRate: number;
  /** Games launched in the window, most chosen first. */
  gamesChosen: { game: string; count: number }[];
  /** Mean seconds played per finished round in the window. */
  avgDuration: { game: string; rounds: number; avgSec: number }[];
}

export interface MetricsDailyRow extends MetricsTotals {
  day: string;
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
   * First event we ever recorded, or null while there is none. The dashboard
   * says so plainly: nothing before this date exists.
   */
  countingSince: string | null;
  today: MetricsToday;
  last7: MetricsWindow;
  last30: MetricsWindow;
  /** Visits per day for the last 30 days, oldest first, gaps filled with 0. */
  daily: MetricsDailyRow[];
  board: MetricsBoardContext;
}
