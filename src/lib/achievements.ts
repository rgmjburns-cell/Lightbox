/**
 * LightBox PLAY — Achievements System
 *
 * Defines 10 achievement badges, persists unlock state to localStorage,
 * and provides check functions that run after each game completion.
 */

import { getAccumulatedPoints } from "./points";

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

// ── Achievement Definitions ──

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-scan",
    name: "First Scan",
    description: "Play any game for the first time",
    icon: "🎮",
    hint: "Play any game to get started!",
  },
  {
    id: "bone-buster-champion",
    name: "Bone Buster Champion",
    description: "Reach level 3 in Bone Buster",
    icon: "🦴",
    hint: "Reach level 3 in Bone Buster",
  },
  {
    id: "word-wizard",
    name: "Word Wizard",
    description: "Complete 3 word search puzzles",
    icon: "📚",
    hint: "Complete 3 Scan Search puzzles",
  },
  {
    id: "puzzle-master",
    name: "Puzzle Master",
    description: "Complete Memory Scan on hard mode",
    icon: "🧩",
    hint: "Complete Memory Scan on hard difficulty",
  },
  {
    id: "scan-explorer",
    name: "Scan Explorer",
    description: "Play all 3 game types",
    icon: "🗺️",
    hint: "Play Bone Buster, Scan Search, and Memory Scan",
  },
  {
    id: "waiting-time-hero",
    name: "Waiting Time Hero",
    description: "Accumulate 10,000 total points",
    icon: "⏰",
    hint: "Earn 10,000 points across all games",
  },
  {
    id: "perfect-match",
    name: "Perfect Match",
    description: "Complete a Memory Scan game in under 20 moves",
    icon: "✨",
    hint: "Finish Memory Scan in under 20 moves",
  },
  {
    id: "speed-reader",
    name: "Speed Reader",
    description: "Find all words in Scan Search in under 60 seconds",
    icon: "⚡",
    hint: "Complete Scan Search in under 60 seconds",
  },
  {
    id: "level-up",
    name: "Level Up",
    description: "Reach level 5 in Bone Buster",
    icon: "⬆️",
    hint: "Reach level 5 in Bone Buster",
  },
  {
    id: "rexs-best-friend",
    name: "Rex's Best Friend",
    description: "Play on 5 different days",
    icon: "🦖",
    hint: "Come back and play on 5 different days",
  },
];

// ── Storage Keys ──

const ACHIEVEMENTS_KEY = "achievements";
const GAMES_PLAYED_KEY = "gamesPlayed";
const PLAY_DAYS_KEY = "playDays";
const SCAN_SEARCH_COMPLETIONS_KEY = "scanSearchCompletions";
const SCAN_SEARCH_BEST_TIME_KEY = "scanSearchBestTime";
const MEMORY_SCAN_BEST_MOVES_KEY = "memoryScanBestMoves";

// ── Helpers ──

function getAchievementStates(): Record<string, AchievementState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAchievementStates(states: Record<string, AchievementState>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(states));
}

function getGamesPlayed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(GAMES_PLAYED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addGamePlayed(gameId: string): void {
  if (typeof window === "undefined") return;
  const games = getGamesPlayed();
  games.add(gameId);
  localStorage.setItem(GAMES_PLAYED_KEY, JSON.stringify([...games]));
}

function getPlayDays(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PLAY_DAYS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function recordPlayDay(): void {
  if (typeof window === "undefined") return;
  const days = getPlayDays();
  const today = new Date().toISOString().slice(0, 10);
  days.add(today);
  localStorage.setItem(PLAY_DAYS_KEY, JSON.stringify([...days]));
}

function getScanSearchCompletions(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(SCAN_SEARCH_COMPLETIONS_KEY) || "0", 10);
}

// ── Trackers (called by game components) ──

/** Call after any game is completed. */
export function trackGameCompletion(gameId: string): void {
  addGamePlayed(gameId);
  recordPlayDay();
}

/** Call when Scan Search puzzle is completed. Pass the final time in seconds. */
export function trackScanSearchCompletion(timeSeconds: number): void {
  if (typeof window === "undefined") return;

  // Increment completion count
  const count = getScanSearchCompletions();
  localStorage.setItem(SCAN_SEARCH_COMPLETIONS_KEY, (count + 1).toString());

  // Track best time
  const best = parseInt(
    localStorage.getItem(SCAN_SEARCH_BEST_TIME_KEY) || "9999",
    10
  );
  if (timeSeconds < best) {
    localStorage.setItem(SCAN_SEARCH_BEST_TIME_KEY, timeSeconds.toString());
  }
}

/** Call when Memory Scan game is completed. Pass the move count. */
export function trackMemoryScanCompletion(moves: number): void {
  if (typeof window === "undefined") return;

  // Track best moves (lowest is best)
  const best = parseInt(
    localStorage.getItem(MEMORY_SCAN_BEST_MOVES_KEY) || "9999",
    10
  );
  if (moves < best) {
    localStorage.setItem(MEMORY_SCAN_BEST_MOVES_KEY, moves.toString());
  }
}

// ── Check Functions ──

function getBoneBusterLevel(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem("boneBusterLevel") || "0", 10);
}

function getMemoryScanHardBest(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem("memoryScanBestHard") || "0", 10);
}

function getScanSearchBestTime(): number {
  if (typeof window === "undefined") return 9999;
  return parseInt(localStorage.getItem(SCAN_SEARCH_BEST_TIME_KEY) || "9999", 10);
}

function getMemoryScanBestMoves(): number {
  if (typeof window === "undefined") return 9999;
  return parseInt(localStorage.getItem(MEMORY_SCAN_BEST_MOVES_KEY) || "9999", 10);
}

/** Run all achievement checks. Returns any newly unlocked achievements. */
export function checkAchievements(): Achievement[] {
  if (typeof window === "undefined") return [];

  const states = getAchievementStates();
  const newlyUnlocked: Achievement[] = [];
  const now = new Date().toISOString();

  const unlock = (id: string): boolean => {
    if (states[id]?.unlocked) return false;
    states[id] = { unlocked: true, unlockedAt: now };
    return true;
  };

  const gamesPlayed = getGamesPlayed();
  const playDays = getPlayDays();
  const scanSearchCount = getScanSearchCompletions();
  const accumulatedPoints = getAccumulatedPoints();
  const boneBusterLevel = getBoneBusterLevel();
  const memoryScanHardBest = getMemoryScanHardBest();
  const scanSearchBestTime = getScanSearchBestTime();
  const memoryScanBestMoves = getMemoryScanBestMoves();

  // First Scan — Play any game for the first time
  if (gamesPlayed.size > 0) {
    if (unlock("first-scan")) {
      newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === "first-scan")!);
    }
  }

  // Bone Buster Champion — Reach level 3 in Bone Buster
  // Level 0 = level 1 in UI, so level 2 means reached level 3
  if (boneBusterLevel >= 2) {
    if (unlock("bone-buster-champion")) {
      newlyUnlocked.push(
        ACHIEVEMENTS.find((a) => a.id === "bone-buster-champion")!
      );
    }
  }

  // Word Wizard — Complete 3 word search puzzles
  if (scanSearchCount >= 3) {
    if (unlock("word-wizard")) {
      newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === "word-wizard")!);
    }
  }

  // Puzzle Master — Complete Memory Scan on hard mode
  if (memoryScanHardBest > 0) {
    if (unlock("puzzle-master")) {
      newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === "puzzle-master")!);
    }
  }

  // Scan Explorer — Play all 3 game types
  const requiredGames = ["bone-buster", "scan-search", "memory-scan"];
  if (requiredGames.every((g) => gamesPlayed.has(g))) {
    if (unlock("scan-explorer")) {
      newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === "scan-explorer")!);
    }
  }

  // Waiting Time Hero — Accumulate 10,000 total points
  if (accumulatedPoints >= 10000) {
    if (unlock("waiting-time-hero")) {
      newlyUnlocked.push(
        ACHIEVEMENTS.find((a) => a.id === "waiting-time-hero")!
      );
    }
  }

  // Perfect Match — Complete a Memory Scan game in under 20 moves
  if (memoryScanBestMoves < 20) {
    if (unlock("perfect-match")) {
      newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === "perfect-match")!);
    }
  }

  // Speed Reader — Find all words in Scan Search in under 60 seconds
  if (scanSearchBestTime < 60) {
    if (unlock("speed-reader")) {
      newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === "speed-reader")!);
    }
  }

  // Level Up — Reach level 5 in Bone Buster
  // Level 0 = level 1, so level 4 = level 5
  if (boneBusterLevel >= 4) {
    if (unlock("level-up")) {
      newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === "level-up")!);
    }
  }

  // Rex's Best Friend — Play on 5 different days
  if (playDays.size >= 5) {
    if (unlock("rexs-best-friend")) {
      newlyUnlocked.push(
        ACHIEVEMENTS.find((a) => a.id === "rexs-best-friend")!
      );
    }
  }

  if (newlyUnlocked.length > 0) {
    saveAchievementStates(states);
  }

  return newlyUnlocked;
}

/** Returns all achievements with their current unlock state. */
export function getAchievements(): (Achievement & AchievementState)[] {
  const states = getAchievementStates();
  return ACHIEVEMENTS.map((a) => ({
    ...a,
    ...(states[a.id] || { unlocked: false }),
  }));
}
