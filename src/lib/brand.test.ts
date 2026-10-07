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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  BAR_LOGO_VERSION,
  BRANDS,
  BRAND_IDS,
  DEFAULT_BRAND_ID,
  HOME_LOGO_VERSION,
  PRODUCT_NAME,
  brand,
  brandConfig,
  brandIdFromEnv,
  colourGameTitle,
  installIcons,
  isBrandId,
  manifestFor,
  resolveBrandId,
  welcomeMessageFor,
} from "./brand";
import { ACHIEVEMENTS, MASCOT_BADGE_ID, badgeIcon, badgeName } from "./achievements";
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

/**
 * Every shipped `.ts`/`.tsx` file under `src/`, as [path, contents] pairs.
 *
 * Test files are skipped: they legitimately import the shared badge definitions
 * to pin them (this file does), and a player never runs them.
 */
function srcSources(dir = fileURLToPath(new URL("../", import.meta.url))): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...srcSources(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push([full, readFileSync(full, "utf8")]);
  }
  return out;
}

/**
 * Source with `import type …` statements removed. A type-only import is erased
 * at build time, so it can carry no shared icon path — or any other value — into
 * a render surface; `src/lib/profile.ts` imports one badge STAT type from the
 * shared module that way and is not a reader of the badge definitions.
 */
const withoutTypeImports = (source: string) =>
  source.replace(/import\s+type\s*\{[^}]*\}\s*from\s*"[^"]*";/g, "");

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
    // the game ID stays `colour-rex`, because that is what scores are submitted
    // (and stored) under. The ICON beside that title is the one game icon that
    // follows the brand since 2 Oct 2026, so both tiles read
    // `brand.colourGameIcon` (pinned by name below).
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
      // ...and the icon next to that title comes from the brand config on both
      // tiles, so a brand's own artwork reaches both at once (see "the colouring
      // game's icon follows the brand" below).
      ["../routes/index.tsx", /icon: brand\.colourGameIcon,/],
      [
        "../routes/play.$gameId.tsx",
        /"colour-rex": \{ title: colourGameTitle\(\), icon: brand\.colourGameIcon \}/,
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

  test("the colouring game's home-tile subtitle is shared copy, its title is not", () => {
    // Owner copy change, 3 Oct 2026: the games-home tile's subtitle reads "Colour
    // our mascot". It is a SHARED games-list entry, so the words are the same on
    // all three instances — nothing brand-specific to resolve, and no helper to
    // add. What must NOT move with it is the tile's TITLE: the owner explicitly
    // kept the game's name, which stays `colourGameTitle()` and therefore still
    // carries each brand's mascot ("Colour Rex" / "Colour Stu"). The game page's
    // title tile and the leaderboard label are untouched for the same reason.
    const home = srcFile("../routes/index.tsx");
    // The subtitle sits on the colouring game's own entry (the id is internal and
    // unchanged: it is what scores are submitted under).
    expect(home).toMatch(/id: "colour-rex",[\s\S]{0,600}?subtitle: "Colour our mascot",/);
    expect(home).not.toMatch(/Colour the mascot/i);
    // ...and the title on that same entry still comes from the mascot helper.
    expect(home).toMatch(/id: "colour-rex",[\s\S]{0,600}?title: colourGameTitle\(\),/);
    expect(colourGameTitle(BRANDS["rad-games"])).toBe("Colour Rex");
    expect(colourGameTitle(BRANDS["the-xray-group"])).toBe("Colour Rex");
    expect(colourGameTitle(BRANDS["imaging-queensland"])).toBe("Colour Stu");
    // The old wording is gone from every shipped source file, not just the tile.
    const stale = srcSources()
      .filter(([, contents]) => /Colour the mascot/i.test(contents))
      .map(([file]) => file);
    expect(stale).toEqual([]);
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
    // resolves it for the instance. The badge ID stays as it is — unlocks are
    // keyed by it — and so does this SHARED icon path: the server never draws
    // badge artwork, and the two pilot brands' own pictures of it are swapped in
    // on the browser half only (see "the badge named after the mascot carries
    // the brand's own artwork" below).
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
    // bar marks), while the FILE it names is still the unversioned path. That one
    // stamp covers all three instances because they draw ONE file here; a pilot's
    // own mark carries its own instead (see `HOME_LOGO_VERSION`).
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
    //
    // Two stamps, because the bar draws two files: the shared Rad Games mark
    // (one file, all three instances) and a pilot's OWN mark. The owner
    // re-supplied Imaging Queensland's own mark on 7 Oct 2026 ("replace the red
    // one"), so that one file's address moved to `?v=4` — and, deliberately, ONLY
    // that one: the other instances' addresses did not change, because their bytes
    // did not.
    expect(BAR_LOGO_VERSION).toBe("3");
    expect(HOME_LOGO_VERSION["imaging-queensland"]).toBe("4");
    expect(HOME_LOGO_VERSION["the-xray-group"]).toBe("3");
    expect(BRANDS["imaging-queensland"].homeLogoUrl).toBe(
      "/brands/imaging-queensland/home-logo.png?v=4",
    );
    // The stamp is a query only, so it names the same file: the artwork pins above
    // (and the static handler, which serves by pathname) still read one path.
    expect(publicFile("/brands/the-xray-group/home-logo.png?v=3")).toBe(
      publicFile("/brands/the-xray-group/home-logo.png"),
    );
    expect(publicFile("/brands/imaging-queensland/home-logo.png?v=4")).toBe(
      publicFile("/brands/imaging-queensland/home-logo.png"),
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
  test("the colouring game's icon follows the brand, and the master's is untouched", async () => {
    // On 2 Oct 2026 the owner supplied this ONE game icon per brand — the mascot
    // with a brush and palette, drawn in each brand's own colours — so it is the
    // only game icon in the app that follows the brand (every other one is still
    // the shared /icons/*.png). The master deliberately keeps the file it has
    // always drawn: the neutral instance is live, and its icon must not move.
    expect(BRANDS["rad-games"].colourGameIcon).toBe("/icons/icon-colour-rex.png");
    expect(
      createHash("sha256")
        .update(readFileSync(publicFile("/icons/icon-colour-rex.png")))
        .digest("hex"),
    ).toBe("0671c09e7315c2674e4dc2dda4d73de4a412d8ccef0d969ff33883f067907a84");

    for (const id of pilots) {
      const config = BRANDS[id];
      expect(config.colourGameIcon).toContain(`/brands/${id}/`);
      expect(config.colourGameIcon).not.toBe(BRANDS["rad-games"].colourGameIcon);
      // A NEW address for new artwork: both pilot urls carry a stamp, so no
      // device can answer them out of a cache of the picture they replace — the
      // trap that taught us this is recorded at BAR_LOGO_VERSION.
      expect(config.colourGameIcon).toMatch(/\?v=\d+$/);
      const file = publicFile(config.colourGameIcon);
      expect(existsSync(file)).toBe(true);
      const image = sharp(file);
      const { width, height } = await image.metadata();
      // Square, so the title tile's square `object-contain` slot is filled
      // without letterboxing (the owner's Imaging Queensland export is 1312x1199
      // and was padded to square, never stretched)...
      expect(width).toBe(512);
      expect(height).toBe(512);
      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number) =>
        data[(y * info.width + x) * info.channels + 3];
      // ...and transparent around the character, so it sits on the dark tile
      // without a white box, while the mascot still fills the canvas (the
      // character and its brush and palette ink ~39% of the square; a shrunken or
      // half-empty export would fall well below that).
      expect(alphaAt(0, 0)).toBe(0);
      expect(alphaAt(info.width - 1, info.height - 1)).toBe(0);
      let inked = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) if (alphaAt(x, y) > 8) inked++;
      }
      expect(inked / (info.width * info.height)).toBeGreaterThan(0.25);
      // Small enough to fetch over a phone's own data in a waiting room.
      expect(readFileSync(file).byteLength).toBeLessThan(150_000);
    }
    // Two brands, two pictures: the tiles must not show the same mascot.
    expect(
      readFileSync(publicFile(BRANDS["imaging-queensland"].colourGameIcon)).equals(
        readFileSync(publicFile(BRANDS["the-xray-group"].colourGameIcon)),
      ),
    ).toBe(false);
  });

  test("the badge named after the mascot carries the brand's own artwork", async () => {
    // On 3 Oct 2026 the owner supplied a picture of this ONE badge per pilot
    // brand: the mascot hugging a heart that spells the badge's own name ("Rex's
    // Best Friend" / "Stu's Best Friend"), 1233-1234 x 1275 RGBA exports. So it
    // becomes the second piece of artwork that follows the brand, after the
    // colouring game's icon. The badge ID is untouched — unlocks are keyed by it
    // — and so is the `{mascot}`-resolved NAME pinned in the test above: both
    // brands' pictures already spell the name themselves.
    //
    // The master keeps the SHARED file, unversioned and byte-identical: the owner
    // did not ask for the neutral instance to change, and that file has been live
    // all along.
    expect(BRANDS["rad-games"].bestFriendBadgeUrl).toBe("/badges/rexs-best-friend.png");
    expect(
      createHash("sha256")
        .update(readFileSync(publicFile("/badges/rexs-best-friend.png")))
        .digest("hex"),
    ).toBe("e9d526f99bb8407e76c1cfcf4ba0b18d6eab0906cf84424ac312da75ac749335");

    for (const id of pilots) {
      const config = BRANDS[id];
      expect(config.bestFriendBadgeUrl).toContain(`/brands/${id}/`);
      expect(config.bestFriendBadgeUrl).not.toBe(BRANDS["rad-games"].bestFriendBadgeUrl);
      // A NEW address for NEW artwork: both pilot urls carry a stamp, so no
      // device can answer them out of a cache of the shared picture they replace
      // (the trap that taught us this is recorded at BAR_LOGO_VERSION).
      expect(config.bestFriendBadgeUrl).toMatch(/\?v=\d+$/);
      const file = publicFile(config.bestFriendBadgeUrl);
      expect(existsSync(file)).toBe(true);
      const { width, height } = await sharp(file).metadata();
      // Square, so the badge grid's square `object-contain` slot is filled
      // without letterboxing (both exports are ~1233x1275 and were fitted into
      // the square and padded with transparent pixels, never stretched)...
      expect(width).toBe(512);
      expect(height).toBe(512);
      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number) =>
        data[(y * info.width + x) * 4 + 3];
      // ...and transparent around the character, so it sits on the dark card
      // without a white box, while the mascot still fills the canvas.
      expect(alphaAt(0, 0)).toBe(0);
      expect(alphaAt(info.width - 1, info.height - 1)).toBe(0);
      let inked = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) if (alphaAt(x, y) > 8) inked++;
      }
      expect(inked / (info.width * info.height)).toBeGreaterThan(0.25);
      // Small enough to fetch over a phone's own data in a waiting room (the
      // owner's 2.1 MB exports are ~97 kB each once fitted to 512 px).
      expect(readFileSync(file).byteLength).toBeLessThan(102_400);
    }
    // Two brands, two pictures: the badge grid must not show the same mascot.
    expect(
      readFileSync(publicFile(BRANDS["imaging-queensland"].bestFriendBadgeUrl)).equals(
        readFileSync(publicFile(BRANDS["the-xray-group"].bestFriendBadgeUrl)),
      ),
    ).toBe(false);
  });

  test("the browser resolves that badge's icon per brand, the server keeps the shared path", () => {
    // The shared definitions are what the leaderboard server imports, and the
    // deployed image runs that file verbatim out of `server/` — where the brand
    // config is not present at all. It also never DRAWS badge artwork (it stores
    // and returns badge IDs), so its copy of the icon path stays shared and pure,
    // and the swap lives on the browser half beside the `{mascot}` name.
    const shared = SHARED_ACHIEVEMENTS.find((a) => a.id === MASCOT_BADGE_ID);
    expect(shared).toBeDefined();
    expect(shared!.icon).toBe("/badges/rexs-best-friend.png");
    for (const id of BRAND_IDS) {
      expect(badgeIcon(shared!, BRANDS[id])).toBe(BRANDS[id].bestFriendBadgeUrl);
    }
    // Every OTHER badge keeps the shared path on every brand.
    for (const badge of SHARED_ACHIEVEMENTS.filter((a) => a.id !== MASCOT_BADGE_ID)) {
      for (const id of BRAND_IDS) expect(badgeIcon(badge, BRANDS[id])).toBe(badge.icon);
    }
    // The default argument is the running brand, and the array the app draws from
    // is the resolved one...
    expect(badgeIcon(shared!)).toBe(brand.bestFriendBadgeUrl);
    const shown = ACHIEVEMENTS.find((a) => a.id === MASCOT_BADGE_ID);
    expect(shown).toBeDefined();
    expect(shown!.icon).toBe(brand.bestFriendBadgeUrl);
    expect(shown!.name).toBe(`${brand.mascotName}'s Best Friend`);
    for (const badge of ACHIEVEMENTS) {
      const fromShared = SHARED_ACHIEVEMENTS.find((a) => a.id === badge.id)!;
      expect(badge.icon).toBe(
        badge.id === MASCOT_BADGE_ID ? brand.bestFriendBadgeUrl : fromShared.icon,
      );
    }
    // ...and no render surface may reach the raw shared definitions: the shared
    // module is imported by the browser half only, and each surface that draws a
    // badge does it through one of the three accessors there.
    const importers = srcSources()
      .filter(([, contents]) =>
        /from\s+"[^"]*server\/achievement-core"/.test(withoutTypeImports(contents)),
      )
      .map(([file]) => file.slice(file.indexOf("/src/") + 5).replace(/^\//, ""));
    expect(importers).toEqual(["lib/achievements.ts"]);
    expect(srcFile("../routes/index.tsx")).toContain("getLastEarnedAchievement");
    expect(srcFile("../routes/achievements.tsx")).toContain("getAchievements");
    // Every game that shows the unlock toast resolves its badge the same way.
    const toasts = srcSources().filter(
      ([file, contents]) =>
        file.includes("/components/games/") && contents.includes("AchievementToast"),
    );
    expect(toasts.length).toBeGreaterThan(0);
    for (const [, contents] of toasts) expect(contents).toContain("checkAchievements(");
  });
  test("the memory game's face-down tile is one shared picture, at a stamped address", async () => {
    // The face-down card is the same picture on every brand (guest tiles are not
    // per-brand artwork). The owner replaced its bytes on 2 Oct 2026 — the earlier
    // Rex tile became a glossy tile carrying a scan glyph — so the game's <img>
    // asks for a stamped address: the file name is unchanged, and a device that
    // cached the previous bytes would otherwise keep drawing the old tile.
    const source = srcFile("../components/games/MemoryScan.tsx");
    expect(source).toMatch(/src="\/rex-memory-tile\.png\?v=\d+"/);
    const file = publicFile("/rex-memory-tile.png");
    expect(existsSync(file)).toBe(true);
    const { width, height } = await sharp(file).metadata();
    expect(width).toBe(height); // the grid's cards are square
    expect(width).toBe(512);
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(info.width - 1, info.height - 1)).toBe(0);
    expect(readFileSync(file).byteLength).toBeLessThan(150_000);
    // The superseded Rex tile is archived, not deleted, so a re-supply can be
    // compared byte for byte with what it replaced.
    expect(
      existsSync(
        fileURLToPath(new URL("../../public/_originals/rex-memory-tile-2026-09-06.png", import.meta.url)),
      ),
    ).toBe(true);
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
      const icons = installIcons(config);
      const expected: [string, number][] = [
        [icons.icon192Url, 192],
        [icons.icon512Url, 512],
        [icons.appleTouchIconUrl, 180], // what iOS asks for
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

  test("a re-supplied app icon is served at a NEW address, and only for that brand", () => {
    // The owner re-supplied The Xray Group's app icon on 3 Oct 2026 ("it was a
    // bit small"), and the three icon FILES kept their names — so the addresses
    // the installed-app surfaces request had to move, or a phone that already
    // installed this app would keep drawing the picture in its own cache. The
    // master and Imaging Queensland carry no such addresses and therefore keep
    // the exact urls they have served since launch: a `?v=` appearing on either
    // of them would silently change a live app's icon request.
    const txg = BRANDS["the-xray-group"];
    expect(txg.manifestIcons).toEqual({
      icon192Url: "/brands/the-xray-group/icon-192.png?v=1",
      icon512Url: "/brands/the-xray-group/icon-512.png?v=1",
      appleTouchIconUrl: "/brands/the-xray-group/icon-180.png?v=1",
    });
    for (const id of ["rad-games", "imaging-queensland"] as const) {
      expect(BRANDS[id]).not.toHaveProperty("manifestIcons");
      expect(installIcons(BRANDS[id])).toEqual({
        icon192Url: BRANDS[id].icon192Url,
        icon512Url: BRANDS[id].icon512Url,
        appleTouchIconUrl: BRANDS[id].appleTouchIconUrl,
      });
    }
    expect(installIcons(BRANDS["rad-games"]).icon512Url).toBe("/icon-512.png");
    expect(installIcons(BRANDS["imaging-queensland"]).icon512Url).toBe(
      "/brands/imaging-queensland/icon-512.png",
    );
    // Every stamped install-icon address still names the same file as the
    // unversioned field beside it — the query is part of the request address
    // only, so `?v=1` must not 404.
    for (const url of Object.values(txg.manifestIcons!)) {
      expect(url.split("?")[0]).toBe(url.replace(/\?v=1$/, ""));
      expect(publicFile(url)).toBe(publicFile(url.replace("?v=1", "")));
    }
    expect(installIcons()).toEqual(installIcons(brand));
  });

  test("the master's icons are the same files it has always shipped", () => {
    const master = BRANDS["rad-games"];
    expect(master.icon192Url).toBe("/icon-192.png");
    expect(master.icon512Url).toBe("/icon-512.png");
    expect(master.appleTouchIconUrl).toBe("/apple-touch-icon.png?v=3");
    // The installed-app surfaces read `installIcons()`, so the pin has to hold
    // there too: the master must not have gained a stamped icon address when The
    // Xray Group's icon moved (3 Oct 2026).
    expect(installIcons(master).icon192Url).toBe("/icon-192.png");
    expect(installIcons(master).icon512Url).toBe("/icon-512.png");
    expect(installIcons(master).appleTouchIconUrl).toBe("/apple-touch-icon.png?v=3");
    // Imaging Queensland's own icons are likewise untouched by that change: same
    // three urls, no version stamp.
    const iq = installIcons(BRANDS["imaging-queensland"]);
    expect(iq.icon192Url).toBe("/brands/imaging-queensland/icon-192.png");
    expect(iq.icon512Url).toBe("/brands/imaging-queensland/icon-512.png");
    expect(iq.appleTouchIconUrl).toBe("/brands/imaging-queensland/icon-180.png");
  });

  test("the add-to-phone page's icon follows the brand, and the master's is untouched", async () => {
    // The add-to-phone page's final card shows "this is what lands on your Home
    // Screen". Until 3 Oct 2026 that was the SHARED `/icon-512.png` on every
    // instance; the owner then supplied each pilot brand its own app-icon
    // picture ("rounded, per brand, like an app icon") and the master was
    // deliberately left alone.
    const master = BRANDS["rad-games"];
    expect(master.addToPhoneIconUrl).toBe("/icon-512.png");
    // The stamps, pinned by value: The Xray Group's picture was re-supplied on
    // 3 Oct 2026 (the owner's revised app icon, same file name), so its address
    // moved on to `?v=2` while Imaging Queensland's `?v=1` picture is the one it
    // has served since the same morning and does not move.
    expect(BRANDS["the-xray-group"].addToPhoneIconUrl).toBe(
      "/brands/the-xray-group/add-to-phone-icon.png?v=2",
    );
    expect(BRANDS["imaging-queensland"].addToPhoneIconUrl).toBe(
      "/brands/imaging-queensland/add-to-phone-icon.png?v=1",
    );
    // The master's file is the same bytes it has always served, so the live
    // neutral instance cannot move because of this change...
    expect(
      createHash("sha256")
        .update(readFileSync(publicFile("/icon-512.png")))
        .digest("hex"),
    ).toBe("8b5deebc0a8cde95dde8953a1b6eeb4d219a46f8839fe05eb28a81dc399313ff");
    for (const id of pilots) {
      const config = BRANDS[id];
      expect(config.addToPhoneIconUrl).toContain(`/brands/${id}/`);
      expect(config.addToPhoneIconUrl).not.toBe(master.addToPhoneIconUrl);
      // A NEW address for new artwork: the `?v=1` stamp is what stops a device
      // answering it out of a cache of the square `/icon-512.png` this instance
      // used to draw here (the trap recorded at BAR_LOGO_VERSION).
      expect(config.addToPhoneIconUrl).toMatch(/\?v=\d+$/);
      const file = publicFile(config.addToPhoneIconUrl);
      expect(existsSync(file)).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("png");
      // One square, at the size the DONE card's 80 CSS px slot wants on a 2x
      // phone, with alpha the supplied exports do not have: the rounding is a
      // mask, not a CSS clip that a later style change could drop.
      expect([meta.width, meta.height]).toEqual([512, 512]);
      expect(meta.hasAlpha).toBe(true);
      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
      // ...the four corners are transparent (the iOS corner radius, ~22% of the
      // side, is baked into the file)...
      for (const [x, y] of [
        [0, 0],
        [info.width - 1, 0],
        [0, info.height - 1],
        [info.width - 1, info.height - 1],
      ]) {
        expect(alphaAt(x, y)).toBe(0);
      }
      // ...while the edges' midpoints and the middle stay opaque, so the artwork
      // is not mostly transparent or half-masked...
      expect(alphaAt(Math.floor(info.width / 2), 0)).toBe(255);
      expect(alphaAt(0, Math.floor(info.height / 2))).toBe(255);
      expect(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2))).toBe(255);
      // ...and it is a picture a waiting-room phone can fetch.
      expect(readFileSync(file).byteLength).toBeLessThan(150_000);
    }
    // Two brands, two pictures: the card must not show the same mascot.
    expect(
      readFileSync(publicFile(BRANDS["imaging-queensland"].addToPhoneIconUrl)).equals(
        readFileSync(publicFile(BRANDS["the-xray-group"].addToPhoneIconUrl)),
      ),
    ).toBe(false);
    // The PWA/manifest icons are NOT this file: they stay the owner's opaque
    // square, exactly as supplied (iOS paints transparency black on the home
    // screen), so the two must never be pointed at the same bytes.
    for (const id of pilots) {
      expect(BRANDS[id].addToPhoneIconUrl).not.toBe(BRANDS[id].icon512Url);
    }
  });

  test("the add-to-phone page draws the brand's own icon in its done card", () => {
    // The markup pin: the page must read the brand field, not a fixed path. The
    // alt text stays mascotName-driven (pinned in "every user-facing mention of
    // the mascot reads the brand config" above), so this test only follows the
    // `src`.
    const page = srcFile("../routes/qr.tsx");
    expect(page).toMatch(
      /<img\s+src=\{brand\.addToPhoneIconUrl\}\s+alt=\{`\$\{brand\.mascotName\} Home Screen icon`\}/,
    );
    // ...and no hard-coded icon path may come back: that literal is what made
    // all three instances show the shared picture.
    expect(page).not.toContain('"/icon-512.png"');
    expect(page).not.toContain("'/icon-512.png'");
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
    // mark appearing twice. Each pilot's mark carries its own file's version
    // stamp, while the master's two urls are the SAME address (`src/lib/brand.ts`
    // builds both from one constant there), so the equality below holds on the
    // address the device requests, not just on the file name.
    expect(BRANDS["rad-games"].homeLogoUrl).toBe(BRANDS["rad-games"].logoUrl);
    expect(BRANDS["imaging-queensland"].homeLogoUrl).toBe(
      "/brands/imaging-queensland/home-logo.png?v=4",
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
    // The expected stamp is per FILE — the master's slot is the shared mark, and
    // each pilot carries `HOME_LOGO_VERSION` for its own.
    for (const id of BRAND_IDS) {
      const homeStamp = id === "rad-games" ? BAR_LOGO_VERSION : HOME_LOGO_VERSION[id];
      expect(BRANDS[id].homeLogoUrl.endsWith(`?v=${homeStamp}`)).toBe(true);
      expect(BRANDS[id].logoUrl.endsWith(`?v=${BAR_LOGO_VERSION}`)).toBe(true);
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
    // the same kind of file. All three are true-transparency cut-outs today, but
    // that has not always held: Imaging Queensland's 300x210 white-field export
    // (1 Oct morning) had no alpha at all and drew as an opaque white tile on the
    // bar, and the 2170x725 RGBA export that replaced it that evening carried a
    // rounded red plate with the corners cut into the artwork. The owner's 7 Oct
    // re-supply is a plain transparent cut-out with no plate. Recording which is
    // which keeps a future file that silently gains or loses its alpha failing
    // here.
    const expectAlpha: Record<(typeof BRAND_IDS)[number], boolean> = {
      "rad-games": true,
      "imaging-queensland": true,
      "the-xray-group": true,
    };
    /** The wire budget per mark (see the transfer note in the loop below). */
    const HOME_LOGO_BUDGET: Record<(typeof BRAND_IDS)[number], number> = {
      "rad-games": 150 * 1024,
      "imaging-queensland": 150 * 1024, // the owner's 23,382-byte export (7 Oct)
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
      // 416 px, the owner's own Imaging Queensland export 174 px (the 583x174 file
      // the owner sent on 7 Oct, installed as it came) and The Xray Group's 118 px.
      // This floor catches a bar pointed at a thumbnail-sized or pre-scaled file.
      expect(meta.height ?? 0).toBeGreaterThanOrEqual(108);
      // Transfer budget, per brand. Every mark now stays under 150 kB: Imaging
      // Queensland's 1.69 MiB 2170x725 export was replaced on 7 Oct by a 23 kB
      // cut-out, so the three-bar budget is one number again. The exact byte count
      // is pinned per brand in the artwork tests below, which still catches any
      // silent re-encode or re-supply.
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

  test("the Imaging Queensland top-bar mark is the owner's current export, drawn the size of The Xray Group's", async () => {
    // Owner direction, 7 Oct 2026: "we have another logo for the top transparent
    // line to replace the red one… make it as big as the xray group one… the last
    // red one was too small."
    //
    // That report is why this test is no longer only a byte pin. The bar sizes both
    // marks with ONE shared class — `h-9 w-auto max-w-[45%] shrink-0 object-contain
    // object-right`, pinned in the rendered-bar test below — so no element of the
    // app made Imaging Queensland's mark smaller: the ARTWORK did. The retired file
    // was the 2170x725 export installed on 1 Oct (the red plate carrying the white
    // lockup, i.ibb.co/wNRDDWr5, archived as
    // `iq-home-logo-2026-10-01-owner-rounded.png`), and it spends 15.5% of its
    // canvas height on transparent margin, so at the slot's 36 CSS px only 613 of
    // its 725 rows ever held ink: the mark the owner saw was 30.4 CSS px tall
    // against The Xray Group's 35.7. The replacement carries ink to the edges of
    // its canvas, which restores the parity the owner asked for — with TXG's and
    // the master's rendering untouched.
    //
    // The owner's file ships byte for byte, as every bar mark does, through
    // `homeLogoKeep` in scripts/brand-artwork-assets.mjs. This fourth supply
    // (https://ibb.co/NntwHkBr → i.ibb.co/3Y4tL8Zv/IMG-1791.png, md5 2d23edc5…)
    // is archived in public/_originals/brands/ as `iq-home-logo-2026-10-07.png`.
    const file = publicFile(BRANDS["imaging-queensland"].homeLogoUrl);
    const original = fileURLToPath(
      new URL("../../public/_originals/brands/iq-home-logo-2026-10-07.png", import.meta.url),
    );
    const bytes = readFileSync(file);
    expect(bytes.equals(readFileSync(original))).toBe(true);
    expect(createHash("md5").update(bytes).digest("hex")).toBe(
      "2d23edc5af90f75ec8b4971ae5c95896",
    );

    const meta = await sharp(file).metadata();
    expect(meta.width).toBe(583);
    expect(meta.height).toBe(174);
    expect(meta.hasAlpha).toBe(true); // a true-transparency cut-out, with no plate
    expect(meta.channels).toBe(4);
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 3.351)).toBeLessThan(0.01);
    // The export at the resolution the owner supplied, and 76x lighter on the wire
    // than the 1,772,328-byte file it retires — a bar mark is drawn 36 CSS px tall,
    // so nothing here needed that resolution.
    expect(bytes.length).toBe(23_382);

    /** The slot every instance's bar draws a mark in: `h-9` (36 CSS px). */
    const SLOT_H = 36;
    const solidAlpha = 200;
    /**
     * A bar mark's solid-ink box (alpha >= 200, so a soft anti-aliased edge is not
     * ink) with its ink's mean luminance and WCAG contrast on the field it is drawn
     * on — the original faint glass, `bg-white/5` over the body gradient's navy
     * #0A1628, which blends to rgb(22,34,51). Measured the same way as every other
     * ink pin in this file, so the numbers are comparable.
     */
    const measure = async (path: string) => {
      const { data, info } = await sharp(path)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const linear = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (r: number, g: number, b: number) =>
        0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      const glass = (a: number, channel: number) => a * 255 + (1 - a) * channel;
      const barLum = luminance(glass(0.05, 0x0a), glass(0.05, 0x16), glass(0.05, 0x28));
      let x0 = info.width;
      let x1 = -1;
      let y0 = info.height;
      let y1 = -1;
      let ink = 0;
      let lum = 0;
      let contrast = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * 4;
          if ((data[i + 3] ?? 0) < solidAlpha) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          const a = (data[i + 3] ?? 0) / 255;
          const L = luminance(
            a * (data[i] ?? 0) + (1 - a) * glass(0.05, 0x0a),
            a * (data[i + 1] ?? 0) + (1 - a) * glass(0.05, 0x16),
            a * (data[i + 2] ?? 0) + (1 - a) * glass(0.05, 0x28),
          );
          ink++;
          lum += L;
          contrast += (Math.max(L, barLum) + 0.05) / (Math.min(L, barLum) + 0.05);
        }
      }
      return {
        width: info.width,
        height: info.height,
        inkWidth: x1 - x0 + 1,
        inkHeight: y1 - y0 + 1,
        ink,
        lum: lum / ink,
        contrast: contrast / ink,
        alphaAt: (x: number, y: number) => data[(y * info.width + x) * 4 + 3] ?? 0,
      };
    };
    /** What the player actually sees: the mark's ink scaled into the shared slot. */
    const drawnHeight = (m: { inkHeight: number; height: number }) =>
      SLOT_H * (m.inkHeight / m.height);
    const drawnWidth = (m: { width: number; height: number; inkWidth: number }) =>
      SLOT_H * (m.width / m.height) * (m.inkWidth / m.width);

    const iq = await measure(file);
    const txg = await measure(publicFile(BRANDS["the-xray-group"].homeLogoUrl));

    // The pin the owner's complaint distils to: in one fixed-height slot, how tall
    // the mark READS is its ink's share of its own canvas. The new export's ink
    // fills the canvas (0.994 of it), so it draws 35.8 CSS px against The Xray
    // Group's 35.7 — a tenth of a CSS pixel apart, on the class both already had.
    expect(iq.inkHeight / iq.height).toBeGreaterThan(0.95);
    expect(drawnHeight(iq)).toBeCloseTo(drawnHeight(txg), 0);
    expect(drawnHeight(iq)).toBeGreaterThan(35);
    expect(drawnHeight(iq)).toBeLessThan(37);
    // Width follows height through the same `w-auto`, and is within a couple of CSS
    // px of TXG's too: 108.4 against 106.8, because this lockup is 3.35:1 where The
    // Xray Group's is 2.97:1 and the slot caps at 45% of the bar's width, which
    // neither mark reaches at the widths a phone is held at.
    expect(drawnWidth(iq)).toBeGreaterThan(0.95 * drawnWidth(txg));
    expect(drawnWidth(iq)).toBeLessThan(1.15 * drawnWidth(txg));

    // And the diagnosis above, straight from the archive rather than folklore: the
    // retired red export's ink covers 0.845 of its canvas, which is exactly the
    // ~5.4 CSS px the owner saw missing. If a future supply arrives with a margin
    // like that again, the first pin in this block fails instead of the owner
    // having to notice.
    const retired = await measure(
      fileURLToPath(
        new URL(
          "../../public/_originals/brands/iq-home-logo-2026-10-01-owner-rounded.png",
          import.meta.url,
        ),
      ),
    );
    expect(retired.inkHeight / retired.height).toBeLessThan(0.9);
    expect(drawnHeight(retired)).toBeLessThan(drawnHeight(txg) - 4);

    // Transparent to every canvas corner: a cut-out, not the opaque white field nor
    // the rounded red plate its two predecessors drew, and no element clip adds a
    // corner to it (the bar's `rounded-2xl` was removed on 2 Oct).
    expect(iq.alphaAt(0, 0)).toBe(0);
    expect(iq.alphaAt(iq.width - 1, 0)).toBe(0);
    expect(iq.alphaAt(0, iq.height - 1)).toBe(0);
    expect(iq.alphaAt(iq.width - 1, iq.height - 1)).toBe(0);

    // Its ink reads on the faint glass it is drawn on: the owner's mark is the white
    // lockup with no plate behind it, so it sits at 15.6:1 against the 4.89:1 of the
    // red plate it retires and the 3.38:1 of the dark 583x174 cut-out before that.
    expect(iq.ink).toBeGreaterThan(10_000);
    expect(iq.lum).toBeGreaterThan(0.15); // 0.971 measured
    expect(iq.contrast).toBeGreaterThan(3); // 15.62:1 measured
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
    // The owner has now supplied this icon three times. 29 Sep: the mark ran
    // right to the edges, so the installed app "looked too big". 30 Sep: the same
    // Rex-X mark with real margins around it (the subject filled 0.62 x 0.64 of
    // the canvas), which the owner then reported on 3 Oct "was a bit small" —
    // and re-supplied (https://ibb.co/F4Y7bfzf) with the mark drawn tighter,
    // filling 0.73 x 0.76. The shipped file is scaled faithfully from that
    // 1254x1254 export — never re-cropped, re-margined or keyed — so the size the
    // owner drew is the size that installs, and the icon is FULL-BLEED: the
    // phone's own mask is what rounds it, which is why the rounded-corner
    // treatment is deliberately NOT baked into these three files.
    const icons = [
      [512, installIcons(BRANDS["the-xray-group"]).icon512Url],
      [192, installIcons(BRANDS["the-xray-group"]).icon192Url],
      [180, installIcons(BRANDS["the-xray-group"]).appleTouchIconUrl],
    ] as const;
    for (const [size, url] of icons) {
      // Every one of them is a NEW address, so a phone holding the previous
      // artwork cannot answer the request out of its own cache.
      expect(url).toMatch(/\?v=1$/);
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
      // Bigger than the export this replaces (0.62 x 0.64) on every size, which
      // is the whole point of the re-supply...
      expect(widthShare).toBeGreaterThan(0.7);
      expect(heightShare).toBeGreaterThan(0.7);
      // ...and still a whole, readable mark with a little breathing room rather
      // than artwork bleeding off the canvas.
      expect(widthShare).toBeLessThan(0.8);
      expect(heightShare).toBeLessThan(0.82);
      // Full-bleed means the corners are the artwork's own white field, opaque:
      // nothing here is masked (the rounded corners live in the add-to-phone
      // picture only).
      expect(data[3]).toBe(255);
      expect(readFileSync(file).byteLength).toBeLessThan(150_000);
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
    // The manifest reads `installIcons()`, so a re-supplied icon is served at a
    // NEW address there too — and the two brands whose icons have not moved keep
    // the exact urls an already-installed app holds.
    for (const id of BRAND_IDS) {
      expect(manifestFor(BRANDS[id]).icons.map((icon) => icon.src)).toEqual([
        installIcons(BRANDS[id]).icon192Url,
        installIcons(BRANDS[id]).icon512Url,
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
    // ...while The Xray Group's manifest now names the re-supplied artwork at its
    // stamped address, and the head's `apple-touch-icon` (same helper) with it.
    expect(manifestFor(BRANDS["the-xray-group"]).icons.map((icon) => icon.src)).toEqual([
      "/brands/the-xray-group/icon-192.png?v=1",
      "/brands/the-xray-group/icon-512.png?v=1",
    ]);
    expect(installIcons(BRANDS["the-xray-group"]).appleTouchIconUrl).toBe(
      "/brands/the-xray-group/icon-180.png?v=1",
    );
  });

  test("the head's apple-touch-icon comes from the same helper as the manifest", () => {
    // Two surfaces, one source: a brand icon that moved in the manifest but not
    // in the head (or the reverse) would install one picture and show another.
    const root = srcFile("../routes/__root.tsx");
    expect(root).toContain('href: installIcons(brand).appleTouchIconUrl');
    expect(root).not.toContain("brand.appleTouchIconUrl");
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

/**
 * The add-to-phone page's step glyphs — pinned here because this file already
 * pins that page's brand-driven copy (see "every user-facing mention of the
 * mascot reads the brand config"), and because nothing at runtime can catch a
 * glyph that points the wrong way: it renders, it is the right size, and it is
 * only wrong to a human eye.
 */
describe("the add-to-phone page's Share step glyph", () => {
  const page = srcFile("../routes/qr.tsx");
  /** The Share case's own markup, up to the next icon (`menu`). */
  const share = page.slice(page.indexOf("function StepIcon"), page.indexOf('case "menu"'));

  test("the share icon is an arrow leaving the box, not an arrow going into it", () => {
    // The page told the owner's patients to tap "the square with the arrow up",
    // but the glyph shipped as a DOWNLOAD arrow: a shaft down the middle of an
    // open tray with its head at the BOTTOM. The owner caught it on a phone on
    // 3 Oct 2026 ("it has the download arrow instead of the share arrow").
    //
    // The tray: a rounded box whose TOP edge is open in the middle — the path
    // draws down the sides and across the bottom only, leaving the arrow a gap
    // to come through.
    expect(share).toContain('d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"');
    // The arrowhead, at the top of the viewBox...
    const head = share.match(/<polyline points="([^"]+)" \/>/);
    expect(head).not.toBeNull();
    const headY = head![1]
      .split(/\s+/)
      .map(Number)
      .filter((_, i) => i % 2 === 1);
    // ...every point of it ABOVE the tray's top edge (y = 12), which is what
    // makes the arrow read as leaving the box rather than going into it...
    expect(Math.max(...headY)).toBeLessThan(12);
    // ...and the shaft starts up there with the head and drops through the
    // opening into the box.
    const shaft = share.match(/<line x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)" \/>/);
    expect(shaft).not.toBeNull();
    expect(Number(shaft![2])).toBeLessThan(12);
    expect(Number(shaft![4])).toBeGreaterThan(12);
    // Same stroke as the menu/home/check icons beside it, so the steps stay one set.
    expect(share).toContain('stroke={stroke} strokeWidth="2"');
    // The download glyph it replaced — shaft from y=3 to y=16 under a head at
    // its bottom — is gone from the page, not just from this case.
    expect(page).not.toContain('d="M12 3v13m0 0l-4-4m4 4l4-4"');
  });
});
