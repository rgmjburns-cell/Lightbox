/**
 * Accessibility helper: honour the OS/browser "Reduce Motion" setting.
 *
 * The global stylesheet (src/styles/app.css) already collapses CSS
 * animations/transitions under `prefers-reduced-motion: reduce`. These
 * helpers exist for the handful of places where motion is produced by
 * JavaScript (requestAnimationFrame loops, particle spawners) and therefore
 * cannot be reached by CSS.
 *
 * Rule of thumb: gate *decorative* motion only. Anything that carries game
 * state (round countdowns, rhythm/beat timing, scoring, matching, cascades)
 * must keep running.
 */

/** True when the user asked for reduced motion. SSR-safe (false on the server). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Collapse a decorative animation duration to 0 when reduced motion is on.
 * Used to skip an intro/celebration frame sequence while still running the
 * logic that sequence would have triggered at its end.
 */
export function decorativeDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
