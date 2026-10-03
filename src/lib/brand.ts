/**
 * Rad Games (LightBox PLAY) — the ONE brand config module.
 *
 * The product ships as one codebase with one deployed instance per brand. Each
 * brand gets its own name, logo, URL and Rex cape colour, and NOTHING else: the
 * presentation of every instance is identical (the dark navy theme, layout and
 * every screen are shared, and there is deliberately no per-brand skinning — not
 * even a colour — beyond the fields below), and game logic and data behaviour
 * are identical too. Every user-visible brand fact lives here, so no screen has
 * to hardcode a brand string of its own.
 *
 * There are THREE instances (owner decision 2026-09-29):
 *   - `rad-games` — the neutral master, and the app that is live today
 *   - `imaging-queensland` — QLD pilot
 *   - `the-xray-group` — VIC pilot
 *
 * Choosing the brand
 * ------------------
 * The brand is resolved ONCE, from the environment, and never changes while the
 * app is running:
 *
 *     VITE_BRAND_ID=the-xray-group bun run build
 *
 * It is a BUILD-TIME value on purpose: Vite inlines it into both the server and
 * the client bundle, so the markup the server renders and the markup the browser
 * hydrates always agree (a runtime-only switch could not, because a built client
 * bundle cannot see the server's environment any more). Running a differently
 * branded instance therefore means building that instance with its own
 * VITE_BRAND_ID: one image per brand. Unset or unknown ids fall back to
 * DEFAULT_BRAND_ID.
 *
 * Per-brand artwork
 * -----------------
 * The owner supplied the pilot brands' artwork on 2026-09-29 and revised the
 * Imaging Queensland top-bar mark and The Xray Group's app icons on 30 Sep.
 *
 * What the mascot is CALLED
 * -------------------------
 * The owner's direction of 2 Oct 2026 renames the mascot on ONE instance: he is
 * "Stu" on Imaging Queensland and stays "Rex" on the master and The Xray Group.
 * It is a copy change, not a skin — the same artwork, theme and every other
 * presentation choice are shared (see the `colors` block below) — and it lives in
 * the `mascotName` field, which every user-facing mention of the mascot reads.
 * Internal identifiers keep their `rex` names on purpose: they are invisible to a
 * player, and the game id in particular is what existing scores hang off.
 *
 * On 1 Oct the owner re-supplied all three of the marks this app draws (links,
 * per-file dimensions, alpha and md5s: `public/_originals/README.md`). Two of
 * them — Imaging Queensland's landscape lockup and The Xray Group's — are
 * byte-identical to the artwork already installed, so nothing changed for those
 * brands. The Rad Games mark came back as a higher-resolution export of the same
 * lockup (1536x1024 with transparent padding, against the 900x420 tight crop
 * shipped on 29 Sep), and that master is what `public/rad-games-logo.png` is now
 * derived from; the superseded file is kept beside it in `public/_originals/brands/`.
 * The marks are per-brand artwork, and it is the only thing that differs visually
 * between the three instances (the `colors` block below stays unified — see
 * "Browser and PWA chrome"):
 *
 *   - `logoUrl` is the shared Rad Games master mark, and it STAYS that in all
 *     three entries: it is what the app header (`src/routes/__root.tsx`) draws on
 *     every instance (owner direction: "make sure the rad games logo that you
 *     have already in place stays like it is").
 *   - `welcomeLogoUrl` is the mark the welcome/login screen draws, and THAT is
 *     per brand: Imaging Queensland and The Xray Group show the owner's artwork
 *     (a Rad Games lockup carrying that brand's Rex), while the master keeps the
 *     shared mark. Neither header draws this one.
 *   - `rexImageUrl` is the mascot `Rex.tsx` draws everywhere in the app (games,
 *     leaderboard, onboarding), so the instance's Rex follows the brand with no
 *     per-screen work.
 *   - `homeLogoUrl` is the brand's own mark for the RIGHT-HAND slot of the app's
 *     top bar (`src/routes/__root.tsx`) — the slot that used to hold the "Hi,
 *     <nickname>" chip (owner direction, 30 Sep). It is per brand, and it is the
 *     ONE mark that is not the shared Rad Games one on the pilot instances: a
 *     pilot instance's top bar signs itself with its own logo. The neutral master
 *     deliberately keeps this field EQUAL to `logoUrl`, and that equality IS the
 *     rule the top bar reads: a brand whose own mark differs from the shared one
 *     draws it on the right, while the master's shared mark already sits on the
 *     left of the same bar, so the master keeps the greeting chip rather than
 *     showing the same mark twice. Since 1 Oct (owner direction) every instance's
 *     bar is the ORIGINAL faint glass (`bg-white/5 backdrop-blur-md`). The mark is
 *     drawn as supplied — the `rounded-2xl` corner clip this slot carried for a day
 *     (1 Oct) was removed on 2 Oct, because the owner's square-cornered The Xray
 *     Group logo looked cut off under it — so a file here has to read on that glass
 *     as its own artwork; how each one measures there is pinned in
 *     `src/lib/brand.test.ts`.
 *   - `welcomeShowsRex` is false for the two pilot brands because their welcome
 *     logos already contain Rex (owner direction: "as they have Rex in them we
 *     don't need Rex as well on the logo in page"). The master draws the shared
 *     mark and its navy Rex, exactly as it did before.
 *   - `icon192Url`/`icon512Url`/`appleTouchIconUrl` are the installed app's
 *     home-screen icons: the PWA manifest and the `apple-touch-icon` link read
 *     them (iOS ignores the manifest, so both are set per brand).
 *   - `colourGameIcon` (2 Oct 2026) and `bestFriendBadgeUrl` (3 Oct 2026) are the
 *     two pieces of GAME artwork that follow the brand: the colouring game's tile
 *     icon, and the picture of the badge named after the mascot. Every other game
 *     icon and badge is still the shared file, and the neutral master keeps the
 *     shared file for both of these too.
 *
 * Each of those is a path under `public/`, so a brand change is a config edit and
 * a file drop. The per-brand files are produced from the owner's originals by
 * `scripts/brand-artwork-assets.mjs` (its header explains the crop and scale
 * conventions); the untouched exports stay in `public/_originals/brands/`.
 * Every mark a player sees is a transparent PNG with no white fringe, because it
 * is composited straight onto whatever field its screen draws — the dark navy
 * theme on every page, and the white frosted bar for the two pilot brands' own
 * marks.
 *
 * Cache-busting the two bar marks
 * -------------------------------
 * The two marks the app's top bar draws (`logoUrl` — the shared Rad Games mark,
 * on the left of every instance — and `homeLogoUrl` — a pilot brand's own mark,
 * on the right) carry a version stamp in their url: `…?v=3` today, built from
 * `BAR_LOGO_VERSION` just below. Artwork is replaced by dropping new bytes over
 * the same file name, so without the stamp the address a device already holds
 * stays "valid" and an installed app can keep drawing the old picture after a
 * deploy: on 1 Oct the owner's own phone still showed the pre-deploy Imaging
 * Queensland mark after TWO redeploys, out of the app/webview/OS disk cache,
 * even though these files are served `cache-control: no-cache` and a normal
 * browser revalidates them. Bumping the constant is the whole procedure for the
 * next artwork change. The stamp is part of the request address only — the same
 * bytes are fetched and nothing on screen changes.
 *
 * The PWA manifest (`name`, `short_name`, `theme_color`, `icons`) is generated
 * from this module at build time by the `brand-manifest` plugin in
 * `vite.config.ts`, so it follows the brand automatically. The name, the
 * description and the icon files are per brand; `theme_color` is not, because the
 * `colors` block below is one unified palette (see "Browser and PWA chrome").
 *
 * Browser and PWA chrome
 * ----------------------
 * The `colors` block is IDENTICAL in all three instances (owner decision
 * 2026-09-29: no per-brand skins — the dark navy theme and every other
 * presentation choice stay the same across apps). It only colours the browser
 * and installed-app chrome (the `theme-color` meta tag in `src/routes/__root.tsx`
 * and the manifest's `theme_color`); the app UI is CSS-driven from
 * `src/styles/app.css` and is the same on every instance.
 *
 * What is deliberately NOT here
 * -----------------------------
 * The game lineup is shared by every brand, and internal identifiers (env var
 * names, routes, table names, localStorage keys, the repo) keep their LightBox
 * names. None of them are visible to a player, and renaming them would risk
 * scores and identities that already exist.
 */

export const BRAND_IDS = ["rad-games", "imaging-queensland", "the-xray-group"] as const;
export type BrandId = (typeof BRAND_IDS)[number];

export interface BrandConfig {
  brandId: BrandId;
  /** The radiology network this instance belongs to. */
  brandName: string;
  /** The game product. The owner renamed the product for every brand. */
  productName: string;
  /**
   * What this instance CALLS its mascot (owner direction, 2 Oct 2026): "Stu" on
   * Imaging Queensland, "Rex" on the master and The Xray Group. This is a copy
   * change, not a skin: the same artwork is drawn on every instance, and only the
   * name a player reads differs.
   *
   * Every user-facing mention of the mascot reads this field — the onboarding
   * sentence, the add-to-phone page, the mascot's accessible names, Colour Rex's
   * game title (via `colourGameTitle()` below), the in-game speech bubbles and
   * the badge named after him. Nothing a player reads hardcodes the name, so a
   * brand that calls him something else cannot drift half-way.
   *
   * Internal identifiers deliberately keep their `rex` names — the game id
   * `colour-rex`, the `colourRexBest` storage key, `/rex-colouring.png`,
   * `/rex-memory-tile.png`, `/icons/icon-colour-rex.png`, the component and file
   * names — because they are invisible to a player and renaming them would churn
   * caches and break scores that already exist.
   */
  mascotName: string;
  /**
   * The mascot's greeting on the home screen before a nickname has been set.
   * Composed from `mascotName` by `welcomeMessageFor()`, so the copy cannot name
   * the mascot differently from the artwork beside it.
   */
  welcomeMessage: string;
  /** How the brand signs itself in the footer of the welcome screen. */
  tagline: string;
  /**
   * Browser and PWA chrome colours: the app's existing charcoal/teal palette.
   * IDENTICAL for every instance (owner decision 2026-09-29: no per-brand
   * skins) — these feed the `theme-color` meta tag and the PWA manifest's
   * `theme_color`, and a per-brand value here would change nothing a player
   * sees inside the app, because the UI is CSS-driven and shared.
   */
  colors: {
    /** Main colour: the app's existing deep charcoal. */
    primary: string;
    /** Accent colour: buttons, highlights, the second word of the wordmark. */
    secondary: string;
    /** Browser and PWA chrome colour (the `theme-color` meta tag). */
    themeColor: string;
  };
  /**
   * Path under public/ for the app header's mark (`src/routes/__root.tsx`): the
   * shared Rad Games mark in all three entries (owner direction, 29 Sep). Like
   * `homeLogoUrl` it ends in the bar-logo version stamp `?v=3` — see
   * `BAR_LOGO_VERSION` below for why the address, and not just the file, is
   * versioned. The welcome screen draws `welcomeLogoUrl` instead, and the games
   * home screen its own `homeLogoUrl`.
   */
  logoUrl: string;
  /** The accessible name for the mark above (the brand's name). */
  logoAlt: string;
  /**
   * Path under public/ for the mark the welcome/login screen draws. Per brand:
   * the two pilot brands show their own artwork there, which already contains
   * Rex; the master shows the shared mark.
   */
  welcomeLogoUrl: string;
  /**
   * Path under public/ for the mascot `Rex.tsx` draws everywhere: the master's
   * navy Rex, or the pilot brand's own Rex. Swapping this one field changes Rex
   * on every screen at once.
   */
  rexImageUrl: string;
  /**
   * Path under public/ for THIS brand's own mark in the right-hand slot of the
   * app's top bar (`src/routes/__root.tsx`), where the "Hi, <nickname>" chip
   * used to sit (owner direction, 30 Sep). The top bar draws it exactly when it
   * differs from `logoUrl` above — i.e. on the two pilot instances, whose own
   * mark is not the shared Rad Games one. The master leaves it EQUAL to
   * `logoUrl` on purpose: its shared mark is already on the left of the same
   * bar, so it keeps the greeting chip instead (see the module header). Drawn on
   * the app's original faint-glass bar with no corner clip of its own — the
   * `rounded-2xl` element clip added on 1 Oct was removed on 2 Oct (the owner's
   * square-cornered The Xray Group logo looked cut off under it; see the bar's own
   * note in `src/routes/__root.tsx`) — so every file here must read on that glass
   * as its own artwork. The url ends
   * in the bar-logo version stamp `?v=3` (see `BAR_LOGO_VERSION` below).
   */
  homeLogoUrl: string;
  /**
   * Whether the welcome screen draws the mascot as well as the mark. False where
   * the welcome logo already contains Rex, so he is not shown twice.
   */
  welcomeShowsRex: boolean;
  /** The installed app's icons: the two PWA manifest sizes and iOS's touch icon. */
  icon192Url: string;
  icon512Url: string;
  appleTouchIconUrl: string;
  /**
   * Path under public/ for the COLOURING GAME's icon: the picture on its tile on
   * the games-home screen (`src/routes/index.tsx`) and in a game page's title
   * tile (`src/routes/play.$gameId.tsx`).
   *
   * The owner supplied a per-brand version of this one icon on 2 Oct 2026 (the
   * same mascot brandishing a brush and palette, drawn in each brand's own
   * colours), so it is the first GAME icon that follows the brand; every other
   * game icon is still the shared `/icons/*.png`. The master deliberately keeps
   * the shared `/icons/icon-colour-rex.png` exactly as it has always been (owner
   * direction), so the neutral instance draws precisely what it drew before.
   *
   * The two pilot urls carry a `?v=1` stamp: this is a NEW address for new
   * artwork, so no device can answer it out of a cache of the old file (see
   * `BAR_LOGO_VERSION` for why an ADDRESS, not just a file, is what reaches an
   * installed app). Bump that stamp — `?v=2`, … — the next time these two files
   * are re-supplied; the master's url is deliberately unstamped, because its
   * file has been live all along and is unchanged. Both urls are literals so the
   * exact versioned address is greppable in the built bundles, exactly like the
   * bar logos (see `BAR_LOGO_VERSION`).
   */
  colourGameIcon: string;
  /**
   * Path under public/ for the artwork of the badge named after the mascot —
   * "Rex's Best Friend" on the master and The Xray Group, "Stu's Best Friend" on
   * Imaging Queensland (`rexs-best-friend`, the badge id the owner has not asked
   * to change).
   *
   * The owner supplied a per-brand picture of that one badge on 3 Oct 2026 — the
   * mascot hugging a heart that carries the badge's own name in that brand's
   * cape colour — so it joins `colourGameIcon` as the second piece of artwork
   * that follows the brand. The badge's ID and the `{mascot}`-resolved NAME are
   * untouched: the id is what unlocks are keyed by, and both brands' pictures
   * already spell the name themselves.
   *
   * The shared definitions in `server/achievement-core.ts` stay pure and keep the
   * shared path — the deployed image runs that file verbatim from `server/`,
   * where this config is not present at all, and it never draws badge artwork —
   * so the swap happens in `src/lib/achievements.ts`, exactly where the name
   * token is resolved (see `ACHIEVEMENTS` there).
   *
   * The master deliberately keeps the shared `/badges/rexs-best-friend.png`,
   * unstamped and byte-identical, because that file has been live all along and
   * the owner did not ask for it to move. The two pilot urls carry a `?v=1`
   * stamp: these are NEW addresses for NEW artwork, so no device can answer them
   * out of a cache (see `BAR_LOGO_VERSION` for why the ADDRESS, not just the
   * file, is what reaches an installed app). Bump that stamp — `?v=2`, … — the
   * next time either file is re-supplied.
   */
  bestFriendBadgeUrl: string;
  /**
   * The app-icon picture the add-to-phone page (`src/routes/qr.tsx`) shows in
   * its final "done" card — "this is what will appear on your Home Screen".
   *
   * It is NOT any of the PWA icons above, even though a pilot brand's file is
   * derived from the same owner export: the manifest/apple-touch icons are the
   * owner's opaque square, byte for byte, because iOS paints transparency black
   * and the artwork has to be ready for the home screen itself. This one is the
   * page's picture, drawn on the app's own navy-and-white theme at 80 CSS px, so
   * it is a 512x512 PNG with the iOS corner radius (~22%) masked into the file —
   * transparent corners, nothing left to a CSS clip that a later style change
   * could drop — which is what makes it read as "an app icon" (owner ask, 3 Oct
   * 2026: "rounded, per brand, like an app icon").
   *
   * The master keeps `/icon-512.png` exactly as it is: the same file its DONE
   * card has always drawn, unstamped and byte-identical, because the owner did
   * not ask for the neutral instance to move. The two pilot urls carry a `?v=1`
   * stamp — NEW addresses for NEW artwork, so no device answers them out of a
   * cache of the square file they replace (see `BAR_LOGO_VERSION` for why the
   * ADDRESS is what reaches an installed app). Bump that stamp the next time
   * either file is re-supplied.
   */
  addToPhoneIconUrl: string;
}

/** The game product's name, used by every brand. */
export const PRODUCT_NAME = "Rad Games";

/**
 * The version stamp the url of every mark in the app's top bar ends in — the
 * shared Rad Games mark (`logoUrl`, drawn on the left of every instance) and a
 * pilot brand's own mark (`homeLogoUrl`, drawn on the right of the two pilot
 * instances): `…/home-logo.png?v=3`.
 *
 * Why the ADDRESS is versioned, not just the file. A brand's bar artwork is
 * replaced by dropping new bytes over the same file name, so the url used to stay
 * identical while the picture changed. A normal browser is fine with that — these
 * files are served `cache-control: no-cache`, so it revalidates — but an INSTALLED
 * app is not: on 1 Oct the owner's own phone kept showing the pre-deploy Imaging
 * Queensland mark through two redeploys, served out of the app/webview/OS disk
 * cache, because the address it had already fetched was never requested again. A
 * version in the address is the one thing a cached device cannot answer from
 * memory.
 *
 * Bumping it IS the whole procedure for the next artwork change: put the new file
 * in place, raise this to `"4"` (then `"5"`, …) and change the `?v=` in the urls
 * below to match — the urls are written out as literals on purpose, so the built
 * client and server bundles contain the exact versioned address a device requests
 * (a `?v=` assembled by a helper at runtime is invisible to a grep of the build).
 * `src/lib/brand.test.ts` pins this value AND every bar url against it, so a bump
 * that misses one of the two edits fails the suite by name.
 *
 * The query is cosmetic: it is part of the request address only, so the same
 * bytes are fetched under a versioned address and nothing a player sees changes.
 * (The static handler serves these paths by pathname, so the query is ignored
 * when the file is read.)
 */
export const BAR_LOGO_VERSION = "3";

/**
 * The welcome screen's greeting, composed from the mascot's name so that no brand
 * carries the sentence twice: the owner changed the mascot's name on Imaging
 * Queensland (2 Oct 2026: "Stu"), and the copy had to follow with nothing left in
 * the file that says "Rex". Every brand builds its message through here, and
 * `src/lib/brand.test.ts` pins each brand's message against its own
 * `mascotName`, so a brand entry that hardcodes a name fails the suite.
 */
export function welcomeMessageFor(mascotName: string): string {
  return `Welcome to ${PRODUCT_NAME}! I am ${mascotName}, your friendly radiology buddy. Pick a game and have fun while you wait!`;
}

/**
 * The three instances, fully defined, so standing one up is one env var away.
 * `rad-games` is the neutral master (no owner network named on screen: the
 * shared mark, the navy Rex and the product's own app icons); the two pilot
 * brands come from the owner's decisions (Imaging Queensland is the confirmed
 * QLD brand, The Xray Group the VIC one) and carry their own welcome logo, Rex
 * and home-screen icons. The `colors` palette and `logoUrl` are the same in all
 * three entries (see "Browser and PWA chrome").
 */
export const BRANDS: Record<BrandId, BrandConfig> = {
  "rad-games": {
    brandId: "rad-games",
    brandName: "Rad Games",
    productName: PRODUCT_NAME,
    // The mascot is called Rex on the master, as he always has been.
    mascotName: "Rex",
    welcomeMessage: welcomeMessageFor("Rex"),
    // The neutral master names no network: it is the product's own instance, so
    // its line stays generic rather than signing itself to a radiology group.
    tagline: "Play radiology-themed games while you wait.",
    // Unified brand palette — identical across all instances (owner decision
    // 29 Sep): this block only colours browser/PWA chrome; the app UI is
    // CSS-driven and identical everywhere.
    colors: {
      primary: "#2D2D2D", // Deep Charcoal (the app's existing palette)
      secondary: "#008C95", // Teal accent
      themeColor: "#0A1628",
    },
    // The master mark IS this brand's mark, carrying the current bar-logo version
    // (see BAR_LOGO_VERSION) so a device holding the previous supply of
    // `/rad-games-logo.png` cannot keep drawing it in the bar.
    logoUrl: "/rad-games-logo.png?v=3",
    logoAlt: "Rad Games",
    welcomeLogoUrl: "/rad-games-logo.png", // the master's own mark
    // Deliberately the SAME stamped url as `logoUrl`: the master's shared mark
    // already sits on the left of the top bar, so the bar keeps the "Hi,
    // <nickname>" chip on the right instead of drawing this mark a second time
    // (owner direction, 30 Sep). This equality is the rule `__root.tsx` reads, so
    // both fields must always carry the same version stamp.
    homeLogoUrl: "/rad-games-logo.png?v=3",
    rexImageUrl: "/welcome-rex-opt.png", // the navy Rex, unchanged
    welcomeShowsRex: true, // mark AND Rex: the look the master has always had
    icon192Url: "/icon-192.png",
    icon512Url: "/icon-512.png",
    appleTouchIconUrl: "/apple-touch-icon.png?v=3",
    // The colouring game's icon stays EXACTLY as it is (owner direction, 2 Oct
    // 2026): the master is the neutral instance and keeps drawing the shared
    // file it has always drawn, at its original unversioned address.
    colourGameIcon: "/icons/icon-colour-rex.png",
    // The badge named after the mascot keeps the SHARED artwork (owner
    // direction, 3 Oct 2026: the two pilot brands were given their own picture
    // of it, the neutral instance was not). This file has been live all along,
    // so it keeps its original unversioned address and its exact bytes.
    bestFriendBadgeUrl: "/badges/rexs-best-friend.png",
    // The add-to-phone page's picture stays the file this instance has always
    // drawn (owner direction, 3 Oct 2026: the two pilot brands were given their
    // own app icon, the neutral instance was not). Unstamped and byte-identical,
    // so nothing about the live master moves.
    addToPhoneIconUrl: "/icon-512.png",
  },
  "imaging-queensland": {
    brandId: "imaging-queensland",
    brandName: "Imaging Queensland",
    productName: PRODUCT_NAME,
    // Owner direction, 2 Oct 2026: Imaging Queensland's mascot is called Stu.
    // Config only — the artwork, the theme and every other presentation choice
    // stay identical to the other two instances (see `mascotName` above).
    mascotName: "Stu",
    welcomeMessage: welcomeMessageFor("Stu"),
    tagline: "Brought to you by Imaging Queensland.",
    // Unified brand palette — identical across all instances (owner decision
    // 29 Sep): this block only colours browser/PWA chrome; the app UI is
    // CSS-driven and identical everywhere.
    colors: {
      primary: "#2D2D2D", // Deep Charcoal (the app's existing palette)
      secondary: "#008C95", // Teal accent
      themeColor: "#0A1628",
    },
    // The shared Rad Games master mark: the header looks the same on every
    // instance (owner direction, 29 Sep) — at the current bar-logo version, so the
    // 1 Oct re-supply of `/rad-games-logo.png` reaches a device that cached the
    // previous bytes (see BAR_LOGO_VERSION).
    logoUrl: "/rad-games-logo.png?v=3",
    logoAlt: "Imaging Queensland",
    // The brand's own welcome artwork (Rad Games lockup with Imaging
    // Queensland's Rex), so this screen does not draw Rex separately.
    welcomeLogoUrl: "/brands/imaging-queensland/welcome-logo.png",
    // The brand's red lockup, for the top bar's right-hand slot. The owner has
    // now supplied it three times: a 482x144 scaled copy (30 Sep), then the
    // 583x174 landscape export itself ("put this imaging Queensland logo on
    // instead", 1 Oct) which turned out to be the OLD mark, and finally the
    // current 300x210 export (1 Oct, https://ibb.co/8gKcz7YX). The owner's file
    // is what ships here, byte for byte — md5 eb0196b6… — so the instance draws
    // their own artwork; the two retired files are archived in
    // public/_originals/brands/. This one is an opaque RGB PNG with a white
    // field (the earlier two were transparent cut-outs), so it draws as a white
    // rounded tile on the bar; those corners are the FILE's own (the artwork has
    // a rounded white field), never an element clip — the `rounded-2xl` the owner
    // asked for on 1 Oct was removed again on 2 Oct and src/routes/__root.tsx
    // carries no corner clip on this slot.
    // The url carries the current bar-logo version (see BAR_LOGO_VERSION): this
    // one file name was re-supplied three times in a single day, and the owner's
    // own phone proved that only a NEW ADDRESS — not a `no-cache` header — makes
    // an installed app fetch the replacement instead of redrawing its cached copy.
    homeLogoUrl: "/brands/imaging-queensland/home-logo.png?v=3",
    rexImageUrl: "/brands/imaging-queensland/rex.png",
    welcomeShowsRex: false, // the welcome logo already contains Rex
    icon192Url: "/brands/imaging-queensland/icon-192.png",
    icon512Url: "/brands/imaging-queensland/icon-512.png",
    appleTouchIconUrl: "/brands/imaging-queensland/icon-180.png",
    // Imaging Queensland's OWN colouring-game icon (owner artwork, 2 Oct 2026):
    // Stu with a brush and palette, red cape and the brand's red spiral badge,
    // 512x512 from a 1312x1199 export padded to square (never stretched). The
    // owner's art is what ships here, so this instance's
    // mascot wears the brand's real colours; the shared file above is untouched
    // and the master still draws it.
    colourGameIcon: "/brands/imaging-queensland/colour-game-icon.png?v=1",
    // Imaging Queensland's OWN picture of the badge named after the mascot
    // (owner artwork, 3 Oct 2026, https://ibb.co/DH9xfB0n): Stu hugging a teal
    // heart reading "Stu's Best Friend", 512x512 from a 1233x1275 export fitted
    // into the square and padded with transparent pixels (never stretched). The
    // shared file is untouched and the master still draws it; a NEW address
    // (`?v=1`) so no device answers it out of a cache of the shared picture.
    bestFriendBadgeUrl: "/brands/imaging-queensland/best-friend-badge.png?v=1",
    // Imaging Queensland's OWN app-icon picture for the add-to-phone page's DONE
    // card (owner artwork, 3 Oct 2026, https://ibb.co/k2nGMQ0y): Stu flying with
    // his red cape and the brand's red spiral behind him — the same supplied
    // export the PWA icons are made from, but scaled to 512x512 with the iOS
    // corner radius (~113 px, 22%) masked into the file, so the page's picture
    // is rounded with transparent corners without any CSS doing it. New address
    // (`?v=1`) so no device answers it out of a cache of `/icon-512.png`, which
    // this instance used to draw here; the shared file and every manifest icon
    // are untouched.
    addToPhoneIconUrl: "/brands/imaging-queensland/add-to-phone-icon.png?v=1",
  },
  "the-xray-group": {
    brandId: "the-xray-group",
    brandName: "The Xray Group",
    productName: PRODUCT_NAME,
    // The Xray Group keeps the mascot's original name (owner direction, 2 Oct).
    mascotName: "Rex",
    welcomeMessage: welcomeMessageFor("Rex"),
    tagline: "Brought to you by The Xray Group.",
    // Unified brand palette — identical across all instances (owner decision
    // 29 Sep): this block only colours browser/PWA chrome; the app UI is
    // CSS-driven and identical everywhere.
    colors: {
      primary: "#2D2D2D", // Deep Charcoal (the app's existing palette)
      secondary: "#008C95", // Teal accent
      themeColor: "#0A1628",
    },
    // The shared Rad Games master mark: the header looks the same on every
    // instance (owner direction, 29 Sep) — at the current bar-logo version, so the
    // 1 Oct re-supply of `/rad-games-logo.png` reaches a device that cached the
    // previous bytes (see BAR_LOGO_VERSION).
    logoUrl: "/rad-games-logo.png?v=3",
    logoAlt: "The Xray Group",
    // The brand's own welcome artwork (Rad Games lockup with The Xray Group's
    // Rex), so this screen does not draw Rex separately.
    welcomeLogoUrl: "/brands/the-xray-group/welcome-logo.png",
    // The brand's mark for the top bar's right-hand slot, supplied by the owner
    // (29 Sep) as a small true-transparency export used here and nowhere else,
    // and re-supplied byte-identical on 1 Oct, so the artwork is unchanged.
    // It is not the welcome logo (a Rad Games lockup carrying Rex, unreadable at
    // this size) and no longer anything on a game page: 351x118 with ink edge to
    // edge is the same wide ~3:1 wordmark shape the other brands' marks have, and
    // it draws ~107 CSS px wide at the slot's 36 CSS px height, so nothing is
    // stretched. The url carries the current bar-logo version (see
    // BAR_LOGO_VERSION), so a later re-supply of this same file name reaches a
    // device that cached the current bytes.
    homeLogoUrl: "/brands/the-xray-group/home-logo.png?v=3",
    rexImageUrl: "/brands/the-xray-group/rex.png",
    welcomeShowsRex: false, // the welcome logo already contains Rex
    icon192Url: "/brands/the-xray-group/icon-192.png",
    icon512Url: "/brands/the-xray-group/icon-512.png",
    appleTouchIconUrl: "/brands/the-xray-group/icon-180.png",
    // The Xray Group's OWN colouring-game icon (owner artwork, 2 Oct 2026): Rex
    // with a brush and palette, orange cape and the brand's orange x badge,
    // 512x512 from a 1254x1254 square export (never stretched). Like Imaging
    // Queensland's, the owner's art is what ships, so this instance's mascot
    // wears the brand's real colours.
    colourGameIcon: "/brands/the-xray-group/colour-game-icon.png?v=1",
    // The Xray Group's OWN picture of the badge named after the mascot (owner
    // artwork, 3 Oct 2026, https://ibb.co/x85WXqt0): Rex hugging a teal heart
    // reading "Rex's Best Friend", 512x512 from a 1234x1275 export fitted into
    // the square and padded with transparent pixels (never stretched). As with
    // Imaging Queensland's, the shared file is untouched, the master still draws
    // it, and the `?v=1` stamp makes this a NEW address a cache cannot answer.
    bestFriendBadgeUrl: "/brands/the-xray-group/best-friend-badge.png?v=1",
    // The Xray Group's OWN app-icon picture for the add-to-phone page's DONE
    // card (owner artwork, 3 Oct 2026, https://ibb.co/1t0J8yKk): Rex made of
    // blue tiles forming the X, orange cape and the brand's orange x badge — the
    // same supplied export the PWA icons are made from, scaled to 512x512 with
    // the iOS corner radius (~113 px, 22%) masked into the file, so it reads as
    // the icon the phone is about to install. New address (`?v=1`), shared file
    // and manifest icons untouched, exactly as for Imaging Queensland.
    addToPhoneIconUrl: "/brands/the-xray-group/add-to-phone-icon.png?v=1",
  },
};

/**
 * An unknown or missing id is the default brand, never a crash or a blank UI.
 * The default stays Imaging Queensland: every deployed instance names its own
 * brand explicitly through VITE_BRAND_ID, so this only covers a local or
 * misconfigured build, and it keeps the id that shipping code already assumes.
 */
export const DEFAULT_BRAND_ID: BrandId = "imaging-queensland";

/** True when `value` names one of the configured brands. */
export function isBrandId(value: unknown): value is BrandId {
  return (
    typeof value === "string" &&
    (BRAND_IDS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

/**
 * The brand id from the environment, or undefined when it is not set. Written as
 * a plain member access on purpose: this is the exact expression Vite replaces
 * with the value at build time. Outside a Vite bundle (`bun test`, the Vite
 * config itself) `import.meta.env` may be absent, which is not an error — the
 * caller falls back to the default brand.
 */
export function brandIdFromEnv(): string | undefined {
  try {
    const value = import.meta.env.VITE_BRAND_ID as string | undefined;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** An unknown or missing id is the default brand, never a crash or a blank UI. */
export function resolveBrandId(raw?: string | null): BrandId {
  return isBrandId(raw) ? (raw.trim().toLowerCase() as BrandId) : DEFAULT_BRAND_ID;
}

/** The config for one brand id (unknown ids resolve to the default brand). */
export function brandConfig(raw?: string | null): BrandConfig {
  return BRANDS[resolveBrandId(raw)];
}

/** The brand this build runs as. */
export const brand: BrandConfig = brandConfig(brandIdFromEnv());

/**
 * The colouring game's TITLE, which carries the mascot's name: "Colour Rex" on
 * the master and The Xray Group, "Colour Stu" on Imaging Queensland.
 *
 * Three surfaces show it — the games-home tile (`src/routes/index.tsx`), a game
 * page's title tile (`src/routes/play.$gameId.tsx`) and the shared leaderboard's
 * game label (`src/lib/leaderboard.ts`) — and every one of them reads this
 * helper, so no two of them can disagree about what the game is called.
 *
 * The game's ID stays `colour-rex`, whatever the mascot is called: the id is
 * internal (it is what scores are submitted under, so renaming it would orphan
 * everyone's history) and no player reads it. The game's ICON is the one part of
 * its presentation that is per brand since 2 Oct 2026 — the owner supplied a
 * version of it in each brand's own colours — so both surfaces draw
 * `brand.colourGameIcon`, whose master entry is still the shared
 * `/icons/icon-colour-rex.png` file, unchanged.
 */
export function colourGameTitle(config: BrandConfig = brand): string {
  return `Colour ${config.mascotName}`;
}

/**
 * The PWA manifest for a brand. `public/manifest.json` is no longer a file on
 * disk: `vite.config.ts` serves this object in dev and writes it into the build,
 * so the installed app's name follows the brand with no second place to edit.
 */
export function manifestFor(config: BrandConfig = brand): {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: string;
  orientation: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string }[];
} {
  return {
    name: config.productName,
    short_name: config.productName,
    description: `Radiology-themed games to play while you wait, from ${config.brandName}.`,
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: config.colors.primary,
    background_color: "#F5F5F5",
    // The icon FILES follow the brand (the installed app shows that brand's
    // artwork on the home screen); the manifest's chrome colour does not.
    icons: [
      { src: config.icon192Url, sizes: "192x192", type: "image/png" },
      { src: config.icon512Url, sizes: "512x512", type: "image/png" },
    ],
  };
}

export default brand;
