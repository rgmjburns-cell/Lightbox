import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import Rex from "~/components/Rex";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import AchievementToast from "~/components/AchievementToast";
import { getPlayerName } from "~/components/Onboarding";
import { addPoints } from "~/lib/points";
import {
  checkAchievements,
  trackGameCompletion,
  type Achievement,
} from "~/lib/achievements";

// ── Types ──

interface Position {
  row: number;
  col: number;
}

type TileType = "bone" | "xray-hand" | "xray-chest" | "radiation" | "xray-skull";

type SpecialType = "none" | "striped-h" | "striped-v" | "rex-burst";

interface Tile {
  id: number;
  type: TileType;
  special: SpecialType;
}

interface Level {
  targetScore: number;
  moves: number;
}

type GamePhase =
  | "playing"
  | "swapping"
  | "matching"
  | "falling"
  | "complete"
  | "failed";

type RexMood = "happy" | "excited" | "encouraging";

// ── Constants ──

const ROWS = 8;
const COLS = 8;
const MAX_CASCADE_CHAIN = 20;

// ── Tile Image Mapping ──

const TILE_IMAGE: Record<TileType, string> = {
  bone: "/bone.png",
  "xray-hand": "/xray-hand.png",
  "xray-chest": "/xray-chest.png",
  radiation: "/radiation.png",
  "xray-skull": "/xray-skull.png",
};

const STRIPED_TILE_IMAGE: Record<TileType, string> = {
  bone: "/striped-bone.png",
  "xray-hand": "/striped-xray-hand.png",
  "xray-chest": "/striped-xray-chest.png",
  radiation: "/striped-radiation.png",
  "xray-skull": "/striped-xray-skull.png",
};

// ── Tile Accent Colors (for glows, particles) ──

const TILE_ACCENT: Record<TileType, { glow: string; particle: string }> = {
  bone: { glow: "rgba(251,191,36,0.5)", particle: "#FBBF24" },
  "xray-hand": { glow: "rgba(59,130,246,0.5)", particle: "#3B82F6" },
  "xray-chest": { glow: "rgba(16,185,129,0.5)", particle: "#10B981" },
  radiation: { glow: "rgba(239,68,68,0.5)", particle: "#EF4444" },
  "xray-skull": { glow: "rgba(236,72,153,0.5)", particle: "#EC4899" },
};

const TILE_TYPES: TileType[] = ["bone", "xray-hand", "xray-chest", "radiation", "xray-skull"];

const LEVELS: Level[] = [
  { targetScore: 1500, moves: 35 },
  { targetScore: 3000, moves: 30 },
  { targetScore: 5000, moves: 28 },
  { targetScore: 8000, moves: 25 },
  { targetScore: 12000, moves: 22 },
  { targetScore: 17000, moves: 20 },
  { targetScore: 24000, moves: 19 },
  { targetScore: 33000, moves: 18 },
  { targetScore: 44000, moves: 17 },
  { targetScore: 58000, moves: 16 },
  { targetScore: 75000, moves: 15 },
  { targetScore: 95000, moves: 14 },
  { targetScore: 120000, moves: 13 },
  { targetScore: 150000, moves: 12 },
  { targetScore: 185000, moves: 12 },
];

const COMBO_THRESHOLDS = [
  { min: 2, text: "Great!" },
  { min: 3, text: "Amazing!" },
  { min: 5, text: "Incredible!" },
  { min: 8, text: "Radiology Rockstar!" },
];

const SCORE_KEY = "boneBuster_score";
const LEVEL_KEY = "boneBusterLevel";
const MOVES_KEY = "boneBusterMoves";
const HINTS_KEY = "boneBusterHintsRemaining";
const INITIAL_HINTS = 5;

// ── Hint Scoring ──

/** Score a single swap on a copy of the grid. Simulates the FULL cascade: swap → find matches →
 *  score → remove tiles → gravity → spawn new tiles → repeat until no more matches.
 *  Uses the EXACT scoring formulas from runMatchCycle (base, chain multiplier, special tile
 *  line-clear bonuses, Rex burst) and mirrors applyGravityAndCascade for gravity/spawning. */
function scoreSwap(grid: (Tile | null)[][], a: Position, b: Position): number {
  const simGrid = deepCopyGrid(grid);

  // Perform swap
  const temp = simGrid[a.row][a.col];
  simGrid[a.row][a.col] = simGrid[b.row][b.col];
  simGrid[b.row][b.col] = temp;

  let totalScore = 0;
  let chain = 0;

  // Cascade loop — capped at MAX_CASCADE_CHAIN for safety
  while (chain <= MAX_CASCADE_CHAIN) {
    const matches = findMatches(simGrid);
    if (matches.length === 0) break;

    // Return -1 if the very first swap produces no matches (invalid swap)
    if (chain === 0 && matches.length === 0) return -1;

    let baseScore = 0;
    let specialScore = 0;
    const toRemove = new Set<string>();
    const specialEffects: { pos: Position; special: SpecialType; tileType: TileType }[] = [];
    const specialSpawns: { pos: Position; tileType: TileType }[] = [];
    let pendingRexBurst: TileType | null = null;
    let pendingRexBurstCenter: Position | null = null;

    // ── Process matches: collect toRemove, score, detect specials ──
    // Mirrors runMatchCycle lines ~1077-1118
    for (const match of matches) {
      for (const pos of match.positions) {
        const key = `${pos.row},${pos.col}`;
        if (!toRemove.has(key)) {
          toRemove.add(key);
          const tile = simGrid[pos.row][pos.col];
          if (tile?.special && tile.special !== "none") {
            specialEffects.push({ pos, special: tile.special, tileType: tile.type });
          }
        }
      }

      // Base score — same formula as runMatchCycle (lines 1092-1093)
      const basePerTile =
        match.maxStraightLength >= 5 ? 60 : match.maxStraightLength === 4 ? 40 : 20;
      baseScore += basePerTile * match.length;

      // Special tile creation / Rex burst — same gating as runMatchCycle (lines 1096-1118)
      if (match.maxStraightLength >= 5 && match.centerPosition) {
        pendingRexBurst = match.tileType;
        pendingRexBurstCenter = match.centerPosition;
      } else if (match.maxStraightLength >= 4) {
        // Match-4 creates a striped-h tile that stays on board (not removed).
        // It may cascade in a subsequent cycle; scored naturally when matched.
        const mid = Math.floor(match.positions.length / 2);
        const spawnKey = `${match.positions[mid].row},${match.positions[mid].col}`;
        toRemove.delete(spawnKey);
        specialSpawns.push({ pos: match.positions[mid], tileType: match.tileType });
      }
    }

    // ── Apply special tile effects (pre-existing special tiles being matched) ──
    // Mirrors runMatchCycle lines ~1125-1158 — added AFTER chain multiplier
    for (const effect of specialEffects) {
      if (effect.special === "striped-h") {
        for (let c = 0; c < COLS; c++) {
          toRemove.add(`${effect.pos.row},${c}`);
        }
        specialScore += 30 * COLS;
      } else if (effect.special === "striped-v") {
        for (let r = 0; r < ROWS; r++) {
          toRemove.add(`${r},${effect.pos.col}`);
        }
        specialScore += 30 * ROWS;
      } else if (effect.special === "rex-burst") {
        // Clear all same-type tiles on the board
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (simGrid[r][c]?.type === effect.tileType) {
              toRemove.add(`${r},${c}`);
            }
          }
        }
      }
    }

    // ── Chain multiplier on base score only (line 1122), then add special effects ──
    // In runMatchCycle: bonusScore = (base * chainMultiplier) + specialEffects + rexBurst
    const chainMultiplier = Math.min(chain + 1, 4);
    totalScore += baseScore * chainMultiplier + specialScore;

    // ── Create special (striped-h) tiles at spawn positions ──
    // These survive the clear (they were removed from toRemove above).
    for (const spawn of specialSpawns) {
      simGrid[spawn.pos.row][spawn.pos.col] = {
        id: nextTileId(),
        type: spawn.tileType,
        special: "striped-h",
      };
    }

    // ── Remove matched tiles ──
    for (const key of toRemove) {
      const [r, c] = key.split(",").map(Number);
      simGrid[r][c] = null;
    }

    // ── Rex burst for match-5+ ──
    // Mirrors triggerRexBurst (line 909): clearedCount * 50 * (chain + 1)
    // runMatchCycle(chain) calls triggerRexBurst(..., chain + 1, ...)
    //   triggerRexBurst computes: 50 * (chain_param + 1)
    // So: 50 * ((chain + 1) + 1) = 50 * (chain + 2)
    if (pendingRexBurst && pendingRexBurstCenter) {
      // Count non-null tiles in 3×3 area (grid already has matched tiles cleared above)
      let clearedCount = 0;
      const cp = pendingRexBurstCenter;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (Math.abs(r - cp.row) <= 1 && Math.abs(c - cp.col) <= 1) {
            if (simGrid[r][c] !== null) clearedCount++;
          }
        }
      }
      totalScore += clearedCount * 50 * (chain + 2);

      // Clear the 3×3 area
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (Math.abs(r - cp.row) <= 1 && Math.abs(c - cp.col) <= 1) {
            simGrid[r][c] = null;
          }
        }
      }
    }

    // ── Apply gravity and spawn new tiles ──
    // Mirrors applyGravityAndCascade (lines 986-1013)
    for (let c = 0; c < COLS; c++) {
      let writeRow = ROWS - 1;
      // Compact non-null tiles downward
      for (let r = ROWS - 1; r >= 0; r--) {
        if (simGrid[r][c] !== null) {
          if (r !== writeRow) {
            simGrid[writeRow][c] = simGrid[r][c];
            simGrid[r][c] = null;
          }
          writeRow--;
        }
      }
      // Spawn new random tiles from above
      for (let r = writeRow; r >= 0; r--) {
        simGrid[r][c] = createTile(randomTileType());
      }
    }

    chain++;
  }

  return totalScore > 0 ? totalScore : -1;
}

/** Find the best valid swap on the current board. Returns the two positions and their score, or null if none. */
function findBestHintSwap(
  grid: (Tile | null)[][]
): { a: Position; b: Position; score: number } | null {
  let best: { a: Position; b: Position; score: number } | null = null;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Swap right
      if (c + 1 < COLS) {
        const score = scoreSwap(grid, { row: r, col: c }, { row: r, col: c + 1 });
        if (score > 0 && (!best || score > best.score)) {
          best = { a: { row: r, col: c }, b: { row: r, col: c + 1 }, score };
        }
      }
      // Swap down
      if (r + 1 < ROWS) {
        const score = scoreSwap(grid, { row: r, col: c }, { row: r + 1, col: c });
        if (score > 0 && (!best || score > best.score)) {
          best = { a: { row: r, col: c }, b: { row: r + 1, col: c }, score };
        }
      }
    }
  }

  return best;
}

let tileIdCounter = 0;
function nextTileId(): number {
  return ++tileIdCounter;
}

// ── Helpers ──

function randomTileType(): TileType {
  return TILE_TYPES[Math.floor(Math.random() * TILE_TYPES.length)];
}

function createTile(type?: TileType, special?: SpecialType): Tile {
  return {
    id: nextTileId(),
    type: type ?? randomTileType(),
    special: special ?? "none",
  };
}

function isAdjacent(a: Position, b: Position): boolean {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

function deepCopyGrid(grid: (Tile | null)[][]): (Tile | null)[][] {
  return grid.map((r) => r.map((t) => (t ? { ...t } : null)));
}

// ── Match Detection ──

interface MatchGroup {
  positions: Position[];
  tileType: TileType;
  length: number;
  isHorizontal: boolean;
  maxStraightLength: number;
  centerPosition: Position | null;
}

function findMatches(grid: (Tile | null)[][]): MatchGroup[] {
  const seedSet = new Set<string>();
  // Track the longest straight-line run and its center for each position
  const straightInfo: Record<string, { length: number; centerRow: number; centerCol: number }> = {};

  // Horizontal: find all positions in straight-line runs of 3+
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 2; c++) {
      const tile = grid[r][c];
      if (!tile) continue;
      let end = c;
      while (end + 1 < COLS && grid[r][end + 1]?.type === tile.type) end++;
      if (end - c + 1 >= 3) {
        const runLen = end - c + 1;
        const center = Math.floor((c + end) / 2);
        for (let i = c; i <= end; i++) {
          const key = `${r},${i}`;
          seedSet.add(key);
          if (!straightInfo[key] || straightInfo[key].length < runLen) {
            straightInfo[key] = { length: runLen, centerRow: r, centerCol: center };
          }
        }
      }
      c = end;
    }
  }

  // Vertical: find all positions in straight-line runs of 3+
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 2; r++) {
      const tile = grid[r][c];
      if (!tile) continue;
      let end = r;
      while (end + 1 < ROWS && grid[end + 1][c]?.type === tile.type) end++;
      if (end - r + 1 >= 3) {
        const runLen = end - r + 1;
        const center = Math.floor((r + end) / 2);
        for (let i = r; i <= end; i++) {
          const key = `${i},${c}`;
          seedSet.add(key);
          if (!straightInfo[key] || straightInfo[key].length < runLen) {
            straightInfo[key] = { length: runLen, centerRow: center, centerCol: c };
          }
        }
      }
      r = end;
    }
  }

  if (seedSet.size === 0) return [];

  // Flood-fill from seed positions to capture L/T-shaped regions:
  // any same-type tile adjacent to a matched tile is also matched.
  const allMatched = new Set<string>(seedSet);
  for (const seedKey of seedSet) {
    const [sr, sc] = seedKey.split(",").map(Number);
    const tileType = grid[sr][sc]!.type;
    const queue: Position[] = [{ row: sr, col: sc }];
    const localVisited = new Set<string>([seedKey]);

    while (queue.length > 0) {
      const { row, col } = queue.shift()!;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        const nk = `${nr},${nc}`;
        if (
          nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS &&
          !localVisited.has(nk) &&
          grid[nr][nc]?.type === tileType
        ) {
          localVisited.add(nk);
          allMatched.add(nk);
          queue.push({ row: nr, col: nc });
        }
      }
    }
  }

  // Group all matched positions into connected components for scoring
  const processed = new Set<string>();
  const groups: MatchGroup[] = [];

  for (const key of allMatched) {
    if (processed.has(key)) continue;
    const [sr, sc] = key.split(",").map(Number);
    const tileType = grid[sr][sc]!.type;
    const positions: Position[] = [];
    const queue: Position[] = [{ row: sr, col: sc }];
    processed.add(key);

    while (queue.length > 0) {
      const { row, col } = queue.shift()!;
      positions.push({ row, col });
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        const nk = `${nr},${nc}`;
        if (
          nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS &&
          !processed.has(nk) &&
          allMatched.has(nk) &&
          grid[nr][nc]?.type === tileType
        ) {
          processed.add(nk);
          queue.push({ row: nr, col: nc });
        }
      }
    }

    // Compute maxStraightLength and centerPosition from the best straight run in this group
    let maxStraight = 0;
    let centerPos: Position | null = null;
    for (const pos of positions) {
      const info = straightInfo[`${pos.row},${pos.col}`];
      if (info && info.length > maxStraight) {
        maxStraight = info.length;
        centerPos = { row: info.centerRow, col: info.centerCol };
      }
    }

    groups.push({ positions, tileType, length: positions.length, isHorizontal: true, maxStraightLength: maxStraight, centerPosition: centerPos });
  }

  return groups;
}

// ── Deadlock Detection ──

function hasValidMoves(grid: (Tile | null)[][]): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Try swap right
      if (c + 1 < COLS) {
        const test = deepCopyGrid(grid);
        const temp = test[r][c];
        test[r][c] = test[r][c + 1];
        test[r][c + 1] = temp;
        if (findMatches(test).length > 0) return true;
      }
      // Try swap down
      if (r + 1 < ROWS) {
        const test = deepCopyGrid(grid);
        const temp = test[r][c];
        test[r][c] = test[r + 1][c];
        test[r + 1][c] = temp;
        if (findMatches(test).length > 0) return true;
      }
    }
  }
  return false;
}

// ── Generate grid with no initial matches ──

function generateCleanGrid(): (Tile | null)[][] {
  const grid: (Tile | null)[][] = [];

  for (let r = 0; r < ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < COLS; c++) {
      let type = randomTileType();
      let attempts = 0;
      while (attempts < 50) {
        const hMatch =
          c >= 2 &&
          grid[r][c - 1]?.type === type &&
          grid[r][c - 2]?.type === type;
        const vMatch =
          r >= 2 &&
          grid[r - 1][c]?.type === type &&
          grid[r - 2][c]?.type === type;
        if (!hMatch && !vMatch) break;
        const alternatives = TILE_TYPES.filter((t) => t !== type);
        type = alternatives[Math.floor(Math.random() * alternatives.length)];
        attempts++;
      }
      grid[r][c] = createTile(type);
    }
  }
  return grid;
}

// ── Tile Sprite Component ──

function TileSprite({
  tile,
  size,
  className = "",
}: {
  tile: Tile;
  size: number;
  className?: string;
}) {
  const isStriped = tile.special === "striped-h" || tile.special === "striped-v";
  const src = isStriped ? STRIPED_TILE_IMAGE[tile.type] : TILE_IMAGE[tile.type];

  return (
    <img
      src={src}
      alt={tile.type}
      width={size}
      height={size}
      fetchPriority="high"
      className={`object-contain pointer-events-none ${className}`}
      style={{ width: size, height: size, imageRendering: "auto" }}
      draggable={false}
    />
  );
}

// ── Memoized Board Component (prevents re-renders on score/moves changes) ──

interface MemoBoardProps {
  grid: (Tile | null)[][];
  selected: Position | null;
  swappingTiles: [Position, Position] | null;
  matchingTiles: Position[];
  wiggleTiles: Position[];
  fallingTiles: { from: Position; to: Position; tile: Tile }[];
  boardShake: boolean;
  hintTiles: [Position, Position] | null;
  handleTileTap: (row: number, col: number) => void;
}

const MemoBoard = memo(function MemoBoard({
  grid,
  selected,
  swappingTiles,
  matchingTiles,
  wiggleTiles,
  fallingTiles,
  boardShake,
  hintTiles,
  handleTileTap,
}: MemoBoardProps) {
  const isMatching = (row: number, col: number) =>
    matchingTiles.some((p) => p.row === row && p.col === col);

  const isSwapping = (row: number, col: number): number | null => {
    if (!swappingTiles) return null;
    if (swappingTiles[0].row === row && swappingTiles[0].col === col) return 0;
    if (swappingTiles[1].row === row && swappingTiles[1].col === col) return 1;
    return null;
  };

  const isHinted = (row: number, col: number): boolean =>
    hintTiles !== null &&
    ((hintTiles[0].row === row && hintTiles[0].col === col) ||
      (hintTiles[1].row === row && hintTiles[1].col === col));

  const isWiggling = (row: number, col: number) =>
    wiggleTiles.some((p) => p.row === row && p.col === col);

  const getSwapTransform = (row: number, col: number): string => {
    const idx = isSwapping(row, col);
    if (idx === null || !swappingTiles) return "";
    const other = swappingTiles[idx === 0 ? 1 : 0];
    const cellSize = 100;
    const dr = (other.row - row) * cellSize;
    const dc = (other.col - col) * cellSize;
    return `translate(${dc}%, ${dr}%)`;
  };

  const getFallingOffset = (row: number, col: number): string | undefined => {
    const fall = fallingTiles.find((f) => f.to.row === row && f.to.col === col);
    if (!fall) return undefined;
    const offset = (fall.from.row - fall.to.row) * 100;
    return `${offset}%`;
  };

  const isFalling = (row: number, col: number): boolean =>
    fallingTiles.some((f) => f.to.row === row && f.to.col === col);

  return (
    <div
      className={`grid gap-1 p-2 bg-white rounded-2xl shadow-lg border border-lightTeal/50 transition-transform duration-100 ${
        boardShake ? "animate-[shake_0.4s_ease-out]" : ""
      }`}
      style={{
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      }}
    >
      {Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) => {
          const tile = grid[r]?.[c];
          const swapIdx = isSwapping(r, c);
          const matched = isMatching(r, c);
          const isSelected =
            selected?.row === r && selected?.col === c;
          const wiggling = isWiggling(r, c);
          const falling = isFalling(r, c);
          const fallOffset = getFallingOffset(r, c);
          const hinted = isHinted(r, c);

          return (
            <button
              key={`${r}-${c}`}
              className={`
                relative aspect-square flex items-center justify-center
                rounded-full select-none outline-none
                ${isSelected ? "z-10" : ""}
                ${tile ? "cursor-pointer" : "bg-transparent"}
              `}
              style={{
                transform: swapIdx !== null ? getSwapTransform(r, c) : undefined,
                transition: swapIdx !== null
                  ? "transform 0.25s ease-in-out"
                  : "transform 0.15s",
                animation: hinted
                  ? "hintPulse 1.2s ease-in-out infinite"
                  : isSelected
                    ? "pulseGlow 0.8s ease-in-out infinite"
                    : wiggling
                      ? "tileWiggle 0.3s ease-in-out"
                      : falling
                        ? "tileFall 0.4s ease-out forwards"
                        : undefined,
                "--fall-from": fallOffset,
                // Selection ring on the button (not clipped by overflow-hidden)
                boxShadow: hinted && tile
                  ? `0 0 0 4px rgba(251,191,36,0.6), 0 0 18px rgba(251,191,36,0.4), 0 0 36px rgba(251,191,36,0.2)`
                  : isSelected && tile
                    ? `0 0 0 3px white, 0 0 14px ${TILE_ACCENT[tile!.type].glow}, 0 0 28px ${TILE_ACCENT[tile!.type].glow}`
                    : undefined,
              } as React.CSSProperties}
              onClick={() => handleTileTap(r, c)}
              onTouchStart={(e) => {
                if (swappingTiles) return;
                if (wiggleTiles.length > 0) return;
                e.currentTarget.style.transform = "scale(0.92)";
              }}
              onTouchEnd={(e) => {
                if (swappingTiles) return;
                if (wiggleTiles.length > 0) return;
                e.currentTarget.style.transform = "";
              }}
              aria-label={`Tile ${r},${c}: ${tile?.type ?? "empty"}`}
            >
              {tile && (
                <>
                  {/* Tile wrapper with idle animations */}
                  <span
                    className={`
                      absolute inset-[2px] rounded-full flex items-center justify-center
                      overflow-hidden
                      ${matched ? "animate-[matchPop_0.35s_ease-out]" : ""}
                    `}
                    style={{
                      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                    }}
                  >
                    {/* Idle shimmer overlay */}
                    {!matched && !isSelected && (
                      <span
                        className="absolute inset-0 z-5 pointer-events-none"
                        style={{
                          background:
                            "linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.3) 50%, transparent 60%)",
                          backgroundSize: "200% 200%",
                          animation: "shimmerIdle 3s ease-in-out infinite",
                        }}
                      />
                    )}

                    {/* Breathing + floating idle animation wrapper */}
                    <span
                      className="relative flex items-center justify-center w-full h-full"
                      style={{
                        animation: !matched && !isSelected
                          ? "tileIdleBreathing 2.5s ease-in-out infinite"
                          : "none",
                        transform: isSelected ? "scale(1.08)" : "scale(1)",
                        transition: isSelected ? "transform 0.15s ease-out" : "none",
                      }}
                    >
                      <TileSprite tile={tile} size={38} />
                    </span>
                  </span>
                </>
              )}
            </button>
          );
        })
      )}
    </div>
  );
});

// ── Main Component ──

export default function BoneBuster() {
  const playerName = typeof window !== "undefined" ? (getPlayerName() || "Player") : "Player";

  // ── Hydration guard ──
  const [isHydrated, setIsHydrated] = useState(false);

  // Game state
  const [grid, setGrid] = useState<(Tile | null)[][]>([]);
  const [selected, setSelected] = useState<Position | null>(null);
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [level, setLevel] = useState(() => {
    if (typeof window === "undefined") return 0;
    const saved = localStorage.getItem(LEVEL_KEY);
    return saved ? Math.min(parseInt(saved, 10), LEVELS.length - 1) : 0;
  });
  const [movesLeft, setMovesLeft] = useState(() => {
    if (typeof window === "undefined") return LEVELS[0].moves;
    // Restore saved movesLeft first (mid-level progress)
    const savedMoves = localStorage.getItem(MOVES_KEY);
    if (savedMoves) {
      const parsed = parseInt(savedMoves, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    // Fall back to current level's move count
    const savedLevel = localStorage.getItem(LEVEL_KEY);
    const lvl = savedLevel ? Math.min(parseInt(savedLevel, 10), LEVELS.length - 1) : 0;
    return LEVELS[lvl].moves;
  });
  const [phase, setPhase] = useState<GamePhase>("playing");
  const [chainCount, setChainCount] = useState(0);
  const [comboText, setComboText] = useState<{ text: string; id: number } | null>(null);
  const [rexMood, setRexMood] = useState<RexMood>("happy");
  const [rexMessage, setRexMessage] = useState("Match 3 or more tiles!");

  // Achievement toast
  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
  const levelCompletedRef = useRef(false);

  // Animation state
  const [swappingTiles, setSwappingTiles] = useState<[Position, Position] | null>(null);
  const [wiggleTiles, setWiggleTiles] = useState<Position[]>([]);
  const [matchingTiles, setMatchingTiles] = useState<Position[]>([]);
  const [fallingTiles, setFallingTiles] = useState<{ from: Position; to: Position; tile: Tile }[]>([]);
  const [particles, setParticles] = useState<{ id: number; row: number; col: number; color: string }[]>([]);

  // ── Hint System State ──
  const [hintsRemaining, setHintsRemaining] = useState(() => {
    if (typeof window === "undefined") return INITIAL_HINTS;
    const saved = localStorage.getItem(HINTS_KEY);
    if (saved === null) {
      localStorage.setItem(HINTS_KEY, INITIAL_HINTS.toString());
      return INITIAL_HINTS;
    }
    return Math.max(0, parseInt(saved, 10));
  });
  const [hintHighlight, setHintHighlight] = useState<[Position, Position] | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Rex Super Burst State ──
  const [rexBurst, setRexBurst] = useState<{
    active: boolean;
    phase: "idle" | "flying" | "burst";
    targetType: TileType | null;
    progress: number;
  }>({ active: false, phase: "idle", targetType: null, progress: 0 });
  const rexBurstAnimRef = useRef<number | null>(null);
  const [boardShake, setBoardShake] = useState(false);

  // Score persistence
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem(SCORE_KEY) || "0", 10);
  });

  const levelConfig = LEVELS[level];

  // ── Client-side initialization (avoid SSR hydration mismatch) ──
  useEffect(() => {
    setGrid(generateCleanGrid());
    setIsHydrated(true);
  }, []);

  // Score animation
  useEffect(() => {
    if (displayScore === score) return;
    const timer = setTimeout(() => {
      setDisplayScore((prev) => {
        const diff = score - prev;
        const step = Math.max(1, Math.ceil(Math.abs(diff) / 20));
        if (Math.abs(diff) < step) return score;
        return prev + Math.sign(diff) * step;
      });
    }, 16);
    return () => clearTimeout(timer);
  }, [displayScore, score]);

  // Persist level
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LEVEL_KEY, level.toString());
    }
  }, [level]);

  // Persist movesLeft (C1 + H4)
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(MOVES_KEY, movesLeft.toString());
    }
  }, [movesLeft]);

  // Persist high score
  useEffect(() => {
    if (score > highScore && typeof window !== "undefined") {
      setHighScore(score);
      localStorage.setItem(SCORE_KEY, score.toString());
    }
  }, [score, highScore]);

  // ── Refs to break circular dependencies between match/gravity callbacks ──
  const runMatchCycleRef = useRef<
    (currentGrid: (Tile | null)[][], chain: number, currentScore: number, currentMoves: number) => void
  >(undefined!);
  const applyGravityAndCascadeRef = useRef<
    (inputGrid: (Tile | null)[][], chain: number, currentScore: number, currentMoves: number) => void
  >(undefined!);
  const triggerRexBurstRef = useRef<
    (targetType: TileType, centerPos: Position, currentGrid: (Tile | null)[][], chain: number, currentScore: number, currentMoves: number) => void
  >(undefined!);

  // ── Refs for values read by handleTileTap (avoid board re-renders on score/moves change) ──
  const scoreRef = useRef(score);
  const movesLeftRef = useRef(movesLeft);
  const phaseRef = useRef(phase);
  const rexBurstActiveRef = useRef(rexBurst.active);
  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { movesLeftRef.current = movesLeft; }, [movesLeft]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { rexBurstActiveRef.current = rexBurst.active; }, [rexBurst.active]);

  // Show combo text
  const showCombo = useCallback((chain: number) => {
    const threshold = [...COMBO_THRESHOLDS].reverse().find((t) => chain >= t.min);
    if (threshold) {
      const id = Date.now();
      setComboText({ text: threshold.text, id });
      setTimeout(() => {
        setComboText((prev) => (prev?.id === id ? null : prev));
      }, 1200);
    }
  }, []);

  // ── Hint System ──

  const clearHintHighlight = useCallback(() => {
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    setHintHighlight(null);
  }, []);

  const useHint = useCallback(() => {
    if (hintsRemaining <= 0) return;
    if (phase !== "playing") return;

    const best = findBestHintSwap(grid);
    if (!best) {
      setRexMessage("No moves to hint!");
      return;
    }

    // Decrement hints
    const newCount = hintsRemaining - 1;
    setHintsRemaining(newCount);
    if (typeof window !== "undefined") {
      localStorage.setItem(HINTS_KEY, newCount.toString());
    }

    // Show the highlight
    setHintHighlight([best.a, best.b]);

    // Auto-clear after 3 seconds
    hintTimerRef.current = setTimeout(() => {
      setHintHighlight(null);
      hintTimerRef.current = null;
    }, 3000);
  }, [hintsRemaining, phase, grid]);

  // Cleanup hint timer on unmount
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  // ── Rex Super Burst Animation ──

  const triggerRexBurst = useCallback(
    (targetType: TileType, centerPos: Position, currentGrid: (Tile | null)[][], chain: number, currentScore: number, currentMoves: number) => {
      setRexBurst({ active: true, phase: "flying", targetType, progress: 0 });

      let startTime: number | null = null;
      const duration = 1200; // ms for flight

      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);

        setRexBurst((prev) => ({
          ...prev,
          progress,
          phase: progress < 1 ? "flying" : "burst",
        }));

        if (progress < 1) {
          rexBurstAnimRef.current = requestAnimationFrame(animate);
        } else {
          // Burst phase — clear 3x3 area centered on the match position
          setBoardShake(true);
          setTimeout(() => setBoardShake(false), 400);

          const newGrid = currentGrid.map((r) => r.map((t) => (t ? { ...t } : null)));
          const clearedPositions: Position[] = [];

          // Clear 3x3 area (or cross pattern) centered on centerPos
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (Math.abs(r - centerPos.row) <= 1 && Math.abs(c - centerPos.col) <= 1) {
                if (newGrid[r][c] !== null) {
                  clearedPositions.push({ row: r, col: c });
                  newGrid[r][c] = null;
                }
              }
            }
          }

          const burstScore = clearedPositions.length * 50 * (chain + 1);

          // Particles for all cleared
          setParticles(
            clearedPositions.map((p) => ({
              id: Math.random(),
              row: p.row,
              col: p.col,
              color: TILE_ACCENT[targetType].particle,
            }))
          );
          setTimeout(() => setParticles([]), 700);

          setGrid(newGrid);
          setScore(currentScore + burstScore);
          setRexBurst({ active: false, phase: "idle", targetType: null, progress: 0 });

          // Continue chain with gravity
          setTimeout(() => {
            applyGravityAndCascadeRef.current!(newGrid, chain + 1, currentScore + burstScore, currentMoves);
          }, 300);
        }
      };

      rexBurstAnimRef.current = requestAnimationFrame(animate);
    },
    []
  );

  // Cleanup rex burst animation
  useEffect(() => {
    return () => {
      if (rexBurstAnimRef.current) cancelAnimationFrame(rexBurstAnimRef.current);
    };
  }, []);

  // ── Deadlock check + reshuffle ──

  const checkDeadlock = useCallback((currentGrid: (Tile | null)[][]) => {
    if (!hasValidMoves(currentGrid)) {
      setRexMessage("No moves! Reshuffling...");
      setTimeout(() => {
        let newGrid = generateCleanGrid();
        // Keep generating until we have a board with valid moves
        let safety = 0;
        while (!hasValidMoves(newGrid) && safety < 100) {
          newGrid = generateCleanGrid();
          safety++;
        }
        setGrid(newGrid);
        setRexMessage("Match 3 or more tiles!");
      }, 800);
    }
  }, []);

  // ── Check level completion / failure ──

  const checkLevelEnd = useCallback((currentScore: number, currentMoves: number) => {
    if (currentScore >= levelConfig.targetScore) {
      setPhase("complete");
      setRexMood("excited");
      setRexMessage(`Amazing work, ${playerName}!`);
    } else if (currentMoves <= 0) {
      setPhase("failed");
      setRexMood("encouraging");
      setRexMessage("Keep trying, you've got this!");
    }
  }, [levelConfig.targetScore, playerName]);

  // ── Apply gravity and trigger cascade ──

  const applyGravityAndCascade = useCallback(
    (inputGrid: (Tile | null)[][], chain: number, currentScore: number, currentMoves: number) => {
      setPhase("falling");
      const newGrid = deepCopyGrid(inputGrid);
      const falls: { from: Position; to: Position; tile: Tile }[] = [];

      for (let c = 0; c < COLS; c++) {
        let writeRow = ROWS - 1;
        // Compact non-null tiles downward
        for (let r = ROWS - 1; r >= 0; r--) {
          if (newGrid[r][c] !== null) {
            if (r !== writeRow) {
              falls.push({
                from: { row: r, col: c },
                to: { row: writeRow, col: c },
                tile: newGrid[r][c]!,
              });
              newGrid[writeRow][c] = newGrid[r][c];
              newGrid[r][c] = null;
            }
            writeRow--;
          }
        }
        // Spawn new tiles from above
        for (let r = writeRow; r >= 0; r--) {
          const tile = createTile();
          newGrid[r][c] = tile;
          falls.push({
            from: { row: r - (writeRow + 1), col: c },
            to: { row: r, col: c },
            tile,
          });
        }
      }

      if (falls.length > 0) {
        setFallingTiles(falls);
      }

      setScore(currentScore);
      setGrid(deepCopyGrid(newGrid));

      setTimeout(() => {
        setFallingTiles([]);
        // Check for cascading matches
        runMatchCycleRef.current!(deepCopyGrid(newGrid), chain, currentScore, currentMoves);
      }, 400);
    },
    []
  );

  // ── Run match cycle (handles match → special → gravity → cascade loop) ──

  const runMatchCycle = useCallback(
    (currentGrid: (Tile | null)[][], chain: number, currentScore: number, currentMoves: number) => {
      // Safety limit (L1)
      if (chain > MAX_CASCADE_CHAIN) {
        setGrid(deepCopyGrid(currentGrid));
        setScore(currentScore);
        setPhase("playing");
        setChainCount(0);
        setRexMood("happy");
        setRexMessage("Match 3 or more tiles!");
        checkDeadlock(currentGrid);
        checkLevelEnd(currentScore, currentMoves);
        return;
      }

      setPhase("matching");
      const matches = findMatches(currentGrid);

      if (matches.length === 0) {
        // Cascade fully resolved
        setGrid(deepCopyGrid(currentGrid));
        setScore(currentScore);
        setPhase("playing");
        setChainCount(0);
        setRexMood("happy");
        setRexMessage("Match 3 or more tiles!");
        checkDeadlock(currentGrid);
        checkLevelEnd(currentScore, currentMoves);
        return;
      }

      setChainCount(chain + 1);
      showCombo(chain + 1);
      setRexMood(chain >= 3 ? "excited" : "happy");

      let bonusScore = 0;
      const toRemove = new Set<string>();
      const positionsToAnimate: Position[] = [];
      const specialEffects: { pos: Position; special: SpecialType; tileType: TileType }[] = [];
      let pendingRexBurst: TileType | null = null;
      let pendingRexBurstCenter: Position | null = null;

      // Process special tiles that are already on the board and being matched
      const specialGrid = deepCopyGrid(currentGrid);
      for (const match of matches) {
        for (const pos of match.positions) {
          const key = `${pos.row},${pos.col}`;
          if (!toRemove.has(key)) {
            toRemove.add(key);
            positionsToAnimate.push(pos);

            const tile = currentGrid[pos.row][pos.col];
            if (tile?.special !== "none") {
              specialEffects.push({ pos, special: tile!.special, tileType: tile!.type });
            }
          }
        }

        // Score calculation — use maxStraightLength for per-tile rate (Fix 4)
        const basePerTile =
          match.maxStraightLength >= 5 ? 60 : match.maxStraightLength === 4 ? 40 : 20;
        bonusScore += basePerTile * match.length;

        // Determine special tile creation / rex burst — gated by maxStraightLength (Fix 1)
        if (match.maxStraightLength >= 5 && match.centerPosition) {
          pendingRexBurst = match.tileType;
          pendingRexBurstCenter = match.centerPosition;
        } else if (match.maxStraightLength >= 4) {
          const mid = Math.floor(match.positions.length / 2);
          const spawnPos = match.positions[mid];
          const spawnKey = `${spawnPos.row},${spawnPos.col}`;
          const special: SpecialType = "striped-h";

          // Don't remove the special spawn point
          toRemove.delete(spawnKey);
          const idx = positionsToAnimate.findIndex(
            (p) => p.row === spawnPos.row && p.col === spawnPos.col
          );
          if (idx >= 0) positionsToAnimate.splice(idx, 1);

          specialGrid[spawnPos.row][spawnPos.col] = {
            id: nextTileId(),
            type: match.tileType,
            special,
          };
        }
      }

      // Apply chain multiplier — capped at 3x (Fix 4: chain + 1, max 4)
      bonusScore *= Math.min(chain + 1, 4);

      // Apply special tile effects (striped tiles)
      for (const effect of specialEffects) {
        if (effect.special === "striped-h") {
          for (let c = 0; c < COLS; c++) {
            const key = `${effect.pos.row},${c}`;
            if (!toRemove.has(key)) {
              toRemove.add(key);
              positionsToAnimate.push({ row: effect.pos.row, col: c });
            }
          }
          bonusScore += 30 * COLS;
        } else if (effect.special === "striped-v") {
          for (let r = 0; r < ROWS; r++) {
            const key = `${r},${effect.pos.col}`;
            if (!toRemove.has(key)) {
              toRemove.add(key);
              positionsToAnimate.push({ row: r, col: effect.pos.col });
            }
          }
          bonusScore += 30 * ROWS;
        } else if (effect.special === "rex-burst") {
          const targetType = effect.tileType;
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (specialGrid[r][c]?.type === targetType) {
                const key = `${r},${c}`;
                if (!toRemove.has(key)) {
                  toRemove.add(key);
                  positionsToAnimate.push({ row: r, col: c });
                }
              }
            }
          }
        }
      }

      // Animate matches with particle colors
      setMatchingTiles(positionsToAnimate);
      setParticles(
        positionsToAnimate.map((p) => {
          const tile = currentGrid[p.row]?.[p.col];
          return {
            id: Math.random(),
            row: p.row,
            col: p.col,
            color: tile ? TILE_ACCENT[tile.type].particle : "#FFD700",
          };
        })
      );

      // Clear matched tiles (use specialGrid which has the new special spawns)
      const clearedGrid = deepCopyGrid(specialGrid);
      for (const pos of positionsToAnimate) {
        clearedGrid[pos.row][pos.col] = null;
      }

      const newScore = currentScore + bonusScore;

      // Update score immediately so displayScore animation can start
      setScore(newScore);

      setTimeout(() => {
        setMatchingTiles([]);
        setParticles([]);

        // Handle pending Rex Burst (M1: use pendingRexBurst, not findMostCommonType)
        if (pendingRexBurst && pendingRexBurstCenter) {
          triggerRexBurstRef.current!(pendingRexBurst, pendingRexBurstCenter, clearedGrid, chain + 1, newScore, currentMoves);
        } else {
          applyGravityAndCascadeRef.current!(clearedGrid, chain + 1, newScore, currentMoves);
        }
      }, 350);

      // Update grid immediately so the cleared state is visible
      setGrid(deepCopyGrid(clearedGrid));
    },
    [showCombo, checkDeadlock, checkLevelEnd]
  );

  // ── Handle tile tap ──

  const handleTileTap = useCallback(
    (row: number, col: number) => {
      // Guard: only allow input during "playing" phase (C2)
      if (phaseRef.current !== "playing") return;
      if (rexBurstActiveRef.current) return; // No interaction during rex burst

      // Clear hint highlight if player taps anything
      clearHintHighlight();

      // We need latest selected & grid — read from closures (stable via ref pattern)
      // selected is captured by the outer scope; grid must be read fresh
      
      // Normal tile selection
      if (!selected) {
        setSelected({ row, col });
        setRexMessage("Now tap an adjacent tile to swap!");
        return;
      }

      if (selected.row === row && selected.col === col) {
        setSelected(null);
        setRexMessage("Match 3 or more tiles!");
        return;
      }

      if (!isAdjacent(selected, { row, col })) {
        setSelected({ row, col });
        return;
      }

      // ── Attempt swap ──
      setPhase("swapping"); // C2: transition to swapping
      setSwappingTiles([selected, { row, col }]);
      setSelected(null);

      // Read current grid via functional update
      const currentGrid = deepCopyGrid(grid);
      const temp = currentGrid[selected.row][selected.col];
      currentGrid[selected.row][selected.col] = currentGrid[row][col];
      currentGrid[row][col] = temp;

      const currentScore = scoreRef.current;
      const currentMoves = movesLeftRef.current;

      setTimeout(() => {
        // Check for matches
        const matches = findMatches(currentGrid);
        if (matches.length > 0) {
          // Valid swap
          setGrid(deepCopyGrid(currentGrid));
          const newMoves = currentMoves - 1;
          setMovesLeft(newMoves);
          setSwappingTiles(null);
          setRexMessage("Match 3 or more tiles!");

          setTimeout(() => {
            runMatchCycleRef.current!(deepCopyGrid(currentGrid), 0, currentScore, newMoves);
          }, 50);
        } else {
          // Invalid swap — wiggle animation (M2)
          setSwappingTiles(null);
          setWiggleTiles([selected, { row, col }]);
          setRexMessage("No match! Try again.");

          setTimeout(() => {
            setWiggleTiles([]);
            setPhase("playing"); // C2: back to playing
            setRexMessage("Match 3 or more tiles!");
          }, 300);
        }
      }, 60);
    },
    [selected, grid, clearHintHighlight]
  );

  // ── Keep refs in sync with latest callbacks (breaks circular dependency) ──
  useEffect(() => { runMatchCycleRef.current = runMatchCycle; }, [runMatchCycle]);
  useEffect(() => { applyGravityAndCascadeRef.current = applyGravityAndCascade; }, [applyGravityAndCascade]);
  useEffect(() => { triggerRexBurstRef.current = triggerRexBurst; }, [triggerRexBurst]);

  // Track completion for points & achievements
  useEffect(() => {
    if (phase === "complete" && !levelCompletedRef.current) {
      levelCompletedRef.current = true;
      // L3: award actual score, not target
      addPoints(score);

      // Daily challenge bonus

      trackGameCompletion("bone-buster");
      const newAchievements = checkAchievements();
      if (newAchievements.length > 0) {
        setToastAchievement(newAchievements[0]);
      }
    }
    if (phase !== "complete") {
      levelCompletedRef.current = false;
    }
  }, [phase, score]);

  // Star calculation
  const stars = useMemo(() => {
    if (score >= levelConfig.targetScore * 2) return 3;
    if (score >= levelConfig.targetScore * 1.5) return 2;
    if (score >= levelConfig.targetScore) return 1;
    return 0;
  }, [score, levelConfig.targetScore]);

  // Next level
  const nextLevel = useCallback(() => {
    // Reset fail counter for the level they just passed
    const failKey = `boneBusterFailCount_${level}`;
    if (typeof window !== "undefined") {
      localStorage.setItem(failKey, "0");
    }

    if (level < LEVELS.length - 1) {
      const newLevel = level + 1;
      setLevel(newLevel);
      setScore(0);
      setDisplayScore(0);
      setMovesLeft(LEVELS[newLevel].moves);
      setGrid(generateCleanGrid());
      setPhase("playing");
      setSelected(null);
      setChainCount(0);
      setRexMood("happy");
      setRexMessage("Match 3 or more tiles!");
    }
  }, [level]);

  const retryLevel = useCallback(() => {
    // Pity mechanic: track consecutive fails per level
    const failKey = `boneBusterFailCount_${level}`;
    const currentFails = parseInt(
      typeof window !== "undefined" ? (localStorage.getItem(failKey) || "0") : "0",
      10
    );
    const newFails = currentFails + 1;
    if (typeof window !== "undefined") {
      localStorage.setItem(failKey, newFails.toString());
    }
    const bonusMoves = newFails >= 3 ? 3 : 0;

    setScore(0);
    setDisplayScore(0);
    setMovesLeft(levelConfig.moves + bonusMoves);
    setGrid(generateCleanGrid());
    setPhase("playing");
    setSelected(null);
    setChainCount(0);
    setRexMood("happy");
    setRexMessage("Match 3 or more tiles!");
  }, [levelConfig.moves, level]);

  // ── Rex Burst bezier path calculation ──

  const rexBurstStyle = useMemo(() => {
    if (!rexBurst.active || rexBurst.phase !== "flying") return { display: "none" };
    const t = rexBurst.progress;
    // Bezier arc: start bottom-left, curve up to top-right
    const p0 = { x: 5, y: 90 };
    const p1 = { x: 30, y: -10 };
    const p2 = { x: 70, y: -10 };
    const p3 = { x: 95, y: 90 };

    const cx = Math.pow(1 - t, 3) * p0.x + 3 * Math.pow(1 - t, 2) * t * p1.x + 3 * (1 - t) * t * t * p2.x + Math.pow(t, 3) * p3.x;
    const cy = Math.pow(1 - t, 3) * p0.y + 3 * Math.pow(1 - t, 2) * t * p1.y + 3 * (1 - t) * t * t * p2.y + Math.pow(t, 3) * p3.y;

    return {
      position: "absolute" as const,
      left: `${cx}%`,
      top: `${cy}%`,
      transform: `translate(-50%, -50%) rotate(${t * 15 - 7}deg)`,
      zIndex: 30,
      pointerEvents: "none" as const,
    };
  }, [rexBurst]);

  // ── Render ──

  return (
    <div className="page-container max-w-lg mx-auto">
      {/* ── Achievement Toast ── */}
      <AchievementToast
        achievement={toastAchievement}
        onDismiss={() => setToastAchievement(null)}
      />

      {/* ── Header: Rex + Score ── */}
      <div className="mb-4">
        <RexSpeechBubble message={rexMessage} mood={rexMood} />
      </div>

      {/* ── Score & Level Bar ── */}
      <div className="card mb-3 p-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-mutedText uppercase font-semibold">
              Level {level + 1}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-primary">
                {displayScore.toLocaleString()}
              </span>
              <span className="text-xs text-mutedText">
                / {levelConfig.targetScore.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-mutedText uppercase font-semibold">
              Moves
            </span>
            <div className="text-2xl font-bold text-secondary">{movesLeft}</div>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-2 bg-lightTeal rounded-full overflow-hidden">
          <div
            className="h-full bg-secondary rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, (score / levelConfig.targetScore) * 100)}%`,
            }}
          />
        </div>
        {/* Hint button */}
        <div className="mt-2 flex justify-center">
          <button
            className={`
              flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold
              transition-all duration-150 active:scale-95
              ${hintsRemaining > 0 && phase === "playing"
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200 cursor-pointer"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }
            `}
            onClick={useHint}
            disabled={hintsRemaining <= 0 || phase !== "playing"}
          >
            <span>💡</span>
            <span>
              {hintsRemaining > 0
                ? `${hintsRemaining} left`
                : "No hints left"}
            </span>
          </button>
        </div>
        {/* Stars */}
        <div className="flex justify-center gap-1 mt-2">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`text-lg transition-all duration-300 ${
                stars >= s ? "scale-110" : "opacity-30"
              }`}
            >
              ⭐
            </span>
          ))}
        </div>
      </div>

      {/* ── Game Board ── */}
      <div className="relative mb-4">
        {/* Combo popup */}
        {comboText && (
          <div
            key={comboText.id}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none animate-[comboPop_1.2s_ease-out_forwards]"
          >
            <span
              className={`font-extrabold drop-shadow-lg ${
                chainCount >= 5 ? "text-4xl text-[#EF4444]" :
                chainCount >= 3 ? "text-3xl text-secondary" :
                "text-2xl text-secondary"
              }`}
            >
              {comboText.text}
            </span>
            {chainCount >= 3 && (
              <span className="block text-center text-lg font-bold text-secondary animate-pulse">
                {chainCount}x Combo!
              </span>
            )}
          </div>
        )}

        {/* Rex Super Burst overlay */}
        {rexBurst.active && rexBurst.phase === "flying" && (
          <>
            {/* Sparkle trail particles (CSS-based) */}
            <div className="absolute inset-0 pointer-events-none z-25 overflow-hidden">
              {Array.from({ length: 12 }).map((_, i) => {
                const trailT = Math.max(0, rexBurst.progress - i * 0.06);
                if (trailT <= 0) return null;
                const p0 = { x: 5, y: 90 };
                const p1 = { x: 30, y: -10 };
                const p2 = { x: 70, y: -10 };
                const p3 = { x: 95, y: 90 };
                const cx = Math.pow(1 - trailT, 3) * p0.x + 3 * Math.pow(1 - trailT, 2) * trailT * p1.x + 3 * (1 - trailT) * trailT * trailT * p2.x + Math.pow(trailT, 3) * p3.x;
                const cy = Math.pow(1 - trailT, 3) * p0.y + 3 * Math.pow(1 - trailT, 2) * trailT * p1.y + 3 * (1 - trailT) * trailT * trailT * p2.y + Math.pow(trailT, 3) * p3.y;
                return (
                  <span
                    key={i}
                    className="absolute text-lg"
                    style={{
                      left: `${cx}%`,
                      top: `${cy}%`,
                      transform: "translate(-50%, -50%)",
                      opacity: 1 - i * 0.08 - (1 - rexBurst.progress) * 0.3,
                    }}
                  >
                    ✨
                  </span>
                );
              })}
            </div>
            {/* Rex flying image */}
            <div style={rexBurstStyle}>
              <img
                src="/rex-super-burst.png"
                alt="Rex Super Burst"
                width={80}
                height={80}
                className="object-contain drop-shadow-[0_0_20px_rgba(0,140,149,0.7)]"
                style={{
                  width: 80,
                  height: 80,
                  filter: "drop-shadow(0 0 15px rgba(0,140,149,0.8))",
                }}
                draggable={false}
              />
            </div>
          </>
        )}

        {/* Rex Burst flash */}
        {rexBurst.active && rexBurst.phase === "burst" && (
          <div className="absolute inset-0 z-20 pointer-events-none bg-white/50 rounded-2xl animate-[flash_0.4s_ease-out]" />
        )}

        {/* Board — only render after client hydration to avoid SSR mismatch */}
        {!isHydrated ? (
          <div
            className="grid gap-1 p-2 bg-white rounded-2xl shadow-lg border border-lightTeal/50"
            style={{
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gridTemplateRows: `repeat(${ROWS}, 1fr)`,
            }}
          >
            {Array.from({ length: ROWS * COLS }, (_, i) => (
              <div
                key={i}
                className="aspect-square rounded-full bg-gray-100 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <MemoBoard
            grid={grid}
            selected={selected}
            swappingTiles={swappingTiles}
            matchingTiles={matchingTiles}
            wiggleTiles={wiggleTiles}
            fallingTiles={fallingTiles}
            boardShake={boardShake}
            hintTiles={hintHighlight}
            handleTileTap={handleTileTap}
          />
        )}

        {/* Particles */}
        {isHydrated && particles.map((p) => {
          const angle = Math.random() * Math.PI * 2;
          const distance = 15 + Math.random() * 25;
          const dx = Math.cos(angle) * distance;
          const dy = Math.sin(angle) * distance;
          return (
            <span
              key={p.id}
              className="absolute pointer-events-none z-25"
              style={{
                left: `${(p.col / COLS) * 100 + 100 / COLS / 2}%`,
                top: `${(p.row / ROWS) * 100 + 100 / ROWS / 2}%`,
                transform: "translate(-50%, -50%)",
                color: p.color,
                fontSize: "0.7rem",
                animation: `particleFly_0.5s_ease-out_forwards`,
                "--px": `${dx}px`,
                "--py": `${dy}px`,
              } as React.CSSProperties}
            >
              ●
            </span>
          );
        })}
      </div>

      {/* ── Rex at bottom for encouragement ── */}
      <div className="flex justify-center mb-20">
        <Rex className="w-10 h-10" mood={rexMood} />
      </div>

      {/* ── Level Complete Modal (Levels 1-14) ── */}
      {phase === "complete" && level < LEVELS.length - 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="excited" />
            <h2 className="text-2xl font-extrabold text-primary mb-2">
              Level Complete!
            </h2>
            <div className="flex justify-center gap-2 mb-4 text-3xl">
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={`transition-all duration-500 ${
                    stars >= s ? "scale-100" : "opacity-20 scale-75"
                  }`}
                >
                  ⭐
                </span>
              ))}
            </div>
            <p className="text-lg text-mutedText mb-1">
              Score: <span className="font-bold text-primary">{score.toLocaleString()}</span>
            </p>
            <p className="text-sm text-mutedText mb-6">
              {stars === 3
                ? "Perfect! All stars earned!"
                : stars === 2
                  ? "Great job! Almost perfect!"
                  : "Level passed!"}
            </p>
            <button
              className="btn-primary w-full text-lg"
              onClick={nextLevel}
            >
              Next Level →
            </button>
          </div>
        </div>
      )}

      {/* ── Victory Celebration (Level 15) ── */}
      {phase === "complete" && level === LEVELS.length - 1 && (
        <>
          {/* Confetti rain */}
          <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
            {Array.from({ length: 40 }, (_, i) => {
              const colors = [
                "#008C95", "#FBBF24", "#3B82F6", "#10B981",
                "#EC4899", "#EF4444", "#8B5CF6", "#F97316",
              ];
              const color = colors[i % colors.length];
              const left = Math.random() * 100;
              const delay = Math.random() * 1.5;
              const duration = 2.5 + Math.random() * 2;
              const size = 6 + Math.random() * 8;
              const shapes = ["■", "●", "▲", "★"];
              const shape = shapes[Math.floor(Math.random() * shapes.length)];
              return (
                <span
                  key={i}
                  className="absolute"
                  style={{
                    left: `${left}%`,
                    top: "-20px",
                    color,
                    fontSize: `${size}px`,
                    animation: `confettiFall ${duration}s ease-in ${delay}s forwards`,
                    opacity: 0,
                  }}
                >
                  {shape}
                </span>
              );
            })}
          </div>

          {/* Victory modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out] relative overflow-hidden">
              {/* Inner confetti burst ring */}
              <div className="absolute inset-0 pointer-events-none">
                {Array.from({ length: 12 }, (_, i) => {
                  const angle = (i / 12) * 360;
                  const rad = (angle * Math.PI) / 180;
                  const dist = 45;
                  const x = 50 + Math.cos(rad) * dist;
                  const y = 50 + Math.sin(rad) * dist;
                  return (
                    <span
                      key={i}
                      className="absolute text-lg"
                      style={{
                        left: `${x}%`,
                        top: `${y}%`,
                        transform: "translate(-50%, -50%)",
                        animation: `particleFly 1s ease-out ${i * 0.06}s forwards`,
                        opacity: 0,
                      }}
                    >
                      ✨
                    </span>
                  );
                })}
              </div>

              <Rex className="w-24 h-24 mx-auto mb-4" mood="excited" />
              <h2 className="text-3xl font-extrabold text-secondary mb-2">
                🏆 You Beat Bone Buster! 🏆
              </h2>
              <p className="text-lg text-mutedText mb-4">
                All 15 levels conquered!
              </p>

              {/* Stars — always 3, prominently shown */}
              <div className="flex justify-center gap-3 mb-4 text-4xl">
                <span className="animate-[dropIn_0.5s_ease-out]" style={{ animationDelay: "0.1s" }}>
                  ⭐
                </span>
                <span className="animate-[dropIn_0.5s_ease-out]" style={{ animationDelay: "0.3s" }}>
                  ⭐
                </span>
                <span className="animate-[dropIn_0.5s_ease-out]" style={{ animationDelay: "0.5s" }}>
                  ⭐
                </span>
              </div>

              <p className="text-lg text-mutedText mb-1">
                Final Score:{" "}
                <span className="font-bold text-primary">{score.toLocaleString()}</span>
              </p>
              <p className="text-sm text-mutedText mb-6">
                Incredible work, {playerName}!
              </p>

              <button
                className="btn-primary w-full text-lg"
                onClick={() => {
                  // Reset fail counter for last level too
                  const fk = `boneBusterFailCount_14`;
                  if (typeof window !== "undefined") localStorage.setItem(fk, "0");
                  setLevel(0);
                  setScore(0);
                  setDisplayScore(0);
                  setMovesLeft(LEVELS[0].moves);
                  setGrid(generateCleanGrid());
                  setPhase("playing");
                  setRexMood("happy");
                  setRexMessage("Match 3 or more tiles!");
                }}
              >
                🔄 Play Again From Level 1
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Level Failed Modal ── */}
      {phase === "failed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="encouraging" />
            <h2 className="text-2xl font-extrabold text-primary mb-2">
              Out of Moves!
            </h2>
            <p className="text-mutedText mb-2">
              You scored{" "}
              <span className="font-bold text-primary">{score.toLocaleString()}</span>
            </p>
            <p className="text-sm text-mutedText mb-6">
              Target: {levelConfig.targetScore.toLocaleString()}
            </p>
            <button className="btn-primary w-full text-lg" onClick={retryLevel}>
              Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
