import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Rex from "~/components/Rex";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import { getPlayerName } from "~/components/Onboarding";

// ── Types ──

type TileType = "bone" | "xray-hand" | "xray-chest" | "radiation" | "xray-skull";

interface Tile {
  id: number;
  pairId: number;
  type: TileType;
  col: number;
  row: number;
  layer: number;
  cleared: boolean;
}

// ── Constants ──

const TILE_TYPES: TileType[] = [
  "bone",
  "xray-hand",
  "xray-chest",
  "radiation",
  "xray-skull",
];

const TILE_IMAGES: Record<TileType, string> = {
  bone: "/bone.png",
  "xray-hand": "/xray-hand.png",
  "xray-chest": "/xray-chest.png",
  radiation: "/radiation.png",
  "xray-skull": "/xray-skull.png",
};

const TILE_LABELS: Record<TileType, string> = {
  bone: "BONE",
  "xray-hand": "HAND",
  "xray-chest": "CHEST",
  radiation: "RAD",
  "xray-skull": "SKULL",
};

// Grid layout
const COLS = 8;
const ROWS = 7;
const MAX_LAYERS = 3;
const CELL_W = 48;
const CELL_H = 58;
const LAYER_OFFSET_X = 24; // CELL_W / 2
const LAYER_OFFSET_Y = 29; // CELL_H / 2
const TILE_W = 56;
const TILE_H = 66;
const TOTAL_TILES = 48; // 24 pairs

// Completion localStorage key
const COMPLETIONS_KEY = "filmStackCompletions";

// ── Helpers ──

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Get all possible tile positions across all layers */
function getAllPositions(): { col: number; row: number; layer: number }[] {
  const positions: { col: number; row: number; layer: number }[] = [];
  for (let layer = 0; layer < MAX_LAYERS; layer++) {
    const maxCol = COLS - layer;
    const maxRow = ROWS - layer;
    for (let col = 0; col < maxCol; col++) {
      for (let row = 0; row < maxRow; row++) {
        positions.push({ col, row, layer });
      }
    }
  }
  return positions;
}

/** Generate a random tile layout */
function generateTiles(): Tile[] {
  const allPositions = getAllPositions();
  const shuffled = shuffleArray(allPositions);
  const chosen = shuffled.slice(0, TOTAL_TILES);

  // Create pairs of tile types
  const pairCount = TOTAL_TILES / 2;
  const typesPerType = Math.floor(pairCount / TILE_TYPES.length);
  const remainder = pairCount % TILE_TYPES.length;

  const typeAssignments: TileType[] = [];
  for (let i = 0; i < TILE_TYPES.length; i++) {
    const count = typesPerType + (i < remainder ? 1 : 0);
    for (let j = 0; j < count; j++) {
      typeAssignments.push(TILE_TYPES[i]);
    }
  }
  // We have pairCount type assignments, each representing a pair (so 2 tiles)
  // But we need TOTAL_TILES tile types (2 of each pair)
  const allTypes: TileType[] = [];
  for (const t of typeAssignments) {
    allTypes.push(t, t); // two tiles per pair
  }
  const shuffledTypes = shuffleArray(allTypes);

  // Assign types and pairIds
  // pairId groups tiles of the same type together
  const pairIdMap = new Map<TileType, number>();
  let nextPairId = 0;
  const typePairIds: number[] = [];
  for (const t of shuffledTypes) {
    if (!pairIdMap.has(t)) {
      pairIdMap.set(t, nextPairId++);
    }
    typePairIds.push(pairIdMap.get(t)!);
  }
  // We need unique pair IDs per pair, not per type group
  // Let me redo: each pair (two tiles of same type) gets a unique pairId
  const pairIds: number[] = [];
  const typeCounters = new Map<TileType, number>();
  let pid = 0;
  for (const t of shuffledTypes) {
    const count = typeCounters.get(t) || 0;
    if (count % 2 === 0) {
      pid++;
    }
    pairIds.push(pid);
    typeCounters.set(t, count + 1);
  }

  return chosen.map((pos, i) => ({
    id: i,
    pairId: pairIds[i],
    type: shuffledTypes[i],
    col: pos.col,
    row: pos.row,
    layer: pos.layer,
    cleared: false,
  }));
}

/** Get pixel position for a tile */
function tilePixelPos(tile: { col: number; row: number; layer: number }): {
  x: number;
  y: number;
} {
  return {
    x: tile.col * CELL_W + tile.layer * LAYER_OFFSET_X,
    y: tile.row * CELL_H + tile.layer * LAYER_OFFSET_Y,
  };
}

/** Get pixel bounding box for a tile */
function tileBoundingBox(tile: {
  col: number;
  row: number;
  layer: number;
}): { left: number; right: number; top: number; bottom: number } {
  const x = tile.col * CELL_W + tile.layer * LAYER_OFFSET_X;
  const y = tile.row * CELL_H + tile.layer * LAYER_OFFSET_Y;
  return {
    left: x,
    right: x + TILE_W,
    top: y,
    bottom: y + TILE_H,
  };
}

/** Check if tile A covers tile B (A is on a higher layer, bounding boxes overlap).
 *  Use an overlap threshold: at least 25% of the tile area must be covered. */
function tileCovers(
  higher: { col: number; row: number; layer: number },
  lower: { col: number; row: number; layer: number }
): boolean {
  if (higher.layer <= lower.layer) return false;

  const hBox = tileBoundingBox(higher);
  const lBox = tileBoundingBox(lower);

  // Check if bounding boxes intersect
  const overlapLeft = Math.max(hBox.left, lBox.left);
  const overlapRight = Math.min(hBox.right, lBox.right);
  const overlapTop = Math.max(hBox.top, lBox.top);
  const overlapBottom = Math.min(hBox.bottom, lBox.bottom);

  if (overlapLeft >= overlapRight || overlapTop >= overlapBottom) {
    return false; // No overlap
  }

  const overlapArea =
    (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
  const tileArea = TILE_W * TILE_H;

  // Must cover at least 25% of the tile area
  return overlapArea >= tileArea * 0.25;
}

/** Check if a tile is selectable */
function isTileSelectable(
  tile: Tile,
  allTiles: Tile[]
): boolean {
  if (tile.cleared) return false;

  // Check if covered by any tile on a higher layer
  const covered = allTiles.some(
    (t) => !t.cleared && t.id !== tile.id && tileCovers(t, tile)
  );
  if (covered) return false;

  // Check left/right blocking on same layer
  const leftBlocked = allTiles.some(
    (t) =>
      !t.cleared &&
      t.id !== tile.id &&
      t.layer === tile.layer &&
      t.row === tile.row &&
      t.col === tile.col - 1
  );
  const rightBlocked = allTiles.some(
    (t) =>
      !t.cleared &&
      t.id !== tile.id &&
      t.layer === tile.layer &&
      t.row === tile.row &&
      t.col === tile.col + 1
  );

  // Selectable if at least one long side is open
  return !leftBlocked || !rightBlocked;
}

/** Find a valid matching pair for hint */
function findHintPair(tiles: Tile[]): [Tile, Tile] | null {
  const selectable = tiles.filter((t) => isTileSelectable(t, tiles));
  // Group by type
  const byType = new Map<TileType, Tile[]>();
  for (const t of selectable) {
    const arr = byType.get(t.type) || [];
    arr.push(t);
    byType.set(t.type, arr);
  }
  // Find a type with at least 2 matching pairIds
  for (const [, arr] of byType) {
    // Group by pairId
    const byPairId = new Map<number, Tile[]>();
    for (const t of arr) {
      const a = byPairId.get(t.pairId) || [];
      a.push(t);
      byPairId.set(t.pairId, a);
    }
    for (const [, pairs] of byPairId) {
      if (pairs.length >= 2) {
        return [pairs[0], pairs[1]];
      }
    }
    // Also check: any two tiles of same type
    if (arr.length >= 2) {
      return [arr[0], arr[1]];
    }
  }
  return null;
}

/** Check if there are any valid moves */
function hasValidMoves(tiles: Tile[]): boolean {
  return findHintPair(tiles) !== null;
}

// ── Component ──

export default function FilmStack() {
  const playerName =
    typeof window !== "undefined" ? getPlayerName() : "Player";

  const [tiles, setTiles] = useState<Tile[]>(() => generateTiles());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rexMessage, setRexMessage] = useState("Match pairs to clear the board!");
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [showWin, setShowWin] = useState(false);
  const [hintIds, setHintIds] = useState<number[]>([]);
  const [matchAnimIds, setMatchAnimIds] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [completions, setCompletions] = useState(0);
  const [shufflesUsed, setShufflesUsed] = useState(0);

  const boardRef = useRef<HTMLDivElement>(null);

  // Load completions on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const val = parseInt(localStorage.getItem(COMPLETIONS_KEY) || "0", 10);
    setCompletions(isNaN(val) ? 0 : val);
  }, []);

  // Clear hint after a delay
  useEffect(() => {
    if (hintIds.length > 0) {
      const t = setTimeout(() => setHintIds([]), 2000);
      return () => clearTimeout(t);
    }
  }, [hintIds]);

  // Clear match animation
  useEffect(() => {
    if (matchAnimIds.length > 0) {
      const t = setTimeout(() => setMatchAnimIds([]), 500);
      return () => clearTimeout(t);
    }
  }, [matchAnimIds]);

  const remainingTiles = useMemo(
    () => tiles.filter((t) => !t.cleared).length,
    [tiles]
  );

  const selectableIds = useMemo(() => {
    const ids = new Set<number>();
    for (const t of tiles) {
      if (isTileSelectable(t, tiles)) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [tiles]);

  const getBoardDimensions = useCallback(() => {
    let maxX = 0;
    let maxY = 0;
    for (const t of tiles) {
      const pos = tilePixelPos(t);
      if (pos.x + TILE_W > maxX) maxX = pos.x + TILE_W;
      if (pos.y + TILE_H > maxY) maxY = pos.y + TILE_H;
    }
    return { w: maxX, h: maxY };
  }, [tiles]);

  const boardDims = useMemo(() => getBoardDimensions(), [getBoardDimensions]);

  // Handle new game
  const newGame = useCallback(() => {
    setTiles(generateTiles());
    setSelectedId(null);
    setRexMessage("Match pairs to clear the board!");
    setRexMood("happy");
    setShowWin(false);
    setHintIds([]);
    setMatchAnimIds([]);
    setLocked(false);
    setShufflesUsed(0);
  }, []);

  // Shuffle remaining tiles
  const shuffleRemaining = useCallback(() => {
    setTiles((prev) => {
      const remaining = prev.filter((t) => !t.cleared);
      const cleared = prev.filter((t) => t.cleared);

      if (remaining.length === 0) return prev;

      // Get all positions of remaining tiles
      const positions = remaining.map((t) => ({
        col: t.col,
        row: t.row,
        layer: t.layer,
      }));
      const shuffledPositions = shuffleArray(positions);

      return [
        ...cleared,
        ...remaining.map((t, i) => ({
          ...t,
          col: shuffledPositions[i].col,
          row: shuffledPositions[i].row,
          layer: shuffledPositions[i].layer,
        })),
      ];
    });
    setSelectedId(null);
    setHintIds([]);
    setRexMessage("Board shuffled! Keep matching.");
    setRexMood("encouraging");
    setShufflesUsed((s) => s + 1);
  }, []);

  // Hint
  const showHint = useCallback(() => {
    const pair = findHintPair(tiles);
    if (pair) {
      setHintIds([pair[0].id, pair[1].id]);
      setRexMessage("Here's a match!");
      setRexMood("happy");
    } else {
      setRexMessage("No moves available — try shuffling!");
      setRexMood("encouraging");
    }
  }, [tiles]);

  // Handle tile click
  const handleTileClick = useCallback(
    (tileId: number) => {
      if (locked) return;

      const tile = tiles.find((t) => t.id === tileId);
      if (!tile || tile.cleared) return;
      if (!selectableIds.has(tileId)) return;

      if (selectedId === null) {
        // First selection
        setSelectedId(tileId);
        setRexMessage("Now find its match!");
        setRexMood("happy");
        setHintIds([]);
      } else if (selectedId === tileId) {
        // Deselect
        setSelectedId(null);
        setRexMessage("Match pairs to clear the board!");
        setRexMood("happy");
      } else {
        // Second selection — check match
        const firstTile = tiles.find((t) => t.id === selectedId);
        if (!firstTile) {
          setSelectedId(tileId);
          return;
        }

        if (firstTile.type === tile.type) {
          // Match!
          setLocked(true);
          const matchId1 = selectedId;
          const matchId2 = tileId;
          setMatchAnimIds([matchId1, matchId2]);
          setSelectedId(null);
          setRexMessage("Nice match!");
          setRexMood("excited");

          // Clear both tiles after animation
          setTimeout(() => {
            setTiles((prev) => {
              const updated = prev.map((t) =>
                t.id === matchId1 || t.id === matchId2
                  ? { ...t, cleared: true }
                  : t
              );
              const remaining = updated.filter((t) => !t.cleared);

              if (remaining.length === 0) {
                // Win!
                setShowWin(true);
                setRexMessage("Board complete! Amazing! 🎉");
                setRexMood("excited");

                // Increment completions
                if (typeof window !== "undefined") {
                  const current = parseInt(
                    localStorage.getItem(COMPLETIONS_KEY) || "0",
                    10
                  );
                  const next = (isNaN(current) ? 0 : current) + 1;
                  localStorage.setItem(COMPLETIONS_KEY, next.toString());
                  setCompletions(next);
                }
              } else {
                setRexMessage(
                  `${remaining.length} tile${remaining.length > 1 ? "s" : ""} left!`
                );
                setRexMood("happy");

                // Check if there are valid moves
                if (!hasValidMoves(updated)) {
                  setTimeout(() => {
                    setRexMessage("No moves left — try shuffling!");
                    setRexMood("encouraging");
                  }, 200);
                }
              }

              return updated;
            });
            setMatchAnimIds([]);
            setLocked(false);
          }, 400);
        } else {
          // No match
          setRexMessage("Not a match — try again!");
          setRexMood("encouraging");
          setSelectedId(null);
        }
      }
    },
    [locked, tiles, selectedId, selectableIds]
  );

  // Sort tiles for rendering: lower layer first, then by row, then by col
  const sortedTiles = useMemo(() => {
    return [...tiles].sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer;
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
  }, [tiles]);

  const scaleFactor = useMemo(() => {
    // Scale board to fit mobile screens
    if (typeof window === "undefined") return 1;
    const maxWidth = Math.min(window.innerWidth - 32, 400);
    return Math.min(1, maxWidth / boardDims.w);
  }, [boardDims.w]);

  return (
    <div className="page-container max-w-lg mx-auto">
      {/* ── Rex Header ── */}
      <div className="mb-4">
        <RexSpeechBubble message={rexMessage} mood={rexMood} />
      </div>

      {/* ── Info Bar ── */}
      <div className="card mb-3 p-3 flex items-center justify-between">
        <div className="text-center flex-1">
          <span className="text-xs text-mutedText uppercase font-semibold">
            Tiles Left
          </span>
          <div className="text-2xl font-bold text-primary">
            {remainingTiles}
          </div>
        </div>
        <div className="text-center flex-1">
          <span className="text-xs text-mutedText uppercase font-semibold">
            Boards Done
          </span>
          <div className="text-2xl font-bold text-secondary">
            {completions}
          </div>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="flex justify-center gap-2 mb-4">
        <button
          className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 text-white
                     border border-white/20 hover:bg-white/20 transition-all
                     active:scale-95"
          onClick={shuffleRemaining}
        >
          🔀 Shuffle
        </button>
        <button
          className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 text-white
                     border border-white/20 hover:bg-white/20 transition-all
                     active:scale-95"
          onClick={showHint}
        >
          💡 Hint
        </button>
        <button
          className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 text-white
                     border border-white/20 hover:bg-white/20 transition-all
                     active:scale-95"
          onClick={newGame}
        >
          🔄 New
        </button>
      </div>

      {/* ── Board ── */}
      <div className="flex justify-center mb-4">
        <div
          ref={boardRef}
          className="relative"
          style={{
            width: boardDims.w,
            height: boardDims.h,
            transform: `scale(${scaleFactor})`,
            transformOrigin: "top center",
            marginBottom:
              boardDims.h * scaleFactor - boardDims.h > 0
                ? 0
                : -(boardDims.h - boardDims.h * scaleFactor),
          }}
        >
          {/* Layer shadow indicators */}
          {sortedTiles
            .filter((t) => !t.cleared)
            .map((tile) => {
              const pos = tilePixelPos(tile);
              const isSelected = selectedId === tile.id;
              const isHinted = hintIds.includes(tile.id);
              const isMatchAnim = matchAnimIds.includes(tile.id);
              const isSelectable = selectableIds.has(tile.id);

              return (
                <div
                  key={tile.id}
                  className={`absolute cursor-pointer transition-all duration-200
                    ${isMatchAnim ? "opacity-0 scale-0" : "opacity-100"}
                    ${!isSelectable && !isSelected ? "opacity-70" : ""}
                  `}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: TILE_W,
                    height: TILE_H,
                    zIndex: tile.layer * 100 + tile.row * 10 + tile.col,
                  }}
                  onClick={() => handleTileClick(tile.id)}
                >
                  {/* Shadow for depth */}
                  {tile.layer > 0 && (
                    <div
                      className="absolute rounded-lg bg-black/20"
                      style={{
                        left: -2,
                        top: -2,
                        right: 2,
                        bottom: 2,
                        zIndex: -1,
                      }}
                    />
                  )}

                  {/* Tile card */}
                  <div
                    className={`relative w-full h-full rounded-lg flex flex-col items-center justify-center p-1
                      transition-all duration-200
                      ${isSelected ? "ring-2 ring-yellow-400 ring-offset-1 ring-offset-transparent scale-105 shadow-lg shadow-yellow-400/30" : ""}
                      ${isHinted ? "ring-2 ring-blue-400 ring-offset-1 ring-offset-transparent animate-pulse shadow-lg shadow-blue-400/30" : ""}
                      ${isSelectable && !isSelected && !isHinted ? "hover:brightness-110" : ""}
                    `}
                    style={{
                      background: isSelected
                        ? "linear-gradient(135deg, #fef9e7 0%, #fdebd0 100%)"
                        : isHinted
                          ? "linear-gradient(135deg, #e8f4fd 0%, #d1e8ff 100%)"
                          : "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
                      border: isSelected
                        ? "2px solid #f59e0b"
                        : isHinted
                          ? "2px solid #3b82f6"
                          : "1px solid rgba(255,255,255,0.3)",
                      boxShadow: isSelected
                        ? "0 4px 16px rgba(245, 158, 11, 0.3)"
                        : isHinted
                          ? "0 4px 16px rgba(59, 130, 246, 0.3)"
                          : tile.layer === 0
                            ? "0 2px 6px rgba(0,0,0,0.15)"
                            : tile.layer === 1
                              ? "0 3px 8px rgba(0,0,0,0.2)"
                              : "0 4px 12px rgba(0,0,0,0.25)",
                    }}
                  >
                    {/* Tile image */}
                    <img
                      src={TILE_IMAGES[tile.type]}
                      alt={TILE_LABELS[tile.type]}
                      className="w-8 h-8 object-contain"
                      draggable={false}
                    />
                    {/* Tile label */}
                    <span className="text-[9px] font-bold text-primary mt-0.5 leading-tight text-center">
                      {TILE_LABELS[tile.type]}
                    </span>
                  </div>
                </div>
              );
            })}

          {/* Cleared tiles placeholder - keep layout stable */}
          {tiles
            .filter((t) => t.cleared)
            .map((tile) => {
              const pos = tilePixelPos(tile);
              return (
                <div
                  key={`cleared-${tile.id}`}
                  className="absolute pointer-events-none"
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: TILE_W,
                    height: TILE_H,
                    zIndex: tile.layer,
                  }}
                />
              );
            })}
        </div>
      </div>

      {/* ── Rex ── */}
      <div className="flex justify-center mb-20">
        <Rex className="w-10 h-10" mood={rexMood} />
      </div>

      {/* ── Win Modal ── */}
      {showWin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="excited" />
            <h2 className="text-2xl font-extrabold text-primary mb-2">
              Board Complete!
            </h2>
            <p className="text-mutedText mb-1">
              You cleared all the tiles!
            </p>
            <p className="text-sm text-secondary font-medium mb-4">
              Boards completed: {completions}
            </p>
            {shufflesUsed > 0 && (
              <p className="text-xs text-mutedText mb-4">
                Shuffles used: {shufflesUsed}
              </p>
            )}
            <button
              className="btn-primary w-full"
              onClick={newGame}
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* ── CSS for scale animation ── */}
      <style>{`
        @keyframes scaleIn {
          0% { opacity: 0; transform: scale(0.8); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
