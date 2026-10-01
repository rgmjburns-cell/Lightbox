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
| Imaging Queensland | https://ibb.co/TxDY9MwB | `i.ibb.co/210WG3F7/Imaging-Queensland-Landscape-RW.png` | `brands/iq-home-logo.png` | 583x174 | RGBA, transparent corners | `5bd49aaee87b636956732809e3c870ae` |
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
  ("put this imaging Queensland logo on instead"), so the shipped file is now a
  byte for byte copy of this original — 583x174, md5
  `5bd49aaee87b636956732809e3c870ae`, identical to the file here. The 482x144
  scaled export it replaced is kept beside it as
  `brands/iq-home-logo-2026-09-30.png` (md5 `757318fc60e48026fb60091f3e8c4d99`),
  and `scripts/brand-artwork-assets.mjs` now copies this original through instead
  of resampling it (`homeLogoKeep`). The round corners the owner asked for on the
  same day are a DISPLAY treatment on the element in `src/routes/__root.tsx`
  (`rounded-2xl`, the radius the app's game tiles use) — the artwork is never
  cropped, keyed or masked.
- **The Xray Group** — byte-identical to `brands/txg-tile-logo.png`, which is
  itself byte-identical to the shipped
  `brands/the-xray-group/home-logo.png`. No change.
