/**
 * LightBox PLAY — Points System
 *
 * Manages player points: accumulation, history, and reading total from
 * all game high scores.
 */

const TOTAL_POINTS_KEY = "totalPoints";
const POINTS_HISTORY_KEY = "pointsHistory";

// ── Game high-score keys ──

const GAME_SCORE_KEYS = [
  "boneBuster_score",
  "scanSearchHighScore",
  "memoryScanBestEasy",
  "memoryScanBestHard",
  "colourRexBest",
  "mriMixupBest_3x3",
  "mriMixupBest_4x4",
  "scanWordsHighScore",
  "spotDiffHighScore",
  "scanRushHighScore",
];

// ── Public API ──

/** Sum of all individual game high scores. */
export function getTotalPoints(): number {
  if (typeof window === "undefined") return 0;
  let sum = 0;
  for (const key of GAME_SCORE_KEYS) {
    const val = parseInt(localStorage.getItem(key) || "0", 10);
    if (!isNaN(val)) sum += val;
  }
  return sum;
}

/** Add points to the accumulated total (separate from per-game high scores). */
export function addPoints(amount: number): void {
  if (typeof window === "undefined" || amount <= 0) return;

  // Accumulated total
  const current = parseInt(localStorage.getItem(TOTAL_POINTS_KEY) || "0", 10);
  localStorage.setItem(TOTAL_POINTS_KEY, (current + amount).toString());

  // Daily history
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const history = getPointsHistory();

  const existingIdx = history.findIndex((h) => h.date === today);
  if (existingIdx >= 0) {
    history[existingIdx].points += amount;
  } else {
    history.push({ date: today, points: amount });
  }

  // Keep only last 90 days
  const trimmed = history.slice(-90);
  localStorage.setItem(POINTS_HISTORY_KEY, JSON.stringify(trimmed));
}

/** Returns daily point totals (most recent first). */
export function getPointsHistory(): { date: string; points: number }[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(POINTS_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as { date: string; points: number }[];
  } catch {
    return [];
  }
}

/** Total accumulated points (used for achievements like "Waiting Time Hero"). */
export function getAccumulatedPoints(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(TOTAL_POINTS_KEY) || "0", 10);
}
