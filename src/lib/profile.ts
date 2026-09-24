/**
 * LightBox PLAY — server-side player profile, browser half.
 *
 * Two jobs:
 *   1. SNAPSHOT — collect what this device knows about the player (per-game
 *      personal bests, the achievement inputs, the badges earned) so a score
 *      submit can mirror it on the server.
 *   2. APPLY — write a profile that came back from the server into localStorage,
 *      so an installed PWA (whose storage starts empty) is rehydrated instead of
 *      looking like a brand-new player.
 *
 * Nothing here talks to the network, and nothing here ever LOWERS a local value:
 * a device that has been played on since the last sync keeps its newer numbers.
 * The API calls themselves live in `~/lib/leaderboard`.
 */

import {
  applyAchievementStats,
  mergeUnlockedBadges,
  readAchievementStats,
  readUnlockedBadges,
} from "./achievements";
import { getGameBests, setGameBest } from "./points";
import { getPlayerName, isGuestName, setPlayerId, setPlayerName } from "./playerIdentity";
import type { AchievementStats } from "../../server/achievement-core";

/** One game's lifetime facts, derived server-side from the banked rounds. */
export interface ProfileGameTotals {
  game: string;
  best: number;
  total: number;
  rounds: number;
}

/** The durable profile the server keeps for a player id. */
export interface ServerPlayerProfile {
  playerId: string;
  name: string;
  createdAt: string;
  /** Sum of the player's per-game personal bests (the client's lifetime total). */
  lifetimeTotal: number;
  /** Personal best per storage key — written straight back into localStorage. */
  bests: Record<string, number>;
  /** Lifetime per-game bests/totals/rounds from the rounds banked on the board. */
  perGame: ProfileGameTotals[];
  stats: AchievementStats;
  badges: { id: string; unlockedAt: string }[];
  /** The current board month and this player's total in it. */
  month: string;
  monthlyTotal: number;
}

/** What a score submit sends along with the round. */
export interface ProfileSnapshot {
  bests: Record<string, number>;
  stats: AchievementStats;
  badges: Record<string, string>;
}

/**
 * The SURVIVOR half of a player's data: badge unlocks and per-game personal
 * bests, kept server-side in a table the monthly purge leaves alone. It is what
 * a device gets back in a brand-new month even though the player's name, scores
 * and profile are gone.
 *
 * There is deliberately no name in here — a name is exactly what must not come
 * back from a wipe.
 */
export interface ServerSurvivorProgress {
  badges: { id: string; unlockedAt: string }[];
  bests: Record<string, number>;
  updatedAt: string | null;
}

/** Everything this device knows, for mirroring on the server. */
export function readProfileSnapshot(): ProfileSnapshot {
  return {
    bests: getGameBests(),
    stats: readAchievementStats(),
    badges: readUnlockedBadges(),
  };
}

/**
 * Write survivor progress (badges + personal bests) into this device.
 *
 * Merges upwards only — a badge the device already knows about is never removed
 * and a best is never lowered — and touches NOTHING else: no name (the player
 * types a fresh nickname for the new month), no player id, no stats. This is the
 * path that shows a returning player their badges after the monthly purge.
 */
export function applySurvivorProgress(progress: ServerSurvivorProgress): void {
  if (typeof window === "undefined") return;
  for (const [key, value] of Object.entries(progress.bests ?? {})) {
    setGameBest(key, value);
  }
  mergeUnlockedBadges(progress.badges ?? []);
}

/**
 * Write a server profile into this device.
 *
 * The id and the name are adopted first (the fresh-install case has neither), so
 * every later request speaks for the same identity. Bests and stats merge
 * upwards only, and badges are unioned.
 */
export function applyServerProfile(profile: ServerPlayerProfile): void {
  if (typeof window === "undefined") return;

  setPlayerId(profile.playerId);
  // Never overwrite a name the player is using right now with the stored one,
  // unless there is nothing here at all (the installed-PWA case) — or this
  // device is only carrying an auto-generated guest identity.
  const current = getPlayerName();
  if (!current || isGuestName(current)) setPlayerName(profile.name);

  for (const [key, value] of Object.entries(profile.bests)) {
    setGameBest(key, value);
  }
  applyAchievementStats(profile.stats);
  mergeUnlockedBadges(profile.badges);
}
