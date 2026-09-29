/**
 * Unit tests for the brand config module (`src/lib/brand.ts`).
 *
 * The point of these tests is that a per-brand instance cannot drift: all three
 * brands are fully defined, an unknown or missing id always resolves to the
 * default brand instead of a blank UI, and every user-visible string a brand
 * carries is the renamed product rather than the old "LightBox" name.
 *
 * Presentation is deliberately NOT per-brand (owner decision 2026-09-29: no
 * per-brand skins), so the `colors` block is pinned as one unified palette that
 * all three entries must share — it only colours browser/PWA chrome, and the app
 * UI is identical everywhere.
 *
 * Rex's cape is the one thing a brand may change about how the app looks, so it
 * is pinned here too: the two pilot brands carry a cape colour, the neutral
 * master does not, and the cape mask the colour is painted through really is a
 * cape (the mascot's face is not in it) and really does line up with the artwork
 * it overlays.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  BRANDS,
  BRAND_IDS,
  DEFAULT_BRAND_ID,
  DEFAULT_REX_CAPE_COLOR,
  PRODUCT_NAME,
  brand,
  brandConfig,
  brandIdFromEnv,
  isBrandId,
  manifestFor,
  resolveBrandId,
  rexCapeColorFor,
} from "./brand";
import {
  REX_ART_URL,
  REX_CAPE_COLOR_VAR,
  REX_CAPE_MASK_URL,
  rexCapeStyle,
} from "../components/RexCape";

/** Every string a player can see from a brand config. */
function visibleStrings(id: (typeof BRAND_IDS)[number]): string[] {
  const config = BRANDS[id];
  return [
    config.brandName,
    config.productName,
    config.tagline,
    config.welcomeMessage,
    config.logoAlt,
    config.logoUrl,
  ];
}

/** A path under public/ for a brand asset url. */
const publicFile = (url: string) =>
  fileURLToPath(new URL(`../../public/${url.replace(/^\//, "")}`, import.meta.url));

describe("brand config", () => {
  test("all three brands are fully defined", () => {
    expect(BRAND_IDS).toHaveLength(3);
    for (const id of BRAND_IDS) {
      const config = BRANDS[id];
      expect(config.brandId).toBe(id);
      expect(config.brandName.length).toBeGreaterThan(0);
      expect(config.productName).toBe(PRODUCT_NAME);
      expect(config.welcomeMessage).toContain(PRODUCT_NAME);
      expect(config.tagline.length).toBeGreaterThan(0);
      expect(config.colors.primary).toMatch(/^#[0-9A-F]{6}$/i);
      expect(config.colors.secondary).toMatch(/^#[0-9A-F]{6}$/i);
      expect(config.colors.themeColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(config.logoUrl.startsWith("/")).toBe(true);
      expect(config.logoAlt).toBe(config.brandName);
    }
  });

  test("the three instances are the master plus the two pilot brands", () => {
    expect(BRAND_IDS).toEqual(["rad-games", "imaging-queensland", "the-xray-group"]);
    expect(BRANDS["rad-games"].brandName).toBe("Rad Games");
    expect(BRANDS["imaging-queensland"].brandName).toBe("Imaging Queensland");
    expect(BRANDS["the-xray-group"].brandName).toBe("The Xray Group");
    // The neutral master names no radiology network: it is the product's own
    // instance, so it must not sign itself to one of the pilot brands.
    const masterTagline = BRANDS["rad-games"].tagline;
    for (const id of ["imaging-queensland", "the-xray-group"] as const) {
      expect(BRANDS[id].tagline).toContain(BRANDS[id].brandName);
      expect(masterTagline).not.toContain(BRANDS[id].brandName);
    }
    // Browser/PWA chrome is NOT per-brand (owner decision 29 Sep: no per-brand
    // skins), so no two instances may ship a different palette.
    expect(BRANDS["imaging-queensland"].colors).toEqual(BRANDS["rad-games"].colors);
    expect(BRANDS["the-xray-group"].colors).toEqual(BRANDS["rad-games"].colors);
  });

  test("all three instances share one identical browser/PWA palette", () => {
    // The app's existing palette, pinned by value: `colors` only colours the
    // browser and installed-app chrome (the `theme-color` meta tag and the
    // manifest's `theme_color`). The app UI itself is CSS-driven and the same
    // everywhere, so a differing block here would be the only per-brand visual
    // difference in the codebase — which the owner ruled out on 29 Sep. Rex's
    // cape is the one authorised per-brand difference, and it is not in here.
    const unified = {
      primary: "#2D2D2D", // deep charcoal
      secondary: "#008C95", // teal accent
      themeColor: "#0A1628",
    };
    for (const id of BRAND_IDS) {
      expect(BRANDS[id].colors).toEqual(unified);
    }
  });

  test("no brand carries the retired product name", () => {
    for (const id of BRAND_IDS) {
      for (const value of visibleStrings(id)) {
        expect(value).not.toContain("LightBox");
        expect(value).not.toContain("LIGHTBOX");
        expect(value).not.toContain("\u2014"); // em dash: project copy standard
      }
    }
  });

  test("the product name is Rad Games", () => {
    expect(PRODUCT_NAME).toBe("Rad Games");
    expect(brand.productName).toBe("Rad Games");
  });
});

describe("Rex's cape", () => {
  const pilotBrands = ["imaging-queensland", "the-xray-group"] as const;

  test("the neutral master keeps the cape drawn in the artwork", () => {
    // No override means no overlay is drawn at all, which is what makes the
    // master instance look exactly as it did before brands existed.
    expect(BRANDS["rad-games"].rexCapeColor).toBeUndefined();
    expect(rexCapeColorFor(BRANDS["rad-games"])).toBe(DEFAULT_REX_CAPE_COLOR);
    expect(rexCapeStyle(BRANDS["rad-games"])).toBeNull();
  });

  test("the two pilot brands carry a placeholder cape colour", () => {
    for (const id of pilotBrands) {
      const cape = BRANDS[id].rexCapeColor;
      expect(cape).toMatch(/^#[0-9A-F]{6}$/i);
      expect(rexCapeColorFor(BRANDS[id])).toBe(cape);
    }
    // Two brands, two capes, or nothing is telling the instances apart.
    expect(BRANDS["imaging-queensland"].rexCapeColor).not.toBe(
      BRANDS["the-xray-group"].rexCapeColor,
    );
    // And nobody else acquires one by accident.
    expect(BRAND_IDS.filter((id) => BRANDS[id].rexCapeColor)).toEqual([...pilotBrands]);
  });

  test("the overlay hands the brand colour to the cape rule", () => {
    const style = rexCapeStyle(BRANDS["the-xray-group"]);
    expect(style?.[REX_CAPE_COLOR_VAR]).toBe(BRANDS["the-xray-group"].rexCapeColor);
    // A colour and nothing else: recolouring Rex with a filter would repaint the
    // whole character, bones and all.
    expect(Object.keys(style ?? {})).toEqual([REX_CAPE_COLOR_VAR]);
    expect(Object.keys(style ?? {})).not.toContain("filter");
  });

  test("the cape rule masks the colour, and is gated on mask support", () => {
    // The mask, the colour and the `@supports` guard all live in the stylesheet:
    // if the gate were dropped, a browser without CSS masks would paint a solid
    // brand-coloured square over Rex instead of leaving his navy cape alone.
    const css = readFileSync(
      fileURLToPath(new URL("../styles/app.css", import.meta.url)),
      "utf8",
    );
    const gate = css.indexOf("@supports (mask-image: url(\"\")) or (-webkit-mask-image: url(\"\"))");
    expect(gate).toBeGreaterThan(-1);
    const block = css.slice(gate, css.indexOf("}", gate));
    expect(block).toContain(".rex-cape");
    expect(block).toContain(`mask-image: url("${REX_CAPE_MASK_URL}")`);
    expect(block).toContain(`-webkit-mask-image: url("${REX_CAPE_MASK_URL}")`); // iOS Safari
    expect(block).toContain("background-color: var(--rex-cape-color");
    // `contain` + `center` is what lands the cape on the shoulders of an image
    // drawn the same way, whatever size the caller gives Rex.
    expect(block).toContain("mask-size: contain");
    expect(block).toContain("mask-position: center");
    expect(block).toContain("mask-repeat: no-repeat");
  });

  test("the running brand's cape follows its config", () => {
    expect(rexCapeStyle()?.[REX_CAPE_COLOR_VAR] ?? null).toBe(brand.rexCapeColor ?? null);
  });
});

describe("brand logo asset", () => {
  test("every brand's logo file exists in public/", () => {
    for (const id of BRAND_IDS) {
      expect(existsSync(publicFile(BRANDS[id].logoUrl))).toBe(true);
    }
  });
  test("the shared Rad Games mark is a wide, transparent PNG that loads fast", async () => {
    // The mark replaced the corporate placeholder, so this pins the properties
    // the two places that draw it rely on: a transparent background (the header
    // and the welcome screen are dark), a wide lockup (sized by width, not
    // height) and a file small enough for a waiting-room phone connection.
    const file = publicFile("/rad-games-logo.png");
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    expect(width).toBeGreaterThanOrEqual(600); // sharp on a 3x phone screen
    expect(width / height).toBeGreaterThan(1.8); // wide lockup
    expect(bytes.length).toBeLessThan(250 * 1024);
  });
});

describe("cape mask asset", () => {
  test("it is a transparent PNG the same size as the mascot artwork", async () => {
    // The overlay is drawn straight over the mascot with `contain`, so the mask
    // has to be the artwork's size (and square) or the cape would sit off the
    // shoulders. Derived from the artwork by scripts/rex-cape-assets.mjs.
    const maskFile = publicFile(REX_CAPE_MASK_URL);
    const artFile = publicFile(REX_ART_URL);
    expect(existsSync(maskFile)).toBe(true);
    expect(existsSync(artFile)).toBe(true);
    const [mask, art] = await Promise.all([
      sharp(maskFile).metadata(),
      sharp(artFile).metadata(),
    ]);
    expect(mask.format).toBe("png");
    expect(mask.hasAlpha).toBe(true);
    expect([mask.width, mask.height]).toEqual([art.width, art.height]);
    expect(readFileSync(maskFile).length).toBeLessThan(100 * 1024);
  });

  test("it covers the cape, keeps the folds and leaves Rex's face alone", async () => {
    const { data, info } = await sharp(publicFile(REX_CAPE_MASK_URL))
      .raw()
      .toBuffer({ resolveWithObject: true });
    let covered = 0;
    let facePixels = 0;
    const alphas = new Set<number>();
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const alpha = data[(y * info.width + x) * 4 + 3];
        if (alpha > 0) {
          covered++;
          alphas.add(alpha);
        }
        // Rex's irises are the same navy family as his cape, so the mask has to
        // be built to exclude them: painting the face with the brand colour is
        // exactly the kind of character change this feature must not make.
        if (x >= 215 && x <= 315 && y >= 100 && y <= 155 && alpha > 40) facePixels++;
      }
    }
    const share = covered / (info.width * info.height);
    expect(share).toBeGreaterThan(0.04); // the cape really is in there
    expect(share).toBeLessThan(0.15); // and it is the cape, not the character
    expect(alphas.size).toBeGreaterThan(20); // folds survive: not a flat cut-out
    expect(facePixels).toBeLessThan(20); // the face is not painted
  });
});
describe("resolveBrandId", () => {
  test("accepts a known id, ignoring case and padding", () => {
    expect(resolveBrandId("rad-games")).toBe("rad-games");
    expect(resolveBrandId("imaging-queensland")).toBe("imaging-queensland");
    expect(resolveBrandId("the-xray-group")).toBe("the-xray-group");
    expect(resolveBrandId("  THE-XRAY-GROUP  ")).toBe("the-xray-group");
    expect(resolveBrandId("RAD-GAMES")).toBe("rad-games");
    expect(isBrandId("Imaging-Queensland")).toBe(true);
  });

  test("falls back to the default brand for anything unknown", () => {
    expect(DEFAULT_BRAND_ID).toBe("imaging-queensland");
    for (const value of [undefined, null, "", "   ", "capital-radiology", "1", "{}"]) {
      expect(resolveBrandId(value)).toBe(DEFAULT_BRAND_ID);
      expect(isBrandId(value)).toBe(false);
    }
  });

  test("brandConfig returns the config for the resolved id", () => {
    expect(brandConfig("the-xray-group")).toBe(BRANDS["the-xray-group"]);
    expect(brandConfig("nonsense")).toBe(BRANDS[DEFAULT_BRAND_ID]);
    expect(brand).toBe(brandConfig(brandIdFromEnv()));
  });
});

describe("manifestFor", () => {
  test("the installed app is named after the product, per brand", () => {
    const manifest = manifestFor(BRANDS["the-xray-group"]);
    expect(manifest.name).toBe("Rad Games");
    expect(manifest.short_name).toBe("Rad Games");
    // One unified palette, so this is the same charcoal for every instance
    // rather than a per-brand chrome colour.
    expect(manifest.theme_color).toBe("#2D2D2D");
    expect(manifest.theme_color).toBe(BRANDS["the-xray-group"].colors.primary);
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
  });

  test("every brand's manifest carries the same unified theme colour", () => {
    // Only the name and description follow the brand; the chrome does not.
    for (const id of BRAND_IDS) {
      expect(manifestFor(BRANDS[id]).theme_color).toBe("#2D2D2D");
    }
  });

  test("it defaults to the running brand", () => {
    expect(manifestFor()).toEqual(manifestFor(brand));
    expect(manifestFor().name).toBe(PRODUCT_NAME);
    expect(manifestFor().description).toContain(brand.brandName);
  });
});
