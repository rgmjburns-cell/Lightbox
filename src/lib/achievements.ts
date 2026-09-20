/**
 * LightBox PLAY — Achievements System
 *
 * Defines the 10 achievement badges, persists unlock state to localStorage, and
 * provides check functions that run after each game completion.
 *
 * The badge DEFINITIONS and every THRESHOLD live in `server/achievement-core.ts`,
 * which the leaderboard server imports too: the server computes a player's
 * badges itself (so they can be restored on a new device), and it must agree
 * with the browser exactly. This file is the browser's half — reading the raw
 * inputs out of localStorage, applying the shared thresholds, and writing the
 * unlocks back.
 */

import {
  ACHIEVEMENTS,
  EMPTY_ACHIEVEMENT_STATS,
  evaluateUnlockedBadgeIds,
  type Achievement,
  type AchievementState,
  type AchievementStats,
} from "../../server/achievement-core";
import { getAccumulatedPoints, setAccumulatedPoints } from "./points";

export { ACHIEVEMENTS };
export type { Achievement, AchievementState };

// ── Storage Keys ──

const ACHIEVEMENTS_KEY = "achievements";
const GAMES_PLAYED_KEY = "gamesPlayed";
const PLAY_DAYS_KEY = "playDays";
const SCAN_SEARCH_COMPLETIONS_KEY = "scanSearchCompletions";
const SCAN_SEARCH_BEST_TIME_KEY = "scanSearchBestTime";
const MEMORY_SCAN_BEST_MOVES_KEY = "memoryScanBestMoves";
const BONE_BUSTER_LEVEL_KEY = "boneBusterLevel";
const MEMORY_SCAN_BEST_HARD_KEY = "memoryScanBestHard";

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

function getInt(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = parseInt(raw, 10);
  return isNaN(value) ? fallback : value;
}

function getScanSearchCompletions(): number {
  return getInt(SCAN_SEARCH_COMPLETIONS_KEY, 0);
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
  const best = getInt(SCAN_SEARCH_BEST_TIME_KEY, 9999);
  if (timeSeconds < best) {
    localStorage.setItem(SCAN_SEARCH_BEST_TIME_KEY, timeSeconds.toString());
  }
}

/** Call when Memory Scan game is completed. Pass the move count. */
export function trackMemoryScanCompletion(moves: number): void {
  if (typeof window === "undefined") return;

  // Track best moves (lowest is best)
  const best = getInt(MEMORY_SCAN_BEST_MOVES_KEY, 9999);
  if (moves < best) {
    localStorage.setItem(MEMORY_SCAN_BEST_MOVES_KEY, moves.toString());
  }
}

// ── The browser's view of the shared stats ──

/** Everything the shared badge thresholds need, read from this device. */
export function readAchievementStats(): AchievementStats {
  if (typeof window === "undefined") return { ...EMPTY_ACHIEVEMENT_STATS };
  return {
    gamesPlayed: [...getGamesPlayed()],
    playDays: [...getPlayDays()],
    scanSearchCompletions: getScanSearchCompletions(),
    accumulatedPoints: getAccumulatedPoints(),
    boneBusterLevel: getInt(BONE_BUSTER_LEVEL_KEY, 0),
    memoryScanHardBest: getInt(MEMORY_SCAN_BEST_HARD_KEY, 0),
    scanSearchBestTime: getInt(SCAN_SEARCH_BEST_TIME_KEY, 9999),
    memoryScanBestMoves: getInt(MEMORY_SCAN_BEST_MOVES_KEY, 9999),
  };
}

/**
 * Rehydration: merge stats that came back from the server into this device.
 *
 * Every value moves only in the direction that could unlock a badge (counts and
 * levels up, "best" times/moves down), so restoring can never take a badge away
 * from the local state — and a device that has been played on since the last
 * sync keeps its newer numbers.
 */
export function applyAchievementStats(stats: AchievementStats): void {
  if (typeof window === "undefined") return;

  const maxInt = (key: string, value: number) => {
    const next = Math.floor(value);
    if (next > getInt(key, 0)) localStorage.setItem(key, String(next));
  };
  const minInt = (key: string, value: number) => {
    const next = Math.floor(value);
    if (next < getInt(key, 9999)) localStorage.setItem(key, String(next));
  };

  maxInt(BONE_BUSTER_LEVEL_KEY, stats.boneBusterLevel);
  maxInt(MEMORY_SCAN_BEST_HARD_KEY, stats.memoryScanHardBest);
  maxInt(SCAN_SEARCH_COMPLETIONS_KEY, stats.scanSearchCompletions);
  minInt(SCAN_SEARCH_BEST_TIME_KEY, stats.scanSearchBestTime);
  minInt(MEMORY_SCAN_BEST_MOVES_KEY, stats.memoryScanBestMoves);
  setAccumulatedPoints(stats.accumulatedPoints);

  const days = getPlayDays();
  for (const day of stats.playDays) days.add(day);
  localStorage.setItem(PLAY_DAYS_KEY, JSON.stringify([...days]));

  const games = getGamesPlayed();
  for (const game of stats.gamesPlayed) games.add(game);
  localStorage.setItem(GAMES_PLAYED_KEY, JSON.stringify([...games]));
}

/** Badge ids this device has unlocked, with the moment each was earned. */
export function readUnlockedBadges(): Record<string, string> {
  const states = getAchievementStates();
  const badges: Record<string, string> = {};
  for (const [id, state] of Object.entries(states)) {
    if (state?.unlocked) badges[id] = state.unlockedAt ?? new Date().toISOString();
  }
  return badges;
}

/**
 * Rehydration: adopt the badges the server says were earned. Unlocks are
 * permanent, so this only ever ADDS badges the device does not know about yet
 * (e.g. everything earned in the browser before the app was installed to the
 * home screen), and keeps the earlier of two unlock moments.
 */
export function mergeUnlockedBadges(
  badges: { id: string; unlockedAt?: string }[],
): void {
  if (typeof window === "undefined" || badges.length === 0) return;
  const states = getAchievementStates();
  let changed = false;
  for (const badge of badges) {
    if (!ACHIEVEMENTS.some((a) => a.id === badge.id)) continue;
    const existing = states[badge.id];
    if (existing?.unlocked) {
      if (badge.unlockedAt && existing.unlockedAt && badge.unlockedAt < existing.unlockedAt) {
        states[badge.id] = { unlocked: true, unlockedAt: badge.unlockedAt };
        changed = true;
      }
      continue;
    }
    states[badge.id] = {
      unlocked: true,
      unlockedAt: badge.unlockedAt ?? new Date().toISOString(),
    };
    changed = true;
  }
  if (changed) saveAchievementStates(states);
}

// ── Check Functions ──

/**
 * Run all achievement checks against the shared thresholds. Returns any newly
 * unlocked achievements, in the order they are defined — "Level Up" last, so it
 * counts the badges unlocked in this same pass.
 */
export function checkAchievements(): Achievement[] {
  if (typeof window === "undefined") return [];

  const states = getAchievementStates();
  const now = new Date().toISOString();
  const newlyUnlocked: Achievement[] = [];

  for (const id of evaluateUnlockedBadgeIds(readAchievementStats())) {
    if (states[id]?.unlocked) continue;
    states[id] = { unlocked: true, unlockedAt: now };
    const achievement = ACHIEVEMENTS.find((a) => a.id === id);
    if (achievement) newlyUnlocked.push(achievement);
  }

  if (newlyUnlocked.length > 0) saveAchievementStates(states);

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

/**
 * Returns the most recently unlocked badge, or null if none are unlocked.
 *
 * The badge with the LATEST unlockedAt wins. If timestamps tie (e.g. several
 * badges unlocked in the same session), the badge appearing LATER in the
 * ACHIEVEMENTS array wins, so the result is deterministic.
 */
export function getLastEarnedAchievement():
  | (Achievement & AchievementState)
  | null {
  const earned = getAchievements().filter((a) => a.unlocked && a.unlockedAt);
  if (earned.length === 0) return null;

  earned.sort((a, b) => {
    const ta = new Date(a.unlockedAt!).getTime();
    const tb = new Date(b.unlockedAt!).getTime();
    if (ta !== tb) return tb - ta; // newest first
    // Tie: later entry in ACHIEVEMENTS first
    const ia = ACHIEVEMENTS.findIndex((x) => x.id === a.id);
    const ib = ACHIEVEMENTS.findIndex((x) => x.id === b.id);
    return ib - ia;
  });

  return earned[0];
}
