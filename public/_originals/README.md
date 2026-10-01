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
| Imaging Queensland (current) | https://ibb.co/8gKcz7YX | `i.ibb.co/b5WJHKb7/IMG-1258.png` | `brands/iq-home-logo-2026-10-01-owner.png` | 300x210 | **RGB, no alpha** — an opaque white field (61.1% of pixels) carrying the brand's red lockup (227,26,47, 34.5%) | `eb0196b66b3e1bb7c8843a242c6a4696` |

- The owner's 6,385-byte upload IS what ships: `brands/imaging-queensland/home-logo.png`
  is a byte for byte copy of it, and `scripts/brand-artwork-assets.mjs` now copies
  **this** original through under `homeLogoKeep: true`. The script also checks the
  original's md5 against `HOME_LOGO_MD5` and refuses to run if it does not match, so
  a re-run can never silently resample or re-encode it (210 px is taller than
  `HOME_LOGO_HEIGHT` = 144, so without `homeLogoKeep` the pipeline *would* scale it
  down), and a future re-supply dropped in without being archived fails loudly.
- The file it replaced is archived beside it as
  `brands/iq-home-logo-2026-10-01.png` — the 583x174 export that shipped until this
  swap, byte-identical to `brands/iq-home-logo.png` (md5
  `5bd49aaee87b636956732809e3c870ae`), which stays in place as the owner's first
  1 Oct supply. Both halves of the swap are therefore traceable, and the 482x144
  copy before them remains `brands/iq-home-logo-2026-09-30.png`.
- Two consequences, both pinned by tests in `src/lib/brand.test.ts`:
  - **It is the only bar mark with no alpha.** The bar (`src/routes/__root.tsx`,
    `bg-white/5` over the navy body) therefore draws a white rounded tile rather
    than a cut-out logo: mean contrast on that field is 11.33:1, against the
    retired 583x174 export's 3.38:1.
  - **It draws much narrower.** The bar sizes its mark by height (`h-9`, 36 CSS
    px), so the new 1.43:1 aspect renders ~51x36 CSS px where the 3.35:1 export
    rendered ~120x36 — a visible change in the bar's weight, measured from the
    rendered page and recorded in `/home/team/shared/new-iq-logo/MEASUREMENTS.md`.
- The rounded corners are unchanged and still a display treatment: the bar
  element's `rounded-2xl` (16 px, the radius the home-screen game tiles use)
  clips the `<img>` box. Nothing about the PNG is cropped, keyed or masked — the
  file is the owner's bytes, all the way through.
