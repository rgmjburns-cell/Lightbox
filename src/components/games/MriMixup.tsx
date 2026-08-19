import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import Rex from "~/components/Rex";
import AchievementToast from "~/components/AchievementToast";
import { getPlayerName } from "~/components/Onboarding";
import { getPlayerName as getLbPlayerName, submitScore } from "~/lib/leaderboard";
import LeaderboardEntry from "~/components/LeaderboardEntry";
import { addPoints } from "~/lib/points";
import {
  checkAchievements,
  trackGameCompletion,
  type Achievement,
} from "~/lib/achievements";

// ── Types ──

type GridSize = 3 | 4;
type GamePhase = "idle" | "playing" | "win";
type RexMood = "happy" | "excited" | "encouraging";

interface TileData {
  id: number;       // current position index (0 = top-left, row-major)
  homeIndex: number; // correct/original position
}

// ── Constants ──

const BOARD_SIZE_PX = 320; // CSS pixels for the board
const TILE_GAP = 3;
const SLIDE_DURATION = 150; // ms

const PUZZLE_IMAGE = "/mri-puzzle.png";

// ── Helpers ──

/** Convert flat index → (row, col). Row-major order. */
function idxToRowCol(idx: number, size: GridSize): { row: number; col: number } {
  return { row: Math.floor(idx / size), col: idx % size };
}

/** Convert (row, col) → flat index. */
function rowColToIdx(row: number, col: number, size: GridSize): number {
  return row * size + col;
}

/** Check if two positions are adjacent (Manhattan distance = 1). */
function isAdjacent(a: number, b: number, size: GridSize): boolean {
  const pa = idxToRowCol(a, size);
  const pb = idxToRowCol(b, size);
  return Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col) === 1;
}

/** Create a solved board: tile at position i has homeIndex i. */
function createSolvedBoard(size: GridSize): TileData[] {
  const total = size * size;
  return Array.from({ length: total }, (_, i) => ({
    id: i,
    homeIndex: i,
  }));
}

/** Count inversions in array (ignoring the empty tile). */
function countInversions(tiles: TileData[], emptyIdx: number, size: GridSize): number {
  let inv = 0;
  const n = tiles.length;
  for (let i = 0; i < n; i++) {
    if (i === emptyIdx) continue;
    for (let j = i + 1; j < n; j++) {
      if (j === emptyIdx) continue;
      if (tiles[i].homeIndex > tiles[j].homeIndex) inv++;
    }
  }
  return inv;
}

/**
 * Check solvability for a sliding puzzle.
 * For odd grid (3×3): solvable if inversions is even.
 * For even grid (4×4): solvable if (inversions + row of empty from bottom) is odd.
 */
function isSolvable(tiles: TileData[], size: GridSize): boolean {
  const emptyIdx = tiles.findIndex((t) => t.homeIndex === size * size - 1);
  const inv = countInversions(tiles, emptyIdx, size);
  if (size % 2 === 1) {
    return inv % 2 === 0;
  } else {
    const emptyRowFromBottom = size - Math.floor(emptyIdx / size);
    return (inv + emptyRowFromBottom) % 2 === 1;
  }
}

/** Shuffle the board until it's solvable and not already solved. */
function shuffleBoard(size: GridSize): TileData[] {
  const total = size * size;
  let tiles: TileData[];
  let attempts = 0;
  do {
    // Fisher-Yates shuffle on the indices
    const indices = Array.from({ length: total }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    tiles = indices.map((homeIdx, pos) => ({
      id: pos,
      homeIndex: homeIdx,
    }));
    attempts++;
  } while (
    (!isSolvable(tiles, size) || isSolved(tiles)) &&
    attempts < 1000
  );
  return tiles;
}

/** Check if all tiles are in their home positions. */
function isSolved(tiles: TileData[]): boolean {
  return tiles.every((t) => t.id === t.homeIndex);
}

/** Format seconds as mm:ss. */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Scoring ──

function calculateScore(size: GridSize, moves: number, seconds: number): number {
  const base = size === 3 ? 100 : 250;
  const movePenalty = Math.max(0, moves - (size === 3 ? 15 : 40));
  const timePenalty = Math.max(0, Math.floor(seconds / 5));
  return Math.max(base, base + (size === 3 ? 50 : 100) - movePenalty - timePenalty);
}

// ── Component ──

export default function MriMixup() {
  const playerName =
    typeof window !== "undefined" ? getPlayerName() : "Player";

  // ── State ──
  const [size, setSize] = useState<GridSize>(3);
  const [tiles, setTiles] = useState<TileData[]>(() => shuffleBoard(3));
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [rexMood, setRexMood] = useState<RexMood>("happy");
  const [rexMessage, setRexMessage] = useState("Slide the tiles to reconstruct the scan!");
  const [slidingTile, setSlidingTile] = useState<number | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [score, setScore] = useState(0);
  const [submitRank, setSubmitRank] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const highScoreKey = `mriMixupBest_${size}x${size}`;

  const totalTiles = size * size;
  const emptyIdx = tiles.findIndex((t) => t.homeIndex === totalTiles - 1);
  const tileSize = Math.floor((BOARD_SIZE_PX - TILE_GAP * (size + 1)) / size);

  // ── Timer ──

  useEffect(() => {
    if (phase === "playing") {
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  // ── Handle tile tap ──

  const handleTileTap = useCallback(
    (tilePos: number) => {
      if (phase === "win") return;
      if (!isAdjacent(tilePos, emptyIdx, size)) return;

      // Start game on first move
      if (phase === "idle") {
        setPhase("playing");
      }

      // Perform swap
      setSlidingTile(tilePos);
      setTimeout(() => setSlidingTile(null), SLIDE_DURATION);

      setTiles((prev) => {
        const next = [...prev];
        const currentEmptyIdx = next.findIndex((t) => t.homeIndex === totalTiles - 1);
        const tileAtPos = next[tilePos];
        next[currentEmptyIdx] = { ...tileAtPos, id: currentEmptyIdx };
        next[tilePos] = { id: tilePos, homeIndex: totalTiles - 1 }; // the "empty" slot
        return next;
      });

      const newMoves = moves + 1;
      setMoves(newMoves);

      // Check win after swap (on next render cycle)
      // We check after state update
    },
    [phase, emptyIdx, size, moves, totalTiles]
  );

  // Check for win
  useEffect(() => {
    if (phase !== "playing" && phase !== "idle") return;
    if (moves === 0) return;
    if (isSolved(tiles)) {
      setPhase("win");
      const finalScore = calculateScore(size, moves, seconds);
      setScore(finalScore);
      addPoints(finalScore);

      // Save high score
      const prev = parseInt(localStorage.getItem(highScoreKey) || "0", 10);
      if (finalScore > prev) {
        localStorage.setItem(highScoreKey, finalScore.toString());
      }

      trackGameCompletion("mri-mixup");
      // Live leaderboard: submit the stored best across both board sizes.
      // Read localStorage directly here (the memo is computed pre-save).
      // Fire-and-forget when a name is stored (silent on failure).
      if (getLbPlayerName()) {
        const best3 = parseInt(localStorage.getItem("mriMixupBest_3x3") || "0", 10);
        const best4 = parseInt(localStorage.getItem("mriMixupBest_4x4") || "0", 10);
        submitScore("mri-mixup", Math.max(best3, best4)).then((r) => {
          if (r) setSubmitRank(r.rank);
        });
      }
      const newAch = checkAchievements();
      if (newAch.length > 0) setAchievements(newAch);

      setRexMood("excited");
      setRexMessage(
        size === 3
          ? `Amazing! You solved it in ${moves} moves! Try 4×4 for a real challenge!`
          : `Incredible! ${moves} moves — you're a puzzle master, ${playerName}!`
      );
    }
  }, [tiles, phase, moves, size, seconds, playerName, highScoreKey]);

  // ── New game ──

  const newGame = useCallback(
    (newSize?: GridSize) => {
      const s = newSize ?? size;
      setSize(s);
      setTiles(shuffleBoard(s));
      setPhase("idle");
      setMoves(0);
      setSeconds(0);
      setSlidingTile(null);
      setScore(0);
      setAchievements([]);
      setRexMood("happy");
      setRexMessage("Slide the tiles to reconstruct the scan!");
    },
    [size]
  );

  // ── Leaderboard score keys ──

  const bestScore = useMemo(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem(highScoreKey) || "0", 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highScoreKey, phase]);

  // Best across both board sizes (3×3 and 4×4) — what gets submitted to the
  // shared monthly leaderboard.
  const bestScoreAll = useMemo(() => {
    if (typeof window === "undefined") return 0;
    return Math.max(
      parseInt(localStorage.getItem("mriMixupBest_3x3") || "0", 10),
      parseInt(localStorage.getItem("mriMixupBest_4x4") || "0", 10),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Empty tile position for animation ──

  const emptyPos = idxToRowCol(emptyIdx, size);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Rex Speech Bubble */}
      <RexSpeechBubble mood={rexMood} message={rexMessage} />

      {/* Controls Bar */}
      <div className="flex items-center gap-3 flex-wrap justify-center">
        <div className="flex rounded-lg overflow-hidden border border-white/20">
          <button
            onClick={() => newGame(3)}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              size === 3
                ? "bg-secondary text-white"
                : "bg-white/10 text-white/60 hover:bg-white/20"
            }`}
          >
            3×3 Easy
          </button>
          <button
            onClick={() => newGame(4)}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              size === 4
                ? "bg-secondary text-white"
                : "bg-white/10 text-white/60 hover:bg-white/20"
            }`}
          >
            4×4 Hard
          </button>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-white/20">
          <button
            onClick={() => newGame(size)}
            className="px-3 py-1.5 text-xs font-semibold bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
          >
            ↺ Reset
          </button>
          <button
            onClick={() => {
              setTiles(shuffleBoard(size));
              setPhase("idle");
              setSlidingTile(null);
              setScore(0);
              setAchievements([]);
            }}
            className="px-3 py-1.5 text-xs font-semibold bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
          >
            🔀 Shuffle
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-sm">
        <div className="text-center">
          <p className="text-xs text-white/50 uppercase tracking-wide">Moves</p>
          <p className="font-bold text-white text-lg">{moves}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-white/50 uppercase tracking-wide">Time</p>
          <p className="font-bold text-white text-lg">{formatTime(seconds)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-white/50 uppercase tracking-wide">Best</p>
          <p className="font-bold text-secondary text-lg">{bestScore > 0 ? bestScore : "—"}</p>
        </div>
      </div>

      {/* Reference Thumbnail */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/50">Reference:</span>
        <div
          className="rounded-lg overflow-hidden border-2 border-secondary/30 shadow-sm"
          style={{ width: tileSize * 2, height: tileSize * 2 }}
        >
          <img
            src={PUZZLE_IMAGE}
            alt="Reference"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Puzzle Board */}
      <div
        className="relative rounded-xl overflow-hidden shadow-lg"
        style={{
          width: BOARD_SIZE_PX,
          height: BOARD_SIZE_PX,
          background: "#1a1a2e",
        }}
      >
        {/* Grid lines */}
        {Array.from({ length: size - 1 }, (_, i) => (
          <div
            key={`h${i}`}
            className="absolute bg-white/5"
            style={{
              left: 0,
              top: (i + 1) * tileSize + (i + 0.5) * TILE_GAP,
              width: "100%",
              height: TILE_GAP,
            }}
          />
        ))}
        {Array.from({ length: size - 1 }, (_, i) => (
          <div
            key={`v${i}`}
            className="absolute bg-white/5"
            style={{
              top: 0,
              left: (i + 1) * tileSize + (i + 0.5) * TILE_GAP,
              width: TILE_GAP,
              height: "100%",
            }}
          />
        ))}

        {/* Tiles */}
        {tiles.map((tile) => {
          if (tile.homeIndex === totalTiles - 1) return null; // empty slot, not rendered
          const pos = idxToRowCol(tile.id, size);
          const homePos = idxToRowCol(tile.homeIndex, size);
          const isMoving = slidingTile === tile.id;

          const left = pos.col * (tileSize + TILE_GAP) + TILE_GAP;
          const top = pos.row * (tileSize + TILE_GAP) + TILE_GAP;

          // Background position: show the portion of the image at homePos
          const bgX = -(homePos.col * (tileSize + TILE_GAP) + TILE_GAP);
          const bgY = -(homePos.row * (tileSize + TILE_GAP) + TILE_GAP);

          return (
            <div
              key={`tile-${tile.homeIndex}`}
              className={`absolute cursor-pointer select-none rounded-sm ${
                isMoving ? "z-10" : "z-0"
              }`}
              style={{
                width: tileSize,
                height: tileSize,
                left,
                top,
                transition: isMoving
                  ? `left ${SLIDE_DURATION}ms ease-in-out, top ${SLIDE_DURATION}ms ease-in-out`
                  : "none",
                backgroundImage: `url(${PUZZLE_IMAGE})`,
                backgroundSize: `${BOARD_SIZE_PX}px ${BOARD_SIZE_PX}px`,
                backgroundPosition: `${bgX}px ${bgY}px`,
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }}
              onClick={() => handleTileTap(tile.id)}
            >
              {/* Tile number indicator (small, top-left) */}
              <span
                className="absolute top-0.5 left-1 text-[9px] font-bold text-white/60"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
              >
                {tile.homeIndex + 1}
              </span>
            </div>
          );
        })}
      </div>

      {/* Win overlay */}
      {phase === "win" && (
        <div className="card text-center w-full max-w-sm animate-fadeIn">
          <div className="text-4xl mb-2">🎉</div>
          <h3 className="text-xl font-bold text-primary mb-1">Puzzle Solved!</h3>
          <p className="text-sm text-mutedText mb-3">
            {moves} moves • {formatTime(seconds)} • +{score} pts
          </p>
          <LeaderboardEntry
            game="mri-mixup"
            score={bestScoreAll}
            rank={submitRank}
            onRank={setSubmitRank}
          />
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => newGame()}
              className="btn-primary px-4 py-2 text-sm font-semibold rounded-lg"
            >
              Play Again
            </button>
            {size === 3 && (
              <button
                onClick={() => newGame(4)}
                className="btn-secondary px-4 py-2 text-sm font-semibold rounded-lg"
              >
                Try 4×4
              </button>
            )}
          </div>
        </div>
      )}

      {/* Rex below the board */}
      <Rex className="w-12 h-12" mood={rexMood} />

      {/* Achievement toast */}
      {achievements.length > 0 && (
        <AchievementToast
          achievements={achievements}
          onClose={() => setAchievements([])}
        />
      )}
    </div>
  );
}
