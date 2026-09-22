/**
 * LightBox PLAY — shared leaderboard client helper.
 *
 * Talks to the REST API served by serve.ts:
 *   GET  /api/leaderboard                 list (Top 5 + the caller's own row)
 *   POST /api/leaderboard                 submit a finished round
 *   POST /api/leaderboard/clear           admin wipe (passcode)
 *   POST /api/player/claim                resolve the identity behind a name
 *   GET  /api/player/profile?id=|name=    the durable player profile
 *   POST /api/player/delete               erase THIS player's own rows (Settings)
 * (see server/leaderboard.ts for the exact JSON contracts).
 *
 * Player identity: a real first name gets a hidden, server-issued player id
 * (see `~/lib/playerIdentity`). The id is stored locally and sent with every
 * later request, so a player is still recognised after local storage is wiped —
 * the installed-PWA ("Add to Home Screen") case — and so two people with the
 * same first name stay two separate identities on the board.
 *
 * Every function fails SILENTLY (console.warn only) so games and pages
 * never break if the API is down.
 */

import {
  PENDING_PREV_GUEST_KEY,
  ensurePlayerName,
  getPlayerId,
  getPlayerName,
  isGuestName,
  isValidPlayerName,
  setPlayerId,
} from "./playerIdentity";
import {
  applyServerProfile,
  readProfileSnapshot,
  type ServerPlayerProfile,
} from "./profile";
import { endGameRound } from "./metrics";

// Re-exported so existing imports (`from "~/lib/leaderboard"`) keep working.
export {
  ensurePlayerName,
  getPlayerId,
  getPlayerName,
  isGuestName,
  isValidPlayerName,
  setPlayerId,
  upgradePlayerName,
} from "./playerIdentity";

export type LeaderboardGame =
  | "scan-rush"
  | "bone-buster"
  | "scan-search"
  | "memory-scan"
  | "mri-mixup"
  | "ecg-rhythm"
  | "colour-rex"
  | "film-stack";
export type LeaderboardFilter = "all" | LeaderboardGame;

/** All games on the shared board: id (as submitted), display label, emoji. */
export const GAME_META: { id: LeaderboardGame; label: string; emoji: string }[] = [
  { id: "scan-rush", label: "Scan Rush", emoji: "⚡" },
  { id: "bone-buster", label: "Bone Buster", emoji: "🦴" },
  { id: "scan-search", label: "Scan Search", emoji: "🔍" },
  { id: "memory-scan", label: "Memory Scan", emoji: "🧠" },
  { id: "mri-mixup", label: "MRI Mix-Up", emoji: "🧩" },
  { id: "ecg-rhythm", label: "Pulse Pop", emoji: "❤️" },
  { id: "colour-rex", label: "Colour Rex", emoji: "🎨" },
  { id: "film-stack", label: "Film Stack", emoji: "🩻" },
];

export interface LeaderboardEntry {
  rank: number;
  name: string;
  game: LeaderboardGame;
  score: number;
  /**
   * True for the row belonging to the CALLER'S identity (the server decides this
   * from the player id, not from the displayed name — so two players called
   * "Sarah" each see exactly their own row). Undefined only for an older server.
   */
  isYou?: boolean;
}

/** The caller's own row: rank on the FULL monthly board, even outside the top 5. */
export interface LeaderboardPosition {
  rank: number;
  name: string;
  score: number;
}

export interface LeaderboardBoard {
  /** Top 5 players of the month (the server caps the list). */
  entries: LeaderboardEntry[];
  /** The stored player's own row, or null when they have no score this month. */
  you: LeaderboardPosition | null;
}

/** Result of a name entry (see `resolvePlayerName`). */
export type NameEntryResult =
  | { status: "restored"; profile: ServerPlayerProfile | null }
  | { status: "fresh"; profile: ServerPlayerProfile | null }
  | { status: "confirm"; profile: ServerPlayerProfile };

// ── Calls ──

async function postJson(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; data: Record<string, unknown> } | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("Player API failed:", path, res.status, res.statusText);
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (data.ok !== true) {
      console.warn("Player API failed:", path, data);
      return null;
    }
    return { ok: true, data };
  } catch (err) {
    console.warn("Player API error:", path, err);
    return null;
  }
}

function profileFrom(data: Record<string, unknown>): ServerPlayerProfile | null {
  const profile = data.profile;
  return typeof profile === "object" && profile !== null
    ? (profile as ServerPlayerProfile)
    : null;
}

/**
 * Claim/resolve the identity behind a first name (POST /api/player/claim).
 *
 * `restore: true` is the EXPLICIT "that's me, restore my progress" gesture used
 * by a device with empty storage; without it a name entry never inherits an
 * existing profile that happens to share the name. Returns the profile (after
 * writing it into this device) or null on failure.
 */
export async function claimPlayerName(
  name: string,
  opts: { restore?: boolean } = {},
): Promise<{
  playerId: string | null;
  name: string;
  restored: boolean;
  created: boolean;
  lost: string | null;
  profile: ServerPlayerProfile | null;
} | null> {
  const trimmed = name.trim();
  if (!isValidPlayerName(trimmed)) return null;
  const result = await postJson("/api/player/claim", {
    name: trimmed,
    playerId: getPlayerId() ?? undefined,
    restore: opts.restore === true,
    ...readProfileSnapshot(),
  });
  if (!result) return null;

  const profile = profileFrom(result.data);
  if (profile) applyServerProfile(profile);
  const playerId = typeof result.data.playerId === "string" ? result.data.playerId : null;
  if (playerId) setPlayerId(playerId);
  return {
    playerId,
    name: typeof result.data.name === "string" ? result.data.name : trimmed,
    restored: result.data.restored === true,
    created: result.data.created === true,
    lost: typeof result.data.lost === "string" ? result.data.lost : null,
    profile,
  };
}

/**
 * Read a name's existing profile WITHOUT changing anything (nothing is created
 * or adopted). Only answers when exactly one identity uses that name; an
 * ambiguous name returns null, which is what keeps two "Sarah"s apart.
 */
export async function probePlayerProfileByName(
  name: string,
): Promise<ServerPlayerProfile | null> {
  const trimmed = name.trim();
  if (!isValidPlayerName(trimmed)) return null;
  try {
    const res = await fetch(
      `/api/player/profile?name=${encodeURIComponent(trimmed)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; profile?: unknown };
    if (data.ok !== true) return null;
    return typeof data.profile === "object" && data.profile !== null
      ? (data.profile as ServerPlayerProfile)
      : null;
  } catch {
    return null;
  }
}

/**
 * Read back the profile for a player id (defaults to the stored one) and apply
 * it to this device. This is the boot-time rehydration: an installed PWA whose
 * other keys are gone still has the id, and gets its name, bests, stats and
 * badges back. Returns the profile, or null when there is nothing to restore.
 */
export async function rehydratePlayerProfile(
  playerId?: string,
): Promise<ServerPlayerProfile | null> {
  const id = playerId ?? getPlayerId();
  if (!id) return null;
  try {
    const res = await fetch(`/api/player/profile?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; profile?: unknown };
    if (data.ok !== true) return null;
    if (typeof data.profile !== "object" || data.profile === null) return null;
    const profile = data.profile as ServerPlayerProfile;
    applyServerProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

/**
 * The name-entry flow, shared by the onboarding screen and the leaderboard gate.
 *
 *   * this device already has an id → attach to it (`restored`);
 *   * otherwise ask the server whether that first name already has a profile:
 *       - a unique match → `confirm`, so the PLAYER decides. The caller renders
 *         "[name] — that's me / start fresh" and only then calls `restoreName`
 *         or `startFreshName`. Nothing is written until they choose.
 *       - no match      → a fresh identity is created (`fresh`).
 */
export async function resolvePlayerName(name: string): Promise<NameEntryResult> {
  if (getPlayerId()) {
    const claimed = await claimPlayerName(name);
    return { status: "restored", profile: claimed?.profile ?? null };
  }
  const existing = await probePlayerProfileByName(name);
  if (existing) return { status: "confirm", profile: existing };
  const claimed = await claimPlayerName(name);
  return { status: "fresh", profile: claimed?.profile ?? null };
}

/** "That's me" — adopt the profile the probe found. */
export async function restorePlayerName(
  name: string,
): Promise<ServerPlayerProfile | null> {
  const claimed = await claimPlayerName(name, { restore: true });
  return claimed?.profile ?? null;
}

/** "I'm new" — take a fresh identity instead of the one the name matched. */
export async function startFreshPlayerName(
  name: string,
): Promise<ServerPlayerProfile | null> {
  const claimed = await claimPlayerName(name);
  return claimed?.profile ?? null;
}

/**
 * Submit a finished round's score. A stored name is guaranteed: when nobody has
 * entered one, a guest identity ("Guest NNNN") is auto-created and used, so
 * every completed round lands on the board. The score ADDS to the player's
 * monthly total for that game (the board is cumulative — nothing is replaced or
 * compared), so callers must pass the score the round actually earned, once.
 * When a guest identity was upgraded to a real name since the last submit, the
 * guest name is sent as prevName so the server merges (adds) the guest's rows
 * into the real name's. The player's profile snapshot rides along, and a
 * server-issued id is stored if this device did not have one yet. Returns null on
 * any failure (silent). On success returns the player's competition rank on the
 * month's cumulative "all" board.
 *
 * This is also where a finished round is reported to the first-party usage log
 * (see `~/lib/metrics`): `endGameRound` needs no answer, cannot fail the submit
 * and is called for every completion, so it lives here rather than in each of the
 * eight games. Pass `{ roundEnd: false }` for a submit that does NOT finish a
 * round — the guest-name upgrade re-sends a round the game already reported, and
 * counting it twice would inflate the dashboard.
 */
export async function submitScore(
  game: LeaderboardGame,
  score: number,
  options: { roundEnd?: boolean } = {}
): Promise<{ rank: number } | null> {
  // Called before the network work: the round is over now, whatever the API says.
  if (options.roundEnd !== false) endGameRound(game);
  const name = ensurePlayerName();
  try {
    const body: Record<string, unknown> = {
      name,
      game,
      score,
      ...readProfileSnapshot(),
    };
    const playerId = getPlayerId();
    if (playerId) body.playerId = playerId;
    const prevName = localStorage.getItem(PENDING_PREV_GUEST_KEY);
    if (prevName && prevName !== name) {
      body.prevName = prevName;
    }
    const res = await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("Leaderboard submit failed:", res.status, res.statusText);
      return null;
    }
    const data = (await res.json()) as {
      ok: boolean;
      rank?: number;
      playerId?: string | null;
    };
    if (!data.ok) {
      console.warn("Leaderboard submit failed:", data);
      return null;
    }
    // Merge acknowledged — the guest rows now live under the real name.
    localStorage.removeItem(PENDING_PREV_GUEST_KEY);
    // First identity for this device: remember it (never for a guest name, which
    // has no identity).
    if (data.playerId && !isGuestName(name)) setPlayerId(data.playerId);
    return { rank: data.rank ?? 1 };
  } catch (err) {
    console.warn("Leaderboard submit error:", err);
    return null;
  }
}

/** What the server erased for this player: rows off the board, and its profile. */
export interface DeletePlayerDataResult {
  scores: number;
  players: number;
  profiles: number;
}
/**
 * Erase this device's own server-side data: the scores rows it put on the board,
 * its identity row and its mirrored profile (POST /api/player/delete).
 *
 * The server trusts the identity this device already holds: the id cookie the
 * client mirrors (see `~/lib/playerIdentity`) is what authorises the delete, and
 * the id/name are sent along as well so the call still works on a device whose
 * cookie is missing. A guest ("Guest NNNN") has no id, so its own name is what
 * identifies its anonymous row.
 *
 * Returns null when the call failed. The caller must then NOT wipe local storage:
 * a silent local wipe would leave the player convinced their board rows were
 * erased when they were not.
 */
export async function deletePlayerData(): Promise<DeletePlayerDataResult | null> {
  const name = getPlayerName();
  const playerId = getPlayerId();
  const result = await postJson("/api/player/delete", {
    ...(name ? { name } : {}),
    ...(playerId ? { playerId } : {}),
  });
  if (!result) return null;
  const deleted = result.data.deleted as Record<string, unknown> | undefined;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    scores: count(deleted?.scores),
    players: count(deleted?.players),
    profiles: count(deleted?.profiles),
  };
}
/**
 * Fetch this month's board. `game` filters to a single game; "all" (default) is
 * the combined board where each player's score is the SUM of every point they
 * earned that month. The server returns the top 5 — each row flagged `isYou` for
 * the caller's own identity — plus the stored player's own row as `you` (ranked
 * against the full board) when they have scored this month, even when they are
 * outside the top 5. Stored names that the API would reject are simply not sent.
 * Returns null on failure.
 */
export async function fetchLeaderboard(
  game: LeaderboardFilter = "all"
): Promise<LeaderboardBoard | null> {
  try {
    const stored = getPlayerName();
    const params = new URLSearchParams({ game });
    if (stored && isValidPlayerName(stored)) params.set("player", stored.trim());
    const playerId = getPlayerId();
    if (playerId) params.set("pid", playerId);
    const res = await fetch(`/api/leaderboard?${params.toString()}`);
    if (!res.ok) {
      console.warn("Leaderboard fetch failed:", res.status, res.statusText);
      return null;
    }
    const data = (await res.json()) as {
      ok: boolean;
      entries?: LeaderboardEntry[];
      you?: LeaderboardPosition | null;
    };
    if (!data.ok || !Array.isArray(data.entries)) return null;
    return { entries: data.entries, you: data.you ?? null };
  } catch (err) {
    console.warn("Leaderboard fetch error:", err);
    return null;
  }
}
