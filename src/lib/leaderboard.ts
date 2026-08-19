/**
 * LightBox PLAY — shared leaderboard client helper.
 *
 * Talks to the REST API served by serve.ts at /api/leaderboard
 * (GET list, POST submit, POST /api/leaderboard/clear — see
 * server/leaderboard.ts for the exact JSON contract).
 *
 * Every function fails SILENTLY (console.warn only) so games and pages
 * never break if the API is down.
 */

const PLAYER_NAME_KEY = "lightboxPlayerName";
// Legacy key written by the onboarding flow (src/components/Onboarding.tsx)
// and Settings. Read as a fallback so patients who entered a name before
// this helper existed are still recognised; setPlayerName keeps both keys
// in sync.
const LEGACY_PLAYER_NAME_KEY = "playerName";
// When a guest identity is upgraded to a real name, the guest name is parked
// here so the next submitScore can tell the server to merge the guest's rows
// into the real name's row. Cleared once the merge is acknowledged.
const PENDING_PREV_GUEST_KEY = "lightboxPendingPrevGuest";

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
}

/** Stored player name, or null when nobody has entered one yet. */
export function getPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(PLAYER_NAME_KEY) ??
    localStorage.getItem(LEGACY_PLAYER_NAME_KEY)
  );
}

/** Persist the player name (also mirrored to the legacy onboarding key). */
export function setPlayerName(name: string): void {
  localStorage.setItem(PLAYER_NAME_KEY, name);
  localStorage.setItem(LEGACY_PLAYER_NAME_KEY, name);
}

/** True when the name is an auto-generated guest identity ("Guest NNNN"). */
export function isGuestName(name: string): boolean {
  return /^Guest \d{4}$/.test(name);
}

/**
 * Guarantee a stored player name, auto-creating a guest identity
 * ("Guest NNNN", e.g. "Guest 4823") when nobody has entered a real name.
 * Returns the name. Every completed round therefore has a name to submit
 * under, even for fully anonymous play.
 */
export function ensurePlayerName(): string {
  const existing = getPlayerName();
  if (existing) return existing;
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  const guest = `Guest ${digits}`;
  setPlayerName(guest);
  return guest;
}

/**
 * Replace the stored name with a real one. When the current name is a guest
 * identity, it is parked as the pending-previous name so the next
 * submitScore can POST prevName and have the server merge the guest's rows
 * into the real name's row. When the current name is already real, this is
 * just a plain rename.
 */
export function upgradePlayerName(realName: string): void {
  const current = getPlayerName();
  if (current && isGuestName(current)) {
    localStorage.setItem(PENDING_PREV_GUEST_KEY, current);
  }
  setPlayerName(realName);
}

/**
 * Submit a finished game score. A stored name is guaranteed: when nobody has
 * entered one, a guest identity ("Guest NNNN") is auto-created and used, so
 * every completed round lands on the board. When a guest identity was
 * upgraded to a real name since the last submit, the guest name is sent as
 * prevName so the server merges the guest's rows into the real name's.
 * Returns null on any failure (silent). On success returns the player's rank
 * on the month's "all" board.
 */
export async function submitScore(
  game: LeaderboardGame,
  score: number
): Promise<{ rank: number } | null> {
  const name = ensurePlayerName();
  try {
    const body: Record<string, unknown> = { name, game, score };
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
    const data = (await res.json()) as { ok: boolean; rank?: number };
    if (!data.ok) {
      console.warn("Leaderboard submit failed:", data);
      return null;
    }
    // Merge acknowledged — the guest rows now live under the real name.
    localStorage.removeItem(PENDING_PREV_GUEST_KEY);
    return { rank: data.rank ?? 1 };
  } catch (err) {
    console.warn("Leaderboard submit error:", err);
    return null;
  }
}

/**
 * Fetch this month's board. `game` filters to a single game; "all" (default)
 * returns each player's best score across games. Returns null on failure.
 */
export async function fetchLeaderboard(
  game: LeaderboardFilter = "all"
): Promise<{ entries: LeaderboardEntry[] } | null> {
  try {
    const res = await fetch(
      `/api/leaderboard?game=${encodeURIComponent(game)}`
    );
    if (!res.ok) {
      console.warn("Leaderboard fetch failed:", res.status, res.statusText);
      return null;
    }
    const data = (await res.json()) as {
      ok: boolean;
      entries?: LeaderboardEntry[];
    };
    if (!data.ok || !Array.isArray(data.entries)) return null;
    return { entries: data.entries };
  } catch (err) {
    console.warn("Leaderboard fetch error:", err);
    return null;
  }
}

/** Validate a first name against the API's rules (1–20 chars, safe charset). */
export function isValidPlayerName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= 1 &&
    trimmed.length <= 20 &&
    /^[A-Za-z0-9 .'-]+$/.test(trimmed)
  );
}
