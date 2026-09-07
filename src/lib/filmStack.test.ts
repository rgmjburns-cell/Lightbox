import { test, expect } from "bun:test";
import {
  COLS,
  HAND_GAP,
  HAND_SLOT_MAX,
  HAND_SIZE,
  MATCH_COUNT,
  SIDE_MARGIN,
  TILE_W,
  boardSize,
  convergeOffset,
  dealBoard,
  displayRect,
  emptySelection,
  fitScale,
  generateBoard,
  handLayout,
  imageIdOf,
  makeRng,
  matchForPick,
  shufflePositions,
  validateMatch,
  type FilmTile,
  type HandTile,
} from "~/lib/filmStack";

const TILE_ART = (n: number) => `/film-tiles/tile-${String(n).padStart(2, "0")}.png`;

// ── Correct image matching ──────────────────────────────────────────────

test("4 identical identifiers → valid match", () => {
  const hand: HandTile[] = [101, 102, 103, 104].map((id) => ({ id, imageId: 7 }));
  expect(matchForPick(hand, 7)).toEqual([101, 102, 103, 104]);
  expect(validateMatch(hand, [101, 102, 103, 104])).toBe(true);
});

test("4 different identifiers → no match", () => {
  const hand: HandTile[] = [1, 7, 12, 20].map((id, i) => ({ id, imageId: [1, 7, 12, 20][i] }));
  expect(matchForPick(hand, 20)).toBeNull();
  expect(validateMatch(hand, [1, 7, 12, 20])).toBe(false);
});

test("3 identical + 1 different → no match", () => {
  const hand: HandTile[] = [
    { id: 1, imageId: 3 },
    { id: 2, imageId: 3 },
    { id: 3, imageId: 3 },
    { id: 4, imageId: 9 },
  ];
  expect(matchForPick(hand, 3)).toBeNull();
  expect(matchForPick(hand, 9)).toBeNull();
  expect(validateMatch(hand, [1, 2, 3, 4])).toBe(false);
});

test("match validation rejects wrong size / unknown ids / invalid identifier", () => {
  const hand: HandTile[] = [1, 2, 3, 4].map((id) => ({ id, imageId: 5 }));
  expect(validateMatch(hand, [1, 2, 3])).toBe(false);
  expect(validateMatch(hand, [1, 2, 3, 4, 5])).toBe(false);
  expect(validateMatch(hand, [1, 2, 3, 999])).toBe(false);
  const zero: HandTile[] = [1, 2, 3, 4].map((id) => ({ id, imageId: 0 }));
  expect(validateMatch(zero, [1, 2, 3, 4])).toBe(false);
});

test("imageId is 1:1 with the displayed asset", () => {
  for (let n = 1; n <= 21; n++) expect(imageIdOf(TILE_ART(n))).toBe(n);
  expect(imageIdOf("/film-tiles/tile-07.png")).not.toBe(imageIdOf("/film-tiles/tile-08.png"));
});

test("dealt board: identical images come in groups of exactly 4", () => {
  for (let level = 1; level <= 10; level++) {
    const tiles = generateBoard(level, makeRng(level * 991));
    const counts = new Map<number, number>();
    tiles.forEach((t) => {
      counts.set(t.imageId, (counts.get(t.imageId) ?? 0) + 1);
      expect(t.art).toBe(TILE_ART(t.imageId));
    });
    counts.forEach((n) => expect(n).toBe(MATCH_COUNT));
  }
});

// ── Shuffle / new game state ────────────────────────────────────────────

test("shuffling reassigns positions only — identifier↔image relationship unchanged", () => {
  const before = generateBoard(4, makeRng(42));
  const after = shufflePositions(before, makeRng(7), 360);
  const key = (t: FilmTile) => `${t.imageId}|${t.art}|${t.type}`;
  expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
  after.forEach((t) => {
    const orig = before.find((b) => b.id === t.id)!;
    expect(key(t)).toBe(key(orig));
    expect(t.imageId).toBe(imageIdOf(t.art));
    expect(t.cleared).toBe(orig.cleared);
    expect(t.inHand).toBe(orig.inHand);
  });
});

test("new game clears previous selection/match state", () => {
  // Component applies emptySelection() + clears flying on reset: assert the helper.
  const cleared = emptySelection();
  expect(cleared).toEqual({ hand: [], match: [] });
});

// ── Board clamp math at mobile widths ───────────────────────────────────

function allTilesInside(tiles: FilmTile[], containerW: number): { bad: number; lo: number; hi: number } {
  const { w: boardW } = boardSize(tiles);
  const scale = fitScale(boardW, containerW);
  const dims = { boardW, containerW, scale };
  let bad = 0;
  let lo = Infinity;
  let hi = -Infinity;
  tiles.forEach((t) => {
    const r = displayRect(t, dims);
    lo = Math.min(lo, r.x);
    hi = Math.max(hi, r.x + r.w);
    if (r.x < SIDE_MARGIN - 0.5 || r.x + r.w > containerW - SIDE_MARGIN + 0.5) bad++;
  });
  return { bad, lo, hi };
}

for (const vw of [393, 320]) {
  test(`all gameplay tiles stay inside a ${vw}px-wide viewport (all levels)`, () => {
    for (let level = 1; level <= 10; level++) {
      for (let seed = 1; seed <= 3; seed++) {
        const tiles = dealBoard(level, vw - 32, makeRng(level * 1000 + seed));
        const { bad, lo, hi } = allTilesInside(tiles, vw - 32);
        expect(bad).toBe(0);
        expect(lo).toBeGreaterThanOrEqual(SIDE_MARGIN - 0.5);
        expect(hi).toBeLessThanOrEqual(vw - 32 - SIDE_MARGIN + 0.5);
      }
    }
  });
}

test("shuffle keeps every tile inside the game area", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const tiles = shufflePositions(generateBoard(9, makeRng(seed)), makeRng(seed + 50), 393 - 32);
    expect(allTilesInside(tiles, 393 - 32).bad).toBe(0);
  }
});

test("tile full width is accounted for (max-x includes TILE_W)", () => {
  const tiles = generateBoard(5, makeRng(11));
  const { w: boardW } = boardSize(tiles);
  const scale = fitScale(boardW, 393 - 32);
  const dims = { boardW, containerW: 393 - 32, scale };
  // Rightmost column tiles must still end inside the area.
  const rightmost = tiles.filter((t) => t.col === COLS - 1 && t.layer === 0);
  expect(rightmost.length).toBeGreaterThan(0);
  rightmost.forEach((t) => {
    const r = displayRect(t, dims);
    expect(r.x + r.w).toBeLessThanOrEqual(393 - 32 - SIDE_MARGIN + 0.5);
    expect(r.w).toBeCloseTo(TILE_W * scale, 6);
  });
});

// ── Compact hand geometry ───────────────────────────────────────────────

test("all 4 hand slots fit inside the hand panel on mobile", () => {
  for (const panelW of [329, 361, 288]) {
    // 393px/320px viewports minus page padding (32) minus section padding (16).
    const { slot, rowWidth } = handLayout(panelW);
    expect(slot).toBeLessThanOrEqual(HAND_SLOT_MAX);
    expect(rowWidth).toBeLessThanOrEqual(panelW);
    expect(rowWidth).toBe(4 * slot + 3 * HAND_GAP);
    expect(HAND_GAP).toBeLessThanOrEqual(8);
  }
});

test("hand holds exactly 4 slots", () => {
  expect(HAND_SIZE).toBe(4);
});

// ── Converge animation offsets ──────────────────────────────────────────

test("matched tiles animate into a compact contiguous group", () => {
  const layout = handLayout(361);
  const offs = [0, 1, 2, 3].map((s) => convergeOffset(s, layout));
  // Outer slots move inward, inner slots barely move; net movement ≈ 0 (centred).
  expect(offs[0]).toBeGreaterThan(0);
  expect(offs[3]).toBeLessThan(0);
  expect(Math.abs(offs[1])).toBeLessThan(Math.abs(offs[0]));
  expect(Math.abs(offs[2])).toBeLessThan(Math.abs(offs[3]));
  expect(offs[0] + offs[1] + offs[2] + offs[3]).toBeCloseTo(0, 6);
  // After converging, adjacent tile centres are exactly one slot apart (touching).
  const centres = [0, 1, 2, 3].map(
    (s) => s * (layout.slot + layout.gap) + layout.slot / 2 + offs[s],
  );
  for (let i = 1; i < 4; i++) expect(centres[i] - centres[i - 1]).toBeCloseTo(layout.slot, 6);
});
