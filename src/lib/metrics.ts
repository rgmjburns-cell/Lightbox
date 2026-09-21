/**
 * First-party usage analytics — the client beacon.
 *
 * WHAT IT DOES: sends three tiny events to our own server (`POST /api/metrics`),
 * which appends them to the instance's own SQLite file. Nothing else changes on
 * the device and nothing else is measured:
 *
 *   visit       a page of the app was opened (home, scores, badges, add-to-phone,
 *               settings, a game page). One per page per tab.
 *   game_start  a game's page mounted — the player chose that game.
 *   game_end    a round reached its result screen, with the seconds it took.
 *
 * PRIVACY RULES (deliberate; the IT self-check claims "no analytics service / no
 * third-party disclosure", and this keeps that claim true):
 *   * NO third-party anything. One same-origin POST to our own endpoint.
 *   * NO personal data: no name, no player id, no cookie, no IP, no device or
 *     fingerprint data. What is sent is a session id, an event type, a page path,
 *     a game id and a duration.
 *   * The session id is a random UUID generated in the browser and kept in
 *     sessionStorage ONLY: per tab, and gone the moment the tab closes. It is
 *     deliberately NOT a cookie and NOT localStorage, so nothing new persists on
 *     the device and a session cannot be followed across visits.
 *   * Nothing here can affect the player: every call is fire-and-forget, ignores
 *     failures, never retries and has no UI. If the endpoint is down or blocked,
 *     the app behaves exactly as before (silently, no event).
 *   * The /admin dashboard deliberately never calls these helpers.
 *
 * Timing: `game_end`'s duration is measured in the browser from the moment the
 * round started (the game page mounted, or the previous round's result screen)
 * up to the result screen. A round that reports less than MIN_ROUND_SEC is treated
 * as junk and dropped — a real round of any of our games takes longer than that.
 */
import { useEffect } from "react";

const ENDPOINT = "/api/metrics";
const SESSION_KEY = "lightboxSessionId";
/** Below this a "round" is not a round (guards against duplicate submits). */
const MIN_ROUND_SEC = 5;

/** Page paths we instrument. /admin is intentionally absent. */
export type TrackedPage =
  | "/"
  | "/leaderboard"
  | "/achievements"
  | "/qr"
  | "/settings"
  | `/play/${string}`;

interface TrackFields {
  page?: string;
  game?: string;
  duration_sec?: number;
}

// ── Session identity (sessionStorage only) ──────────────────────────────────

let memorySession: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual path
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The tab's random session id, created on first use. Held in sessionStorage, so
 * it disappears with the tab and is never shared between tabs or devices. When
 * storage is blocked (private mode, hardened browser) we keep it in a module
 * variable instead: the tab still measures, it just loses the id if the module
 * reloads. Never throws, never returns a persistent identifier.
 */
export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  if (memorySession) return memorySession;
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      memorySession = stored;
      return stored;
    }
  } catch {
    // sessionStorage unavailable — fall back to memory below
  }
  memorySession = randomId();
  try {
    window.sessionStorage.setItem(SESSION_KEY, memorySession);
  } catch {
    // fine: memory-only session
  }
  return memorySession;
}

// ── Beacon ─────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget. Never awaited, never retried, never surfaced: a failed beacon
 * is a missing data point, not a broken game.
 */
function send(type: string, fields: TrackFields = {}): void {
  if (typeof window === "undefined") return; // SSR — nothing to measure
  const session = getSessionId();
  if (!session) return;
  const body: Record<string, unknown> = { session, type };
  if (fields.page) body.page = fields.page;
  if (fields.game) body.game = fields.game;
  if (typeof fields.duration_sec === "number") {
    body.duration_sec = Math.max(0, Math.round(fields.duration_sec));
  }
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true, // survives a navigation right after a round ends
    }).catch(() => {
      // ignored on purpose
    });
  } catch {
    // ignored on purpose
  }
}

// ── Page visits ────────────────────────────────────────────────────────────

// Pages already reported by THIS tab. Keeps the count honest for the two cases
// that would otherwise double- or re-count: React's development double-invoked
// effects, and a player bouncing home → game → home (one visit per page per tab,
// which is what "page visits" means for us).
const reportedPages = new Set<string>();

export function trackVisit(page: string): void {
  if (reportedPages.has(page)) return;
  reportedPages.add(page);
  send("visit", { page });
}

/** Report one visit for `page` when this component mounts (client-side only). */
export function useVisit(page: TrackedPage | (string & {})): void {
  useEffect(() => {
    trackVisit(page);
  }, [page]);
}

// ── Game rounds ────────────────────────────────────────────────────────────

// When each game's current round began, per tab. Keyed by game id so a player
// switching games (or a second mounted game) cannot cross wires.
const roundStartedAt = new Map<string, number>();

/** A game component mounted: the player chose this game, and a round is on. */
export function startGameRound(game: string): void {
  if (typeof window === "undefined") return;
  roundStartedAt.set(game, Date.now());
  send("game_start", { game });
}

/**
 * A round reached its result screen. Reports the seconds played and re-arms the
 * clock, so a replay ("Play Again" without a remount) is timed from this round's
 * end rather than accumulating across every round of the visit.
 */
export function endGameRound(game: string): void {
  if (typeof window === "undefined") return;
  const startedAt = roundStartedAt.get(game);
  if (startedAt === undefined) return; // no round in flight — nothing to report
  roundStartedAt.set(game, Date.now());
  const elapsedSec = (Date.now() - startedAt) / 1000;
  if (elapsedSec < MIN_ROUND_SEC) return; // duplicate/degenerate submit
  send("game_end", { game, duration_sec: elapsedSec });
}

/** Forget a live round (used when a round is abandoned or replaced). */
export function resetGameRound(game: string): void {
  roundStartedAt.delete(game);
}

/** Mount a game's page: one visit for the page, one start for the round. */
export function useGameRound(game: string | null | undefined): void {
  useEffect(() => {
    if (!game) return;
    trackVisit(`/play/${game}`);
    startGameRound(game);
    return () => resetGameRound(game);
  }, [game]);
}
