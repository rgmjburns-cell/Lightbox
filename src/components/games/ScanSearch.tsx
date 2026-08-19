import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import Rex from "~/components/Rex";
import AchievementToast from "~/components/AchievementToast";
import { getPlayerName } from "~/components/Onboarding";
import { submitScore } from "~/lib/leaderboard";
import LeaderboardEntry from "~/components/LeaderboardEntry";
import { Link } from "@tanstack/react-router";
import { addPoints } from "~/lib/points";
import {
  checkAchievements,
  trackGameCompletion,
  trackScanSearchCompletion,
  type Achievement,
} from "~/lib/achievements";

// ── Types ──

type Mode = "kids" | "adults";

interface WordPlacement {
  word: string;
  positions: { row: number; col: number }[];
  direction: "horizontal" | "vertical" | "diagonal";
}

// ── Word Lists ──

const KIDS_WORDS = [
  "BONE", "XRAY", "SCAN", "HEART", "REX", "TEETH", "BRAIN",
  "BODY", "ARM", "LEG", "HAND", "FOOT", "CAST", "DOC", "CHEST", "SPINE",
];

const ADULT_WORDS = [
  "RADIOLOGY", "ULTRASOUND", "FRACTURE", "CONTRAST",
  "SCANNER", "PATIENT", "DIAGNOSIS", "IMAGING", "THORAX",
  "PELVIS", "CRANIUM", "CERVICAL", "LUMBAR", "ANGIO", "BIOPSY",
];

const GRID_SIZE = 10;

// ── Helpers ──

function randomChar(): string {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Grid Generation ──

function generateGrid(wordList: string[], count: number): { grid: string[][]; placements: WordPlacement[] } {
  const grid: string[][] = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill("")
  );

  const shuffled = shuffleArray(wordList);
  const selectedWords = shuffled.slice(0, count);
  selectedWords.sort((a, b) => b.length - a.length);

  const directions = ["horizontal", "vertical", "diagonal"] as const;
  const placements: WordPlacement[] = [];

  for (const word of selectedWords) {
    const attempts = shuffleArray(
      Array.from({ length: GRID_SIZE * GRID_SIZE * directions.length }, (_, i) => ({
        row: Math.floor(i / (GRID_SIZE * directions.length)),
        col: Math.floor((i % (GRID_SIZE * directions.length)) / directions.length),
        dir: directions[i % directions.length],
      }))
    );

    let placed = false;

    for (const attempt of attempts) {
      const { row, col, dir } = attempt;
      const len = word.length;
      const positions: { row: number; col: number }[] = [];
      let fits = true;

      for (let i = 0; i < len; i++) {
        let r = row;
        let c = col;

        if (dir === "horizontal") c += i;
        else if (dir === "vertical") r += i;
        else { r += i; c += i; }

        if (r >= GRID_SIZE || c >= GRID_SIZE) {
          fits = false;
          break;
        }

        const existing = grid[r][c];
        if (existing !== "" && existing !== word[i]) {
          fits = false;
          break;
        }

        positions.push({ row: r, col: c });
      }

      if (fits) {
        for (let i = 0; i < len; i++) {
          grid[positions[i].row][positions[i].col] = word[i];
        }
        placements.push({ word, positions, direction: dir });
        placed = true;
        break;
      }
    }
  }

  // Fill remaining cells with random letters
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === "") {
        grid[r][c] = randomChar();
      }
    }
  }

  return { grid, placements };
}

// ── Component ──

export default function ScanSearch() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";

  const [mode, setMode] = useState<Mode>("kids");
  const wordList = mode === "kids" ? KIDS_WORDS : ADULT_WORDS;
  const wordCount = mode === "kids" ? 7 : 6;

  const [puzzle, setPuzzle] = useState(() => generateGrid(wordList, wordCount));
  const [grid, setGrid] = useState(puzzle.grid);
  const [placements, setPlacements] = useState(puzzle.placements);

  const [foundWords, setFoundWords] = useState<Set<string>>(new Set());
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [flashWord, setFlashWord] = useState<string | null>(null);

  const [timer, setTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [rexMessage, setRexMessage] = useState("Find all the hidden radiology words!");
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [showComplete, setShowComplete] = useState(false);

  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
  const completedRef = useRef(false);

  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("scanSearchHighScore") || "0", 10);
  });
  const [submitRank, setSubmitRank] = useState<number | null>(null);

  // ── Chain selection: tap letters one by one, they accumulate ──
  const [selectedChain, setSelectedChain] = useState<{ row: number; col: number }[]>([]);

  // Regenerate puzzle when mode changes
  const regenerate = useCallback(() => {
    const newPuzzle = generateGrid(wordList, wordCount);
    setPuzzle(newPuzzle);
    setGrid(newPuzzle.grid);
    setPlacements(newPuzzle.placements);
    setFoundWords(new Set());
    setSelectedCells(new Set());
    setSelectedChain([]);
    setFlashWord(null);
    setTimer(0);
    setTimerRunning(false);
    setScore(0);
    setShowComplete(false);
    setRexMessage("Find all the hidden radiology words!");
    setRexMood("happy");
  }, [mode, wordList, wordCount]);

  useEffect(() => {
    regenerate();
  }, [mode]);

  // Timer
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => {
      setTimer((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  // Track completion for points & achievements
  useEffect(() => {
    if (showComplete && !completedRef.current) {
      completedRef.current = true;
      addPoints(score);

      trackGameCompletion("scan-search");
      trackScanSearchCompletion(timer);
      // Live leaderboard: submit the stored best, fire-and-forget
      // (submitScore self-handles the player name, auto-creating a guest
      // identity when needed — silent on failure, never breaks the game).
      submitScore("scan-search", highScore).then((r) => {
        if (r) setSubmitRank(r.rank);
      });
      const newAchievements = checkAchievements();
      if (newAchievements.length > 0) {
        setToastAchievement(newAchievements[0]);
      }
    }
    if (!showComplete) {
      completedRef.current = false;
    }
  }, [showComplete, score, timer]);

  // Check if two cells are adjacent (including diagonally)
  const isAdjacent = (a: { row: number; col: number }, b: { row: number; col: number }): boolean => {
    const dr = Math.abs(a.row - b.row);
    const dc = Math.abs(a.col - b.col);
    return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
  };

  // Check if the current chain matches any unfound word (in either direction)
  const checkChainForWord = useCallback(
    (chain: { row: number; col: number }[]): WordPlacement | null => {
      if (chain.length < 3) return null;
      for (const placement of placements) {
        if (foundWords.has(placement.word)) continue;
        const pos = placement.positions;
        if (chain.length !== pos.length) continue;
        // Check forward match
        let forwardMatch = true;
        let backwardMatch = true;
        for (let i = 0; i < pos.length; i++) {
          if (chain[i].row !== pos[i].row || chain[i].col !== pos[i].col) forwardMatch = false;
          if (chain[i].row !== pos[pos.length - 1 - i].row || chain[i].col !== pos[pos.length - 1 - i].col) backwardMatch = false;
        }
        if (forwardMatch || backwardMatch) return placement;
      }
      return null;
    },
    [placements, foundWords]
  );

  // Handle tapping a cell
  const handleCellTap = useCallback(
    (row: number, col: number) => {
      if (showComplete) return;
      if (!timerRunning) setTimerRunning(true);

      const pos = { row, col };
      const cellKey = `${row},${col}`;

      // Already in chain? Remove from that point onward (deselect)
      const existingIdx = selectedChain.findIndex((c) => c.row === row && c.col === col);
      if (existingIdx >= 0) {
        if (existingIdx === selectedChain.length - 1) {
          const newChain = selectedChain.slice(0, -1);
          setSelectedChain(newChain);
          setSelectedCells(new Set(newChain.map((c) => `${c.row},${c.col}`)));
          return;
        }
        const newChain = selectedChain.slice(0, existingIdx);
        setSelectedChain(newChain);
        setSelectedCells(new Set(newChain.map((c) => `${c.row},${c.col}`)));
        return;
      }

      // Empty chain: start a new one
      if (selectedChain.length === 0) {
        setSelectedChain([pos]);
        setSelectedCells(new Set([cellKey]));
        return;
      }

      // Check if adjacent to the last cell in chain
      const lastCell = selectedChain[selectedChain.length - 1];
      if (!isAdjacent(lastCell, pos)) {
        setSelectedChain([pos]);
        setSelectedCells(new Set([cellKey]));
        return;
      }

      // Add to chain
      const newChain = [...selectedChain, pos];
      setSelectedChain(newChain);
      setSelectedCells(new Set(newChain.map((c) => `${c.row},${c.col}`)));

      // Check if chain matches a word
      const match = checkChainForWord(newChain);
      if (match) {
        // Inline the word-found logic to avoid circular dependency
        const newFound = new Set(foundWords);
        newFound.add(match.word);
        setFoundWords(newFound);

        const speedBonus = Math.max(0, 200 - timer);
        const earned = 100 + speedBonus;
        setScore((s) => s + earned);

        setFlashWord(match.word);
        setTimeout(() => setFlashWord(null), 800);

        setRexMood("excited");
        setRexMessage(`Found "${match.word}"! +${earned} pts`);

        if (newFound.size === placements.length) {
          setTimerRunning(false);
          setShowComplete(true);
          setRexMood("excited");
          setRexMessage(`Amazing, ${playerName}! All words found! 🎉`);
          const finalScore = score + earned;
          if (finalScore > highScore) {
            setHighScore(finalScore);
            if (typeof window !== "undefined") {
              localStorage.setItem("scanSearchHighScore", finalScore.toString());
            }
          }
        } else {
          setTimeout(() => {
            setRexMood("happy");
            setRexMessage(`${placements.length - newFound.size} word${placements.length - newFound.size > 1 ? "s" : ""} left to find!`);
          }, 2000);
        }

        setSelectedChain([]);
        setSelectedCells(new Set());
      }
    },
    [showComplete, timerRunning, selectedChain, checkChainForWord, foundWords, placements, timer, score, highScore, playerName]
  );

  const handleWordFound = useCallback(
    (placement: WordPlacement) => {
      const newFound = new Set(foundWords);
      newFound.add(placement.word);
      setFoundWords(newFound);

      // Score: 100 base + speed bonus
      const speedBonus = Math.max(0, 200 - timer);
      const earned = 100 + speedBonus;
      setScore((s) => s + earned);

      setFlashWord(placement.word);
      setTimeout(() => setFlashWord(null), 800);

      setRexMood("excited");
      setRexMessage(`Found "${placement.word}"! +${earned} pts`);

      // Check if all words found
      if (newFound.size === placements.length) {
        setTimerRunning(false);
        setShowComplete(true);
        setRexMood("excited");
        setRexMessage(`Amazing, ${playerName}! All words found! 🎉`);

        const finalScore = score + earned;
        if (finalScore > highScore) {
          setHighScore(finalScore);
          if (typeof window !== "undefined") {
            localStorage.setItem("scanSearchHighScore", finalScore.toString());
          }
        }
      }

      setTimeout(() => {
        if (newFound.size !== placements.length) {
          setRexMood("happy");
          setRexMessage(
            `${placements.length - newFound.size} word${placements.length - newFound.size > 1 ? "s" : ""} left to find!`
          );
        }
      }, 2000);
    },
    [foundWords, placements, timer, score, highScore, playerName]
  );

  // Compute which cells are "found" (part of found words)
  const foundCellSet = useMemo(() => {
    const set = new Set<string>();
    for (const placement of placements) {
      if (foundWords.has(placement.word)) {
        for (const pos of placement.positions) {
          set.add(`${pos.row},${pos.col}`);
        }
      }
    }
    return set;
  }, [placements, foundWords]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="page-container max-w-lg mx-auto">
      {/* ── Achievement Toast ── */}
      <AchievementToast
        achievement={toastAchievement}
        onDismiss={() => setToastAchievement(null)}
      />

      {/* ── Rex Header ── */}
      <div className="mb-4">
        <RexSpeechBubble message={rexMessage} mood={rexMood} />
      </div>

      {/* ── Mode Toggle ── */}
      <div className="flex justify-center gap-2 mb-4">
        <button
          className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
            mode === "kids"
              ? "bg-secondary text-white shadow-md"
              : "bg-white text-mutedText border border-lightTeal"
          }`}
          onClick={() => setMode("kids")}
        >
          🧒 Kids
        </button>
        <button
          className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
            mode === "adults"
              ? "bg-secondary text-white shadow-md"
              : "bg-white text-mutedText border border-lightTeal"
          }`}
          onClick={() => setMode("adults")}
        >
          🧑 Adults
        </button>
      </div>

      {/* ── Score & Timer ── */}
      <div className="card mb-3 p-3 flex items-center justify-between">
        <div>
          <span className="text-xs text-mutedText uppercase font-semibold">Score</span>
          <div className="text-2xl font-bold text-primary">{score.toLocaleString()}</div>
        </div>
        <div className="text-center">
          <span className="text-xs text-mutedText uppercase font-semibold">Timer</span>
          <div className="text-2xl font-bold text-secondary">{formatTime(timer)}</div>
        </div>
        <div className="text-right">
          <span className="text-xs text-mutedText uppercase font-semibold">Found</span>
          <div className="text-2xl font-bold text-primary">
            {foundWords.size}/{placements.length}
          </div>
        </div>
      </div>

      {/* ── Word List ── */}
      <div className="card mb-3 p-3">
        <div className="flex flex-wrap gap-2">
          {placements.map((p) => {
            const found = foundWords.has(p.word);
            return (
              <span
                key={p.word}
                className={`px-3 py-1 rounded-full text-sm font-bold transition-all duration-300 ${
                  found
                    ? "bg-teal-100 text-secondary line-through"
                    : "bg-lightGrey text-primary"
                } ${
                  flashWord === p.word ? "scale-110 bg-lightTeal shadow-md" : ""
                }`}
              >
                {p.word}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="relative select-none mb-4">
        <div
          className="grid gap-[2px] p-2 bg-white rounded-2xl shadow-lg border border-lightTeal/50"
          style={{
            gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
            touchAction: "manipulation",
          }}
        >
          {Array.from({ length: GRID_SIZE }, (_, r) =>
            Array.from({ length: GRID_SIZE }, (_, c) => {
              const cellKey = `${r},${c}`;
              const isFound = foundCellSet.has(cellKey);
              const isSelected = selectedCells.has(cellKey);

              return (
                <button
                  key={cellKey}
                  className={`
                    aspect-square flex items-center justify-center
                    rounded-lg text-lg font-bold
                    transition-all duration-150 active:scale-90
                    cursor-pointer select-none
                    ${
                      isFound
                        ? "bg-teal-100 text-secondary"
                        : isSelected
                          ? "bg-lightTeal text-secondary ring-2 ring-secondary"
                          : "bg-lightTeal/20 text-primary hover:bg-lightTeal/40"
                    }
                  `}
                  onClick={() => handleCellTap(r, c)}
                  aria-label={`Cell ${r},${c}: ${grid[r][c]}`}
                >
                  <span
                    className={`font-mono ${isFound ? "text-secondary" : ""}`}
                  >
                    {grid[r][c]}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── New Game Button ── */}
      <div className="flex justify-center gap-3 mb-4">
        <button
          className="btn-secondary text-sm"
          onClick={regenerate}
        >
          🔄 New Puzzle
        </button>
      </div>

      {/* ── Best Score ── */}
      {highScore > 0 && (
        <p className="text-center text-xs text-mutedText mb-4">
          🏆 Best Score: {highScore.toLocaleString()}
        </p>
      )}

      {/* ── Rex ── */}
      <div className="flex justify-center mb-20">
        <Rex className="w-10 h-10" mood={rexMood} />
      </div>

      {/* ── Complete Modal ── */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="excited" />
            <h2 className="text-2xl font-extrabold text-primary mb-2">
              Puzzle Complete!
            </h2>
            <p className="text-lg text-mutedText mb-1">
              Score: <span className="font-bold text-primary">{score.toLocaleString()}</span>
            </p>
            <p className="text-sm text-mutedText mb-2">
              Time: {formatTime(timer)}
            </p>
            {score >= highScore && (
              <p className="text-secondary font-bold mb-4">🏆 New High Score! 🏆</p>
            )}
            <LeaderboardEntry
              game="scan-search"
              score={highScore}
              rank={submitRank}
              onRank={setSubmitRank}
            />
            <button
              className="btn-primary w-full text-lg"
              onClick={regenerate}
            >
              Play Again
            </button>
            <Link to="/" className="btn-secondary w-full text-lg mt-4 block">Back to Games</Link>
          </div>
        </div>
      )}
    </div>
  );
}
