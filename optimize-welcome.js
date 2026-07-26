const sharp = require("sharp");

async function optimize() {
  // welcome-bg.png → JPEG, ~400KB
  await sharp("public/welcome-bg.png")
    .resize(1200, null, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile("public/welcome-bg-opt.jpg");
  console.log("bg done:", require("fs").statSync("public/welcome-bg-opt.jpg").size, "bytes");

  // welcome-rex.png → optimized PNG, ~100KB
  await sharp("public/welcome-rex.png")
    .resize(400, null, { fit: "inside", withoutEnlargement: true })
    .png({ quality: 85, compressionLevel: 9, palette: true })
    .toFile("public/welcome-rex-opt.png");
  console.log("rex done:", require("fs").statSync("public/welcome-rex-opt.png").size, "bytes");

  // welcome-lightbox-logo.png → optimized PNG, ~50KB
  await sharp("public/welcome-lightbox-logo.png")
    .resize(250, null, { fit: "inside", withoutEnlargement: true })
    .png({ quality: 85, compressionLevel: 9, palette: true })
    .toFile("public/welcome-lightbox-logo-opt.png");
  console.log("lightbox done:", require("fs").statSync("public/welcome-lightbox-logo-opt.png").size, "bytes");
}

optimize().catch((e) => console.error(e));
