/**
 * Rad Games (LightBox PLAY) — the ONE brand config module.
 *
 * The product ships as one codebase with one deployed instance per brand: each
 * brand gets its own name, logo, colours and URL, with identical game logic and
 * data behaviour. Every user-visible brand fact lives here, so no screen has to
 * hardcode a brand string of its own.
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
 * `logoUrl` is a path under `public/`. The brands' own logo artwork has not been
 * supplied yet, so each brand points at an existing asset as a placeholder. To
 * use the real mark: drop the file in (for example
 * `public/brands/imaging-queensland.png`) and change that one field. The header
 * and the welcome screen draw the logo on a dark background, so it must be a
 * light-on-dark mark. `logoAlt` is the accessible name next to it.
 *
 * The PWA manifest (`name`, `short_name`, `theme_color`) is generated from this
 * module at build time by the `brand-manifest` plugin in `vite.config.ts`, so it
 * follows the brand automatically.
 *
 * What is deliberately NOT here
 * -----------------------------
 * Rex the mascot and the game lineup are shared by every brand, and internal
 * identifiers (env var names, routes, table names, localStorage keys, the repo)
 * keep their LightBox names. None of them are visible to a player, and renaming
 * them would risk scores and identities that already exist.
 */

export const BRAND_IDS = ["imaging-queensland", "the-xray-group"] as const;
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
  colors: {
    /** Main brand colour. */
    primary: string;
    /** Accent colour: buttons, highlights, the second word of the wordmark. */
    secondary: string;
    /** Browser and PWA chrome colour (the `theme-color` meta tag). */
    themeColor: string;
  };
  /** Path under public/ — a placeholder until the real brand mark arrives. */
  logoUrl: string;
  logoAlt: string;
}

/** The game product's name, used by every brand. */
export const PRODUCT_NAME = "Rad Games";

/**
 * Both brands, fully defined, so a new instance is one env var away. The names
 * come from the pilot decisions (Imaging Queensland is the confirmed QLD brand);
 * the colours and logos are IDX-family placeholders the owner can correct.
 */
export const BRANDS: Record<BrandId, BrandConfig> = {
  "imaging-queensland": {
    brandId: "imaging-queensland",
    brandName: "Imaging Queensland",
    productName: PRODUCT_NAME,
    welcomeMessage: `Welcome to ${PRODUCT_NAME}! I am Rex, your friendly radiology buddy. Pick a game and have fun while you wait!`,
    tagline: "Brought to you by Imaging Queensland.",
    colors: {
      primary: "#2D2D2D", // Deep Charcoal (the app's existing palette)
      secondary: "#008C95", // Teal accent
      themeColor: "#0A1628",
    },
    logoUrl: "/welcome-idx-logo.png", // placeholder: light-on-dark corporate mark
    logoAlt: "Imaging Queensland",
  },
  "the-xray-group": {
    brandId: "the-xray-group",
    brandName: "The Xray Group",
    productName: PRODUCT_NAME,
    welcomeMessage: `Welcome to ${PRODUCT_NAME}! I am Rex, your friendly radiology buddy. Pick a game and have fun while you wait!`,
    tagline: "Brought to you by The Xray Group.",
    colors: {
      primary: "#173A5E", // Deep clinical navy (placeholder)
      secondary: "#00A3AD", // Bright teal accent (placeholder)
      themeColor: "#0B1F33",
    },
    logoUrl: "/welcome-idx-logo.png", // placeholder: swap for the Xray Group mark
    logoAlt: "The Xray Group",
  },
};

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
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

export default brand;
