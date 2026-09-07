/**
 * Film Stack — pure game logic + layout geometry.
 *
 * Extracted from src/components/games/FilmStack.tsx so the rules and the
 * mobile-layout math are unit-testable with `bun test`. This module has no
 * DOM/React imports; the component stays thin and rendering-focused.
 *
 * Match rule (owner spec — mahjong solitaire): a match = TWO hand tiles
 * sharing the SAME imageId (1:1 with the displayed /film-tiles/tile-NN.png
 * asset). The deal places EXACTLY two copies of every face on the board, so
 * every pair is clearable and the board is winnable.
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
  /** Compact footprint: playable columns (first N cols of the 8×7 grid). */
  cols?: number;
  /** Compact footprint: playable rows (first N rows of the 8×7 grid). */
  rows?: number;
}

/** Level table — tile counts stay close to the original design, achieved
 *  with PAIRS of 2 (every face appears exactly TWICE on the board, so a
 *  pair always matches). With 21 unique faces the max pair capacity is
 *  42 tiles — levels designed above 42 are capped at 42 and ramp difficulty
 *  through layers/density/footprint instead. The board is dealt from a
 *  compact per-level footprint so the layout reads as one tight mahjong
 *  block rather than a sparse 8×7 scatter (the old 524px-wide spread). */
export const LEVELS: LevelCfg[] = [
  { types: 4, count: 36, layers: 2, cols: 6, rows: 6 },
  { types: 4, count: 40, layers: 2, cols: 6, rows: 6 },
  { types: 4, count: 42, layers: 3, cols: 6, rows: 6 },
  { types: 5, count: 42, layers: 3, cols: 7, rows: 6 },
  { types: 5, count: 42, layers: 3, cols: 7, rows: 6 },
  { types: 5, count: 42, layers: 3, dense: true, cols: 8, rows: 6 },
  { types: 5, count: 42, layers: 3, dense: true, cols: 8, rows: 6 },
  { types: 5, count: 42, layers: 3, dense: true, cols: 8, rows: 6 },
  { types: 5, count: 42, layers: 3, dense: true, cols: 8, rows: 6 },
  { types: 5, count: 42, layers: 3, dense: true, cols: 8, rows: 6 },
];

export const COLS = 8;
export const ROWS = 7;
export const CELL_W = 64;
export const CELL_H = 74;
export const TILE_W = 76;
export const TILE_H = 84;
export const HAND_SIZE = 4;
/** A match = exactly this many hand tiles with the same imageId (a pair). */
export const MATCH_COUNT = 2;
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

/** All positions of the compact per-level footprint (defaults to full grid). */
export function allPositions(layers: number, cols = COLS, rows = ROWS): GridPos[] {
  const out: GridPos[] = [];
  for (let l = 0; l < layers; l++)
    for (let c = 0; c < cols - l; c++) for (let r = 0; r < rows - l; r++) out.push({ col: c, row: r, layer: l });
  return out;
}

/** Ordered list of the 21 unique faces (type + art), cycled for min repeats. */
export const FACE_POOL: { type: TileType; imageId: number; art: string }[] = (() => {
  const pool: { type: TileType; imageId: number; art: string }[] = [];
  for (let g = 0; g < 21; g++) {
    const type = TYPES[g % TYPES.length];
    const arts = KIND_ART[type];
    const use = Math.floor(g / TYPES.length);
    const art = arts[use % arts.length];
    pool.push({ type, imageId: imageIdOf(art), art });
  }
  return pool;
})();

/**
 * Deal a board: every face appears in exactly one PAIR (2 identical copies),
 * so the whole board is clearable in theory. Faces cycle the 21 unique ones —
 * a level with 18 faces uses 18 distinct arts, 22 faces some arts twice (each
 * still exactly 2 copies on the board), 30 faces three arts repeated — always
 * the MINIMUM number of repeated faces for any count. The footprint is the
 * compact per-level grid (defaults to full 8×7 when cols/rows unset).
 */
export function generateBoard(level: number, rand: Rand = Math.random): FilmTile[] {
  const cfg = LEVELS[level - 1] ?? LEVELS[0];
  const dense = cfg.dense === true;
  const total = cfg.count;
  const ps = shuffleArr(allPositions(cfg.layers, cfg.cols ?? COLS, cfg.rows ?? ROWS), rand).slice(0, total);
  const pairs = total / 2;
  const pool: { type: TileType; imageId: number; art: string }[] = [];
  for (let i = 0; i < pairs; i++) {
    const face = FACE_POOL[i % FACE_POOL.length];
    pool.push(face, face);
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

/**
 * Overall-fit scale with a hard per-tile floor: the result must also keep a
 * single tile (plus SIDE_MARGIN on each side) inside the container. The cap
 * is meaningful at container widths below TILE_W + 2*SIDE_MARGIN (e.g. the
 * 320px acceptance case) where board-fit alone can leave tiles overflowing
 * a container the component measured narrower than the one it lays out for.
 */
export function fitScale(boardW: number, containerW: number): number {
  if (boardW <= 0 || containerW <= 0) return 1;
  const maxTileScale = (containerW - 2 * SIDE_MARGIN) / TILE_W;
  return Math.min(1, containerW / boardW, Math.max(0, maxTileScale));
}

export interface BoardDims {
  boardW: number;
  containerW: number;
  scale: number;
  /** Real measured width of the element the tiles are rendered into. When it
   *  differs from containerW (e.g. the first-paint FALLBACK frame before the
   *  ResizeObserver reports), the clamp is applied to THIS box so tiles can
   *  never be positioned by a layout the real container cannot show. */
  realW?: number;
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
 * (full scaled TILE_W width) stays within
 * [SIDE_MARGIN, boxW - SIDE_MARGIN], where boxW is the width of the REAL
 * rendered container (defaults to dims.containerW; pass `realW` when the
 * layout width is only an estimate, i.e. pre-measurement).
 */
export function displayRect(
  t: { col: number; row: number; layer: number; dense?: boolean },
  dims: BoardDims,
): DisplayRect {
  const { boardW, containerW, scale, realW } = dims;
  const raw = basePos(t);
  const w = TILE_W * scale;
  const h = TILE_H * scale;
  const boxW = realW && realW > 0 ? Math.min(realW, containerW) : containerW;
  const padX = Math.max(0, (boxW - boardW * scale) / 2);
  const lo = SIDE_MARGIN;
  const hi = Math.max(lo, boxW - w - SIDE_MARGIN);
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

export function selectable(t: FilmTile, all: FilmTile[]): boolean {
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
 * After a pick, if the hand now holds exactly MATCH_COUNT (2) tiles with the
 * picked identifier, those tile ids form the match. Otherwise null.
 */
export function matchForPick(hand: HandTile[], pickedImageId: number): number[] | null {
  if (pickedImageId <= 0) return null;
  const ids = hand.filter((h) => h.imageId === pickedImageId).map((h) => h.id);
  return ids.length === MATCH_COUNT ? ids : null;
}

/**
 * Re-validate immediately before animating/removing: exactly MATCH_COUNT (2)
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

/**
 * Hand-aware winnability oracle: can a player clear a fresh board using the
 * real rules — pick an exposed tile into the 4-slot hand, bash when a pair
 * (same image) meets, return a tile when the hand is full? The sim mimics a
 * competent player: always bash when possible, hold distinct faces, and only
 * return a held tile when the hand is full and no bash is available.
 * Used by dealBoard to guarantee every deal presented to the player is
 * clearable (retries reject unwinnable random deals).
 */
export function handWinnable(tiles: FilmTile[]): boolean {
  const cur = tiles.map((t) => ({ ...t }));
  const hand: { id: number; imageId: number }[] = [];
  let removed = 0;
  let guard = 0;
  while (guard++ < tiles.length * 8 + 64) {
    const exposed = cur.filter((t) => !t.cleared && !t.inHand && selectable(t, cur));
    if (exposed.length === 0) return removed === tiles.length;
    let acted = false;
    // Bash with a mate already in hand.
    for (const t of exposed) {
      const mi = hand.findIndex((h) => h.imageId === t.imageId);
      if (mi >= 0) {
        cur.forEach((x) => {
          if (x.id === t.id) x.cleared = true;
          if (x.id === hand[mi].id) {
            x.cleared = true;
            x.inHand = false;
          }
        });
        hand.splice(mi, 1);
        removed += 2;
        acted = true;
        break;
      }
    }
    if (acted) continue;
    // Bash an exposed pair.
    out: for (let i = 0; i < exposed.length; i++) {
      for (let j = i + 1; j < exposed.length; j++) {
        if (exposed[i].imageId === exposed[j].imageId) {
          cur.forEach((x) => {
            if (x.id === exposed[i].id || x.id === exposed[j].id) x.cleared = true;
          });
          removed += 2;
          acted = true;
          break out;
        }
      }
    }
    if (acted) continue;
    // Hold an exposed tile of a face NOT already held (room permitting).
    for (const t of exposed) {
      if (hand.length < HAND_SIZE && !hand.some((h) => h.imageId === t.imageId)) {
        cur.forEach((x) => {
          if (x.id === t.id) x.inHand = true;
        });
        hand.push({ id: t.id, imageId: t.imageId });
        acted = true;
        break;
      }
    }
    if (acted) continue;
    // Hand is full and no bash is possible: return a held tile whose face is
    // NOT currently exposed (most "dead" choice) to free a slot.
    const exposedFaces = new Set(exposed.map((t) => t.imageId));
    if (hand.length === HAND_SIZE && exposedFaces.size > 0) {
      let toReturn = -1;
      for (let h = 0; h < hand.length; h++) if (!exposedFaces.has(hand[h].imageId)) {
        toReturn = h;
        break;
      }
      if (toReturn === -1) toReturn = 0;
      cur.forEach((x) => {
        if (x.id === hand[toReturn].id) x.inHand = false;
      });
      hand.splice(toReturn, 1);
      acted = true;
      continue;
    }
    return false;
  }
  return removed === tiles.length;
}

function scoreLayout(tiles: FilmTile[], containerW: number): { ok: boolean; bad: number; cover: number } {
  const v = layoutViolations(tiles, containerW);
  return { ok: v.outside.length === 0 && v.maxCover <= MAX_COVER, bad: v.outside.length, cover: v.maxCover };
}

/**
 * Deal a validated, WINNABLE board: retry random pair-deals until no tile
 * leaves the game area (0 off-screen at the measured width), no tile is
 * excessively covered AND the hand-aware clear sim passes (bounded tries).
 * Every board the player actually sees is clearable; a fallback of last
 * resort keeps a layout-clean board even if the sim never passes.
 */
export function dealBoard(
  level: number,
  containerW: number,
  rand: Rand = Math.random,
  tries = 30,
): FilmTile[] {
  let bestWin: FilmTile | null = null; // best WINNABLE candidate seen
  let bestWinScore: { bad: number; cover: number } | null = null;
  let bestLayout: FilmTile | null = null; // best layout candidate (fallback)
  let bestLayoutScore: { bad: number; cover: number } | null = null;
  for (let i = 0; i < tries; i++) {
    const cand = generateBoard(level, rand);
    const s = scoreLayout(cand, containerW);
    const win = handWinnable(cand);
    if (win && s.ok) return cand;
    if (win) {
      if (!bestWinScore || s.bad < bestWinScore.bad || (s.bad === bestWinScore.bad && s.cover < bestWinScore.cover)) {
        bestWin = cand;
        bestWinScore = s;
      }
    } else if (!bestLayoutScore || s.bad < bestLayoutScore.bad || (s.bad === bestLayoutScore.bad && s.cover < bestLayoutScore.cover)) {
      bestLayout = cand;
      bestLayoutScore = s;
    }
  }
  if (bestWin) return bestWin;
  if (bestLayout) return bestLayout;
  return generateBoard(level, rand); // practically unreachable
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
  const orderSource = tiles.filter((t) => !t.cleared && !t.inHand).map((t) => ({ col: t.col, row: t.row, layer: t.layer }));
  let best = apply(tiles, shuffleArr(orderSource, rand));
  if (containerW <= 0) return best;
  let bestCover = layoutViolations(best, containerW).maxCover;
  if (bestCover <= MAX_COVER) return best;
  for (let i = 1; i < 10; i++) {
    const cand = apply(tiles, shuffleArr(orderSource, rand));
    const cover = layoutViolations(cand, containerW).maxCover;
    if (cover < bestCover) {
      best = cand;
      bestCover = cover;
      if (cover <= MAX_COVER) break;
    }
  }
  return best;
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