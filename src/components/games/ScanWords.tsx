import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Rex from "~/components/Rex";
import AchievementToast from "~/components/AchievementToast";
import { getPlayerName } from "~/components/Onboarding";
import { addPoints } from "~/lib/points";
import {
  checkAchievements,
  trackGameCompletion,
  type Achievement,
} from "~/lib/achievements";

// ── Types ──

type Mode = "kids" | "adults";

interface WordDef {
  word: string;
  clue: string;
}

interface PlacedWord {
  word: string;
  clue: string;
  row: number;
  col: number;
  direction: "across" | "down";
  number: number;
}

interface Cell {
  letter: string;
  number?: number; // clue number
  row: number;
  col: number;
}

// ── Word Sets ──

const KIDS_WORDS: WordDef[] = [
  { word: "BONE", clue: "What your skeleton is made of" },
  { word: "XRAY", clue: "A picture that sees through your skin" },
  { word: "SCAN", clue: "A machine looks inside you" },
  { word: "REX", clue: "Our friendly skeleton mascot" },
  { word: "CAST", clue: "A hard cover for a broken bone" },
  { word: "DOCTOR", clue: "The person who helps you feel better" },
  { word: "HEART", clue: "The organ that pumps blood" },
  { word: "BRAIN", clue: "The thinking organ in your head" },
  { word: "SPINE", clue: "The bones down your back" },
  { word: "TEETH", clue: "What you see on a dental X-ray" },
  { word: "ARM", clue: "From shoulder to hand" },
  { word: "LEG", clue: "From hip to foot" },
];

const ADULT_WORDS: WordDef[] = [
  { word: "RADIOLOGY", clue: "The medical specialty of imaging" },
  { word: "FRACTURE", clue: "A break in a bone" },
  { word: "CONTRAST", clue: "Dye used to enhance imaging" },
  { word: "MAMMOGRAM", clue: "Breast cancer screening X-ray" },
  { word: "ULTRASOUND", clue: "Imaging using sound waves" },
  { word: "THORAX", clue: "The chest region" },
  { word: "PELVIS", clue: "The hip bone structure" },
  { word: "CRANIUM", clue: "The skull" },
  { word: "CERVICAL", clue: "The neck portion of the spine" },
  { word: "LUMBAR", clue: "The lower back vertebrae" },
  { word: "BIOPSY", clue: "Tissue sample for diagnosis" },
  { word: "ANGIO", clue: "Imaging of blood vessels" },
];

// ── Crossword Generation ──

const GRID_SIZE = 12;

function generateCrossword(wordDefs: WordDef[], count: number): {
  grid: Cell[][];
  placedWords: PlacedWord[];
} {
  // Retry up to 20 times to get a decent puzzle
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = tryGenerate(wordDefs, count, attempt);
    if (result.placedWords.length >= Math.min(count, 3)) {
      return result;
    }
  }
  // Last resort: return whatever we got on the first attempt
  return tryGenerate(wordDefs, count, 0);
}

function tryGenerate(wordDefs: WordDef[], count: number, attempt: number): {
  grid: Cell[][];
  placedWords: PlacedWord[];
} {
  // Pick words — use different shuffle on retries
  const shuffled = [...wordDefs].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);
  // Sort longest first for better placement
  selected.sort((a, b) => b.word.length - a.word.length);

  // Init grid
  const grid: (string | null)[][] = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill(null)
  );

  const placedWords: PlacedWord[] = [];
  let clueNumber = 1;

  for (const wd of selected) {
    const word = wd.word.toUpperCase();
    const len = word.length;
    let placed = false;

    if (placedWords.length === 0) {
      // Place first word horizontally near center
      const row = Math.floor(GRID_SIZE / 2);
      const col = Math.floor((GRID_SIZE - len) / 2);
      for (let i = 0; i < len; i++) {
        grid[row][col + i] = word[i];
      }
      placedWords.push({
        word,
        clue: wd.clue,
        row,
        col,
        direction: "across",
        number: clueNumber++,
      });
      placed = true;
    } else {
      // Try to intersect with existing words
      const candidates: {
        wd: WordDef;
        word: string;
        intersectRow: number;
        intersectCol: number;
        startRow: number;
        startCol: number;
        direction: "across" | "down";
        intersectIdx: number;
        wordIdx: number;
      }[] = [];

      for (const pw of placedWords) {
        const pWord = pw.word;
        for (let pi = 0; pi < pWord.length; pi++) {
          const letter = pWord[pi];
          for (let wi = 0; wi < word.length; wi++) {
            if (word[wi] !== letter) continue;

            if (pw.direction === "across") {
              // Try placing new word vertically through this intersection
              const startRow = pw.row - wi;
              const col = pw.col + pi;
              if (startRow >= 0 && startRow + len <= GRID_SIZE) {
                let fits = true;
                for (let i = 0; i < len; i++) {
                  const r = startRow + i;
                  const existing = grid[r][col];
                  if (existing !== null && existing !== word[i]) {
                    fits = false;
                    break;
                  }
                  // Check adjacent cells aren't conflicting
                  if (col > 0 && grid[r][col - 1] !== null) {
                    const isPartOfAcross =
                      placedWords.some(
                        (pw2) =>
                          pw2.direction === "across" &&
                          pw2.row === r &&
                          col - 1 >= pw2.col &&
                          col - 1 < pw2.col + pw2.word.length
                      );
                    if (!isPartOfAcross) {
                      fits = false;
                      break;
                    }
                  }
                  if (col < GRID_SIZE - 1 && grid[r][col + 1] !== null) {
                    const isPartOfAcross =
                      placedWords.some(
                        (pw2) =>
                          pw2.direction === "across" &&
                          pw2.row === r &&
                          col + 1 >= pw2.col &&
                          col + 1 < pw2.col + pw2.word.length
                      );
                    if (!isPartOfAcross) {
                      fits = false;
                      break;
                    }
                  }
                }
                if (fits) {
                  candidates.push({
                    wd,
                    word,
                    intersectRow: pw.row,
                    intersectCol: col,
                    startRow,
                    startCol: col,
                    direction: "down",
                    intersectIdx: pi,
                    wordIdx: wi,
                  });
                }
              }
            } else {
              // pw is down, try placing new word horizontally
              const row = pw.row + pi;
              const startCol = pw.col - wi;
              if (startCol >= 0 && startCol + len <= GRID_SIZE) {
                let fits = true;
                for (let i = 0; i < len; i++) {
                  const c = startCol + i;
                  const existing = grid[row][c];
                  if (existing !== null && existing !== word[i]) {
                    fits = false;
                    break;
                  }
                }
                if (fits) {
                  candidates.push({
                    wd,
                    word,
                    intersectRow: row,
                    intersectCol: pw.col,
                    startRow: row,
                    startCol,
                    direction: "across",
                    intersectIdx: pi,
                    wordIdx: wi,
                  });
                }
              }
            }
          }
        }
      }

      if (candidates.length > 0) {
        // Pick a random candidate
        const c = candidates[Math.floor(Math.random() * candidates.length)];
        for (let i = 0; i < len; i++) {
          if (c.direction === "across") {
            grid[c.startRow][c.startCol + i] = word[i];
          } else {
            grid[c.startRow + i][c.startCol] = word[i];
          }
        }
        placedWords.push({
          word,
          clue: c.wd.clue,
          row: c.startRow,
          col: c.startCol,
          direction: c.direction,
          number: clueNumber++,
        });
        placed = true;
      }
    }
  }

  // Sort placed words by position for numbering
  placedWords.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });
  // Re-number
  placedWords.forEach((pw, i) => {
    pw.number = i + 1;
  });

  // Convert grid to cells
  const cells: Cell[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const letter = grid[r][c];
      // Find if this cell starts a word
      const startWord = placedWords.find(
        (pw) => pw.row === r && pw.col === c
      );
      row.push({
        letter: letter || "",
        number: startWord?.number,
        row: r,
        col: c,
      });
    }
    cells.push(row);
  }

  return { grid: cells, placedWords };
}

// ── Component ──

export default function ScanWords() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";

  const [mode, setMode] = useState<Mode>("kids");
  const wordDefs = mode === "kids" ? KIDS_WORDS : ADULT_WORDS;
  const wordCount = mode === "kids" ? 6 : 7;

  const [puzzle, setPuzzle] = useState(() => generateCrossword(wordDefs, wordCount));
  const [userGrid, setUserGrid] = useState<string[][]>(() =>
    puzzle.grid.map((row) => row.map((cell) => ""))
  );
  const [placedWords, setPlacedWords] = useState(puzzle.placedWords);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [direction, setDirection] = useState<"across" | "down">("across");

  const [timer, setTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [showComplete, setShowComplete] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    correct: number;
    total: number;
  } | null>(null);

  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
  const completedRef = useRef(false);

  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("scanWordsHighScore") || "0", 10);
  });

  // Regenerate
  const regenerate = useCallback(() => {
    const newPuzzle = generateCrossword(wordDefs, wordCount);
    setPuzzle(newPuzzle);
    setUserGrid(newPuzzle.grid.map((row) => row.map(() => "")));
    setPlacedWords(newPuzzle.placedWords);
    setSelectedRow(null);
    setSelectedCol(null);
    setDirection("across");
    setTimer(0);
    setTimerRunning(false);
    setScore(0);
    setShowComplete(false);
    setCheckResult(null);
    setRexMood("happy");
  }, [mode, wordDefs, wordCount]);

  useEffect(() => {
    regenerate();
  }, [mode]);

  // Timer
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  // Track completion
  useEffect(() => {
    if (showComplete && !completedRef.current) {
      completedRef.current = true;
      addPoints(score);

      trackGameCompletion("crossword");
      const newAchievements = checkAchievements();
      if (newAchievements.length > 0) {
        setToastAchievement(newAchievements[0]);
      }
    }
    if (!showComplete) {
      completedRef.current = false;
    }
  }, [showComplete, score]);

  // Handle cell tap
  const handleCellTap = useCallback(
    (row: number, col: number) => {
      if (showComplete) return;
      if (!timerRunning) setTimerRunning(true);

      const cell = puzzle.grid[row][col];
      if (!cell.letter) return; // black square

      // If tapping same cell, toggle direction
      if (selectedRow === row && selectedCol === col) {
        setDirection((d) => (d === "across" ? "down" : "across"));
        return;
      }

      setSelectedRow(row);
      setSelectedCol(col);
    },
    [showComplete, timerRunning, selectedRow, selectedCol, puzzle]
  );

  // Handle key input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showComplete || selectedRow === null || selectedCol === null) return;
      if (!timerRunning) setTimerRunning(true);

      const key = e.key.toUpperCase();

      if (key === "BACKSPACE" || key === "DELETE") {
        setUserGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[selectedRow][selectedCol] = "";
          return next;
        });
        // Move backward
        moveSelection(-1);
        return;
      }

      if (key === "TAB") {
        e.preventDefault();
        moveSelection(1);
        return;
      }

      if (key === "ARROWUP") {
        e.preventDefault();
        moveToCell(selectedRow - 1, selectedCol);
        return;
      }
      if (key === "ARROWDOWN") {
        e.preventDefault();
        moveToCell(selectedRow + 1, selectedCol);
        return;
      }
      if (key === "ARROWLEFT") {
        e.preventDefault();
        moveToCell(selectedRow, selectedCol - 1);
        return;
      }
      if (key === "ARROWRIGHT") {
        e.preventDefault();
        moveToCell(selectedRow, selectedCol + 1);
        return;
      }

      // Letter input
      if (/^[A-Z]$/.test(key)) {
        setUserGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[selectedRow][selectedCol] = key;
          return next;
        });
        moveSelection(1);
      }
    },
    [showComplete, timerRunning, selectedRow, selectedCol, direction, puzzle]
  );

  const moveSelection = (delta: number) => {
    if (selectedRow === null || selectedCol === null) return;
    if (direction === "across") {
      moveToCell(selectedRow, selectedCol + delta);
    } else {
      moveToCell(selectedRow + delta, selectedCol);
    }
  };

  const moveToCell = (row: number, col: number) => {
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return;
    if (!puzzle.grid[row][col].letter) return;
    setSelectedRow(row);
    setSelectedCol(col);
  };

  // Find which cells are part of the selected word
  const selectedWordCells = useMemo(() => {
    if (selectedRow === null || selectedCol === null) return new Set<string>();
    const set = new Set<string>();

    // Find the word that starts at or contains the selected cell in the given direction
    if (direction === "across") {
      // Find the start of the horizontal word
      let startCol = selectedCol;
      while (startCol > 0 && puzzle.grid[selectedRow][startCol - 1].letter) {
        startCol--;
      }
      for (let c = startCol; c < GRID_SIZE && puzzle.grid[selectedRow][c].letter; c++) {
        set.add(`${selectedRow},${c}`);
      }
    } else {
      let startRow = selectedRow;
      while (startRow > 0 && puzzle.grid[startRow - 1][selectedCol].letter) {
        startRow--;
      }
      for (let r = startRow; r < GRID_SIZE && puzzle.grid[r][selectedCol].letter; r++) {
        set.add(`${r},${selectedCol}`);
      }
    }
    return set;
  }, [selectedRow, selectedCol, direction, puzzle]);

  // Check answers
  const handleCheck = () => {
    let correct = 0;
    let total = 0;

    for (const pw of placedWords) {
      for (let i = 0; i < pw.word.length; i++) {
        const r = pw.direction === "across" ? pw.row : pw.row + i;
        const c = pw.direction === "across" ? pw.col + i : pw.col;
        total++;
        if (userGrid[r][c] === pw.word[i]) {
          correct++;
        }
      }
    }

    setCheckResult({ correct, total });

    if (correct === total) {
      // Calculate score based on time
      const timeBonus = Math.max(0, 600 - timer * 2);
      const finalScore = 500 + timeBonus;
      setScore(finalScore);
      setTimerRunning(false);
      setShowComplete(true);
      setRexMood("excited");

      if (finalScore > highScore) {
        setHighScore(finalScore);
        if (typeof window !== "undefined") {
          localStorage.setItem("scanWordsHighScore", finalScore.toString());
        }
      }
    } else {
      setRexMood("encouraging");
    }
  };

  // Determine which cells have correct letters
  const correctCells = useMemo(() => {
    const set = new Set<string>();
    if (!checkResult || checkResult.correct === checkResult.total) return set;
    for (const pw of placedWords) {
      for (let i = 0; i < pw.word.length; i++) {
        const r = pw.direction === "across" ? pw.row : pw.row + i;
        const c = pw.direction === "across" ? pw.col + i : pw.col;
        if (userGrid[r]?.[c] === pw.word[i]) {
          set.add(`${r},${c}`);
        }
      }
    }
    return set;
  }, [checkResult, placedWords, userGrid]);

  // Incorrect cells
  const incorrectCells = useMemo(() => {
    const set = new Set<string>();
    if (!checkResult || checkResult.correct === checkResult.total) return set;
    for (const pw of placedWords) {
      for (let i = 0; i < pw.word.length; i++) {
        const r = pw.direction === "across" ? pw.row : pw.row + i;
        const c = pw.direction === "across" ? pw.col + i : pw.col;
        if (userGrid[r]?.[c] && userGrid[r][c] !== pw.word[i]) {
          set.add(`${r},${c}`);
        }
      }
    }
    return set;
  }, [checkResult, placedWords, userGrid]);

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

      {/* ── Rex Header (silent mascot — no speech bubble from Rex, use system message instead) ── */}
      <div className="mb-4 flex items-center gap-3">
        <Rex className="w-10 h-10" mood={rexMood} />
        <div className="bg-white rounded-2xl px-4 py-2 shadow-sm text-sm text-primary font-medium">
          {showComplete
            ? `Amazing, ${playerName}! All correct! 🎉`
            : checkResult
              ? `${checkResult.correct}/${checkResult.total} correct — keep going!`
              : "Tap a cell to start typing!"}
        </div>
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
          <span className="text-xs text-mutedText uppercase font-semibold">Timer</span>
          <div className="text-2xl font-bold text-secondary">{formatTime(timer)}</div>
        </div>
        <div className="text-right">
          <span className="text-xs text-mutedText uppercase font-semibold">High Score</span>
          <div className="text-2xl font-bold text-primary">{highScore.toLocaleString()}</div>
        </div>
      </div>

      {/* ── Crossword Grid ── */}
      <div
        className="select-none mb-4 focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={(el) => el?.focus()}
      >
        <div
          className="grid bg-white rounded-2xl shadow-lg border border-lightTeal/50 overflow-hidden"
          style={{
            gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
            touchAction: "manipulation",
          }}
        >
          {puzzle.grid.map((row, r) =>
            row.map((cell, c) => {
              const cellKey = `${r},${c}`;
              const isSelected = selectedRow === r && selectedCol === c;
              const isInSelectedWord = selectedWordCells.has(cellKey);
              const isCorrect = correctCells.has(cellKey);
              const isIncorrect = incorrectCells.has(cellKey);
              const isEmpty = !cell.letter;
              const userLetter = userGrid[r]?.[c] || "";

              return (
                <button
                  key={cellKey}
                  className={`
                    aspect-square flex items-center justify-center relative
                    text-sm font-bold transition-all duration-100
                    cursor-pointer select-none
                    ${
                      isEmpty
                        ? "bg-primary/5 pointer-events-none"
                        : isSelected
                          ? "bg-lightTeal ring-2 ring-secondary z-10 scale-105"
                          : isInSelectedWord
                            ? "bg-lightTeal/40"
                            : "bg-white"
                    }
                    ${isCorrect ? "bg-teal-100 text-secondary" : ""}
                    ${isIncorrect ? "bg-red-50 text-red-500" : ""}
                    hover:bg-lightTeal/30
                  `}
                  onClick={() => handleCellTap(r, c)}
                  aria-label={`Cell ${r},${c}`}
                >
                  {/* Clue number */}
                  {cell.number && (
                    <span className="absolute top-0.5 left-1 text-[8px] text-mutedText font-bold">
                      {cell.number}
                    </span>
                  )}
                  <span
                    className={
                      isCorrect
                        ? "text-secondary"
                        : isIncorrect
                          ? "text-red-500"
                          : userLetter
                            ? "text-primary"
                            : "text-transparent"
                    }
                  >
                    {userLetter || (showComplete ? cell.letter : "·")}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Clues ── */}
      <div className="card mb-3 p-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Across */}
          <div>
            <h3 className="text-xs font-bold text-secondary uppercase mb-2">Across</h3>
            <ul className="space-y-1.5">
              {placedWords
                .filter((pw) => pw.direction === "across")
                .map((pw) => (
                  <li
                    key={pw.number}
                    className={`text-xs cursor-pointer hover:bg-lightTeal/30 rounded px-1 py-0.5 transition-colors ${
                      selectedWordCells.has(`${pw.row},${pw.col}`)
                        ? "bg-lightTeal/40 font-bold"
                        : ""
                    }`}
                    onClick={() => {
                      setSelectedRow(pw.row);
                      setSelectedCol(pw.col);
                      setDirection("across");
                    }}
                  >
                    <span className="font-bold text-secondary">{pw.number}.</span>{" "}
                    {pw.clue}
                  </li>
                ))}
            </ul>
          </div>
          {/* Down */}
          <div>
            <h3 className="text-xs font-bold text-secondary uppercase mb-2">Down</h3>
            <ul className="space-y-1.5">
              {placedWords
                .filter((pw) => pw.direction === "down")
                .map((pw) => (
                  <li
                    key={pw.number}
                    className={`text-xs cursor-pointer hover:bg-lightTeal/30 rounded px-1 py-0.5 transition-colors ${
                      selectedWordCells.has(`${pw.row},${pw.col}`)
                        ? "bg-lightTeal/40 font-bold"
                        : ""
                    }`}
                    onClick={() => {
                      setSelectedRow(pw.row);
                      setSelectedCol(pw.col);
                      setDirection("down");
                    }}
                  >
                    <span className="font-bold text-secondary">{pw.number}.</span>{" "}
                    {pw.clue}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex justify-center gap-3 mb-4">
        {!showComplete && (
          <button className="btn-primary text-sm" onClick={handleCheck}>
            ✅ Check Answers
          </button>
        )}
        <button className="btn-secondary text-sm" onClick={regenerate}>
          🔄 New Puzzle
        </button>
      </div>

      {/* ── Best Score ── */}
      {highScore > 0 && (
        <p className="text-center text-xs text-white/70 mb-4">
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
              Score:{" "}
              <span className="font-bold text-primary">{score.toLocaleString()}</span>
            </p>
            <p className="text-sm text-mutedText mb-2">Time: {formatTime(timer)}</p>
            {score >= highScore && (
              <p className="text-secondary font-bold mb-4">🏆 New High Score! 🏆</p>
            )}
            <button
              className="btn-primary w-full text-lg"
              onClick={regenerate}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
