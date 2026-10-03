# Original artwork (never served, never modified)

Files here are the owner's untouched exports. The app requests the processed
copies under `public/` (and `public/brands/<brand>/`), produced from these by
`scripts/brand-artwork-assets.mjs`. Nothing in this directory is sent to a
browser — it exists so a processed file can always be traced back to what the
owner actually supplied.

## The owner's 1 Oct 2026 re-supply of the three marks

Supplied as ImgBB links; the image each one resolves to (via the page's
`og:image`) is recorded with its dimensions and md5 so a later re-supply can be
compared byte for byte.

| mark | owner's link | resolves to | file | dimensions | alpha | md5 |
|---|---|---|---|---|---|---|
| Rad Games | https://ibb.co/S7QQq7Tf | `i.ibb.co/0VBBPVNs/…F41.png` | `brands/rad-games-logo-master-2026-10-01.png` | 1536x1024 | RGBA, transparent padding (content 1506x696 at 15,193) | `3e3db3dd278d5e8b391e777aac9c0d32` |
| Imaging Queensland — **superseded the same day**, see the next section | https://ibb.co/TxDY9MwB | `i.ibb.co/210WG3F7/Imaging-Queensland-Landscape-RW.png` | `brands/iq-home-logo.png` | 583x174 | RGBA, transparent corners | `5bd49aaee87b636956732809e3c870ae` |
| The Xray Group | https://ibb.co/nsXqMt47 | `i.ibb.co/qMHLYVhN/IMG-9712.png` | `brands/txg-tile-logo.png` | 351x118 | RGBA, transparent corners | `ad62c5b83981aae386de7d0a0c4594c9` |

What that meant for the app:

- **Rad Games** — the re-supply is the same lockup at higher resolution (the
  visible pixels overlap the file shipped on 29 Sep by IoU 0.9685 at equal size;
  the residual is resampling). It is a fresh master, so
  `public/rad-games-logo.png` is now derived from this file — cropped to the
  visible pixels (alpha > 8) and scaled to 900 px wide, `png({compressionLevel:
  9, effort: 10})`, which lands at 900x416 and 129 KB, the same width and size
  class as the file it replaces. The replaced file is kept here as
  `brands/rad-games-logo-2026-09-29.png`.
- **Imaging Queensland** — byte-identical to `brands/iq-home-logo.png`. Until
  1 Oct it was only the source the shipped `brands/imaging-queensland/home-logo.png`
  (482x144) was scaled from; on 1 Oct the owner asked for the supplied file itself
  ("put this imaging Queensland logo on instead"), so the shipped file became a
  byte for byte copy of this original — 583x174, md5
  `5bd49aaee87b636956732809e3c870ae`, identical to the file here. The 482x144
  scaled export it replaced is kept beside it as
  `brands/iq-home-logo-2026-09-30.png` (md5 `757318fc60e48026fb60091f3e8c4d99`),
  and `scripts/brand-artwork-assets.mjs` copies that original through instead of
  resampling it (`homeLogoKeep`). The round corners the owner asked for on the
  same day are a DISPLAY treatment on the element in `src/routes/__root.tsx`
  (`rounded-2xl`, the radius the app's game tiles use) — the artwork is never
  cropped, keyed or masked. **This 583x174 file turned out to be the OLD mark and
  was replaced the same day — see the next section.**
- **The Xray Group** — byte-identical to `brands/txg-tile-logo.png`, which is
  itself byte-identical to the shipped
  `brands/the-xray-group/home-logo.png`. No change.

## The owner's second Imaging Queensland supply (1 Oct 2026)

The 583x174 landscape export installed that morning was the OLD logo, so the
owner re-supplied the brand's current mark. Same provenance discipline: the
ImgBB link, the image its page resolves to, its dimensions, its alpha and its
md5, so any later re-supply can be compared byte for byte.

| mark | owner's link | resolves to | file | dimensions | alpha | md5 |
|---|---|---|---|---|---|---|
| Imaging Queensland — **rejected the same evening, see the next section** | https://ibb.co/8gKcz7YX | `i.ibb.co/b5WJHKb7/IMG-1258.png` | `brands/iq-home-logo-2026-10-01-whitefield.png` (was `…-owner.png`) | 300x210 | **RGB, no alpha** — an opaque white field (61.1% of pixels) carrying the brand's red lockup (227,26,47, 34.5%) | `eb0196b66b3e1bb7c8843a242c6a4696` |

- That 6,385-byte upload WAS what shipped for a few hours: `brands/imaging-queensland/home-logo.png`
  was a byte for byte copy of it, and `scripts/brand-artwork-assets.mjs` copied
  **that** original through under `homeLogoKeep: true` (with the md5 checked against
  `HOME_LOGO_MD5`, which is what makes a re-run unable to silently resample it — at
  210 px tall it is above `HOME_LOGO_HEIGHT` = 144, so the ordinary pipeline *would*
  have scaled it). The owner rejected it after seeing it on the bar (see the next
  section) and the file was renamed to `iq-home-logo-2026-10-01-whitefield.png` so
  the rejected export and the current one are not both called "owner".
- The file it replaced is still archived beside it as
  `brands/iq-home-logo-2026-10-01.png` — the 583x174 export that shipped until this
  swap, byte-identical to `brands/iq-home-logo.png` (md5
  `5bd49aaee87b636956732809e3c870ae`), which stays in place as the owner's first
  1 Oct supply. Both halves of that swap are therefore traceable, and the 482x144
  copy before them remains `brands/iq-home-logo-2026-09-30.png`.
- The two reasons it was rejected, both measured and recorded here rather than
  guessed:
  - **It was the only bar mark with no alpha.** The bar (`src/routes/__root.tsx`,
    `bg-white/5` over the navy body) therefore drew a white rounded tile rather
    than a cut-out logo — mean contrast 11.33:1 against the retired 583x174
    export's 3.38:1, with the white field the brightest thing on the bar.
  - **It drew much narrower.** The bar sizes its mark by height (`h-9`, 36 CSS
    px), so the 1.43:1 aspect rendered ~51x36 CSS px where the 3.35:1 export
    rendered ~120x36 — a visible change in the bar's weight, measured from the
    rendered page and recorded in `/home/team/shared/new-iq-logo/MEASUREMENTS.md`.
- The rounded corners on the bar element (`rounded-2xl`, 16 px, the radius the
  home-screen game tiles use) are unchanged and remained a display clip in that
  version: the `<img>` box was clipped rather than the artwork pre-rounded.

## The owner's third Imaging Queensland supply (1 Oct 2026) — the current mark

The owner rejected the white-field export above and sent the same lockup with the
corners rounded **in the artwork itself**. Same provenance discipline: the ImgBB
link, the image its page resolves to, its dimensions, its alpha and its md5.

| mark | owner's link | resolves to | file | dimensions | alpha | md5 |
|---|---|---|---|---|---|---|
| Imaging Queensland (current) | https://ibb.co/wNRDDWr5 | `i.ibb.co/xSDVVj8x/D771-F476-0844-4512-89-F9-56-BE1-BF3-DE4-F.png` | `brands/iq-home-logo-2026-10-01-owner-rounded.png` | 2170x725 | **RGBA**, transparent corners (17.0% of the canvas fully transparent; solid field 1,289,654 px = a red #DF1C2B-ish field 84.7% of it, carrying the lockup in white 11.2%) | `c16f680faac96392bcc84a4b0ff69f9c` |

- This upload IS what ships, byte for byte: `brands/imaging-queensland/home-logo.png`
  is a copy of the original archived here (1,772,328 bytes, ~1.69 MiB), and
  `scripts/brand-artwork-assets.mjs` copies **this** original through under
  `homeLogoKeep: true`, with `HOME_LOGO_MD5` now `c16f680f…`. It is deliberately
  shipped at the resolution the owner supplied: the script never resamples a
  keep-through mark, and at 725 px tall it is far above `HOME_LOGO_HEIGHT` (144), so
  it is the one bar mark that carries a serving cost — the box's other marks are
  6–150 kB, this one is 1.69 MiB.
- The corners are now in the file, not only in the bar element: the four canvas
  corners have alpha 0, the shape starts 56 px down (a transparent margin), and at
  that top row the first solid pixel is 87 px in from the left where at mid height
  the field starts at 28 px. The element's `rounded-2xl` (16 px) stays exactly as it
  was — it clips the element box, and a file with its own rounded corners shows
  through it unchanged, so every brand keeps one identical presentation rule.
- On the bar it draws 2.993:1 (2170/725), i.e. ~108x36 CSS px in the same `h-9`
  slot at which the rejected 300x210 export drew ~51x36 and the original 583x174
  export drew ~120x36 — the weight the owner wanted back, measured from the rendered
  page and recorded in `/home/team/shared/new-iq-logo/r2/MEASUREMENTS.md`.

## The owner's 2 Oct 2026 supply: the colouring game's icon, per brand, and a new memory tile

Three ImgBB uploads, archived here before anything was processed from them.

| mark | owner's link | resolves to | file | dimensions | alpha | md5 |
|---|---|---|---|---|---|---|
| Imaging Queensland — the colouring game's icon | https://ibb.co/XZ5sHmTY | `i.ibb.co/QFHN0sGD/77712-D3-E-14-DA-4-F19-B333-963-ADAB1-BCA0.png` | `brands/iq-colour-game-icon.png` | 1312x1199 | RGBA, fully transparent background (52.3% of the canvas alpha 0); content 1229x1073 at 52,67 | `13d5363c5caafa23fb5ed5c0b3e9c524` |
| The Xray Group — the colouring game's icon | https://ibb.co/k6HXkd9V | `i.ibb.co/gFjJHnPb/AEEA22-D6-117-C-497-A-9226-A23-C12-FB9-B19.png` | `brands/txg-colour-game-icon.png` | 1254x1254 | RGBA, fully transparent background (45.9% alpha 0); content 1136x1193 | `fee99d56dde18e220ae9b88d4507424c` |
| Memory Scan — the face-down tile, ALL brands | https://ibb.co/xqSkHnjp | `i.ibb.co/r2GjsB6C/10-F8-AF2-B-CD53-463-A-A2-C4-4-FCCE4-D4-ACE3.png` | `memory-card-back.png` | 1254x1254 | RGBA, transparent background (14.6% alpha 0); content 1174x1165 — one rounded tile, not a grid | `20435e36063ff3bd3f83e10203c49fe7` |

What shipped, and how it was derived:
- **The two game icons are the first GAME artwork in this repo that is per brand.**
  Both draw the same mascot (brush in one hand, palette in the other) in that
  brand's own colours: Imaging Queensland's is red caped with the brand's red
  spiral badge, The Xray Group's orange caped with the brand's orange x badge.
  Each is resampled to a **512x512** square — the Imaging Queensland export is
  1312x1199, so it was fitted into the square and padded with transparent pixels,
  **never stretched or cropped** — and written to
  `public/brands/<brand>/colour-game-icon.png` (512x512 RGBA; 53,005 bytes for
  Imaging Queensland, 67,646 for The Xray Group — the same size class as the
  shared `public/icons/*.png` game icons, which are 55–80 kB at 256x256). The
  master keeps `/icons/icon-colour-rex.png`
  untouched (sha256 `0671c09e…`), so the live neutral instance is unchanged.
  The pipeline is a one-off (like the earlier artwork passes): trim the
  transparent border, fit into 96% of the square, extend to the square with
  alpha 0, `png({ compressionLevel: 9, effort: 10 })`.
- **The memory tile is ONE shared picture for all three brands**, replacing the
  Rex tile that was at `public/rex-memory-tile.png` (archived beside this file as
  `rex-memory-tile-2026-09-06.png`, md5 `6ed85e38937d5c1ad9de836307b3572b`). The
  new art is the same glossy teal card, now carrying a scan glyph instead of Rex;
  it is a single tile face, so it is the CARD BACK — the game's 14 distinct pair
  faces (`public/memory-tile-*.png`) are untouched. Shipped at **512x512**, 98,991
  bytes (the file it replaces was 1,260,812 bytes, ~92% smaller). The file name is
  unchanged, so its address carries a `?v=1` stamp.

## The owner's 3 Oct 2026 supply: the "Best Friend" badge, per pilot brand

Two ImgBB uploads of the ONE badge named after the mascot, archived here before
anything was processed from them. The master was not asked to change and keeps
the shared `/badges/rexs-best-friend.png` byte for byte.

| mark | owner's link | resolves to | file | dimensions | alpha | md5 |
|---|---|---|---|---|---|---|
| Imaging Queensland — the mascot badge | https://ibb.co/DH9xfB0n | `i.ibb.co/5grNhQbV/96326790-E389-4-E69-949-F-AFA975-A4967-E.png` | `brands/iq-best-friend-badge.png` | 1233x1275 | RGBA, transparent background (46.7% of the canvas alpha 0); content 1199x1169 at 15,56 | `d4077ffd7f8430d16e0f48da152399ce` |
| The Xray Group — the mascot badge | https://ibb.co/x85WXqt0 | `i.ibb.co/M5NrZkx4/7628-F04-C-D6-B7-4962-9136-CC5482692-A90.png` | `brands/txg-best-friend-badge.png` | 1234x1275 | RGBA, transparent background (47.1% alpha 0); content 1195x1168 at 16,56 | `971d66f58e57959ed14db24834483020` |

What shipped, and how it was derived:

- **Both files are byte-identical to the owner's uploads** (the md5s above are the
  uploads' own), so the two images are the originals, not re-exports.
- **Each picture is the same joke in that brand's colours**: the mascot hugging a
  glossy teal heart that carries the badge's own name, with the cape and the
  shoulder badge in the brand's colour — Imaging Queensland's is red-caped with
  the red spiral badge and reads **"Stu's Best Friend"**; The Xray Group's is
  orange-caped with the orange x badge and reads **"Rex's Best Friend"**. Both
  already spell the name, which is why neither the badge's ID (`rexs-best-friend`,
  what unlocks are keyed by) nor its `{mascot}`-resolved NAME changed.
- Shipped as **512x512** RGBA in `public/brands/<brand>/best-friend-badge.png`
  (Imaging Queensland 99,179 bytes, The Xray Group 96,197 — both a hair under the
  100 kB target). Same convention as the 2 Oct colouring-game icons: crop to the
  visible pixels (alpha > 8), scale the artwork into **96% of a transparent
  square — never stretched or cropped away** — extend to the square with alpha 0,
  `png({ compressionLevel: 9, effort: 10 })`. The pipeline is a one-off, like the
  earlier artwork passes.
- The urls in `src/lib/brand.ts` (`bestFriendBadgeUrl`) carry a `?v=1` stamp on
  the two pilot brands — a NEW address for NEW artwork, so no installed app can
  answer it out of a cache — while the master's is the original unversioned
  `/badges/rexs-best-friend.png`.
## The owner's add-to-phone app icon, per brand (3 Oct 2026)
The add-to-phone page's final card had been showing the SHARED `/icon-512.png` on
every instance. The owner asked for the brand's own picture there — "rounded, per
brand, like an app icon" — and supplied one image per pilot brand through ImgBB.
Both uploads turn out to be **the same two files this directory already archives**
as the source of each brand's PWA icons, byte for byte:

| brand | owner's link | resolves to | archived file | dimensions | alpha | md5 |
|---|---|---|---|---|---|---|
| The Xray Group | https://ibb.co/1t0J8yKk | `i.ibb.co/JwcF5629/4-F9-FEAE3-DB39-4724-A213-BE492667-D8-AC.png` | `brands/txg-app-icon.png` | 1024x1024 | **RGB, no alpha** — an opaque white field carrying Rex built from blue tiles that form the X, orange cape and the brand's orange x badge | `10d703e3ee1c36696a96791e4d2cf02d` |
| Imaging Queensland | https://ibb.co/k2nGMQ0y | `i.ibb.co/r2PQv4Mt/DB97-B3-D3-B4-DA-4-D96-B64-E-C7-E77969-B370.png` | `brands/iq-app-icon.png` | 1254x1254 | **RGB, no alpha** — an opaque white field carrying Stu flying with the red cape and the brand's red spiral behind him | `a672da9eef426568c48db0061eb943b3` |
- Both links were fetched a second time when this page icon was made: 496,163
  bytes for The Xray Group and 2,082,994 for Imaging Queensland, md5 identical to
  the archived files above and to the copies the owner's artwork directory holds.
  So no new original was added here, and the archive was already complete.
What shipped, and how it was derived:
- `public/brands/<brand>/add-to-phone-icon.png`, **512x512 RGBA** — Imaging
  Queensland 119,863 bytes, The Xray Group 34,054 (both well under the 150 kB
  budget this app holds per-brand artwork to). `scripts/brand-artwork-assets.mjs`
  scales the archived square with lanczos3, forces alpha on (`ensureAlpha()` — the
  supplied exports have no alpha channel), composits an SVG rounded rectangle
  `dest-in` and encodes with `png({compressionLevel: 9, effort: 10,
  adaptiveFiltering: false })`. The rectangle's radius is **113 px of 512 (22%)**,
  the iOS home-screen corner, so the picture has genuinely transparent corners.
- **The rounding is baked into the file, not left to CSS.** The page keeps its
  own `rounded-2xl` clip (the master's card has always had one, and master still
  draws the unrounded shared file), but the two pilot files are rounded on their
  own, so the icon reads as an app icon even where that class is lost.
- **The PWA icons are untouched by this.** The manifest and apple-touch icons
  (`icon-512/192/180.png`) stay the owner's opaque square, exactly as supplied —
  iOS paints transparency black on the home screen — and the shared
  `/icon-512.png` is unchanged. This file is the page's picture only.
- The urls in `src/lib/brand.ts` (`addToPhoneIconUrl`) carry a `?v=1` stamp on the
  two pilot brands — a NEW address for NEW artwork, so no device answers it out of
  a cache of the square `/icon-512.png` they used to draw — while the master's is
  the original unversioned `/icon-512.png`.
