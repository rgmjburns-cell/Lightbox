/**
 * Build the per-brand artwork the app draws, from the originals the owner
 * supplied.
 *
 * The owner supplied one "flying Rex" mascot, one welcome-page logo and one
 * phone home-screen icon per pilot brand (Imaging Queensland, The Xray Group).
 * The originals are design-tool exports: a large canvas, uneven empty margins
 * and, for the mascot, a landscape frame. This script turns each one into the
 * file the app actually requests, so the urls in `src/lib/brand.ts` point at
 * something predictable:
 *
 *   public/brands/<brand>/welcome-logo.png   the brand mark on the welcome screen
 *   public/brands/<brand>/home-logo.png      the brand mark in the top bar's right-hand slot
 *   public/brands/<brand>/rex.png            the mascot, drawn everywhere by Rex.tsx
 *   public/brands/<brand>/icon-512.png       PWA / home-screen icon
 *   public/brands/<brand>/icon-192.png       PWA / home-screen icon
 *   public/brands/<brand>/icon-180.png       iOS apple-touch-icon
 *
 * Two conventions are inherited from the artwork these accompany, so a brand
 * instance looks like the master and not like a differently-scaled app:
 *
 *   - the welcome logo is cropped tight to its visible pixels and sized by
 *     WIDTH, because both the master mark and the brand marks are wide lockups
 *     the welcome screen draws at `clamp(200px, 30vw, 250px)`;
 *   - the mascot is drawn with `object-fit: contain` inside a SQUARE wrapper, so
 *     its canvas is square and its visible character is scaled to fill the same
 *     share of that canvas the master artwork does (85.3% of the width), which
 *     is what keeps Rex the same size across the app.
 *
 * The top-bar mark (owner direction, 30 Sep — it replaced the "Hi, <nickname>"
 * chip in a pilot instance's top bar, see `src/routes/__root.tsx`) follows
 * neither of those conventions: that bar draws the mark at one fixed HEIGHT
 * (`h-9`, 36 CSS px), and the export arrives already cut out, with true
 * transparency and even margins, so it is scaled whole — no keying, no cropping
 * — down to `HOME_LOGO_HEIGHT` device px, and never up: artwork smaller than the
 * slot is left at its own size, because interpolating it upward only makes it
 * soft and larger. A brand marked `homeLogoKeep` skips even that: its supplied
 * file is the shipped file, byte for byte (checked against `HOME_LOGO_MD5`), so
 * a re-run of this script can never re-encode or resample the artwork the owner
 * installed. A game page's white title tile carries no mark at all any
 * more (the owner revoked the title-tile logo on 30 Sep), so that pipeline —
 * and its white-keying pass — is gone with it.
 *
 * Cropping uses an alpha threshold (>8/255): the exports carry a faint
 * near-invisible glow out to the canvas edge, and cropping to that would leave
 * a lopsided margin that pulls the artwork off centre.
 *
 * The supplied home-screen icons are opaque (a white background behind Rex), and
 * they are kept that way: an app icon is drawn on the phone's own home screen,
 * not on the app's navy theme, and iOS paints transparency black. The Xray
 * Group's icons were replaced with the owner's revised artwork on 30 Sep (the
 * same Rex-X mark with the margins the owner wanted around it); the resizing
 * below is deliberately faithful — the supplied square is scaled to each install
 * size, never re-cropped or re-margined, so what the owner drew is what installs.
 *
 * Run from the repo root:  node scripts/brand-artwork-assets.mjs
 * Originals live in public/_originals/brands/ and are never modified.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = "public/_originals/brands";
const OUT = "public/brands";

/** The supplied original for each derived file, per brand. Only the pilot brand
 * that the owner sent separate top-bar artwork for carries `homeLogo`; the other
 * two reuse the files above (`brand.ts` says which). */
const BRANDS = {
  "imaging-queensland": {
    logo: "iq-logo.png",
    homeLogo: "iq-home-logo-2026-10-01-owner-rounded.png",
    // Owner direction, 1 Oct: the supplied canvas IS the shipped file, so it is
    // copied through byte for byte rather than resampled and the instance draws
    // the owner's own artwork (see `keepHomeLogo`). This is the owner's THIRD
    // supply that day — the 583x174 landscape export installed first turned out
    // to be the OLD mark, the 300x210 export that replaced it drew as an opaque
    // white tile the owner rejected, and this 2170x725 RGBA export is the current
    // mark with the rounded corners drawn into the artwork itself. It is archived
    // here as `iq-home-logo-2026-10-01-owner-rounded.png`; the white-field export
    // it retires is kept beside it as `iq-home-logo-2026-10-01-whitefield.png`.
    homeLogoKeep: true,
    rex: "iq-rex.png",
    icon: "iq-app-icon.png",
  },
  "the-xray-group": {
    logo: "txg-logo.png",
    rex: "txg-rex.png",
    icon: "txg-app-icon.png",
  },
};

/** Alpha below this reads as an empty pixel when cropping. */
const ALPHA_CUTOFF = 8;

/** Welcome logo width in device pixels: 250 CSS px on a 3x screen. */
const LOGO_WIDTH = 750;

/**
 * Top-bar mark height in device pixels. The app's top bar draws the mark at
 * `h-9` (36 CSS px), so a 3x phone wants 108 device px; 144 is 4x that — crisp
 * with headroom and still far under the transfer budget. Artwork smaller than
 * this is left alone (see the note in the header): upscaling buys nothing.
 */
const HOME_LOGO_HEIGHT = 144;

/** Mascot canvas in device pixels (the master artwork is 400; more headroom here). */
const REX_CANVAS = 512;

/**
 * The share of its square canvas the master mascot artwork fills horizontally
 * (`public/welcome-rex-opt.png`: 341 visible px of 400). Matching it keeps Rex
 * the same on-screen size in a brand instance as in the master.
 */
const REX_WIDTH_FILL = 0.853;

/** The icon sizes the manifest and iOS ask for. */
const ICON_SIZES = [512, 192, 180];

const PNG = { compressionLevel: 9, effort: 10, adaptiveFiltering: true };

/** The bounding box of everything above `ALPHA_CUTOFF`, in pixels. */
async function visibleBoxOf(pipeline, label) {
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let x0 = info.width;
  let y0 = info.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < ALPHA_CUTOFF) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) throw new Error(`${label}: nothing visible above the alpha cutoff`);
  return { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The bounding box of everything above `ALPHA_CUTOFF`, in pixels. */
async function visibleBox(file) {
  return visibleBoxOf(sharp(file), file);
}

/** The cropped, alpha-preserving artwork, as a sharp pipeline. */
async function cropped(file) {
  const box = await visibleBox(file);
  return sharp(file).extract({
    left: box.x0,
    top: box.y0,
    width: box.width,
    height: box.height,
  });
}

/** Crop to the visible artwork, scale it to `LOGO_WIDTH` and write it. */
async function writeLogo(file, dest) {
  const box = await visibleBox(file);
  const height = Math.round((LOGO_WIDTH * box.height) / box.width);
  const info = await (await cropped(file))
    .resize({ width: LOGO_WIDTH, height, fit: "fill", kernel: "lanczos3" })
    .png(PNG)
    .toFile(dest);
  return { dest, width: info.width, height: info.height, bytes: info.size, src: `${box.width}x${box.height}` };
}

/**
 * Crop to the visible mascot, centre it on a transparent square canvas sized so
 * the character occupies the master artwork's share of the width, then scale
 * the canvas to `REX_CANVAS`.
 */
async function writeRex(file, dest) {
  const box = await visibleBox(file);
  const side = Math.round(box.width / REX_WIDTH_FILL);
  // Padding to the square canvas and scaling it down are two passes on purpose:
  // sharp composites after it resizes, so a one-pass pipeline would try to drop
  // the full-size artwork onto the already-shrunk canvas.
  const padded = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await (await cropped(file)).png().toBuffer(),
        left: Math.round((side - box.width) / 2),
        top: Math.round((side - box.height) / 2),
      },
    ])
    .png()
    .toBuffer();
  const info = await sharp(padded)
    .resize(REX_CANVAS, REX_CANVAS, { fit: "fill", kernel: "lanczos3" })
    .png(PNG)
    .toFile(dest);
  return {
    dest,
    width: info.width,
    height: info.height,
    bytes: info.size,
    src: `${box.width}x${box.height}`,
    fill: (box.width / side).toFixed(3),
  };
}

/**
 * Scale the top bar's mark down to `HOME_LOGO_HEIGHT`, whole.
 *
 * The export arrives already cut out with true transparency and even margins, so
 * it is neither keyed nor cropped: the supplied canvas is scaled as it is,
 * keeping its aspect and every anti-aliased edge exactly as drawn. Artwork that
 * is already at or below the target height is written as it stands — upscaling a
 * small export would only soften it and make the file bigger.
 */
async function writeHomeLogo(file, dest) {
  const meta = await sharp(file).metadata();
  const scale = meta.height > HOME_LOGO_HEIGHT ? HOME_LOGO_HEIGHT / meta.height : 1;
  const height = Math.round(meta.height * scale);
  const width = Math.round(meta.width * scale);
  const pipeline =
    scale < 1
      ? sharp(file).resize({ width, height, fit: "fill", kernel: "lanczos3" })
      : sharp(file);
  const info = await pipeline.png(PNG).toFile(dest);
  return {
    dest,
    width: info.width,
    height: info.height,
    bytes: info.size,
    src: `${meta.width}x${meta.height}`,
    hasAlpha: meta.hasAlpha,
    resampled: scale < 1,
  };
}

/**
 * The md5 of the owner's current top-bar export, per brand, as archived in
 * `public/_originals/brands/`. A keep-through mark must still be this exact
 * file: a later re-supply that is dropped in under the same name without being
 * archived and recorded here fails the run instead of silently reaching
 * patients (the 1 Oct Imaging Queensland swaps are exactly why this exists — the
 * first file that day, 583x174 md5 5bd49aae…, was the OLD mark, and the second,
 * 300x210 md5 eb0196b6…, drew as a white tile the owner rejected).
 */
const HOME_LOGO_MD5 = {
  "imaging-queensland": "c16f680faac96392bcc84a4b0ff69f9c",
};

/**
 * Copy the supplied top-bar mark through unchanged, byte for byte.
 *
 * Owner direction, 1 Oct: the file the owner supplied IS what the app draws —
 * "put this imaging Queensland logo on instead" — so it is never resampled, and
 * the shipped file's md5 matches the original's. This is stronger than the
 * convention the other artwork follows: 725 px tall artwork would otherwise be
 * scaled down to `HOME_LOGO_HEIGHT` (144) — losing the resolution the owner
 * supplied — and even a pixel-identical re-encode through sharp would break the
 * byte-for-byte promise the artwork is pinned by in `src/lib/brand.test.ts`.
 */
async function keepHomeLogo(file, dest, expectedMd5) {
  const md5 = createHash("md5").update(readFileSync(file)).digest("hex");
  if (md5 !== expectedMd5) {
    throw new Error(
      `${file}: md5 ${md5} is not the recorded owner export ${expectedMd5} — archive the new ` +
        `supply in ${SRC} and record it before shipping it`,
    );
  }
  copyFileSync(file, dest);
  const meta = await sharp(file).metadata();
  return {
    dest,
    width: meta.width,
    height: meta.height,
    bytes: statSync(dest).size,
    src: `${meta.width}x${meta.height}`,
    hasAlpha: meta.hasAlpha,
    resampled: false,
    md5,
  };
}

/** Resize the supplied square icon to each size the app installs at. */
async function writeIcons(file, dir) {
  const meta = await sharp(file).metadata();
  const out = [];
  for (const size of ICON_SIZES) {
    const info = await sharp(file)
      .resize(size, size, { fit: "fill", kernel: "lanczos3" })
      .png(PNG)
      .toFile(path.join(dir, `icon-${size}.png`));
    out.push({ size, bytes: info.size, src: `${meta.width}x${meta.height}`, hasAlpha: meta.hasAlpha });
  }
  return out;
}

const report = [];
const originals = readdirSync(SRC);
for (const [brand, files] of Object.entries(BRANDS)) {
  const dir = path.join(OUT, brand);
  mkdirSync(dir, { recursive: true });
  for (const key of ["logo", "rex", "icon"]) {
    if (!originals.includes(files[key])) throw new Error(`missing original ${SRC}/${files[key]}`);
  }
  if (files.homeLogo && !originals.includes(files.homeLogo)) {
    throw new Error(`missing original ${SRC}/${files.homeLogo}`);
  }
  report.push({
    brand,
    logo: await writeLogo(path.join(SRC, files.logo), path.join(dir, "welcome-logo.png")),
    home: files.homeLogo
      ? files.homeLogoKeep
        ? await keepHomeLogo(
            path.join(SRC, files.homeLogo),
            path.join(dir, "home-logo.png"),
            HOME_LOGO_MD5[brand],
          )
        : await writeHomeLogo(path.join(SRC, files.homeLogo), path.join(dir, "home-logo.png"))
      : null,
    rex: await writeRex(path.join(SRC, files.rex), path.join(dir, "rex.png")),
    icons: await writeIcons(path.join(SRC, files.icon), dir),
  });
}

const kB = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
for (const row of report) {
  console.log(row.brand);
  console.log(`  welcome-logo.png  ${row.logo.width}x${row.logo.height}  ${kB(row.logo.bytes)}  (cropped from ${row.logo.src})`);
  if (row.home) {
    console.log(
      `  home-logo.png     ${row.home.width}x${row.home.height}  ${kB(row.home.bytes)}  (${row.home.resampled ? "scaled" : "kept"} from ${row.home.src}, ${
        row.home.hasAlpha ? "alpha kept" : "opaque as supplied"
      }${row.home.md5 ? `, md5 ${row.home.md5}` : ""})`,
    );
  }
  console.log(`  rex.png           ${row.rex.width}x${row.rex.height}  ${kB(row.rex.bytes)}  (cropped from ${row.rex.src}, width fill ${row.rex.fill})`);
  for (const icon of row.icons) {
    console.log(`  icon-${icon.size}.png      ${icon.size}x${icon.size}  ${kB(icon.bytes)}${icon.hasAlpha ? "" : "  (opaque, as supplied)"}`);
  }
}
