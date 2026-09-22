// Cache-Control policy for the production server (serve.ts).
//
// Why this exists: the browser bug where the owner sometimes saw a white page
// with unstyled, oversized text until a refresh. No cache headers were sent
// anywhere, so a browser could keep an old copy of the HTML shell. After a
// deploy the CSS/JS filenames change (they are content-hashed), so that stale
// HTML points at /assets/app-<oldhash>.css, which no longer exists -> unstyled
// first paint. A refresh pulled fresh HTML and everything looked normal again.
//
// The rules:
//   /assets/*   -> immutable, one year. Vite content-hashes these filenames
//                  (app-YyzddHJ_.css), so a file at a given URL never changes.
//   everything else served by us -> `no-cache` (revalidate every time). This
//                  covers the SSR'd HTML documents and the un-hashed static
//                  files in dist/client (icons, badges, manifest.json,
//                  welcome-*.png, rex.png, ...). Their URLs are stable, so they
//                  must never be trusted blindly.
//   /api/*      -> null: leave untouched. The leaderboard and metrics handlers
//                  set their own semantics (and their own headers).
//
// This module is deliberately dependency-free and never imports serve.ts
// (which binds a port on import), so it can be unit-tested directly.

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const NO_CACHE_CONTROL = "no-cache";

/**
 * The Cache-Control value to send for `pathname`, or null to set nothing.
 *
 * Pure and side-effect free so tests can import it without starting a server.
 */
export function cacheControlFor(pathname: string): string | null {
  // API responses manage their own caching (none of them should be cached).
  if (pathname === "/api" || pathname.startsWith("/api/")) return null;
  // Content-hashed build output: safe to cache forever.
  if (pathname.startsWith("/assets/")) return IMMUTABLE_CACHE_CONTROL;
  // HTML documents and every un-hashed asset: always revalidate.
  return NO_CACHE_CONTROL;
}

/**
 * Return `res` with `Cache-Control: no-cache` merged into its headers,
 * preserving status, status text, body and any other header the handler set.
 * Used for the SSR fallthrough so the HTML shell can never be served stale.
 */
export function withNoCache(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", NO_CACHE_CONTROL);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
