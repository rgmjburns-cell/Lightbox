import sharp from "sharp";
import fs from "fs";

// rex.png is 256x256, fully opaque (100% occupancy).
// Target: Rex at ~44% of canvas area.
// Linear scale: sqrt(0.44/1.0) = 0.6633
// New canvas: 256 / 0.6633 ≈ 386px per side → 65px padding per side
const PAD = 65;
const paddedSize = 256 + 2 * PAD; // 386

async function run() {
  // Create padded version with transparent background
  const padded = await sharp({
    create: {
      width: paddedSize,
      height: paddedSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite([{ input: "public/rex.png", top: PAD, left: PAD }])
  .png()
  .toBuffer();

  // Verify occupancy
  const { data, info } = await sharp(padded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 10) n++;
  const pct = (n / (info.width * info.height) * 100).toFixed(1);
  console.log("Padded image:", info.width, "x", info.height, "Rex occupancy:", pct + "%");

  // Generate icons
  const sizes = [
    { name: "favicon.ico", size: 32 },
    { name: "icon-192.png", size: 192 },
    { name: "icon-512.png", size: 512 },
    { name: "apple-touch-icon.png", size: 180 },
  ];

  for (const { name, size } of sizes) {
    const buf = await sharp(padded).resize(size, size, { fit: "cover", position: "center" }).png().toBuffer();
    fs.writeFileSync("public/" + name, buf);
    console.log("Generated", name, "(" + size + "x" + size + ")");
  }

  console.log("All icons generated.");
}
run().catch(e => { console.error(e); process.exit(1); });
