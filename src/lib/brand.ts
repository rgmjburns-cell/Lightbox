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
 * The owner supplied the pilot brands' artwork on 2026-09-29, and it is the only
 * thing that differs visually between the three instances (the `colors` block
 * below stays unified — see "Browser and PWA chrome"):
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
 *   - `tileLogoUrl` is the small mark on a game page's white title tile (owner
 *     request, 29 Sep): the two pilot brands point at their own tile artwork,
 *     the master at the shared Rad Games mark. The tile is white, so these must
 *     read on white — the pilot brands' are coloured lockups, and they are
 *     produced with their white background keyed out to transparency.
 *   - `homeLogoUrl` is the mark on the games home header (`src/routes/index.tsx`),
 *     in the empty space opposite the player's name (owner request, 29 Sep). It
 *     is per brand, and it is the ONE mark that is not the shared Rad Games one
 *     on the pilot instances: the home screen greets the brand's own patient, so
 *     it carries that brand's mark. This screen is dark navy, so every file here
 *     must read on navy.
 *   - `welcomeShowsRex` is false for the two pilot brands because their welcome
 *     logos already contain Rex (owner direction: "as they have Rex in them we
 *     don't need Rex as well on the logo in page"). The master draws the shared
 *     mark and its navy Rex, exactly as it did before.
 *   - `icon192Url`/`icon512Url`/`appleTouchIconUrl` are the installed app's
 *     home-screen icons: the PWA manifest and the `apple-touch-icon` link read
 *     them (iOS ignores the manifest, so both are set per brand).
 *
 * Each of those is a path under `public/`, so a brand change is a config edit and
 * a file drop. The per-brand files are produced from the owner's originals by
 * `scripts/brand-artwork-assets.mjs` (its header explains the crop and scale
 * conventions); the untouched exports stay in `public/_originals/brands/`.
 * Every mark a player sees is drawn on the app's dark navy background, so each
 * one must read on dark: they are transparent PNGs with no white fringe.
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
  /** Rex's greeting on the home screen before a nickname has been set. */
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
   * shared Rad Games mark in all three entries (owner direction, 29 Sep). The
   * welcome screen draws `welcomeLogoUrl` instead, and the games home screen its
   * own `homeLogoUrl`.
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
   * Path under public/ for the small mark on a game page's white title tile
   * (`src/routes/play.$gameId.tsx`), right-aligned beside the game name. Every
   * brand carries one: the two pilot brands use the owner's own tile artwork (a
   * wide, coloured lockup that reads on the white tile), and the master keeps
   * the shared Rad Games mark so it is not the only blank tile.
   */
  tileLogoUrl: string;
  /**
   * Path under public/ for the mark on the games home header
   * (`src/routes/index.tsx`), right-aligned opposite the player's name. Per
   * brand, and the one place a pilot instance does NOT show the shared Rad Games
   * mark: that header greets this brand's own player, so it draws this brand's
   * own mark (owner request, 29 Sep). Drawn on the app's dark navy background,
   * so it must read on navy.
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
}

/** The game product's name, used by every brand. */
export const PRODUCT_NAME = "Rad Games";

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
    welcomeMessage: `Welcome to ${PRODUCT_NAME}! I am Rex, your friendly radiology buddy. Pick a game and have fun while you wait!`,
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
    logoUrl: "/rad-games-logo.png", // the master mark IS this brand's mark
    logoAlt: "Rad Games",
    welcomeLogoUrl: "/rad-games-logo.png", // the master's own mark
    tileLogoUrl: "/rad-games-logo.png", // the shared mark: the master has no other
    // Same mark again: on the master instance the shared mark IS the brand's
    // mark, and it is drawn on the same dark navy it was designed for.
    homeLogoUrl: "/rad-games-logo.png",
    rexImageUrl: "/welcome-rex-opt.png", // the navy Rex, unchanged
    welcomeShowsRex: true, // mark AND Rex: the look the master has always had
    icon192Url: "/icon-192.png",
    icon512Url: "/icon-512.png",
    appleTouchIconUrl: "/apple-touch-icon.png?v=3",
  },
  "imaging-queensland": {
    brandId: "imaging-queensland",
    brandName: "Imaging Queensland",
    productName: PRODUCT_NAME,
    welcomeMessage: `Welcome to ${PRODUCT_NAME}! I am Rex, your friendly radiology buddy. Pick a game and have fun while you wait!`,
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
    // instance (owner direction, 29 Sep).
    logoUrl: "/rad-games-logo.png",
    logoAlt: "Imaging Queensland",
    // The brand's own welcome artwork (Rad Games lockup with Imaging
    // Queensland's Rex), so this screen does not draw Rex separately.
    welcomeLogoUrl: "/brands/imaging-queensland/welcome-logo.png",
    // The owner's tile mark for this brand (a red Sunshine Coast Radiology
    // lockup), sized for a game page's title tile.
    tileLogoUrl: "/brands/imaging-queensland/tile-logo.png",
    // The brand's mark for the home header, supplied as a true-transparency
    // export by the owner (29 Sep) and only used here: the welcome screen keeps
    // the lockup above, which carries this brand's Rex.
    homeLogoUrl: "/brands/imaging-queensland/home-logo.png",
    rexImageUrl: "/brands/imaging-queensland/rex.png",
    welcomeShowsRex: false, // the welcome logo already contains Rex
    icon192Url: "/brands/imaging-queensland/icon-192.png",
    icon512Url: "/brands/imaging-queensland/icon-512.png",
    appleTouchIconUrl: "/brands/imaging-queensland/icon-180.png",
  },
  "the-xray-group": {
    brandId: "the-xray-group",
    brandName: "The Xray Group",
    productName: PRODUCT_NAME,
    welcomeMessage: `Welcome to ${PRODUCT_NAME}! I am Rex, your friendly radiology buddy. Pick a game and have fun while you wait!`,
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
    // instance (owner direction, 29 Sep).
    logoUrl: "/rad-games-logo.png",
    logoAlt: "The Xray Group",
    // The brand's own welcome artwork (Rad Games lockup with The Xray Group's
    // Rex), so this screen does not draw Rex separately.
    welcomeLogoUrl: "/brands/the-xray-group/welcome-logo.png",
    // The owner's tile mark for this brand (the x-ray group lockup), sized for a
    // game page's title tile.
    tileLogoUrl: "/brands/the-xray-group/tile-logo.png",
    // The home header draws this brand's tile lockup rather than its welcome
    // artwork: the welcome logo is a Rad Games lockup carrying Rex (busy and
    // unreadable at 40 CSS px), while this one is the brand's own wordmark in the
    // same wide ~3:1 shape the other two brands' header marks have.
    homeLogoUrl: "/brands/the-xray-group/tile-logo.png",
    rexImageUrl: "/brands/the-xray-group/rex.png",
    welcomeShowsRex: false, // the welcome logo already contains Rex
    icon192Url: "/brands/the-xray-group/icon-192.png",
    icon512Url: "/brands/the-xray-group/icon-512.png",
    appleTouchIconUrl: "/brands/the-xray-group/icon-180.png",
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
