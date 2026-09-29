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
 *   public/brands/<brand>/tile-logo.png      the mark on a game page's title tile
 *   public/brands/<brand>/home-logo.png      the brand mark on the games home header
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
 * The title-tile logo (owner's artwork, 29 Sep) follows the second convention
 * instead: a game page draws it at one fixed HEIGHT (`h-8` in
 * `src/routes/play.$gameId.tsx`), so these are sized by height and cropped tight,
 * and their flat white background is keyed out to transparency — the tile behind
 * them is white today, and a transparent mark stays correct if that ever moves.
 * Keying only touches near-pure white, so the anti-aliased edge of a coloured
 * letter keeps its blend and the mark looks exactly as the owner supplied it.
 *
 * Cropping uses an alpha threshold (>8/255): the exports carry a faint
 * near-invisible glow out to the canvas edge, and cropping to that would leave
 * a lopsided margin that pulls the artwork off centre. The one exception is the
 * home-header mark (owner request, 29 Sep): that export already arrives with
 * true transparency and small, even margins, so it is scaled whole — which also
 * keeps its aspect at exactly 3.00, the same wide-lockup shape the header slot
 * draws for the other brand.
 *
 * The supplied home-screen icons are opaque (a white background behind Rex), and
 * they are kept that way: an app icon is drawn on the phone's own home screen,
 * not on the app's navy theme, and iOS paints transparency black.
 *
 * Run from the repo root:  node scripts/brand-artwork-assets.mjs
 * Originals live in public/_originals/brands/ and are never modified.
 */
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = "public/_originals/brands";
const OUT = "public/brands";

/** The supplied original for each derived file, per brand. Only the pilot brand
 * that the owner sent separate home-header artwork for carries `homeLogo`; the
 * other two reuse the files above (`brand.ts` says which). */
const BRANDS = {
  "imaging-queensland": {
    logo: "iq-logo.png",
    tile: "iq-tile-logo.png",
    homeLogo: "iq-home-logo.png",
    rex: "iq-rex.png",
    icon: "iq-app-icon.png",
  },
  "the-xray-group": {
    logo: "txg-logo.png",
    tile: "txg-tile-logo.png",
    rex: "txg-rex.png",
    icon: "txg-app-icon.png",
  },
};

/** Alpha below this reads as an empty pixel when cropping. */
const ALPHA_CUTOFF = 8;

/** Welcome logo width in device pixels: 250 CSS px on a 3x screen. */
const LOGO_WIDTH = 750;

/** Title-tile logo height in device pixels: 32 CSS px on a 3x screen. */
const TILE_LOGO_HEIGHT = 96;
/**
 * Home-header logo width in device pixels. The games home header draws the mark
 * at `h-10` (40 CSS px) so a 3:1 lockup is ~120 CSS px wide, i.e. 360 device px
 * on a 3x screen; 1086 is 3x that again, which leaves the mark crisp on a 3x
 * phone if the slot ever grows to `h-12`. The owner's export is 2172x724, so
 * this is a straight half-scale (584 kB -> ~65 kB) with its alpha kept.
 */
const HOME_LOGO_WIDTH = 1086;

/**
 * A pixel at least this light on every channel is the tile logo's flat white
 * background. The threshold sits just below pure white on purpose: it clears the
 * background completely while leaving the anti-aliased edge of a coloured letter
 * (a blend, never 250+ on all three channels) untouched.
 */
const WHITE_CUTOFF = 250;

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
 * The tile logo's flat white background as transparency, ready to crop: sharp
 * resizes after it composites, so keying and cropping are two passes on purpose.
 */
async function keyOutWhite(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (
      data[i] >= WHITE_CUTOFF &&
      data[i + 1] >= WHITE_CUTOFF &&
      data[i + 2] >= WHITE_CUTOFF
    ) {
      data[i + 3] = 0;
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  });
}

/** Key the white background out, crop to the mark, scale it to TILE_LOGO_HEIGHT. */
async function writeTileLogo(file, dest) {
  const keyed = await keyOutWhite(file);
  const box = await visibleBoxOf(keyed, file);
  const width = Math.round((TILE_LOGO_HEIGHT * box.width) / box.height);
  const info = await keyed
    .extract({ left: box.x0, top: box.y0, width: box.width, height: box.height })
    .resize({ width, height: TILE_LOGO_HEIGHT, fit: "fill", kernel: "lanczos3" })
    .png(PNG)
    .toFile(dest);
  const meta = await sharp(dest).metadata();
  return {
    dest,
    width: meta.width,
    height: meta.height,
    bytes: statSync(dest).size,
    src: `${box.width}x${box.height}`,
  };
}

/**
 * Scale the games home header's mark to HOME_LOGO_WIDTH, whole.
 *
 * The other two brands' header marks are reused files (the master's shared mark
 * and the pilot's tile lockup), and this is the one brand whose header artwork
 * the owner supplied separately. It arrives with true transparency and even
 * margins, so it is neither keyed nor cropped: the supplied canvas is scaled as
 * it is, keeping its 3.00 aspect and every anti-aliased edge exactly as drawn.
 */
async function writeHomeLogo(file, dest) {
  const meta = await sharp(file).metadata();
  const height = Math.round((HOME_LOGO_WIDTH * meta.height) / meta.width);
  const info = await sharp(file)
    .resize({ width: HOME_LOGO_WIDTH, height, fit: "fill", kernel: "lanczos3" })
    .png(PNG)
    .toFile(dest);
  return {
    dest,
    width: info.width,
    height: info.height,
    bytes: info.size,
    src: `${meta.width}x${meta.height}`,
    hasAlpha: meta.hasAlpha,
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
  for (const key of ["logo", "tile", "rex", "icon"]) {
    if (!originals.includes(files[key])) throw new Error(`missing original ${SRC}/${files[key]}`);
  }
  if (files.homeLogo && !originals.includes(files.homeLogo)) {
    throw new Error(`missing original ${SRC}/${files.homeLogo}`);
  }
  report.push({
    brand,
    logo: await writeLogo(path.join(SRC, files.logo), path.join(dir, "welcome-logo.png")),
    tile: await writeTileLogo(path.join(SRC, files.tile), path.join(dir, "tile-logo.png")),
    home: files.homeLogo
      ? await writeHomeLogo(path.join(SRC, files.homeLogo), path.join(dir, "home-logo.png"))
      : null,
    rex: await writeRex(path.join(SRC, files.rex), path.join(dir, "rex.png")),
    icons: await writeIcons(path.join(SRC, files.icon), dir),
  });
}

const kB = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
for (const row of report) {
  console.log(row.brand);
  console.log(`  welcome-logo.png  ${row.logo.width}x${row.logo.height}  ${kB(row.logo.bytes)}  (cropped from ${row.logo.src})`);
  console.log(`  tile-logo.png     ${row.tile.width}x${row.tile.height}  ${kB(row.tile.bytes)}  (cropped from ${row.tile.src}, white keyed out)`);
  if (row.home) {
    console.log(`  home-logo.png     ${row.home.width}x${row.home.height}  ${kB(row.home.bytes)}  (scaled from ${row.home.src}, alpha kept)`);
  }
  console.log(`  rex.png           ${row.rex.width}x${row.rex.height}  ${kB(row.rex.bytes)}  (cropped from ${row.rex.src}, width fill ${row.rex.fill})`);
  for (const icon of row.icons) {
    console.log(`  icon-${icon.size}.png      ${icon.size}x${icon.size}  ${kB(icon.bytes)}${icon.hasAlpha ? "" : "  (opaque, as supplied)"}`);
  }
}
