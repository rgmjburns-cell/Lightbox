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
 * The owner's per-brand artwork (29 Sep) is pinned here too: the shared Rad
 * Games mark stays the HEADER on every instance, the welcome screen and the
 * mascot follow the brand, the two pilot brands do not show Rex twice on the
 * welcome screen, and every file a brand points at really exists in public/ with
 * the shape the screen drawing it relies on. A missing or opaque asset is a
 * blank hole or a black box in the UI, and nothing at runtime would catch it.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  BRANDS,
  BRAND_IDS,
  DEFAULT_BRAND_ID,
  PRODUCT_NAME,
  brand,
  brandConfig,
  brandIdFromEnv,
  isBrandId,
  manifestFor,
  resolveBrandId,
} from "./brand";

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

/** The source of a file in src/, for the markup assertions below. */
const srcFile = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

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
      // Every asset url a screen draws must be a public/ path, and the flag that
      // decides whether the welcome screen draws Rex must be an explicit boolean
      // (undefined would silently hide him).
      for (const url of [
        config.welcomeLogoUrl,
        config.rexImageUrl,
        config.tileLogoUrl,
        config.homeLogoUrl,
        config.icon192Url,
        config.icon512Url,
        config.appleTouchIconUrl,
      ]) {
        expect(url.startsWith("/")).toBe(true);
      }
      expect(typeof config.welcomeShowsRex).toBe("boolean");
      expect(config.icon192Url).not.toBe(config.icon512Url);
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

describe("per-brand artwork", () => {
  const pilots = ["imaging-queensland", "the-xray-group"] as const;
  /** The public/ path for a brand asset url, with any cache-buster dropped. */
  const assetPath = (url: string) => publicFile(url.split("?")[0]);

  test("the header keeps the shared Rad Games mark on every instance", () => {
    // Owner direction, 29 Sep: the mark already in place stays where it is.
    // Only the welcome screen draws anything else.
    for (const id of BRAND_IDS) {
      expect(BRANDS[id].logoUrl).toBe("/rad-games-logo.png");
      expect(existsSync(assetPath(BRANDS[id].logoUrl))).toBe(true);
    }
  });

  test("the welcome mark follows the brand, and the master keeps the shared one", () => {
    expect(BRANDS["rad-games"].welcomeLogoUrl).toBe("/rad-games-logo.png");
    for (const id of pilots) {
      const config = BRANDS[id];
      expect(config.welcomeLogoUrl).toContain(`/brands/${id}/`);
      expect(config.welcomeLogoUrl).not.toBe(config.logoUrl);
      expect(existsSync(assetPath(config.welcomeLogoUrl))).toBe(true);
    }
    // Two brands, two marks, or the welcome screen would not tell them apart.
    expect(BRANDS["imaging-queensland"].welcomeLogoUrl).not.toBe(
      BRANDS["the-xray-group"].welcomeLogoUrl,
    );
  });

  test("the mascot follows the brand, and the master keeps the navy Rex", () => {
    expect(BRANDS["rad-games"].rexImageUrl).toBe("/welcome-rex-opt.png");
    for (const id of pilots) {
      const config = BRANDS[id];
      expect(config.rexImageUrl).toContain(`/brands/${id}/`);
      expect(config.rexImageUrl).not.toBe(BRANDS["rad-games"].rexImageUrl);
      expect(existsSync(assetPath(config.rexImageUrl))).toBe(true);
    }
    expect(BRANDS["imaging-queensland"].rexImageUrl).not.toBe(
      BRANDS["the-xray-group"].rexImageUrl,
    );
  });

  test("the welcome screen draws Rex only where the mark has none", () => {
    // The pilot brands' welcome artwork contains Rex, so drawing the component
    // as well would show him twice (owner direction, 29 Sep).
    expect(BRANDS["rad-games"].welcomeShowsRex).toBe(true);
    for (const id of pilots) expect(BRANDS[id].welcomeShowsRex).toBe(false);
    expect(BRAND_IDS.filter((id) => BRANDS[id].welcomeShowsRex)).toEqual(["rad-games"]);
  });

  test("every brand's home-screen icons exist at both PWA sizes, plus iOS", async () => {
    for (const id of BRAND_IDS) {
      const config = BRANDS[id];
      const expected: [string, number][] = [
        [config.icon192Url, 192],
        [config.icon512Url, 512],
        [config.appleTouchIconUrl, 180], // what iOS asks for
      ];
      for (const [url, size] of expected) {
        const file = assetPath(url);
        expect(existsSync(file)).toBe(true);
        const meta = await sharp(file).metadata();
        expect(meta.format).toBe("png");
        expect([meta.width, meta.height]).toEqual([size, size]);
      }
    }
  });

  test("the master's icons are the same files it has always shipped", () => {
    const master = BRANDS["rad-games"];
    expect(master.icon192Url).toBe("/icon-192.png");
    expect(master.icon512Url).toBe("/icon-512.png");
    expect(master.appleTouchIconUrl).toBe("/apple-touch-icon.png?v=3");
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

describe("brand artwork files", () => {
  /** The per-brand files a screen draws, in the order they matter. */
  const artwork = () =>
    BRAND_IDS.flatMap((id) => [
      { id, kind: "welcome logo", url: BRANDS[id].welcomeLogoUrl },
      { id, kind: "mascot", url: BRANDS[id].rexImageUrl },
    ]);

  test("the marks and the mascots are transparent PNGs, not opaque rectangles", async () => {
    // Every one of them is drawn straight onto the app's dark navy background, so
    // an opaque file would show as a solid block and a pale fringe would glow
    // against the theme.
    for (const asset of artwork()) {
      const meta = await sharp(publicFile(asset.url)).metadata();
      expect(meta.format).toBe("png");
      expect(meta.hasAlpha).toBe(true);
    }
  });

  test("welcome logos are wide, sharp on a 3x phone and small enough to load", async () => {
    for (const id of BRAND_IDS) {
      const file = publicFile(BRANDS[id].welcomeLogoUrl);
      const meta = await sharp(file).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      expect(width).toBeGreaterThanOrEqual(600); // 250 CSS px on a 3x screen
      expect(width / height).toBeGreaterThan(1.2); // a wide lockup, sized by width
      expect(readFileSync(file).length).toBeLessThan(250 * 1024);
    }
  });

  test("the mascot art is square, so `contain` in a square slot keeps him whole", async () => {
    for (const id of BRAND_IDS) {
      const file = publicFile(BRANDS[id].rexImageUrl);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(meta.height);
      expect(meta.width ?? 0).toBeGreaterThanOrEqual(384);
      expect(readFileSync(file).length).toBeLessThan(250 * 1024);
    }
  });

  test("a pilot brand's mascot is a fitted character, not a wide frame with margins", async () => {
    // The owner's exports are 3:2 canvases with empty margins. Drawn with
    // `contain` in a square slot, an uncropped one would render Rex much smaller
    // than the master's; `scripts/brand-artwork-assets.mjs` crops to the visible
    // pixels and pads to a square so the character fills the same share of the
    // frame the master artwork does (85% of the width).
    for (const id of ["imaging-queensland", "the-xray-group"] as const) {
      const { data, info } = await sharp(publicFile(BRANDS[id].rexImageUrl))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let x0 = info.width;
      let x1 = -1;
      let y0 = info.height;
      let y1 = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * 4 + 3] < 8) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      const widthShare = (x1 - x0 + 1) / info.width;
      const heightShare = (y1 - y0 + 1) / info.height;
      expect(widthShare).toBeGreaterThan(0.8);
      expect(widthShare).toBeLessThan(0.9);
      expect(heightShare).toBeGreaterThan(0.5); // a whole character
      expect(heightShare).toBeLessThan(0.9);
    }
  });
  test("every brand has a home-header mark, and it is the brand's own", async () => {
    // Owner request, 29 Sep: the games home header carries the brand's mark in
    // the empty space opposite the greeting. This is the ONE header mark that is
    // per brand rather than the shared Rad Games one: that screen greets the
    // brand's own patient.
    expect(BRANDS["rad-games"].homeLogoUrl).toBe("/rad-games-logo.png");
    expect(BRANDS["imaging-queensland"].homeLogoUrl).toBe(
      "/brands/imaging-queensland/home-logo.png",
    );
    // The Xray Group's welcome logo is a Rad Games lockup carrying Rex (busy at
    // 40 CSS px), so its header draws the brand's own wide wordmark export, which
    // the owner supplied on 29 Sep: the same ~3:1 shape as the other two marks.
    expect(BRANDS["the-xray-group"].homeLogoUrl).toBe("/brands/the-xray-group/home-logo.png");
    for (const id of BRAND_IDS) {
      const url = BRANDS[id].homeLogoUrl;
      expect(url.startsWith("/")).toBe(true);
      expect(existsSync(publicFile(url))).toBe(true);
    }
    // Two pilot brands, two marks: one shared mark on both headers would not
    // tell the instances apart.
    expect(BRANDS["imaging-queensland"].homeLogoUrl).not.toBe(
      BRANDS["the-xray-group"].homeLogoUrl,
    );
    expect(BRANDS["imaging-queensland"].homeLogoUrl).not.toBe(
      BRANDS["rad-games"].homeLogoUrl,
    );
  });

  test("a home-header mark is a transparent PNG that reads on the navy header", async () => {
    // The home screen is the app's dark navy, and the mark sits at `h-10`
    // (40 CSS px). The master's mark was designed for that field, and the pilot
    // brands' marks had to survive it: an opaque file would be a solid block, and
    // a mark too close to the navy would disappear into it. Contrast is measured
    // the way WCAG does (per-pixel, against #0A1628, averaged over the visible
    // pixels); a mark's own dark outline may sit at 1:1, so the pin is the mean
    // rather than every pixel.
    const navy = { r: 0x0a, g: 0x16, b: 0x28 };
    const linear = (channel: number) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: number, g: number, b: number) =>
      0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const navyLuminance = luminance(navy.r, navy.g, navy.b);
    const contrast = (r: number, g: number, b: number) => {
      const l = luminance(r, g, b);
      return (Math.max(l, navyLuminance) + 0.05) / (Math.min(l, navyLuminance) + 0.05);
    };

    for (const id of BRAND_IDS) {
      const file = publicFile(BRANDS[id].homeLogoUrl);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("png");
      expect(meta.hasAlpha).toBe(true);
      // The mark is sized by HEIGHT on screen (`h-10` = 40 CSS px), so the 3x-DPR
      // slot is ~120 device px tall. All three marks clear that: the master's is
      // 420 px and the two owner-supplied exports are 362 and 118. This floor
      // catches a header pointed at a thumbnail-sized or pre-scaled file.
      expect(meta.height ?? 0).toBeGreaterThanOrEqual(96);
      expect(readFileSync(file).length).toBeLessThan(150 * 1024);

      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let visible = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue; // an edge/anti-aliased pixel, not ink
        visible++;
        total += contrast(data[i], data[i + 1], data[i + 2]);
      }
      expect(visible).toBeGreaterThan(info.width); // a mark, not a blank canvas
      expect(total / visible).toBeGreaterThan(3);
    }
  });

  test("the Imaging Queensland header mark is the owner's export, scaled down whole", async () => {
    // The owner supplied this one (29 Sep) already cut out, as a 2172x724 export
    // with true transparency and small, even margins. Nothing is keyed or
    // cropped: it is scaled whole to 1086 wide (a straight half-scale that is
    // still 3x the ~120 CSS px the header can draw), which keeps its aspect at
    // exactly 3.00 and its corners fully transparent. The file has to stay small
    // enough for a waiting-room phone connection, and this pins all four.
    const file = publicFile(BRANDS["imaging-queensland"].homeLogoUrl);
    const meta = await sharp(file).metadata();
    expect(meta.width).toBe(1086);
    expect(meta.height).toBe(362);
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 3)).toBeLessThan(0.02);
    expect(readFileSync(file).length).toBeLessThan(150 * 1024);

    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(info.width - 1, 0)).toBe(0);
    expect(alphaAt(0, info.height - 1)).toBe(0);
    expect(alphaAt(info.width - 1, info.height - 1)).toBe(0);
  });

  test("the Xray Group header mark is the owner's export, drawn near 1:1", async () => {
    // The second owner-supplied mark (29 Sep) is small and tightly cut: 351x118
    // with true transparency and ink edge to edge, so there is no margin to trim
    // and no reason to resample it. At `h-10` (40 CSS px) its 2.97 aspect draws
    // ~119 CSS px wide, which is within ~2% of the 3x-DPR slot and well above 2x
    // — sharper per device pixel than any other header mark, and 6.6 kB on the
    // wire. This pins the file, not the slot (the slot is shared and pinned
    // separately), so re-cropping or downscaling the artwork fails here.
    const file = publicFile(BRANDS["the-xray-group"].homeLogoUrl);
    const meta = await sharp(file).metadata();
    expect(meta.width).toBe(351);
    expect(meta.height).toBe(118);
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 2.97)).toBeLessThan(0.02);
    expect(readFileSync(file).length).toBeLessThan(150 * 1024);

    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(info.width - 1, 0)).toBe(0);
    expect(alphaAt(0, info.height - 1)).toBe(0);
    expect(alphaAt(info.width - 1, info.height - 1)).toBe(0);

    let x0 = info.width;
    let x1 = -1;
    let y0 = info.height;
    let y1 = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (alphaAt(x, y) < 200) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    // The mark fills its canvas: the shared slot draws the wordmark, not padding.
    expect((x1 - x0 + 1) / info.width).toBeGreaterThan(0.98);
    expect((y1 - y0 + 1) / info.height).toBeGreaterThan(0.95);
  });

  test("the games home header draws the brand's mark at one shared size", () => {
    // Owner request, 29 Sep: the mark sits right-aligned in the empty space
    // opposite the greeting. Only the artwork is per brand — the size, the slot
    // and the theme are identical on all three instances, so the class is a
    // literal, never a brand-conditional value.
    const home = srcFile("../routes/index.tsx");
    expect(home).toContain("src={brand.homeLogoUrl}");
    expect(home).toContain("alt={brand.logoAlt}");
    expect(home).toMatch(/<img\s+src=\{brand\.homeLogoUrl\}/);
    expect(home).toMatch(/className="ml-auto h-10 w-auto shrink-0"/);
    expect(home).not.toMatch(/brand\.brandId/); // no per-brand sizing or slot
    // A long nickname must not push the mark out: the text column can shrink
    // (`min-w-0`) and the headline ellipsises.
    expect(home).toMatch(/<div className="min-w-0">/);
    expect(home).toMatch(/text-xl font-bold text-white truncate whitespace-nowrap/);
  });

  test("every brand has a mark for the game title tile", async () => {
    // Owner request, 29 Sep: each game page's white title tile carries the
    // brand's mark on its right. The master has no tile artwork of its own, so
    // it draws the shared Rad Games mark rather than leaving its tile blank.
    expect(BRANDS["rad-games"].tileLogoUrl).toBe("/rad-games-logo.png");
    for (const id of BRAND_IDS) {
      const url = BRANDS[id].tileLogoUrl;
      expect(url.startsWith("/")).toBe(true);
      expect(existsSync(publicFile(url))).toBe(true);
    }
    for (const id of ["imaging-queensland", "the-xray-group"] as const) {
      expect(BRANDS[id].tileLogoUrl).toBe(`/brands/${id}/tile-logo.png`);
    }
    expect(BRANDS["imaging-queensland"].tileLogoUrl).not.toBe(
      BRANDS["the-xray-group"].tileLogoUrl,
    );
  });
  test("a tile logo is sized for the tile and reads on the white it sits on", async () => {
    // The tile is white and the mark is drawn at `h-8` (32 CSS px). A mark with
    // its own white background would vanish on it, and a near-white mark would
    // only show on the app's dark navy: the pilot brands' artwork has its white
    // background keyed out by scripts/brand-artwork-assets.mjs, and this pins
    // both the keying and the contrast.
    for (const id of BRAND_IDS) {
      const file = publicFile(BRANDS[id].tileLogoUrl);
      const meta = await sharp(file).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      expect(meta.format).toBe("png");
      expect(height).toBeGreaterThanOrEqual(96); // 32 CSS px on a 3x screen
      expect(width / height).toBeGreaterThan(1.5); // a wide lockup, sized by height
      expect(readFileSync(file).length).toBeLessThan(160 * 1024); // the master reuses the header mark

      const { data } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let visible = 0;
      let cleared = 0;
      let luminance = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) {
          cleared++;
          continue;
        }
        visible++;
        luminance += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      expect(visible).toBeGreaterThan(0);
      expect(luminance / visible).toBeLessThan(200); // darker than the tile behind it
      if (id !== "rad-games") expect(cleared).toBeGreaterThan(0); // white keyed out
    }
  });
});

describe("the cape machinery is gone", () => {
  // The per-brand cape colour painted through a mask over the master artwork was
  // an interim mechanism, and the owner's per-brand Rex artwork supersedes it.
  // These assertions exist so it cannot come back half-removed: a leftover
  // overlay, a dangling import, or a second way to recolour Rex would each break
  // one of them.
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

  test("no brand offers a cape colour", () => {
    for (const id of BRAND_IDS) {
      expect(BRANDS[id]).not.toHaveProperty("rexCapeColor");
    }
  });

  test("the mascot component draws the brand's file, with no overlay", () => {
    const rex = read("../components/Rex.tsx");
    expect(rex).toContain("brand.rexImageUrl");
    expect(rex).not.toContain("RexCape");
    expect(rex).not.toContain("rex-cape-mask");
  });

  test("the removal is complete on disk", () => {
    expect(existsSync(here("../components/RexCape.tsx"))).toBe(false);
    expect(existsSync(publicFile("/rex-cape-mask.png"))).toBe(false);
    expect(existsSync(here("../../scripts/rex-cape-assets.mjs"))).toBe(false);
  });

  test("no stylesheet rule masks a cape colour over the mascot", () => {
    const css = read("../styles/app.css");
    expect(css).not.toContain("rex-cape-mask");
    expect(css).not.toContain("--rex-cape-color");
    expect(css).not.toContain("@supports (mask-image");
  });

  test("the welcome screen draws the brand's mark and gates Rex on the flag", () => {
    const onboarding = read("../components/Onboarding.tsx");
    expect(onboarding).toContain("brand.welcomeLogoUrl");
    expect(onboarding).toContain("brand.welcomeShowsRex");
    expect(onboarding).not.toContain("src={brand.logoUrl}");
    // The mark's bottom clearance is gated on the same flag: the master keeps
    // its exact -8px pull-up (its Rex artwork has transparent padding under him
    // that absorbs it), while a mark drawn flush to its own bottom edge takes a
    // real gap. An ungated negative margin would touch the headline on those
    // brands again.
    expect(onboarding).toMatch(
      /marginBottom: brand\.welcomeShowsRex\s*\?\s*"-8px"\s*:\s*"clamp\(/,
    );
    expect(onboarding).not.toMatch(/marginBottom: "-8px"/);
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

  test("the installed app's icons follow the brand, and the master's are unchanged", () => {
    for (const id of BRAND_IDS) {
      expect(manifestFor(BRANDS[id]).icons.map((icon) => icon.src)).toEqual([
        BRANDS[id].icon192Url,
        BRANDS[id].icon512Url,
      ]);
    }
    // An installed master app keeps the icon it already had: a brand's icon
    // reaching the master's manifest would change a live app's home screen.
    expect(manifestFor(BRANDS["rad-games"]).icons.map((icon) => icon.src)).toEqual([
      "/icon-192.png",
      "/icon-512.png",
    ]);
    expect(manifestFor(BRANDS["imaging-queensland"]).icons.map((icon) => icon.src)).toEqual([
      "/brands/imaging-queensland/icon-192.png",
      "/brands/imaging-queensland/icon-512.png",
    ]);
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
