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
 * the shape the screen drawing it relies on (including the alpha the owner
 * supplied: the marks are not all the same kind of file). A missing or mangled
 * asset is a blank hole or a black box in the UI, and nothing at runtime would
 * catch it.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  BAR_LOGO_VERSION,
  BRANDS,
  BRAND_IDS,
  DEFAULT_BRAND_ID,
  PRODUCT_NAME,
  brand,
  brandConfig,
  brandIdFromEnv,
  colourGameTitle,
  isBrandId,
  manifestFor,
  resolveBrandId,
  welcomeMessageFor,
} from "./brand";
import { ACHIEVEMENTS, badgeName } from "./achievements";
import {
  ACHIEVEMENTS as SHARED_ACHIEVEMENTS,
  MASCOT_NAME_TOKEN,
} from "../../server/achievement-core";

/** Every string a player can see from a brand config. */
function visibleStrings(id: (typeof BRAND_IDS)[number]): string[] {
  const config = BRANDS[id];
  return [
    config.brandName,
    config.productName,
    config.mascotName,
    config.tagline,
    config.welcomeMessage,
    config.logoAlt,
    config.logoUrl,
  ];
}

/**
 * A path under public/ for a brand asset url. Any cache-buster is dropped: the
 * url a screen draws is the FILE plus, on the two marks the top bar shows, a
 * `?v=` version stamp (`BAR_LOGO_VERSION`), and that stamp is part of the request
 * address only — the file it names is the unversioned path. Mapping the url to
 * the file this way is what keeps the size/alpha/md5 pins below meaningful now
 * that a bar mark's url carries a query.
 */
const publicFile = (url: string) =>
  fileURLToPath(
    new URL(`../../public/${url.split("?")[0].replace(/^\//, "")}`, import.meta.url),
  );

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
      // The mascot has a name on every instance, and the greeting is composed
      // from it rather than carrying a second copy of the name (owner direction,
      // 2 Oct 2026 — see the `mascotName` field).
      expect(config.mascotName.length).toBeGreaterThan(0);
      expect(config.welcomeMessage).toBe(welcomeMessageFor(config.mascotName));
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

describe("the mascot's name is per brand", () => {
  // Owner direction, 2 Oct 2026: Imaging Queensland's mascot is called Stu. The
  // master and The Xray Group keep Rex, and it stays a CONFIG change — the
  // artwork, the palette and every other presentation choice are shared, so
  // `mascotName` is the whole difference. These tests pin the name per brand and
  // then pin every user-facing place the name can appear to that field, so the
  // rename cannot land half-way on one instance.
  test("Imaging Queensland calls him Stu, the other two keep Rex", () => {
    expect(BRANDS["imaging-queensland"].mascotName).toBe("Stu");
    expect(BRANDS["rad-games"].mascotName).toBe("Rex");
    expect(BRANDS["the-xray-group"].mascotName).toBe("Rex");
  });

  test("the welcome copy says Stu on Imaging Queensland, Rex on the others", () => {
    const iq = BRANDS["imaging-queensland"].welcomeMessage;
    expect(iq).toContain("I am Stu,");
    expect(iq).not.toContain("Rex");
    for (const id of ["rad-games", "the-xray-group"] as const) {
      expect(BRANDS[id].welcomeMessage).toContain("I am Rex,");
      expect(BRANDS[id].welcomeMessage).not.toContain("Stu");
    }
    // No brand's visible copy mentions the OTHER brand's mascot name either.
    for (const id of BRAND_IDS) {
      const other = BRANDS[id].mascotName === "Rex" ? "Stu" : "Rex";
      for (const value of visibleStrings(id)) expect(value).not.toContain(other);
    }
  });

  test("the colouring game's title comes from ONE helper, on all three surfaces", () => {
    // The title carries the mascot's name and is shown in three places: the
    // games-home tile, a game page's title tile and the shared leaderboard's game
    // label. All three read `colourGameTitle()`, so they cannot drift apart — and
    // the game ID and icon stay `colour-rex` / `/icons/icon-colour-rex.png`,
    // because the ID is what scores are submitted (and stored) under.
    expect(colourGameTitle(BRANDS["imaging-queensland"])).toBe("Colour Stu");
    expect(colourGameTitle(BRANDS["rad-games"])).toBe("Colour Rex");
    expect(colourGameTitle(BRANDS["the-xray-group"])).toBe("Colour Rex");
    for (const id of BRAND_IDS) {
      expect(colourGameTitle(BRANDS[id])).toBe(`Colour ${BRANDS[id].mascotName}`);
    }
    // The default argument is the running brand.
    expect(colourGameTitle()).toBe(colourGameTitle(brand));

    const surfaces: [string, RegExp][] = [
      ["../routes/index.tsx", /title: colourGameTitle\(\),/], // games-home tile
      [
        "../routes/play.$gameId.tsx",
        /"colour-rex": \{ title: colourGameTitle\(\), icon: "\/icons\/icon-colour-rex\.png" \}/,
      ],
      ["./leaderboard.ts", /\{ id: "colour-rex", label: colourGameTitle\(\),/],
    ];
    for (const [file, call] of surfaces) {
      const source = srcFile(file);
      expect(source).toMatch(call);
      // ...and no surface may carry the name as a literal of its own.
      expect(source).not.toContain('"Colour Rex"');
      expect(source).not.toContain('"Colour Stu"');
    }
  });

  test("every user-facing mention of the mascot reads the brand config", () => {
    // The copy survey, file by file: each pair is a sentence, an alt or an
    // aria-label a player can read. Every one of them must read
    // `brand.mascotName`...
    const reads: [string, string][] = [
      ["../components/Onboarding.tsx", "{brand.mascotName}"],
      ["../routes/qr.tsx", "Look for ${brand.mascotName} on your Home Screen"],
      ["../routes/qr.tsx", "alt={`${brand.mascotName} Home Screen icon`}"],
      ["../components/games/ColourRex.tsx", "then tap ${brand.mascotName} to fill!"],
      ["../components/games/ColourRex.tsx", "% of ${brand.mascotName} to finish!"],
      [
        "../components/games/ColourRex.tsx",
        "You coloured {progressPct}% of {brand.mascotName}!",
      ],
      ["../components/games/MemoryScan.tsx", "alt={`${brand.mascotName} tile`}"],
      ["../components/games/BoneBuster.tsx", "alt={`${brand.mascotName} Super Burst`}"],
      ["../components/Rex.tsx", "alt={`${brand.mascotName} the skeleton mascot`}"],
      [
        "../components/Rex.tsx",
        "aria-label={`${brand.mascotName} the skeleton mascot`}",
      ],
    ];
    for (const [file, snippet] of reads) {
      expect(srcFile(file)).toContain(snippet);
    }

    // ...and none of those places may still hold a literal name. The literal
    // each file has to be free of is spelled out, rather than "any Rex": the
    // component name, the imports, the asset paths, the localStorage keys and
    // the comments all legitimately keep their `rex` names, and the master's and
    // The Xray Group's `mascotName: "Rex"` is the config itself.
    const free: [string, string[]][] = [
      ["../components/Onboarding.tsx", [">Rex<", '"Rex"']],
      ["../routes/qr.tsx", ["Look for Rex", '"Rex Home Screen icon"']],
      ["../routes/index.tsx", ['"Colour Rex"', '"Colour Stu"']],
      ["../routes/play.$gameId.tsx", ['"Colour Rex"', '"Colour Stu"']],
      ["./leaderboard.ts", ['label: "Colour Rex"', 'label: "Colour Stu"']],
      [
        "../components/games/ColourRex.tsx",
        ["tap Rex to fill!", "% of Rex to finish!", "% of Rex!"],
      ],
      ["../components/games/MemoryScan.tsx", ['alt="Rex tile"']],
      ["../components/games/BoneBuster.tsx", ['alt="Rex Super Burst"']],
      ["../components/Rex.tsx", ['"Rex the skeleton mascot"']],
      // The greeting itself is composed, so the sentence is nowhere in the file.
      ["./brand.ts", ['"I am Rex,', '"I am Stu,']],
    ];
    for (const [file, literals] of free) {
      for (const literal of literals) {
        expect(srcFile(file)).not.toContain(literal);
      }
    }
  });

  test("the badge named after the mascot follows the brand, its id and icon do not", () => {
    // This name lives in the SHARED badge definitions
    // (`server/achievement-core.ts`), which the server imports too, and the
    // deployed image runs that file verbatim from `server/` — where `src/` is not
    // present at all. It therefore cannot read the brand config, so the shared
    // copy carries a token and the browser half (`src/lib/achievements.ts`)
    // resolves it for the instance. The badge ID and the icon path stay as they
    // are: unlocks are keyed by the ID, and the icon file keeps its name.
    const shared = SHARED_ACHIEVEMENTS.find((a) => a.id === "rexs-best-friend");
    expect(shared).toBeDefined();
    expect(shared!.name).toBe(`${MASCOT_NAME_TOKEN}'s Best Friend`);
    expect(shared!.name).not.toContain("Rex");
    expect(shared!.icon).toBe("/badges/rexs-best-friend.png");
    expect(badgeName(shared!.name, BRANDS["imaging-queensland"].mascotName)).toBe(
      "Stu's Best Friend",
    );
    for (const id of ["rad-games", "the-xray-group"] as const) {
      expect(badgeName(shared!.name, BRANDS[id].mascotName)).toBe("Rex's Best Friend");
    }
    // What the app shows comes from the browser list, resolved for the running
    // brand, so no surface can print the raw token either.
    const shown = ACHIEVEMENTS.find((a) => a.id === "rexs-best-friend");
    expect(shown!.name).toBe(`${brand.mascotName}'s Best Friend`);
    for (const badge of ACHIEVEMENTS) {
      expect(badge.name).not.toContain(MASCOT_NAME_TOKEN);
    }
  });
});

describe("per-brand artwork", () => {
  const pilots = ["imaging-queensland", "the-xray-group"] as const;

  test("the header keeps the shared Rad Games mark on every instance", () => {
    // Owner direction, 29 Sep: the mark already in place stays where it is.
    // Only the welcome screen draws anything else. The url carries the current
    // bar-logo version stamp (`BAR_LOGO_VERSION`, `?v=3` today — the shared mark
    // was re-supplied on 1 Oct too, so its address is versioned like the pilots'
    // bar marks), while the FILE it names is still the unversioned path.
    for (const id of BRAND_IDS) {
      expect(BRANDS[id].logoUrl).toBe("/rad-games-logo.png?v=3");
      expect(existsSync(publicFile(BRANDS[id].logoUrl))).toBe(true);
    }
  });

  test("the two marks in the top bar are served from a version-stamped url", () => {
    // Why the address is versioned at all: a brand's bar artwork is replaced by
    // dropping new bytes over the same file name, and an INSTALLED app does not
    // reliably revalidate that name — on 1 Oct the owner's own phone kept drawing
    // the pre-deploy Imaging Queensland mark through two redeploys, out of the
    // app/webview/OS disk cache, even though these files are served
    // `cache-control: no-cache`. A new address is the one thing such a cache
    // cannot answer from memory, so the stamp is pinned by VALUE here and every
    // bar url is checked against it below: a bump has to be a deliberate edit in
    // both files, never a drift.
    expect(BAR_LOGO_VERSION).toBe("3");
    expect(BRANDS["imaging-queensland"].homeLogoUrl).toBe(
      "/brands/imaging-queensland/home-logo.png?v=3",
    );
    // The stamp is a query only, so it names the same file: the artwork pins above
    // (and the static handler, which serves by pathname) still read one path.
    expect(publicFile("/brands/the-xray-group/home-logo.png?v=3")).toBe(
      publicFile("/brands/the-xray-group/home-logo.png"),
    );
    // And the query is the ONLY cache-buster on either bar mark: a version bolted
    // on anywhere else (a second `?`, a `#`) would leave the file unreachable.
    for (const id of BRAND_IDS) {
      expect(BRANDS[id].logoUrl).toBe(`/rad-games-logo.png?v=${BAR_LOGO_VERSION}`);
    }
  });

  test("the welcome mark follows the brand, and the master keeps the shared one", () => {
    expect(BRANDS["rad-games"].welcomeLogoUrl).toBe("/rad-games-logo.png");
    for (const id of pilots) {
      const config = BRANDS[id];
      expect(config.welcomeLogoUrl).toContain(`/brands/${id}/`);
      expect(config.welcomeLogoUrl).not.toBe(config.logoUrl);
      expect(existsSync(publicFile(config.welcomeLogoUrl))).toBe(true);
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
      expect(existsSync(publicFile(config.rexImageUrl))).toBe(true);
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
        const file = publicFile(url);
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
    // the places that draw it rely on: a transparent background (the header and
    // the welcome screen sit on the theme), a wide lockup (sized by width, not
    // height) and a file small enough for a waiting-room phone connection.
    // The owner re-supplied this artwork on 1 Oct (a 1536x1024 export with the
    // lockup on transparent padding); the shipped file is DERIVED from it — cropped
    // to its visible pixels (alpha > 8) and scaled to 900 px wide — and the
    // untouched master is kept in `public/_originals/brands/`. The exact size is
    // pinned because that crop is what makes the mark fill the header at `h-12`
    // instead of floating inside the master's padding.
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
    expect([width, height]).toEqual([900, 416]); // the crop, not the master's padding
    expect(bytes.length).toBeLessThan(250 * 1024);

    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    // Ink reaches every edge: the crop is tight, so nothing is padding.
    expect(Math.max(...Array.from({ length: info.width }, (_, x) => alphaAt(x, 0)))).toBeGreaterThan(
      8,
    );
    expect(
      Math.max(...Array.from({ length: info.width }, (_, x) => alphaAt(x, info.height - 1))),
    ).toBeGreaterThan(8);
    expect(
      Math.max(...Array.from({ length: info.height }, (_, y) => alphaAt(0, y))),
    ).toBeGreaterThan(8);
    expect(
      Math.max(...Array.from({ length: info.height }, (_, y) => alphaAt(info.width - 1, y))),
    ).toBeGreaterThan(8);
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
  test("the top bar's right-hand slot is per brand, and the master keeps its chip", () => {
    // Owner direction, 30 Sep: the app's top bar (`src/routes/__root.tsx`) draws a
    // pilot instance's OWN mark in the slot the "Hi, <nickname>" chip used to
    // fill. The rule the bar reads is the inequality below, never a brand id: a
    // brand whose own mark is not the shared Rad Games one signs the bar with it,
    // while the master leaves the two EQUAL — its shared mark is already on the
    // left of that same bar, so the chip stays on the right rather than the same
    // mark appearing twice. Both marks carry the SAME bar-logo version stamp, so
    // the master's equality below holds on the address the device requests, not
    // just on the file name (`src/lib/brand.ts` builds both from one constant).
    expect(BRANDS["rad-games"].homeLogoUrl).toBe(BRANDS["rad-games"].logoUrl);
    expect(BRANDS["imaging-queensland"].homeLogoUrl).toBe(
      "/brands/imaging-queensland/home-logo.png?v=3",
    );
    expect(BRANDS["the-xray-group"].homeLogoUrl).toBe(
      "/brands/the-xray-group/home-logo.png?v=3",
    );
    for (const id of BRAND_IDS) {
      const url = BRANDS[id].homeLogoUrl;
      expect(url.startsWith("/")).toBe(true);
      // The stamp is a query on a real public/ file, not part of its name.
      expect(existsSync(publicFile(url))).toBe(true);
    }
    // Every mark the bar draws is version-stamped, on every brand, and nothing is
    // left on a stale stamp: this is the cache-busting the version exists for, so
    // a bump that missed a url (or a url that quietly lost its query) fails here.
    const stamp = `?v=${BAR_LOGO_VERSION}`;
    for (const id of BRAND_IDS) {
      expect(BRANDS[id].homeLogoUrl.endsWith(stamp)).toBe(true);
      expect(BRANDS[id].logoUrl.endsWith(stamp)).toBe(true);
      expect(BRANDS[id].homeLogoUrl.split("?")).toHaveLength(2);
      expect(BRANDS[id].logoUrl.split("?")).toHaveLength(2);
    }
    // Both pilot instances must actually differ from the shared mark, or the bar
    // would fall back to the greeting chip and the slot would do nothing.
    for (const id of ["imaging-queensland", "the-xray-group"] as const) {
      expect(BRANDS[id].homeLogoUrl).not.toBe(BRANDS[id].logoUrl);
      expect(BRANDS[id].homeLogoUrl).not.toBe(BRANDS["rad-games"].homeLogoUrl);
    }
    expect(BRANDS["imaging-queensland"].homeLogoUrl).not.toBe(
      BRANDS["the-xray-group"].homeLogoUrl,
    );
  });

  test("a top-bar mark is a PNG with ink of its own, transparent where the owner cut it out", async () => {
    // The mark is drawn at `h-9` (36 CSS px) and every file here has to carry real
    // ink of its own: one that is all-but-invisible would disappear into the bar it
    // is drawn on. (Since 1 Oct, final, every instance's bar is the original faint
    // glass, so this pins the artwork itself — size, ink and the alpha the owner
    // supplied — while the per-bar rendering check lives in the rendered-bar test
    // below.)
    // Alpha is pinned PER BRAND rather than assumed, because the supplies are not
    // the same kind of file: all three arrive cut out with true transparency. That
    // is a CHANGE for Imaging Queensland — the 300x210 white-field export the owner
    // sent on 1 Oct morning had no alpha at all and drew as a white tile, and the
    // owner replaced it that evening with a 2170x725 RGBA export whose rounded
    // corners are drawn into the artwork itself (pinned in full in its own test
    // below). Recording which is which keeps a future file that silently gains or
    // loses its alpha failing here.
    const expectAlpha: Record<(typeof BRAND_IDS)[number], boolean> = {
      "rad-games": true,
      "imaging-queensland": true,
      "the-xray-group": true,
    };
    /** The wire budget per mark (see the transfer note in the loop below). */
    const HOME_LOGO_BUDGET: Record<(typeof BRAND_IDS)[number], number> = {
      "rad-games": 150 * 1024,
      "imaging-queensland": 1_800_000, // the owner's full-resolution export (1,772,328 bytes)
      "the-xray-group": 150 * 1024,
    };
    // Contrast is measured the way WCAG does (per-pixel against the theme navy
    // #0A1628, averaged over the visible pixels); a mark's own dark outline may sit
    // at 1:1 against it, so the pin is the mean rather than every pixel.
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
      expect(meta.hasAlpha).toBe(expectAlpha[id]);
      // The mark is sized by HEIGHT on screen (`h-9` = 36 CSS px), so the 3x-DPR
      // slot is 108 device px tall. All three marks clear that: the master's is
      // 420 px, the owner's own Imaging Queensland export 725 px (the 2170x725 file
      // the owner sent on 1 Oct evening, installed as it came) and The Xray Group's
      // 118 px. This floor catches a bar pointed at a thumbnail-sized or
      // pre-scaled file.
      expect(meta.height ?? 0).toBeGreaterThanOrEqual(108);
      // Transfer budget, per brand. The two derived marks stay under 150 kB; Imaging
      // Queensland's is the owner's own export at full resolution (1.69 MiB), which
      // the owner chose to ship as supplied rather than have it resampled — so the
      // budget there pins the byte count the owner's file actually has, which still
      // catches any silent re-encode or re-supply.
      expect(readFileSync(file).length).toBeLessThan(HOME_LOGO_BUDGET[id]);

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

  test("the Imaging Queensland top-bar mark is the owner's current export, installed as supplied", async () => {
    // Owner direction, 1 Oct: "put this imaging Queensland logo on instead" — which
    // turned into three supplies in one day. The 583x174 landscape export installed
    // that morning (https://ibb.co/TxDY9MwB, md5 5bd49aae…, kept as
    // `iq-home-logo-2026-10-01.png`) was the OLD mark; the 300x210 export that
    // replaced it (https://ibb.co/8gKcz7YX → i.ibb.co/b5WJHKb7/IMG-1258.png, md5
    // eb0196b6…, kept as `iq-home-logo-2026-10-01-whitefield.png`) was REJECTED —
    // it had no alpha, so it drew as an opaque white tile in the bar, much narrower
    // than the mark it retired. The owner's third supply is the brand's current
    // mark with the corners rounded in the artwork itself
    // (https://ibb.co/wNRDDWr5 → i.ibb.co/xSDVVj8x/D771-F476-…-DE4-F.png), archived
    // in public/_originals/brands/ as `iq-home-logo-2026-10-01-owner-rounded.png`.
    // That re-supply IS what this instance ships, byte for byte, through
    // `homeLogoKeep` in scripts/brand-artwork-assets.mjs.
    const file = publicFile(BRANDS["imaging-queensland"].homeLogoUrl);
    const original = fileURLToPath(
      new URL(
        "../../public/_originals/brands/iq-home-logo-2026-10-01-owner-rounded.png",
        import.meta.url,
      ),
    );
    const bytes = readFileSync(file);
    expect(bytes.equals(readFileSync(original))).toBe(true);
    expect(createHash("md5").update(bytes).digest("hex")).toBe(
      "c16f680faac96392bcc84a4b0ff69f9c",
    );

    const meta = await sharp(file).metadata();
    expect(meta.width).toBe(2170);
    expect(meta.height).toBe(725);
    expect(meta.hasAlpha).toBe(true); // RGBA: the corners the owner rounded are cuts
    expect(meta.channels).toBe(4);
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 2.993)).toBeLessThan(0.01);
    // Shipped at the resolution the owner supplied: 1,772,328 bytes, ~1.69 MiB. That
    // is 12x the retired 300x210 export and far past the other marks' 150 kB budget,
    // and it is the owner's explicit choice — the artwork is never resampled, so this
    // pins the file the owner sent rather than a size the app would prefer.
    expect(bytes.length).toBe(1_772_328);

    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    // Transparent to every canvas corner — the opposite of the white field this file
    // replaced. The rounding the owner asked for is drawn IN the artwork, so nothing
    // on the bar element adds it: the `rounded-2xl` element clip that used to sit over
    // this file was removed on 2 Oct and the file's own corners are what shows.
    expect(px(0, 0)[3]).toBe(0);
    expect(px(info.width - 1, 0)[3]).toBe(0);
    expect(px(0, info.height - 1)[3]).toBe(0);
    expect(px(info.width - 1, info.height - 1)[3]).toBe(0);
    // The corner really is cut away, not merely a soft edge: at the shape's top row
    // the first solid pixel sits ~87 px in from the left, where at mid height the
    // solid field starts ~28 px in.
    const solidAlpha = 200;
    const firstSolidX = (y: number) => {
      for (let x = 0; x < info.width; x++) {
        if ((px(x, y)[3] ?? 0) >= solidAlpha) return x;
      }
      return -1;
    };
    const midY = Math.floor(info.height / 2);
    let topRow = -1;
    for (let y = 0; y < info.height; y++) {
      if (firstSolidX(y) >= 0) {
        topRow = y;
        break;
      }
    }
    expect(topRow).toBe(56); // a transparent margin, then the shape
    expect(firstSolidX(midY)).toBeLessThan(40); // the field's own left edge at mid height
    expect(firstSolidX(topRow) - firstSolidX(midY)).toBeGreaterThan(40); // one rounded corner

    // The mark's own ink on the bar it is drawn on, measured the way the other
    // pins in this file measure it: per-pixel WCAG contrast against the field,
    // averaged over the solid pixels. The field is the bar itself — the original
    // faint glass, `bg-white/5` over the body gradient's navy #0A1628, which
    // blends to rgb(22,34,51), luminance 0.0153 — and the ink is composited onto
    // it, never compared to the bare token. This mark is a red field (223,28,43)
    // carrying the lockup in white: mean contrast 4.89:1 on the faint glass at a
    // mean luminance of 0.270, against the rejected white-field export's 11.33:1
    // and the retired 583x174 cut-out's 3.38:1.
    const linear = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: number, g: number, b: number) =>
      0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const glass = (a: number, channel: number) => a * 255 + (1 - a) * channel;
    const barLum = luminance(glass(0.05, 0x0a), glass(0.05, 0x16), glass(0.05, 0x28));
    let ink = 0;
    let lum = 0;
    let contrast = 0;
    let red = 0;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < solidAlpha) continue; // the mark's solid pixels, not a soft edge
      const a = data[i + 3] / 255;
      const L = luminance(
        a * data[i] + (1 - a) * glass(0.05, 0x0a),
        a * data[i + 1] + (1 - a) * glass(0.05, 0x16),
        a * data[i + 2] + (1 - a) * glass(0.05, 0x28),
      );
      ink++;
      lum += L;
      contrast += (Math.max(L, barLum) + 0.05) / (Math.min(L, barLum) + 0.05);
      // The brand's red field, and the white lockup drawn on it.
      if (data[i] > 180 && data[i + 1] < 80 && data[i + 2] < 100) red++;
      else if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white++;
    }
    expect(ink).toBe(1_289_654); // the solid field + the lockup, not the transparent margin
    expect(red).toBeGreaterThan(1_000_000); // the red field is really in there
    expect(white).toBeGreaterThan(100_000); // …with the lockup drawn on it in white
    expect(lum / ink).toBeGreaterThan(0.15); // 0.270 measured
    expect(contrast / ink).toBeGreaterThan(3); // 4.89:1 measured on the faint glass
  });

  test("the Xray Group top-bar mark is the owner's export, drawn near 1:1", async () => {
    // The second owner-supplied mark (29 Sep) is small and tightly cut: 351x118
    // with true transparency and ink edge to edge, so there is no margin to trim
    // and no reason to resample it. At `h-9` (36 CSS px) its 2.97 aspect draws
    // ~107 CSS px wide, which is within ~10% of the 3x-DPR slot's 108 px and well
    // above 2x — sharper per device pixel than any other mark in the slot, and
    // 6.6 kB on the wire. This pins the file, not the slot (the slot is shared and
    // pinned separately), so re-cropping or downscaling the artwork fails here.
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

  test("the top bar draws that mark where the greeting chip used to be", () => {
    // Owner direction, 30 Sep. One shared slot and one shared height for every
    // instance (`h-9` = 36 CSS px on a 56 CSS px bar), so the class is a literal,
    // never a brand-conditional value, and the condition is the mark comparison —
    // not a brand id. The chip is the master's fallback, so it must still be
    // rendered for a player whose name is known.
    const root = srcFile("../routes/__root.tsx");
    expect(root).toContain("brand.homeLogoUrl !== brand.logoUrl");
    expect(root).toMatch(/src=\{brand\.homeLogoUrl\}/);
    expect(root).toContain("alt={brand.logoAlt}");
    // The slot carries no filter of its own, and since 2 Oct no corner radius
    // either: every bar mark is drawn as its own artwork (owner direction, in the
    // single-bar test below) with the corners the file itself has. Both of those
    // are pinned in the no-corner-clip test below.
    expect(root).toMatch(
      /className="h-9 w-auto max-w-\[45%\] shrink-0 object-contain object-right select-none"/,
    );
    expect(root).not.toContain("brightness-0");
    expect(root).toContain("Hi, {playerName}");
    // The shared Rad Games mark stays on the left of the same bar.
    expect(root).toMatch(/src=\{brand\.logoUrl\}/);
  });

  test("the top bar is the original faint glass everywhere, with no filter on any mark", () => {
    // Owner direction, 1 Oct (final, and the last word): "It actually looks
    // better how we originally had it." The white/25 and white/90 bands this bar
    // tried in between are gone, and the bar is the ORIGINAL faint glass —
    // `bg-white/5 backdrop-blur-md`, the string the neutral master never stopped
    // using — as ONE unconditional class on the element. There is no
    // brand-conditional bar left to drift, and no instance can be whiter than
    // another.
    const root = srcFile("../routes/__root.tsx");
    const ORIGINAL = "sticky top-0 z-30 bg-white/5 backdrop-blur-md safe-area-top";
    // Every top-bar class literal in the file, in source order. Exactly one.
    const barClasses = [...root.matchAll(/"(sticky top-0 z-30 [^"]*safe-area-top)"/g)].map(
      (m) => m[1],
    );
    expect(barClasses).toHaveLength(1);
    expect(barClasses[0]).toBe(ORIGINAL);
    // It is a literal on the element, not a ternary that picks it: the bar is not
    // per-brand at all any more.
    expect(root).toContain(`<header className="${ORIGINAL}">`);
    // The faint glass the owner liked is kept — a translucent field with a blur,
    // not a flat fill, and nothing whiter than it anywhere in the file.
    expect(ORIGINAL).toContain("backdrop-blur-md");
    expect(ORIGINAL).toMatch(/bg-white\/5\b/);
    for (const whiter of ["bg-white/25", "bg-white/70", "bg-white/80", "bg-white/90"]) {
      expect(root).not.toContain(whiter);
    }
    // The comparison the right-hand slot reads is still the mark comparison, never
    // a brand id — only the BAR stopped being conditional, the slot did not.
    expect(root).toContain("brand.homeLogoUrl !== brand.logoUrl");

    // No silhouette filter, anywhere, on either mark. The owner rejected the
    // treatment this bar briefly carried — "The logos weren't supposed to change I
    // just wanted the background to be whiter" — and re-supplied the real artwork
    // on 1 Oct, so both bar marks are drawn exactly as their files are.
    expect(root).not.toContain("brightness-0");
    expect(root).not.toMatch(/"h-12 w-auto [^"]*"/); // the shared mark: one plain class
    expect(root).toMatch(
      /<img src=\{brand\.logoUrl\} alt=\{brand\.logoAlt\} className="h-12 w-auto" \/>/,
    );
    // No CSS filter utility survives on either bar mark (none of Tailwind's
    // brightness/contrast/grayscale/invert/saturate utilities).
    expect(root).not.toMatch(/"[^"]*\b(brightness|contrast|grayscale|invert|saturate)-[^"]*"/);
  });

  test("the bar mark carries no corner clip, on any instance", () => {
    // Owner direction, 2 Oct: the slot's `rounded-2xl` clip is GONE. It was added a
    // day earlier ("make the imaging Queensland logo have round corners the same as
    // the whole app does on its tiles") and removed the next day, when the owner's
    // square-cornered The Xray Group logo arrived and the clip left it looking cut
    // off / rounded. The clip was dropped for EVERY instance rather than made
    // per-brand, because the Imaging Queensland artwork already has its rounded
    // corners baked into the file — its look is unchanged without the clip — so one
    // class list still describes all three instances.
    const root = srcFile("../routes/__root.tsx");
    // The slot's class list, pinned in full: nothing was dropped but the radius.
    expect(root).toMatch(
      /className="h-9 w-auto max-w-\[45%\] shrink-0 object-contain object-right select-none"/,
    );
    // Pin the negative on the branded <img> itself, not just on the rest of the file:
    // no corner-radius utility, and no overflow/mask either. The artwork's own corners
    // are what the player sees.
    const barImg = root.match(/<img\s+src=\{brand\.homeLogoUrl\}[\s\S]*?\/>/);
    expect(barImg?.[0]).toBeDefined();
    const barImgSrc = barImg?.[0] ?? "";
    expect(barImgSrc).not.toMatch(/\brounded(-[a-z0-9]+)?\b/);
    expect(barImgSrc).not.toMatch(/\b(overflow-hidden|mask|clip-path)\b/);
    // Nothing on the bar is rounded by the tile radius any more, and the same holds
    // for the shared Rad Games mark on the left of that bar.
    const barClassAttrs = [...root.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    expect(barClassAttrs.filter((c) => c.split(/\s+/).includes("rounded-2xl"))).toHaveLength(0);
    expect(root).toMatch(
      /<img src=\{brand\.logoUrl\} alt=\{brand\.logoAlt\} className="h-12 w-auto" \/>/,
    );
    // The radius the clip was matching is still the app's own tile radius — this test
    // says the BAR no longer uses it, not that the token went away: the home screen's
    // game grid still draws every tile `rounded-2xl` (`src/routes/index.tsx`).
    const home = srcFile("../routes/index.tsx");
    expect(home).toMatch(/overflow-hidden rounded-2xl bg-gradient-to-br/);
    expect(home).toContain("grid grid-cols-2 gap-3"); // the games grid those tiles sit in
  });

  test("every instance's bar renders the same faint glass, and each mark keeps its artwork on it", async () => {
    // Owner direction, 1 Oct (final): the bar is the ORIGINAL faint glass on all
    // three instances, pinned as source in the test above. This is the rendered
    // half of that pin: composite each mark over the field the bar actually draws
    // and read the field and the ink off those pixels. A translucent bar IS its own
    // alpha blended with what passes underneath, so `bg-white/5` over the body
    // gradient's navy (#0A1628) is rgb(22,34,51) and not white — these checks use
    // the blend, never the token.
    const linear = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: number, g: number, b: number) =>
      0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const glass = (a: number, channel: number) => a * 255 + (1 - a) * channel;
    /** The one field every instance's bar draws: `bg-white/5` over the body's navy. */
    const FIELD = { r: glass(0.05, 0x0a), g: glass(0.05, 0x16), b: glass(0.05, 0x28) };
    const BAR_LUM = luminance(FIELD.r, FIELD.g, FIELD.b);
    // A faint glass, in pixels: above the bare navy (0.0079) and nowhere near the
    // 0.7+ a white band reaches — 0.0153 as rendered.
    expect(BAR_LUM).toBeGreaterThan(0.0079);
    expect(BAR_LUM).toBeLessThan(0.05);

    /** The mark's own ink on that field (mean luminance and WCAG contrast). */
    const render = async (url: string) => {
      const { data } = await sharp(publicFile(url))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let ink = 0;
      let inkLum = 0;
      let contrast = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue; // the mark's solid ink, not its soft edge
        const a = data[i + 3] / 255;
        const L = luminance(
          a * data[i] + (1 - a) * FIELD.r,
          a * data[i + 1] + (1 - a) * FIELD.g,
          a * data[i + 2] + (1 - a) * FIELD.b,
        );
        ink++;
        inkLum += L;
        contrast += (Math.max(L, BAR_LUM) + 0.05) / (Math.min(L, BAR_LUM) + 0.05);
      }
      return { bar: BAR_LUM, ink: inkLum / ink, contrast: contrast / ink };
    };

    for (const id of BRAND_IDS) {
      // A pilot instance's bar carries two marks (the shared one left, its own
      // right); the master carries only the shared one — the chip fills its
      // right-hand slot.
      const pilot = BRANDS[id].homeLogoUrl !== BRANDS[id].logoUrl;
      const marks = pilot
        ? [BRANDS[id].logoUrl, BRANDS[id].homeLogoUrl]
        : [BRANDS[id].logoUrl];
      for (const url of marks) {
        const drawn = await render(url);
        // One bar, one field, on every instance: no instance is whiter than
        // another any more.
        expect(drawn.bar).toBeCloseTo(0.0153, 3);
        // Every mark reads on that faint glass, each in its own artwork — Rad Games
        // 7.41:1, Imaging Queensland 4.89:1, The Xray Group 6.11:1 — so the
        // original glass is not a field a mark disappears into. (Imaging
        // Queensland's number moved with the owner's 1 Oct re-supplies: 3.38:1 for
        // the old 583x174 cut-out, 11.33:1 for the rejected white-field 300x210
        // export, and 4.89:1 for the 2170x725 export that replaced it — a red
        // field carrying the lockup in white, with the corners rounded in the
        // artwork.)
        expect(drawn.contrast).toBeGreaterThan(3);
        // And each one is its own artwork rather than a silhouette: the mean ink
        // luminance is 0.431 for the shared mark, 0.270 for Imaging Queensland's
        // red field and white lockup and 0.349 for The Xray Group's.
        expect(drawn.ink).toBeGreaterThan(0.15);
      }
    }
  });

  test("the games home header greets the player and draws no brand mark", () => {
    // Owner direction, 30 Sep: the greeting next to Rex stays exactly as it was,
    // and the brand mark that briefly sat opposite it is gone — a pilot
    // instance's mark now lives in the top bar's right-hand slot instead.
    const home = srcFile("../routes/index.tsx");
    expect(home).toContain("`Hi, ${playerName}!`");
    expect(home).not.toContain("homeLogoUrl");
    expect(home).not.toContain("tileLogoUrl");
    expect(home).not.toMatch(/ml-auto h-10 w-auto shrink-0/);
    // A long nickname must still ellipsise rather than overflow the row, so the
    // text column keeps `min-w-0` and the headline keeps truncating.
    expect(home).toMatch(/<div className="min-w-0">/);
    expect(home).toMatch(/text-xl font-bold text-white truncate whitespace-nowrap/);
  });

  test("a game page's title tile is the game icon and name only", () => {
    // The brand mark on the white title tile (29 Sep) was revoked on 30 Sep: the
    // tile is back to the pre-#75 state, and the field that fed its artwork is
    // gone from the brand config, so nothing can point at a tile logo any more.
    const page = srcFile("../routes/play.$gameId.tsx");
    expect(page).not.toContain("tileLogoUrl");
    expect(page).not.toContain("homeLogoUrl");
    expect(page).toContain("game.title");
    for (const id of BRAND_IDS) {
      expect(BRANDS[id]).not.toHaveProperty("tileLogoUrl");
    }
  });

  test("The Xray Group's installed app icon is the owner's revised artwork", async () => {
    // Owner report (30 Sep): the old icon's mark ran right to the edges, so the
    // installed app "looked too big" on the home screen. The replacement is the
    // same Rex-X mark with real margins around it, scaled faithfully from the
    // owner's 1024x1024 export — never re-cropped and never re-margined — so the
    // padding the owner drew is what installs. The pin is the subject's share of
    // the canvas: 0.62 here, against 0.93 in the artwork it replaced.
    const icons = [
      [512, BRANDS["the-xray-group"].icon512Url],
      [192, BRANDS["the-xray-group"].icon192Url],
      [180, BRANDS["the-xray-group"].appleTouchIconUrl],
    ] as const;
    for (const [size, url] of icons) {
      const file = publicFile(url);
      const meta = await sharp(file).metadata();
      expect([meta.width, meta.height]).toEqual([size, size]);
      expect(meta.hasAlpha).toBe(false); // an app icon is opaque, as supplied

      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let x0 = info.width;
      let x1 = -1;
      let y0 = info.height;
      let y1 = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * 4;
          // The artwork sits on white; anything darker is the mark itself.
          if (data[i] > 242 && data[i + 1] > 242 && data[i + 2] > 242) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      const widthShare = (x1 - x0 + 1) / info.width;
      const heightShare = (y1 - y0 + 1) / info.height;
      expect(widthShare).toBeGreaterThan(0.5); // a whole, readable mark
      expect(widthShare).toBeLessThan(0.75); // with the margin the owner wanted
      expect(heightShare).toBeGreaterThan(0.5);
      expect(heightShare).toBeLessThan(0.75);
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
