import { describe, expect, test } from "bun:test";
import {
  cacheControlFor,
  IMMUTABLE_CACHE_CONTROL,
  NO_CACHE_CONTROL,
  withNoCache,
} from "./cache-control";

describe("cacheControlFor", () => {
  test("content-hashed build output under /assets/ is immutable for a year", () => {
    expect(cacheControlFor("/assets/app-xyz.css")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlFor("/assets/app-YyzddHJ_.css")).toBe(
      IMMUTABLE_CACHE_CONTROL,
    );
    expect(cacheControlFor("/assets/play._gameId-DX42Gd-r.js")).toBe(
      IMMUTABLE_CACHE_CONTROL,
    );
  });

  test("un-hashed client files must revalidate (no-cache, never immutable)", () => {
    expect(cacheControlFor("/icons/icon-scan-rush.png")).toBe("no-cache");
    expect(cacheControlFor("/manifest.json")).toBe("no-cache");
    expect(cacheControlFor("/rex.png")).toBe("no-cache");
    expect(cacheControlFor("/badges/first-round.png")).toBe("no-cache");
    expect(cacheControlFor("/favicon.ico")).toBe("no-cache");
  });

  test("HTML document routes must revalidate", () => {
    expect(cacheControlFor("/")).toBe("no-cache");
    expect(cacheControlFor("/leaderboard")).toBe("no-cache");
    expect(cacheControlFor("/admin")).toBe("no-cache");
    expect(cacheControlFor("/play/scan-rush")).toBe("no-cache");
  });

  test("API paths are left alone", () => {
    expect(cacheControlFor("/api/leaderboard")).toBeNull();
    expect(cacheControlFor("/api/admin/stats")).toBeNull();
    expect(cacheControlFor("/api/player/profile?id=abc")).toBeNull();
    expect(cacheControlFor("/api")).toBeNull();
  });

  test("immutable is never handed out for anything outside /assets/", () => {
    for (const p of ["/", "/manifest.json", "/rex.png", "/icons/a.png"]) {
      expect(cacheControlFor(p)).not.toContain("immutable");
    }
  });
});

describe("withNoCache", () => {
  test("adds no-cache, keeps status and body", async () => {
    const res = withNoCache(
      new Response("<html>hi</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(NO_CACHE_CONTROL);
    expect(res.headers.get("Content-Type")).toBe("text/html");
    expect(await res.text()).toBe("<html>hi</html>");
  });

  test("overrides a stale Cache-Control the handler set, keeps other headers", () => {
    const res = withNoCache(
      new Response("nope", {
        status: 404,
        statusText: "Not Found",
        headers: {
          "Cache-Control": "public, max-age=86400",
          "X-Custom": "kept",
        },
      }),
    );
    expect(res.status).toBe(404);
    expect(res.statusText).toBe("Not Found");
    expect(res.headers.get("Cache-Control")).toBe(NO_CACHE_CONTROL);
    expect(res.headers.get("X-Custom")).toBe("kept");
  });

  test("works for a bodyless response (HEAD / 304)", () => {
    const res = withNoCache(new Response(null, { status: 304 }));
    expect(res.status).toBe(304);
    expect(res.headers.get("Cache-Control")).toBe(NO_CACHE_CONTROL);
  });
});
