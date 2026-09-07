/**
 * Film Stack — pure game logic + layout geometry.
 *
 * Extracted from src/components/games/FilmStack.tsx so the rules and the
 * mobile-layout math are unit-testable with `bun test`. This module has no
 * DOM/React imports; the component stays thin and rendering-focused.
 *
 * Match rule (owner spec): a match = exactly FOUR hand tiles sharing the
 * SAME imageId (1:1 with the displayed /film-tiles/tile-NN.png asset).
 * imageId survives dealing, moving to hand, selecting and shuffling —
 * shuffle reassigns positions only, never identifiers.
 */

export type TileType = "bone" | "xray-hand" | "xray-chest" | "mri" | "xray-skull";

export interface FilmTile {
  id: number;
  type: TileType;
  /** Stable identifier, 1:1 with the displayed image asset (tile-NN.png). */
  imageId: number;
  art: string;
  col: number;
  row: number;
  layer: number;
  dense: boolean;
  cleared: boolean;
  inHand: boolean;
}

export interface HandTile {
  id: number;
  imageId: number;
}

export const TYPES: TileType[] = ["bone", "xray-hand", "xray-chest", "mri", "xray-skull"];

export const KIND_ART: Record<TileType, string[]> = {
  bone: [
    "/film-tiles/tile-01.png",
    "/film-tiles/tile-02.png",
    "/film-tiles/tile-03.png",
    "/film-tiles/tile-04.png",
    "/film-tiles/tile-05.png",
  ],
  "xray-hand": [
    "/film-tiles/tile-06.png",
    "/film-tiles/tile-07.png",
    "/film-tiles/tile-08.png",
    "/film-tiles/tile-09.png",
  ],
  "xray-chest": [
    "/film-tiles/tile-10.png",
    "/film-tiles/tile-11.png",
    "/film-tiles/tile-12.png",
    "/film-tiles/tile-13.png",
  ],
  mri: [
    "/film-tiles/tile-14.png",
    "/film-tiles/tile-15.png",
    "/film-tiles/tile-16.png",
    "/film-tiles/tile-17.png",
  ],
  "xray-skull": [
    "/film-tiles/tile-18.png",
    "/film-tiles/tile-19.png",
    "/film-tiles/tile-20.png",
    "/film-tiles/tile-21.png",
  ],
};

export const LABELS: Record<TileType, string> = {
  bone: "BONE",
  "xray-hand": "HAND",
  "xray-chest": "CHEST",
  mri: "MRI",
  "xray-skull": "SKULL",
};

export interface LevelCfg {
  types: number;
  count: number;
  layers: number;
  dense?: boolean;
}

/** Level table — values match the original game design; do not retune. */
export const LEVELS: LevelCfg[] = [
  { types: 4, count: 36, layers: 2 },
  { types: 4, count: 40, layers: 2 },
  { types: 4, count: 44, layers: 3 },
  { types: 5, count: 44, layers: 3 },
  { types: 5, count: 48, layers: 3 },
  { types: 5, count: 50, layers: 3, dense: true },
  { types: 5, count: 52, layers: 3, dense: true },
  { types: 5, count: 54, layers: 3, dense: true },
  { types: 5, count: 56, layers: 3, dense: true },
  { types: 5, count: 60, layers: 3, dense: true },
];

export const COLS = 8;
export const ROWS = 7;
export const CELL_W = 64;
export const CELL_H = 74;
export const TILE_W = 76;
export const TILE_H = 84;
export const HAND_SIZE = 4;
/** A match = exactly this many hand tiles with the same imageId. */
export const MATCH_COUNT = 4;
/** Minimum side margin (px) every tile must respect inside the game area. */
export const SIDE_MARGIN = 8;
/** Compact hand: gap between the 4 slots. */
export const HAND_GAP = 8;
/** Compact hand: slot size cap (px); shrinks only to fit narrow panels. */
export const HAND_SLOT_MAX = 64;
/** A tile more covered than this by higher layers counts as unreadable. */
export const MAX_COVER = 0.75;

export type Rand = () => number;

/** Deterministic RNG (mulberry32) for tests; defaults to Math.random. */
export function makeRng(seed: number): Rand {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleArr<T>(a: T[], rand: Rand = Math.random): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

/** imageId 1–21 parsed from the asset filename; 0 when unparseable. */
export function imageIdOf(art: string): number {
  const m = /tile-(\d+)\.png/.exec(art);
  return m ? parseInt(m[1], 10) : 0;
}

export interface GridPos {
  col: number;
  row: number;
  layer: number;
}

export function allPositions(layers: number): GridPos[] {
  const out: GridPos[] = [];
  for (let l = 0; l < layers; l++)
    for (let c = 0; c < COLS - l; c++) for (let r = 0; r < ROWS - l; r++) out.push({ col: c, row: r, layer: l });
  return out;
}

/**
 * Deal a board: every unique image appears in exactly one group of
 * MATCH_COUNT identical copies, so the whole board is clearable in theory.
 * Counts not divisible by 4 (levels 6 and 8) are trimmed down to the nearest
 * multiple of 4 — the LEVELS table itself is untouched.
 */
export function generateBoard(level: number, rand: Rand = Math.random): FilmTile[] {
  const cfg = LEVELS[level - 1] ?? LEVELS[0];
  const dense = cfg.dense === true;
  const total = cfg.count - (cfg.count % MATCH_COUNT);
  const ps = shuffleArr(allPositions(cfg.layers), rand).slice(0, total);
  const groups = total / MATCH_COUNT;
  const pool: { type: TileType; imageId: number; art: string }[] = [];
  for (let g = 0; g < groups; g++) {
    const type = TYPES[g % cfg.types];
    const arts = KIND_ART[type];
    const use = Math.floor(g / cfg.types);
    const art = arts[use % arts.length];
    const imageId = imageIdOf(art);
    for (let k = 0; k < MATCH_COUNT; k++) pool.push({ type, imageId, art });
  }
  const dealt = shuffleArr(pool, rand);
  return ps.map((p, id) => ({
    ...p,
    id,
    dense,
    type: dealt[id].type,
    imageId: dealt[id].imageId,
    art: dealt[id].art,
    cleared: false,
    inHand: false,
  }));
}

/** Base (unscaled, unclamped) board position — grid + layer offset. */
export function basePos(t: { col: number; row: number; layer: number; dense?: boolean }): { x: number; y: number } {
  const cellW = t.dense ? 56 : CELL_W;
  const cellH = t.dense ? 64 : CELL_H;
  return { x: t.col * cellW + t.layer * 26, y: t.row * cellH + t.layer * 32 };
}

/** Unscaled board extents (includes full tile width/height). */
export function boardSize(tiles: FilmTile[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  tiles.forEach((t) => {
    const p = basePos(t);
    w = Math.max(w, p.x + TILE_W);
    h = Math.max(h, p.y + TILE_H);
  });
  return { w, h };
}

/** Overall-fit scale only — never the clipping fix (clamping is). */
export function fitScale(boardW: number, containerW: number): number {
  if (boardW <= 0 || containerW <= 0) return 1;
  return Math.min(1, containerW / boardW);
}

export interface BoardDims {
  boardW: number;
  containerW: number;
  scale: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface DisplayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Final on-screen rect for a board tile. The tile is scaled by the overall
 * fit factor, centred via padX, then its x is CLAMPED so the complete tile
 * (full TILE_W width) stays within [SIDE_MARGIN, containerW - SIDE_MARGIN].
 */
export function displayRect(
  t: { col: number; row: number; layer: number; dense?: boolean },
  dims: BoardDims,
): DisplayRect {
  const { boardW, containerW, scale } = dims;
  const raw = basePos(t);
  const w = TILE_W * scale;
  const h = TILE_H * scale;
  const padX = Math.max(0, (containerW - boardW * scale) / 2);
  const lo = SIDE_MARGIN;
  const hi = Math.max(lo, containerW - w - SIDE_MARGIN);
  return { x: clamp(raw.x * scale + padX, lo, hi), y: raw.y * scale, w, h };
}

function rectsOverlap(a: DisplayRect, b: DisplayRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface LayoutReport {
  /** Tile ids with any part outside the side margins. */
  outside: number[];
  /** Largest fraction of a tile's area covered by strictly-higher layers. */
  maxCover: number;
  scale: number;
}

/** Validate a dealt board at a real container width. */
export function layoutViolations(tiles: FilmTile[], containerW: number): LayoutReport {
  const { w: boardW } = boardSize(tiles);
  const scale = fitScale(boardW, containerW);
  const dims: BoardDims = { boardW, containerW, scale };
  const rects = new Map<number, DisplayRect>();
  tiles.forEach((t) => {
    if (!t.cleared && !t.inHand) rects.set(t.id, displayRect(t, dims));
  });
  const outside: number[] = [];
  rects.forEach((r, id) => {
    if (r.x < SIDE_MARGIN - 0.5 || r.x + r.w > containerW - SIDE_MARGIN + 0.5) outside.push(id);
  });
  let maxCover = 0;
  const active = tiles.filter((t) => !t.cleared && !t.inHand);
  active.forEach((t) => {
    const r = rects.get(t.id);
    if (!r) return;
    let covered = 0;
    active.forEach((o) => {
      if (o.layer <= t.layer) return;
      const or = rects.get(o.id);
      if (or) covered += rectsOverlap(r, or);
    });
    maxCover = Math.max(maxCover, covered / (r.w * r.h));
  });
  return { outside, maxCover, scale };
}

/**
 * Deal a validated board: retry random deals until no tile leaves the game
 * area and no tile is excessively covered (bounded tries, keep the best).
 */
export function dealBoard(
  level: number,
  containerW: number,
  rand: Rand = Math.random,
  tries = 25,
): FilmTile[] {
  let best = generateBoard(level, rand);
  let bestScore = scoreLayout(best, containerW);
  if (bestScore.ok) return best;
  for (let i = 1; i < tries; i++) {
    const cand = generateBoard(level, rand);
    const s = scoreLayout(cand, containerW);
    if (s.bad < bestScore.bad || (s.bad === bestScore.bad && s.cover < bestScore.cover)) {
      best = cand;
      bestScore = s;
      if (s.ok) break;
    }
  }
  return best;
}

function scoreLayout(tiles: FilmTile[], containerW: number): { ok: boolean; bad: number; cover: number } {
  const v = layoutViolations(tiles, containerW);
  return { ok: v.outside.length === 0 && v.maxCover <= MAX_COVER, bad: v.outside.length, cover: v.maxCover };
}

/**
 * Shuffle reassigns POSITIONS ONLY among active board tiles — identifiers
 * (imageId/art/type) never move. Retries keep the most readable arrangement.
 */
export function shufflePositions(tiles: FilmTile[], rand: Rand = Math.random, containerW = 0): FilmTile[] {
  const apply = (ts: FilmTile[], order: GridPos[]): FilmTile[] => {
    let i = 0;
    return ts.map((t) => (!t.cleared && !t.inHand ? { ...t, ...order[i++] } : t));
  };
  const activeCount = tiles.filter((t) => !t.cleared && !t.inHand).length;
  if (activeCount === 0) return tiles;
  let best = apply(tiles, shuffleArr(tiles.filter((t) => !t.cleared && !t.inHand).map((t) => ({ col: t.col, row: t.row, layer: t.layer })), rand));
  if (containerW <= 0) return best;
  let bestCover = layoutViolations(best, containerW).maxCover;
  if (bestCover <= MAX_COVER) return best;
  for (let i = 1; i < 10; i++) {
    const cand = apply(tiles, shuffleArr(tiles.filter((t) => !t.cleared && !t.inHand).map((t) => ({ col: t.col, row: t.row, layer: t.layer })), rand));
    const cover = layoutViolations(cand, containerW).maxCover;
    if (cover < bestCover) {
      best = cand;
      bestCover = cover;
      if (cover <= MAX_COVER) break;
    }
  }
  return best;
}

/** Mahjong-style coverage: does higher-layer tile a cover tile b? */
export function covers(
  a: { col: number; row: number; layer: number; dense?: boolean },
  b: { col: number; row: number; layer: number; dense?: boolean },
): boolean {
  if (a.layer <= b.layer) return false;
  const x = basePos(a);
  const y = basePos(b);
  return (
    Math.min(x.x + TILE_W, y.x + TILE_W) - Math.max(x.x, y.x) > 20 &&
    Math.min(x.y + TILE_H, y.y + TILE_H) - Math.max(x.y, y.y) > 20
  );
}

export function selectable(
  t: FilmTile,
  all: FilmTile[],
): boolean {
  if (t.cleared || t.inHand) return false;
  if (all.some((x) => x.id !== t.id && !x.cleared && !x.inHand && covers(x, t))) return false;
  const l = all.some(
    (x) => !x.cleared && !x.inHand && x.layer === t.layer && x.row === t.row && x.col === t.col - 1,
  );
  const r = all.some(
    (x) => !x.cleared && !x.inHand && x.layer === t.layer && x.row === t.row && x.col === t.col + 1,
  );
  return !l || !r;
}

/**
 * After a pick, if the hand now holds exactly MATCH_COUNT tiles with the
 * picked identifier, those tile ids form the match. Otherwise null.
 */
export function matchForPick(hand: HandTile[], pickedImageId: number): number[] | null {
  if (pickedImageId <= 0) return null;
  const ids = hand.filter((h) => h.imageId === pickedImageId).map((h) => h.id);
  return ids.length === MATCH_COUNT ? ids : null;
}

/**
 * Re-validate immediately before animating/removing: exactly MATCH_COUNT
 * tiles, all present, all sharing one valid identifier. On failure the
 * caller must remove nothing and safely clear the invalid state.
 */
export function validateMatch(tiles: HandTile[], ids: number[]): boolean {
  if (ids.length !== MATCH_COUNT) return false;
  const found = ids.map((id) => tiles.find((t) => t.id === id));
  if (found.some((t) => !t)) return false;
  const first = (found[0] as HandTile).imageId;
  return first > 0 && found.every((t) => (t as HandTile).imageId === first);
}

/** Fresh selection/match state — applied on new game, reset and shuffle. */
export function emptySelection(): { hand: number[]; match: number[] } {
  return { hand: [], match: [] };
}

export interface HandLayout {
  slot: number;
  gap: number;
  rowWidth: number;
}

/** Compact centred hand row: 4 equal square slots + small gaps fit panelW. */
export function handLayout(panelW: number): HandLayout {
  const gap = HAND_GAP;
  const slot = Math.max(40, Math.min(HAND_SLOT_MAX, Math.floor((panelW - 3 * gap) / 4)));
  return { slot, gap, rowWidth: 4 * slot + 3 * gap };
}

/**
 * X-offset (px) moving the tile in hand slot `slotIndex` into a tight
 * contiguous group (slot edges touching) centred on the hand row.
 */
export function convergeOffset(slotIndex: number, layout: HandLayout): number {
  const { slot, gap, rowWidth } = layout;
  const center = rowWidth / 2;
  const target = center + (slotIndex - 1.5) * slot;
  const current = slotIndex * (slot + gap) + slot / 2;
  return target - current;
}
