/**
 * Tests for the Terms of Use copy source and the device-side acceptance flag
 * (`src/lib/tou.ts`).
 *
 * Two things have to hold, and both are compliance-relevant:
 *
 *   (a) ACCEPTANCE IS VERSIONED. A device that accepted the terms it was shown
 *       keeps playing without being asked again, but the moment the wording is
 *       bumped the current key does not exist anywhere, so every device is asked
 *       to accept the new wording. An absent, unreadable or mismatched flag is
 *       never treated as an acceptance, because that is the failure that would
 *       bind a patient to terms they were never shown.
 *
 *   (b) THE COPY IS ONE DOCUMENT PER BRAND. All three instances serve the same
 *       wording with their own network's name interpolated, and the points the
 *       IDX IT self-check asked for (not medical advice or a medical device, what
 *       is collected, the monthly clear, no sharing, as is, changes, contact) are
 *       really in it. The tests below pin those sentences so an edit cannot
 *       quietly drop an approved point.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BRANDS, BRAND_IDS, PRODUCT_NAME, brand } from "./brand";
import {
  TOU_ACCEPTANCE_KEY_PREFIX,
  TOU_GATE_POINTS,
  TOU_UPDATED,
  TOU_VERSION,
  acceptToU,
  clearToUAcceptance,
  isToUAccepted,
  touAcceptanceKey,
  touFor,
} from "./tou";

// ── a minimal localStorage stub, in the style of playerIdentity.test.ts ─────

function localStorageStub() {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

let stub: ReturnType<typeof localStorageStub>;
let saved: Record<string, unknown>;

beforeEach(() => {
  saved = {
    window: (globalThis as any).window,
    localStorage: (globalThis as any).localStorage,
  };
  stub = localStorageStub();
  Object.assign(globalThis, { window: globalThis, localStorage: stub });
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    // defineProperty, not assignment: a test that installs a throwing getter (the
    // blocked-storage case) would otherwise make the restore itself throw.
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: v,
    });
  }
});

// ── (a) the acceptance flag ────────────────────────────────────────────────

describe("ToU acceptance store", () => {
  test("an untouched device has not accepted (the gate must show)", () => {
    expect(isToUAccepted()).toBe(false);
    expect(stub.store.size).toBe(0);
  });

  test("accepting stores the version under a version-carrying key", () => {
    acceptToU();
    expect(isToUAccepted()).toBe(true);
    // The flag is per device, versioned, and the version is what is stored.
    expect(TOU_ACCEPTANCE_KEY_PREFIX).toBe("radGamesToUAccepted");
    expect(touAcceptanceKey()).toBe(`${TOU_ACCEPTANCE_KEY_PREFIX}:v${TOU_VERSION}`);
    expect(touAcceptanceKey("2")).toBe("radGamesToUAccepted:v2");
    expect(stub.getItem(touAcceptanceKey())).toBe(TOU_VERSION);
    // One flag, not a set.
    expect(stub.store.size).toBe(1);
  });

  test("acceptance is independent of the player identity (no other key touched)", () => {
    stub.setItem("lightboxPlayerName", "Sarah");
    acceptToU();
    expect(stub.getItem("lightboxPlayerName")).toBe("Sarah");
    expect([...stub.store.keys()].sort()).toEqual(
      ["lightboxPlayerName", touAcceptanceKey()].sort(),
    );
    // Clearing the terms flag does not touch the player's own data.
    clearToUAcceptance();
    expect(stub.getItem("lightboxPlayerName")).toBe("Sarah");
  });

  test("a wording bump asks the player again, and forgets the old flag", () => {
    acceptToU("1");
    expect(isToUAccepted("1")).toBe(true);
    // New wording: the current version has never been accepted on this device.
    expect(isToUAccepted("2")).toBe(false);
    expect(stub.getItem(touAcceptanceKey("2"))).toBeNull();

    acceptToU("2");
    expect(isToUAccepted("2")).toBe(true);
    expect(isToUAccepted("1")).toBe(false);
    // Superseded versions are dropped, so there is exactly one flag.
    expect(stub.store.size).toBe(1);
    expect([...stub.store.keys()]).toEqual([touAcceptanceKey("2")]);
  });

  test("a stale or hand-edited value is not an acceptance", () => {
    stub.setItem(touAcceptanceKey(), "not-the-version");
    expect(isToUAccepted()).toBe(false);
    stub.setItem(touAcceptanceKey(), "");
    expect(isToUAccepted()).toBe(false);
  });

  test("clearToUAcceptance forgets every version at once", () => {
    acceptToU("1");
    stub.setItem(touAcceptanceKey("2"), "2"); // a flag from a parallel version
    clearToUAcceptance();
    expect(isToUAccepted("1")).toBe(false);
    expect(isToUAccepted("2")).toBe(false);
    expect(stub.store.size).toBe(0);
  });

  test("no device at all (SSR / build) means not accepted, and nothing throws", () => {
    delete (globalThis as any).window;
    expect(isToUAccepted()).toBe(false);
    expect(() => acceptToU()).not.toThrow();
    expect(() => clearToUAcceptance()).not.toThrow();
  });

  test("blocked storage reads as not accepted and never throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage blocked (private mode)");
      },
    });
    expect(isToUAccepted()).toBe(false);
    expect(() => acceptToU()).not.toThrow();
    expect(() => clearToUAcceptance()).not.toThrow();
    // A browser with storage disabled shows the gate again: the safe direction.
    expect(isToUAccepted()).toBe(false);
  });

  test("the running version is versioned, dated and stable", () => {
    expect(TOU_VERSION).toMatch(/^\d+$/);
    expect(TOU_UPDATED.length).toBeGreaterThan(0);
    expect(touAcceptanceKey().endsWith(`:v${TOU_VERSION}`)).toBe(true);
  });
});

// ── (b) the copy ───────────────────────────────────────────────────────────

/** Every string a patient can read on the page or the gate. */
function visibleCopy(id: (typeof BRAND_IDS)[number]): string[] {
  const doc = touFor(BRANDS[id]);
  return [
    doc.title,
    doc.intro,
    doc.updated,
    ...doc.sections.flatMap((s) => [s.heading, s.body]),
  ];
}

describe("Terms of Use copy", () => {
  test("it is a short, patient-readable page: a title, an intro and 8+ sections", () => {
    const doc = touFor();
    expect(doc.title).toBe("Terms of Use");
    expect(doc.intro.length).toBeGreaterThan(40);
    expect(doc.sections.length).toBeGreaterThanOrEqual(8);
    expect(doc.sections.length).toBeLessThanOrEqual(12);
    for (const section of doc.sections) {
      expect(section.heading.length).toBeGreaterThan(2);
      expect(section.heading.length).toBeLessThan(60);
      expect(section.body.length).toBeGreaterThan(40);
      // Short sections: this is read on a phone in a waiting room.
      expect(section.body.length).toBeLessThan(600);
    }
    // Plain headings, all distinct.
    expect(new Set(doc.sections.map((s) => s.heading)).size).toBe(
      doc.sections.length,
    );
  });

  test("only the network's name changes between brands", () => {
    for (const id of BRAND_IDS) {
      const network = BRANDS[id].brandName;
      const doc = touFor(BRANDS[id]);
      const all = [doc.intro, ...doc.sections.map((s) => `${s.heading} ${s.body}`)].join(" ");
      expect(all).toContain(network);
      // The network is named by the section that says who provides the service
      // and by the section that says who to ask, so both cannot fall out.
      expect(doc.sections[0]!.body).toContain(network);
      expect(doc.sections.at(-1)!.body).toContain(network);
      // And no OTHER brand's name is on the page. The neutral master's name is
      // the product's own name, so it is expected everywhere and not compared.
      for (const other of BRAND_IDS) {
        if (other === id || BRANDS[other].brandName === PRODUCT_NAME) continue;
        expect(all).not.toContain(BRANDS[other].brandName);
      }
      // The product's name is what is being used, on every instance.
      expect(all).toContain(PRODUCT_NAME);
    }
  });

  test("the same wording is shared: only the interpolated name differs", () => {
    const iq = touFor(BRANDS["imaging-queensland"]);
    const txg = touFor(BRANDS["the-xray-group"]);
    expect(iq.sections.length).toBe(txg.sections.length);
    expect(iq.sections.map((s) => s.heading)).toEqual(
      txg.sections.map((s) => s.heading),
    );
    // Swap the two network names back and the documents are identical.
    const normalise = (doc: ReturnType<typeof touFor>, name: string) =>
      JSON.stringify(doc).split(name).join("<NETWORK>");
    expect(normalise(iq, "Imaging Queensland")).toBe(
      normalise(txg, "The Xray Group"),
    );
  });

  test("it covers every point the IT self-check asked for", () => {
    const text = touFor().sections
      .map((s) => `${s.heading}: ${s.body}`)
      .join(" ")
      .toLowerCase();
    // Scope and the "not medical" disclaimer.
    expect(text).toContain("not medical advice");
    expect(text).toContain("not a medical device");
    expect(text).toContain("medical care");
    // No account, nickname, fair play, session may end.
    expect(text).toContain("do not need an account or a password");
    expect(text).toContain("nickname");
    expect(text).toContain("offensive or abusive");
    expect(text).toContain("may end a session");
    // What is collected, and what is not.
    expect(text).toContain("game scores");
    expect(text).toContain("anonymous statistics");
    expect(text).toContain("real name, phone number, email address, location or device identifiers");
    // Retention and self-service erasure.
    expect(text).toContain("cleared automatically at the start of each month");
    expect(text).toContain("badges and your personal best scores are kept");
    expect(text).toContain("clear all data");
    // No sharing.
    expect(text).toContain("do not sell your information");
    // No warranty, no value, games may change.
    expect(text).toContain("provided as is");
    expect(text).toContain("no money value");
    expect(text).toContain("retire games");
    // Changes to the terms.
    expect(text).toContain("accept the updated terms");
    // Contact.
    expect(text).toContain("member of staff");
  });

  test("no draft marker, no retired name and no em dash in what a patient reads", () => {
    for (const id of BRAND_IDS) {
      for (const value of visibleCopy(id)) {
        // The draft status belongs to the review report, never to the UI.
        expect(value).not.toMatch(/\bdraft\b/i);
        expect(value).not.toMatch(/\bTBD\b/);
        expect(value).not.toContain("LightBox");
        expect(value).not.toContain("LIGHTBOX");
        expect(value).not.toContain("\u2014"); // em dash: project copy standard
        expect(value).not.toContain("<"); // no markup sneaking into the copy
      }
    }
    for (const point of TOU_GATE_POINTS) {
      expect(point).not.toMatch(/\bdraft\b/i);
      expect(point).not.toContain("\u2014");
    }
  });

  test("the first-run gate's summary matches the page and names no brand", () => {
    expect(TOU_GATE_POINTS).toHaveLength(3);
    for (const point of TOU_GATE_POINTS) {
      expect(point.length).toBeGreaterThan(20);
      expect(point.length).toBeLessThan(160);
      for (const id of BRAND_IDS) {
        // The gate is the same on every instance: the brand is named by the
        // network copy, not by the three points.
        expect(point).not.toContain(BRANDS[id].brandName);
      }
    }
    const summary = TOU_GATE_POINTS.join(" ").toLowerCase();
    expect(summary).toContain("no account");
    expect(summary).toContain("nickname");
    expect(summary).toContain("scores");
  });

  test("the running brand's page is the default document", () => {
    expect(touFor()).toEqual(touFor(brand));
    expect(touFor().sections[0]!.body).toContain(brand.brandName);
  });
});
