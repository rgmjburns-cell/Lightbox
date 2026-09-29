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
 * Swapping logos
 * --------------
 * `logoUrl` is a path under `public/`. All three instances currently point at
 * the shared Rad Games master mark (`public/rad-games-logo.png`, the wide RAD
 * GAMES lockup with a transparent background) because the per-brand marks have
 * not been supplied yet: the product mark is what a player sees, and the brand's
 * own name is carried by `brandName`/`tagline` copy and the title bar until its
 * artwork lands. To use a brand's own mark when it arrives: drop the file in (for
 * example `public/brands/imaging-queensland.png`) and change that one field. The
 * header and the welcome screen draw the logo on a dark background, so it must
 * read on dark. `logoAlt` is the accessible name next to it.
 *
 * Rex's cape
 * ----------
 * `rexCapeColor` is the ONE way an instance changes how Rex looks: a hex colour
 * for his cape, which is otherwise the navy baked into the master artwork
 * (`public/welcome-rex-opt.png`). Leave it unset and the artwork shows through
 * untouched (that is the neutral master). Set it and `RexCape`
 * (src/components/RexCape.tsx) paints that colour through the cape mask derived
 * from the same artwork (`public/rex-cape-mask.png`), so the cape, its folds and
 * the drop shadows follow, and nothing else on the character changes. The cape
 * colours below are PLACEHOLDERS the owner will finalise: changing one is a
 * one-line edit here, and nothing else in the codebase has to move.
 *
 * The PWA manifest (`name`, `short_name`, `theme_color`) is generated from this
 * module at build time by the `brand-manifest` plugin in `vite.config.ts`, so it
 * follows the brand automatically. Only the name follows the brand: every
 * instance ships the same `theme_color`, because the `colors` block below is one
 * unified palette (see "Browser and PWA chrome").
 *
 * Browser and PWA chrome
 * ----------------------
 * The `colors` block is IDENTICAL in all three instances (owner decision
 * 2026-09-29: no per-brand skins — the dark navy theme and every other
 * presentation choice stay the same across apps). It only colours the browser
 * and installed-app chrome (the `theme-color` meta tag in `src/routes/__root.tsx`
 * and the manifest's `theme_color`); the app UI is CSS-driven from
 * `src/styles/app.css` and is the same on every instance. Rex's cape
 * (`rexCapeColor`) is the ONE authorised per-brand visual difference.
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
  /** Path under public/ — the shared Rad Games mark until a brand mark lands. */
  logoUrl: string;
  logoAlt: string;
  /**
   * Rex's cape, as a hex colour. OPTIONAL and set by only the branded
   * instances: when it is absent the navy already in the mascot artwork is used
   * as-is (the neutral master). See "Rex's cape" above.
   */
  rexCapeColor?: string;
}

/** The game product's name, used by every brand. */
export const PRODUCT_NAME = "Rad Games";

/**
 * The cape colour already painted into `public/welcome-rex-opt.png` (the median
 * of the cape's pixels). No brand needs to name it: leaving `rexCapeColor` unset
 * shows the artwork as drawn. It exists so code and tests can talk about "the
 * default cape" without hardcoding a hex somewhere else.
 */
export const DEFAULT_REX_CAPE_COLOR = "#204670";

/**
 * The three instances, fully defined, so standing one up is one env var away.
 * `rad-games` is the neutral master (no owner network named on screen, no cape
 * override); the two pilot brands come from the owner's decisions
 * (Imaging Queensland is the confirmed QLD brand, The Xray Group the VIC one).
 * The `colors` palette and the logo are the same in all three entries (see
 * "Browser and PWA chrome"); only the cape colours differ, and they are
 * placeholders the owner will finalise.
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
    // No `rexCapeColor`: the master keeps the navy cape in the artwork.
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
    // The shared Rad Games master mark. A per-brand mark overrides this field
    // when the brand's own artwork arrives.
    logoUrl: "/rad-games-logo.png",
    logoAlt: "Imaging Queensland",
    // PLACEHOLDER cape colour (brand teal) pending the owner's final call.
    // One-line change; nothing else in the codebase moves with it.
    rexCapeColor: "#05B4C2",
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
    // The same shared Rad Games master mark; swap for the Xray Group mark when
    // that artwork arrives.
    logoUrl: "/rad-games-logo.png",
    logoAlt: "The Xray Group",
    // PLACEHOLDER cape colour (crimson) pending the owner's final call.
    rexCapeColor: "#E63946",
  },
};

/**
 * An unknown or missing id is the default brand, never a crash or a blank UI.
 * The default stays Imaging Queensland: every deployed instance names its own
 * brand explicitly through VITE_BRAND_ID, so this only covers a local or
 * misconfigured build, and it keeps the id that shipping code already assumes.
 */
export const DEFAULT_BRAND_ID: BrandId = "imaging-queensland";

/** The cape colour to paint Rex's cape, override first, baked-in navy second. */
export function rexCapeColorFor(config: BrandConfig): string {
  return config.rexCapeColor ?? DEFAULT_REX_CAPE_COLOR;
}

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
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

export default brand;
