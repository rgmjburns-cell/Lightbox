/**
 * LightBox PLAY — the player's identity in this device's local storage.
 *
 * Split out of `leaderboard.ts` so the profile modules can read the name/id
 * without importing the API client (which would be a circular import).
 *
 * Two things live here:
 *   * the DISPLAY NAME the board shows ("Sarah"), plus the legacy key the
 *     onboarding flow has always written, and
 *   * the hidden PLAYER ID the server issues for a real first name. The id is
 *     what makes the player recognisable after a device's storage is wiped —
 *     an installed PWA ("Add to Home Screen") starts with EMPTY local storage,
 *     so the id is the only thing that can bring the profile back.
 */

export const PLAYER_NAME_KEY = "lightboxPlayerName";
// Legacy key written by the onboarding flow (src/components/Onboarding.tsx) and
// Settings. Read as a fallback so patients who entered a name before this helper
// existed are still recognised; setPlayerName keeps both keys in sync.
export const LEGACY_PLAYER_NAME_KEY = "playerName";
// When a guest identity is upgraded to a real name, the guest name is parked
// here so the next submitScore can tell the server to merge the guest's rows
// into the real name's row. Cleared once the merge is acknowledged.
export const PENDING_PREV_GUEST_KEY = "lightboxPendingPrevGuest";
// Server-issued, opaque, never displayed on the board.
export const PLAYER_ID_KEY = "lightboxPlayerId";

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

/** The hidden player id, or null when this device has never been recognised. */
export function getPlayerId(): string | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(PLAYER_ID_KEY);
  return id && id.length > 0 ? id : null;
}

/** Remember (or forget, with null) the server-issued player id. */
export function setPlayerId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(PLAYER_ID_KEY, id);
  else localStorage.removeItem(PLAYER_ID_KEY);
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
 * identity, it is parked as the pending-previous name so the next submitScore
 * can POST prevName and have the server merge the guest's rows into the real
 * name's row. When the current name is already real, this is just a plain
 * rename. The player id is left alone: it belongs to the identity, not the name.
 */
export function upgradePlayerName(realName: string): void {
  const current = getPlayerName();
  if (current && isGuestName(current)) {
    localStorage.setItem(PENDING_PREV_GUEST_KEY, current);
  }
  setPlayerName(realName);
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
