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

export type LeaderboardGame = "scan-rush" | "bone-buster";
export type LeaderboardFilter = "all" | LeaderboardGame;

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

/**
 * Submit a finished game score for the stored player.
 * Returns null when no name is stored (caller shows the prompt) or on any
 * failure. On success returns the player's rank on the month's "all" board.
 */
export async function submitScore(
  game: LeaderboardGame,
  score: number
): Promise<{ rank: number } | null> {
  const name = getPlayerName();
  if (!name) return null;
  try {
    const res = await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, game, score }),
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
