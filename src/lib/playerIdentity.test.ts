/**
 * The player id must survive the "Add to Home Screen" install boundary, so it is
 * mirrored into a cookie as well as localStorage. These tests pin the three
 * behaviours the fix depends on:
 *
 *   (a) an installed PWA (EMPTY localStorage, cookie present) still resolves an id,
 *       which is what makes boot rehydrate the profile instead of re-asking a name;
 *   (b) a genuinely new device (no localStorage, no cookie) has no id, so the name
 *       gate still appears;
 *   (c) a session that predates the cookie mirror (localStorage only) writes the
 *       cookie on boot.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  PLAYER_ID_COOKIE,
  PLAYER_ID_KEY,
  getPlayerId,
  getPlayerIdFromCookie,
  setPlayerId,
  setPlayerIdCookie,
  syncPlayerIdCookie,
} from "./playerIdentity";

const ID = "11111111-2222-3333-4444-555555555555";

// ── minimal browser stub: localStorage + a document.cookie jar ──────────────
let jar: Map<string, string>;
let rawWrites: string[];

function installBrowserEnv() {
  jar = new Map<string, string>();
  rawWrites = [];
  const store = new Map<string, string>();
  const doc = {
    get cookie() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw: string) {
      rawWrites.push(raw);
      const [pair, ...attrs] = raw.split(";").map((p) => p.trim());
      const eq = pair.indexOf("=");
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age"));
      if (maxAge && Number(maxAge.split("=")[1]) <= 0) jar.delete(key);
      else jar.set(key, value);
    },
  };
  const localStorageStub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  Object.assign(globalThis, {
    window: globalThis,
    document: doc,
    localStorage: localStorageStub,
    location: { protocol: "https:" },
  });
  return { store, doc };
}

let saved: Record<string, unknown>;
beforeEach(() => {
  saved = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    localStorage: (globalThis as any).localStorage,
    location: (globalThis as any).location,
  };
  installBrowserEnv();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete (globalThis as any)[k];
    else (globalThis as any)[k] = v;
  }
});

// ── (a) installed PWA: empty localStorage, cookie present ───────────────────
test("cookie alone (installed PWA) still resolves the player id", () => {
  jar.set(PLAYER_ID_COOKIE, ID); // survives install; localStorage is empty
  expect(getPlayerIdFromCookie()).toBe(ID);
  expect(getPlayerId()).toBe(ID); // <- boot sees this and rehydrates
});

// ── (b) genuinely new device: nothing anywhere ─────────────────────────────
test("a new device with empty storage and no cookie has no id (gate still shows)", () => {
  expect(getPlayerIdFromCookie()).toBeNull();
  expect(getPlayerId()).toBeNull();
  expect(syncPlayerIdCookie()).toBeNull();
  expect(jar.size).toBe(0);
});

// ── (c) migration: id already in localStorage ──────────────────────────────
test("an existing localStorage id is mirrored into the cookie on boot", () => {
  localStorage.setItem(PLAYER_ID_KEY, ID);
  expect(getPlayerIdFromCookie()).toBeNull();

  expect(syncPlayerIdCookie()).toBe(ID);
  expect(getPlayerIdFromCookie()).toBe(ID);
  // Idempotent: a second boot does not change the cookie.
  jar.set(PLAYER_ID_COOKIE, ID);
  expect(syncPlayerIdCookie()).toBe(ID);
  expect(getPlayerIdFromCookie()).toBe(ID);
});

// ── set / clear keep both stores in step ───────────────────────────────────
test("setPlayerId mirrors into localStorage and the cookie", () => {
  setPlayerId(ID);
  expect(localStorage.getItem(PLAYER_ID_KEY)).toBe(ID);
  expect(getPlayerIdFromCookie()).toBe(ID);

  setPlayerId(null);
  expect(localStorage.getItem(PLAYER_ID_KEY)).toBeNull();
  expect(getPlayerIdFromCookie()).toBeNull();
  expect(getPlayerId()).toBeNull();
});

test("setPlayerIdCookie is a no-op without a document (SSR / build)", () => {
  delete (globalThis as any).document;
  expect(getPlayerIdFromCookie()).toBeNull();
  expect(() => setPlayerIdCookie(ID)).not.toThrow();
  expect(() => setPlayerId(null)).not.toThrow();
});

test("the cookie is root-scoped, same-site and durable (Secure on https)", () => {
  setPlayerId(ID);
  expect(rawWrites.at(-1)).toBe(
    `${PLAYER_ID_COOKIE}=${ID}; path=/; max-age=31536000; SameSite=Lax; Secure`,
  );

  setPlayerId(ID); // http (localhost dev): no Secure, everything else the same
  (globalThis as any).location = { protocol: "http:" };
  setPlayerId(ID);
  expect(rawWrites.at(-1)).toBe(
    `${PLAYER_ID_COOKIE}=${ID}; path=/; max-age=31536000; SameSite=Lax`,
  );

  setPlayerId(null); // clearing expires it rather than leaving a stale id
  expect(rawWrites.at(-1)).toBe(
    `${PLAYER_ID_COOKIE}=; path=/; max-age=0; SameSite=Lax`,
  );
});
