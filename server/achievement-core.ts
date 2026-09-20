/**
 * LightBox PLAY — achievement TRUTH, shared by the browser and the server.
 *
 * This file lives under `server/` (and is imported by the client with a relative
 * path) for one deliberate reason: the Railway image ships `serve.ts`, `server/`
 * and `dist/` verbatim (see the Dockerfile in the deploy context), so anything the
 * server imports at runtime MUST live inside `server/`. Keeping one copy here
 * means the badge ids, names and thresholds are literally the same code on both
 * sides — the browser cannot drift from the server.
 *
 * It must stay pure: no `bun:sqlite`, no `node:*`, no `localStorage`. The client
 * imports it too, so a forbidden import would break the bundle.
 */

// ── Types ──

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Hint shown when the badge is still locked. */
  hint: string;
}

export interface AchievementState {
  unlocked: boolean;
  unlockedAt?: string; // ISO date string
}

/**
 * Every input the badge thresholds need. The client fills it from localStorage;
 * the server fills it from the player's banked rounds plus whatever the client
 * last reported. All thresholds are MONOTONIC in these values (see
 * `mergeAchievementStats`), which is what makes server-side evaluation safe.
 */
export interface AchievementStats {
  /** Game ids played at least once. */
  gamesPlayed: string[];
  /** ISO dates (YYYY-MM-DD) the player played on. */
  playDays: string[];
  /** Scan Search puzzles completed. */
  scanSearchCompletions: number;
  /** Lifetime accumulated points (points.addPoints total). */
  accumulatedPoints: number;
  /** Highest Bone Buster level reached (0-based: 7 == UI level 8). */
  boneBusterLevel: number;
  /** Best (highest) Memory Scan hard-mode score; 0 = never finished hard. */
  memoryScanHardBest: number;
  /** Fastest Scan Search clear in seconds; 9999 = never. */
  scanSearchBestTime: number;
  /** Fewest moves in a Memory Scan clear; 9999 = never. */
  memoryScanBestMoves: number;
}

export const NEVER_TIME = 9999;

export const EMPTY_ACHIEVEMENT_STATS: AchievementStats = {
  gamesPlayed: [],
  playDays: [],
  scanSearchCompletions: 0,
  accumulatedPoints: 0,
  boneBusterLevel: 0,
  memoryScanHardBest: 0,
  scanSearchBestTime: NEVER_TIME,
  memoryScanBestMoves: NEVER_TIME,
};

/** Badge thresholds — the single source of truth for both sides. */
export const ACHIEVEMENT_THRESHOLDS = {
  boneBusterLevel: 7, // "Reach Level 8" (level is 0-based)
  scanSearchCompletions: 3, // Word Wizard
  accumulatedPoints: 25000, // Waiting Time Hero
  memoryScanBestMoves: 20, // Perfect Match (strictly fewer than 20)
  scanSearchBestTime: 60, // Speed Reader (strictly under 60s)
  playDays: 5, // Rex's Best Friend
  scanExplorerGames: ["bone-buster", "scan-search", "memory-scan"],
  levelUpCount: 7, // Level Up: 7 badges other than itself
} as const;

// ── Achievement Definitions ──

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-scan",
    name: "First Scan",
    description: "Play any game for the first time",
    icon: "/badges/first-scan.png",
    hint: "Play any game to get started!",
  },
  {
    id: "bone-buster-champion",
    name: "Bone Buster Champion",
    description: "Reach Level 8 in Bone Buster",
    icon: "/badges/bone-buster-champion.png",
    hint: "Reach Level 8 in Bone Buster",
  },
  {
    id: "word-wizard",
    name: "Word Wizard",
    description: "Complete 3 word search puzzles",
    icon: "/badges/word-wizard.png",
    hint: "Complete 3 Scan Search puzzles",
  },
  {
    id: "puzzle-master",
    name: "Puzzle Master",
    description: "Complete Memory Scan on hard mode",
    icon: "/badges/puzzle-master.png",
    hint: "Complete Memory Scan on hard difficulty",
  },
  {
    id: "scan-explorer",
    name: "Scan Explorer",
    description: "Play all 3 game types",
    icon: "/badges/scan-explorer.png",
    hint: "Play Bone Buster, Scan Search, and Memory Scan",
  },
  {
    id: "waiting-time-hero",
    name: "Waiting Time Hero",
    description: "Accumulate 25,000 total points",
    icon: "/badges/waiting-time-hero.png",
    hint: "Accumulate 25,000 total points",
  },
  {
    id: "perfect-match",
    name: "Perfect Match",
    description: "Complete a Memory Scan game in under 20 moves",
    icon: "/badges/perfect-match.png",
    hint: "Finish Memory Scan in under 20 moves",
  },
  {
    id: "speed-reader",
    name: "Speed Reader",
    description: "Find all words in Scan Search in under 60 seconds",
    icon: "/badges/speed-reader.png",
    hint: "Complete Scan Search in under 60 seconds",
  },
  {
    id: "level-up",
    name: "Level Up",
    description: "Earn 7 different badges",
    icon: "/badges/level-up.png",
    hint: "Earn 7 different badges",
  },
  {
    id: "rexs-best-friend",
    name: "Rex's Best Friend",
    description: "Play on 5 different days",
    icon: "/badges/rexs-best-friend.png",
    hint: "Come back and play on 5 different days",
  },
];

export const ACHIEVEMENT_IDS: string[] = ACHIEVEMENTS.map((a) => a.id);

// ── Evaluation ──

/**
 * The badge ids whose thresholds `stats` satisfies, in ACHIEVEMENTS order.
 *
 * "Level Up" is evaluated LAST on purpose (it counts the badges unlocked above
 * it), exactly like the client used to. Every threshold is monotonic — a stat
 * only ever moves towards unlocking — so evaluating from a merged snapshot gives
 * the same answer as evaluating incrementally after every round.
 */
export function evaluateUnlockedBadgeIds(stats: AchievementStats): string[] {
  const have = new Set<string>();
  const gamesPlayed = new Set(stats.gamesPlayed);
  const t = ACHIEVEMENT_THRESHOLDS;

  if (gamesPlayed.size > 0) have.add("first-scan");
  if (stats.boneBusterLevel >= t.boneBusterLevel) have.add("bone-buster-champion");
  if (stats.scanSearchCompletions >= t.scanSearchCompletions) have.add("word-wizard");
  if (stats.memoryScanHardBest > 0) have.add("puzzle-master");
  if (t.scanExplorerGames.every((g) => gamesPlayed.has(g))) have.add("scan-explorer");
  if (stats.accumulatedPoints >= t.accumulatedPoints) have.add("waiting-time-hero");
  if (stats.memoryScanBestMoves < t.memoryScanBestMoves) have.add("perfect-match");
  if (stats.scanSearchBestTime < t.scanSearchBestTime) have.add("speed-reader");
  if (new Set(stats.playDays).size >= t.playDays) have.add("rexs-best-friend");

  // Level Up counts every OTHER badge that is unlocked — including ones already
  // earned in an earlier session and ones satisfied right here.
  const othersUnlocked = ACHIEVEMENT_IDS.filter(
    (id) => id !== "level-up" && have.has(id),
  ).length;
  if (othersUnlocked >= t.levelUpCount) have.add("level-up");

  return ACHIEVEMENT_IDS.filter((id) => have.has(id));
}

/**
 * Badges that `already` records but `stats` no longer satisfies.
 *
 * Unlocks are permanent, so this list is *informational* only: it is empty
 * whenever stats and stored unlocks agree, and the caller keeps the stored
 * unlocks either way. It exists so a test can prove the two sides agree.
 */
export function badgesNotJustifiedByStats(
  stats: AchievementStats,
  already: Record<string, AchievementState>,
): string[] {
  const justified = new Set(evaluateUnlockedBadgeIds(stats));
  return ACHIEVEMENT_IDS.filter(
    (id) => already[id]?.unlocked === true && !justified.has(id),
  );
}

// ── Merging ──

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function unionCapped(a: string[], b: string[], cap: number): string[] {
  const set = new Set<string>();
  for (const v of [...a, ...b]) set.add(v);
  const all = [...set].sort();
  return all.length > cap ? all.slice(all.length - cap) : all;
}

/**
 * Combine two snapshots of the same player's stats.
 *
 * Every rule is monotone so the merged value can only ever move towards
 * unlocking a badge — which is why merging a weaker snapshot can never take a
 * badge away. Counts/levels/points take the max, "best" times and move counts
 * take the min, sets union (capped so the server's JSON blob stays small).
 */
export function mergeAchievementStats(
  a: AchievementStats,
  b: AchievementStats,
): AchievementStats {
  return {
    gamesPlayed: unionCapped(a.gamesPlayed, b.gamesPlayed, 50),
    playDays: unionCapped(a.playDays, b.playDays, 400),
    scanSearchCompletions: Math.max(
      num(a.scanSearchCompletions, 0),
      num(b.scanSearchCompletions, 0),
    ),
    accumulatedPoints: Math.max(
      num(a.accumulatedPoints, 0),
      num(b.accumulatedPoints, 0),
    ),
    boneBusterLevel: Math.max(num(a.boneBusterLevel, 0), num(b.boneBusterLevel, 0)),
    memoryScanHardBest: Math.max(
      num(a.memoryScanHardBest, 0),
      num(b.memoryScanHardBest, 0),
    ),
    scanSearchBestTime: Math.min(
      num(a.scanSearchBestTime, NEVER_TIME),
      num(b.scanSearchBestTime, NEVER_TIME),
    ),
    memoryScanBestMoves: Math.min(
      num(a.memoryScanBestMoves, NEVER_TIME),
      num(b.memoryScanBestMoves, NEVER_TIME),
    ),
  };
}

/** Normalise untrusted JSON (a request body or a DB blob) into stats. */
export function coerceAchievementStats(value: unknown): AchievementStats {
  if (typeof value !== "object" || value === null) return { ...EMPTY_ACHIEVEMENT_STATS };
  const raw = value as Record<string, unknown>;
  return {
    gamesPlayed: strArray(raw.gamesPlayed),
    playDays: strArray(raw.playDays),
    scanSearchCompletions: Math.max(0, Math.floor(num(raw.scanSearchCompletions, 0))),
    accumulatedPoints: Math.max(0, Math.floor(num(raw.accumulatedPoints, 0))),
    boneBusterLevel: Math.max(0, Math.floor(num(raw.boneBusterLevel, 0))),
    memoryScanHardBest: Math.max(0, Math.floor(num(raw.memoryScanHardBest, 0))),
    scanSearchBestTime: Math.min(
      NEVER_TIME,
      Math.max(0, Math.floor(num(raw.scanSearchBestTime, NEVER_TIME))),
    ),
    memoryScanBestMoves: Math.min(
      NEVER_TIME,
      Math.max(0, Math.floor(num(raw.memoryScanBestMoves, NEVER_TIME))),
    ),
  };
}
