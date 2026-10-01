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
