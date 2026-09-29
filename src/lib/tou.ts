/**
 * Rad Games — the Terms of Use: the ONE copy source, and the device-side
 * acceptance flag.
 *
 * ── DRAFT FOR IDX LEGAL REVIEW ──────────────────────────────────────────────
 * The wording in `touFor()` below is a DRAFT written for IDX's legal review,
 * covering the points the IT self-check raised (scope, what is collected, how
 * long it is kept, no sharing, no warranty, changes, contact). It is NOT
 * lawyer-reviewed text and it must not reach a live instance until the owner and
 * lead have approved the wording. The version string in `TOU_VERSION` is what a
 * later wording change bumps: every player is then asked to accept again, so an
 * unapproved revision cannot silently bind anyone still playing.
 *
 * ── One page for all three brands ──────────────────────────────────────────
 * There is one Terms of Use for the whole product. Only `brandName` differs
 * between instances, and it is interpolated here from the brand config
 * (`src/lib/brand.ts`) rather than written out, so the radiology network named
 * on the page is always the network whose instance the player is on. Nothing
 * else in the wording is per-brand.
 *
 * ── Why acceptance is versioned and separate from the name ─────────────────
 * Acceptance is stored under a key that CONTAINS the version
 * (`radGamesToUAccepted:v1`), and the value stored is the version it accepted.
 * So a returning player with the current version skips the gate, and the moment
 * `TOU_VERSION` changes, the new key does not exist on any device and everyone
 * is asked once more. Accepting a new version also deletes superseded keys, so a
 * device keeps one flag rather than a growing set.
 *
 * It is deliberately independent of the player identity flow: the flag is per
 * device, in localStorage, and is written before (or without) any nickname
 * being entered, so the gate never depends on the leaderboard or on the server.
 * Storage that is unavailable (private mode, hardened browser) simply reads as
 * "not accepted", which shows the gate rather than silently skipping it.
 *
 * The copy deliberately avoids em dashes (the project's user-visible copy
 * standard) and contains no "Draft" marker: the draft status above is for
 * developers and the review report, never for a patient reading the page.
 */

import { PRODUCT_NAME, brand, type BrandConfig } from "./brand";

/**
 * The version of the ToU wording. Bump this whenever the copy changes in a way a
 * player should be asked about again: it is the key of the stored acceptance and
 * the value stored under it, and it is what makes the gate re-appear.
 */
export const TOU_VERSION = "1";

/** The month the wording below was last changed (shown on the page). */
export const TOU_UPDATED = "September 2026";

/**
 * Prefix of the per-device acceptance key. The full key carries the version
 * (`radGamesToUAccepted:v1`) so an old acceptance can never satisfy a new
 * version, and the key is namespaced to this product rather than the old
 * LightBox name because it is brand-independent state.
 */
export const TOU_ACCEPTANCE_KEY_PREFIX = "radGamesToUAccepted";

/** One short section of the page: a plain heading and its body copy. */
export interface TouSection {
  heading: string;
  body: string;
}

/** The whole document, ready to render (version/date kept for the page footer). */
export interface TouDocument {
  version: string;
  updated: string;
  title: string;
  intro: string;
  sections: TouSection[];
}

/**
 * The Terms of Use for one brand. Every string is plain, short and
 * patient-readable (people read this in a waiting room), with no legalese, and
 * only the network's name changes between instances.
 */
export function touFor(config: BrandConfig = brand): TouDocument {
  const network = config.brandName;
  const product = config.productName || PRODUCT_NAME;
  return {
    version: TOU_VERSION,
    updated: TOU_UPDATED,
    title: "Terms of Use",
    intro: `Below are the short terms for using ${product}. There is no account, no password and nothing to pay, and you can stop playing at any time.`,
    sections: [
      {
        heading: `What ${product} is`,
        body: `${product} is a free set of games you can play while you wait. It is provided by ${network} for your entertainment and is not part of your medical care. ${product} is not medical advice and is not a medical device. Nothing you do in the games changes your scan, your results or the treatment you receive.`,
      },
      {
        heading: "Using the service",
        body: `You do not need an account or a password. You play under a nickname you choose, and you can change it in Settings. Please play fairly, and choose a nickname that is not offensive or abusive. We may end a session that is being used to disrupt the games or spoil them for other players.`,
      },
      {
        heading: "What we collect",
        body: `We keep the nickname you choose, your game scores, and anonymous statistics about how the games are used, such as how many games were played and how long a session lasted. We use those statistics to improve the service. We do not ask for or collect your real name, phone number, email address, location or device identifiers.`,
      },
      {
        heading: "How long we keep it",
        body: `Leaderboard scores and nicknames are cleared automatically at the start of each month. Your badges and your personal best scores are kept against an anonymous internal player ID, so a returning player keeps their progress while no name or score row survives the monthly clear. You can erase everything at any time in Settings, under Clear All Data.`,
      },
      {
        heading: "Sharing your information",
        body: `We do not sell your information, and we do not share it with anyone else. The usage statistics are used only to run and improve this gaming service.`,
      },
      {
        heading: "The service is provided as is",
        body: `${product} is provided as is and may be slow, interrupted or unavailable from time to time. Scores and badges are for fun only and have no money value. We may change, pause or retire games at any time.`,
      },
      {
        heading: "Changes to these terms",
        body: `We may update these terms. When we do, you will be asked to accept the updated terms the next time you visit, and continuing to use ${product} means you accept them. The terms in force are always the ones shown on this page.`,
      },
      {
        heading: "Questions or concerns",
        body: `If you have a question about these terms, or about the information we hold, please ask a member of staff at the practice where you are waiting, or use the contact details published by ${network} on their website.`,
      },
    ],
  };
}

/**
 * The three plain points the first-run gate shows above the accept button. They
 * live here, with the rest of the wording, so the one-screen summary and the
 * full page it summarises cannot drift apart; a test pins that they stay short,
 * brand-neutral and consistent with the sections below.
 */
export const TOU_GATE_POINTS: readonly string[] = [
  "Free to play. No account, no password and nothing to pay.",
  "You play under a nickname you choose, so your real name is never needed.",
  "We keep your nickname, your scores and anonymous usage statistics so the leaderboard works.",
];

/** The key a device stores its acceptance of `version` under. */
export function touAcceptanceKey(version: string = TOU_VERSION): string {
  return `${TOU_ACCEPTANCE_KEY_PREFIX}:v${version}`;
}

/**
 * localStorage, or null when it cannot be used at all. Reading the property
 * itself can throw in a browser with storage blocked, which is why even this
 * step is guarded: a device with no usable storage shows the gate (the safe
 * direction) instead of crashing the app.
 */
function acceptanceStore(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Every acceptance key this device holds, whatever version it names. */
function storedAcceptanceKeys(store: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith(`${TOU_ACCEPTANCE_KEY_PREFIX}:`)) keys.push(key);
    }
  } catch {
    // A store that cannot be listed is treated as holding nothing.
  }
  return keys;
}

/**
 * True when THIS device has accepted THIS version of the terms. False for a
 * device that has never accepted, one that accepted an older version, and one
 * where the stored value does not match the key it sits under (a half-written or
 * hand-edited flag is not an acceptance). Also false on the server, where there
 * is no device to ask.
 */
export function isToUAccepted(version: string = TOU_VERSION): boolean {
  const store = acceptanceStore();
  if (!store) return false;
  try {
    return store.getItem(touAcceptanceKey(version)) === version;
  } catch {
    return false;
  }
}

/**
 * Record the player's acceptance of `version` on this device (first run, or
 * after a wording bump). Superseded acceptance keys are removed at the same
 * time, so a device holds exactly one flag.
 *
 * Never throws and never changes anything when storage is unavailable: the gate
 * would simply appear again, which is the direction that cannot silently bind a
 * player to terms they were not shown.
 */
export function acceptToU(version: string = TOU_VERSION): void {
  const store = acceptanceStore();
  if (!store) return;
  const keep = touAcceptanceKey(version);
  try {
    store.setItem(keep, version);
    for (const key of storedAcceptanceKeys(store)) {
      if (key !== keep) store.removeItem(key);
    }
  } catch {
    // Storage refused the write: the gate shows again next visit.
  }
}

/** Forget the device's acceptance (used by tests and by a data erase). */
export function clearToUAcceptance(): void {
  const store = acceptanceStore();
  if (!store) return;
  try {
    for (const key of storedAcceptanceKeys(store)) store.removeItem(key);
  } catch {
    // Nothing to do: a store that cannot be written holds no usable flag.
  }
}
