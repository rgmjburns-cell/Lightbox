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
 *     so the id is mirrored into a COOKIE (which survives the install) and is
 *     the thing that brings the profile back.
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
// The id is ALSO mirrored into a cookie under the same name. localStorage is
// EMPTY in an installed PWA ("Add to Home Screen" gets its own web-app container
// on iOS and a fresh one on Android), but the origin's COOKIES survive that
// install boundary — so the cookie is what lets boot recognise the player there
// and rehydrate the profile instead of asking for a name again.
export const PLAYER_ID_COOKIE = PLAYER_ID_KEY;
const PLAYER_ID_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** True when a real `document.cookie` is available (browser, not SSR/build). */
function hasCookieStore(): boolean {
  return typeof document !== "undefined" && typeof document.cookie === "string";
}

/** The player id mirrored in the cookie, or null. */
export function getPlayerIdFromCookie(): string | null {
  if (!hasCookieStore()) return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${PLAYER_ID_COOKIE}=([^;]*)`),
  );
  if (!match) return null;
  const value = decodeURIComponent(match[1] ?? "");
  return value.length > 0 ? value : null;
}

/** Mirror the id into the cookie (or expire it, with null). */
export function setPlayerIdCookie(id: string | null): void {
  if (!hasCookieStore()) return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:"
      ? "; Secure"
      : "";
  const value = id ? encodeURIComponent(id) : "";
  const maxAge = id ? PLAYER_ID_COOKIE_MAX_AGE : 0;
  document.cookie = `${PLAYER_ID_COOKIE}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * Migration for players recognised before the cookie mirror existed: when an id
 * is already in localStorage, write it into the cookie (a no-op when the cookie
 * already matches). Called once at boot, so any session that predates this fix
 * creates the cookie on its next load and a later install restores automatically.
 * Returns the id it found, if any.
 */
export function syncPlayerIdCookie(): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(PLAYER_ID_KEY);
  if (!stored || stored.length === 0) return null;
  if (getPlayerIdFromCookie() !== stored) setPlayerIdCookie(stored);
  return stored;
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
 * The hidden player id, or null when this device has never been recognised.
 *
 * localStorage first, then the COOKIE: an installed PWA boots with empty
 * localStorage but keeps the origin's cookies, so this is what recognises the
 * player there and lets boot rehydrate the profile without a name prompt.
 */
export function getPlayerId(): string | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(PLAYER_ID_KEY);
  if (id && id.length > 0) return id;
  return getPlayerIdFromCookie();
}

/** Remember (or forget, with null) the server-issued player id. */
export function setPlayerId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(PLAYER_ID_KEY, id);
  else localStorage.removeItem(PLAYER_ID_KEY);
  setPlayerIdCookie(id);
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
