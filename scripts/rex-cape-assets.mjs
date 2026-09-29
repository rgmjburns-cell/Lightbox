/**
 * Build the cape recolour mask from the Rex master artwork.
 *
 * Rex's cape colour is a per-brand setting (`rexCapeColor` in src/lib/brand.ts),
 * but the mascot ships as one raster PNG (`public/welcome-rex-opt.png`) with the
 * cape's navy baked in. This script derives a greyscale-alpha mask of just the
 * cape from that artwork. `RexCape` (src/components/RexCape.tsx) paints the
 * brand colour through the mask on top of the PNG, so every instance gets its
 * own cape without a second mascot asset per brand and without touching any
 * other pixel of the character.
 *
 * The mask's ALPHA carries two things at once:
 *   - coverage: 0 outside the cape, 1 inside it (anti-aliased edges in between)
 *   - shading:  bright cape folds get alpha 1 (pure brand colour), deeper folds
 *     get ~0.62, so the original navy shows through and the cape keeps its
 *     volume instead of going flat.
 *
 * Run after replacing the master artwork:  node scripts/rex-cape-assets.mjs
 * Writes public/rex-cape-mask.png. Pass --preview <hex>[,<hex>] to also write
 * /tmp/rex-cape-preview-<hex>.png composites for eyeballing a brand colour.
 */
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SOURCE = "public/welcome-rex-opt.png";
const OUT = "public/rex-cape-mask.png";

// Cape detection. The cape is the only large mid-blue area in the artwork; the
// thresholds keep Rex's white bones (no saturation), his cream skull (warm hue)
// and the teal chest badge (hue ~170-185) out of the mask.
const HUE_MIN = 200;
const HUE_MAX = 252;
const MIN_BLUE_OVER_RED = 22; // b - r, kills greys and the warm skull
const MIN_SATURATION = 0.16;
// Shading floor, so the darkest folds keep some of the original navy.
const SHADE_FLOOR = 0.62;

const hueOf = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return -1;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};

const { data, info } = await sharp(SOURCE)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height } = info;
const out = Buffer.alloc(width * height * 4);

// First pass: how well does a pixel match the cape, and how bright is it there?
let maxLum = 0;
const coverage = new Float32Array(width * height);
const lum = new Float32Array(width * height);
let selected = 0;

for (let i = 0; i < width * height; i++) {
  const o = i * 4;
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  const a = data[o + 3] / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  const hue = hueOf(r, g, b);
  const isCape =
    a > 0.05 &&
    hue >= HUE_MIN &&
    hue <= HUE_MAX &&
    sat >= MIN_SATURATION &&
    b - r >= MIN_BLUE_OVER_RED;
  if (!isCape) continue;
  // How *committed* to the cape the pixel is: a full-strength cape pixel has
  // high saturation, a bone-edge blend is washed out. Keeps the seam soft.
  const strength = Math.min(1, Math.max(0, (sat - MIN_SATURATION) / 0.25));
  coverage[i] = Math.min(1, strength + 0.35) * a;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  lum[i] = l;
  if (l > maxLum) maxLum = l;
  selected++;
}

// Rex's irises are the same navy family as the cape, so the colour rule alone
// also paints his eyes with the brand colour. The cape is the only LARGE blue
// mass in the artwork and his face is above the shoulders, so drop the small
// colour matches that sit entirely in the head band. Measured on the current
// master: the cape is 9,305 + 2,635 px, the next real cape fragment 447 px, and
// the eyes 83 px and smaller, all above y=160.
const HEAD_BAND_MAX_Y = 160;
const MIN_FRAGMENT = 500;
const labels = new Int32Array(width * height).fill(-1);
const components = [];
for (let start = 0; start < width * height; start++) {
  if (coverage[start] <= 0 || labels[start] >= 0) continue;
  const id = components.length;
  const component = { id, size: 0, maxY: 0 };
  const stack = [start];
  labels[start] = id;
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p / width) | 0;
    component.size++;
    if (y > component.maxY) component.maxY = y;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = ny * width + nx;
      if (coverage[q] > 0 && labels[q] < 0) {
        labels[q] = id;
        stack.push(q);
      }
    }
  }
  components.push(component);
}

const dropped = components.filter((c) => c.size < MIN_FRAGMENT && c.maxY <= HEAD_BAND_MAX_Y);
const kept = components.filter((c) => !dropped.includes(c));
for (let i = 0; i < width * height; i++) {
  if (coverage[i] <= 0) continue;
  if (dropped.some((c) => c.id === labels[i])) coverage[i] = 0;
}
const keptPixels = kept.reduce((sum, c) => sum + c.size, 0);
const largest = kept.reduce((max, c) => Math.max(max, c.size), 0);
if (keptPixels < 8000 || largest < 5000) {
  throw new Error(
    `cape mask looks wrong: ${keptPixels} pixels kept, largest component ${largest}. ` +
      `Re-check the thresholds against the new ${SOURCE}.`,
  );
}
console.log(
  `components: kept ${kept.length} (largest ${largest}px), dropped ${dropped.length} ` +
    `face matches (${dropped.map((c) => c.size).join(", ")} px)`,
);

// Grey levels of the cape we can map shading against (2nd/98th percentile, so a
// stray pixel cannot flatten the whole range).
const values = [];
for (let i = 0; i < width * height; i++) if (coverage[i] > 0) values.push(lum[i]);
values.sort((x, y) => x - y);
const lo = values[Math.floor(values.length * 0.06)] ?? 0;
const hi = values[Math.floor(values.length * 0.96)] ?? maxLum;

for (let i = 0; i < width * height; i++) {
  if (coverage[i] <= 0) continue;
  const o = i * 4;
  const shade = Math.min(1, Math.max(0, (lum[i] - lo) / Math.max(1, hi - lo)));
  const alpha = coverage[i] * (SHADE_FLOOR + (1 - SHADE_FLOOR) * shade);
  out[o] = 255;
  out[o + 1] = 255;
  out[o + 2] = 255;
  out[o + 3] = Math.round(Math.min(1, alpha) * 255);
}

await sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(OUT);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
const size = (await sharp(OUT).metadata(), (await import("node:fs")).statSync(OUT).size);
console.log(
  `cape pixels ${selected} of ${width * height} (${((selected / (width * height)) * 100).toFixed(1)}%)`,
);
console.log(`luminance range ${lo.toFixed(0)}..${hi.toFixed(0)}`);
console.log(`wrote ${OUT} ${kb(size)}`);

// --preview #RRGGBB[,#RRGGBB] : render exactly what the browser will draw, so a
// brand colour can be judged on the real artwork before it is committed.
const previewArg = process.argv.indexOf("--preview");
if (previewArg !== -1) {
  const colours = (process.argv[previewArg + 1] ?? "").split(",").filter(Boolean);
  const mask = await sharp(OUT).raw().toBuffer({ resolveWithObject: true });
  mkdirSync("/tmp/rex-cape-preview", { recursive: true });
  for (const hex of colours) {
    const c = hex.replace("#", "");
    const layer = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      layer[i * 4] = parseInt(c.slice(0, 2), 16);
      layer[i * 4 + 1] = parseInt(c.slice(2, 4), 16);
      layer[i * 4 + 2] = parseInt(c.slice(4, 6), 16);
      layer[i * 4 + 3] = mask.data[i * 4 + 3];
    }
    const file = path.resolve(`/tmp/rex-cape-preview/${hex.replace("#", "").toLowerCase()}.png`);
    await sharp(SOURCE)
      .ensureAlpha()
      .composite([{ input: layer, raw: { width, height, channels: 4 } }])
      .png()
      .toFile(file);
    console.log(`preview ${file}`);
  }
}
