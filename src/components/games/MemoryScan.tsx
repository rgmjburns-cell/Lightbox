import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import Rex from "~/components/Rex";
import AchievementToast from "~/components/AchievementToast";
import { getPlayerName } from "~/components/Onboarding";
import { submitScore } from "~/lib/leaderboard";
import LeaderboardEntry from "~/components/LeaderboardEntry";
import { addPoints } from "~/lib/points";
import {
  checkAchievements,
  trackGameCompletion,
  trackMemoryScanCompletion,
  type Achievement,
} from "~/lib/achievements";

// ── Types ──

interface Card {
  id: number;
  pairId: number;
  emoji: string;
  label: string;
}

type Difficulty = "easy" | "hard";

// ── Card Data ──

const CARD_PAIRS: { emoji: string; label: string }[] = [
  { emoji: "🦴", label: "BONE" },
  { emoji: "❤️", label: "HEART" },
  { emoji: "🦷", label: "TOOTH" },
  { emoji: "💀", label: "SKULL" },
  { emoji: "🩻", label: "MRI" },
  { emoji: "⚡", label: "X-RAY" },
  { emoji: "🧠", label: "BRAIN" },
  { emoji: "🩻", label: "CHEST" },
  { emoji: "🫁", label: "LUNGS" },
  { emoji: "👁️", label: "EYE" },
  { emoji: "🦵", label: "FEMUR" },
  { emoji: "🤲", label: "HANDS" },
];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCards(difficulty: Difficulty): Card[] {
  const pairCount = difficulty === "easy" ? 8 : 12;
  const selected = shuffleArray(CARD_PAIRS).slice(0, pairCount);

  const cards: Card[] = [];
  selected.forEach((pair, idx) => {
    cards.push({ id: idx * 2, pairId: idx, emoji: pair.emoji, label: pair.label });
    cards.push({ id: idx * 2 + 1, pairId: idx, emoji: pair.emoji, label: pair.label });
  });

  return shuffleArray(cards);
}

// ── Component ──

export default function MemoryScan() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";

  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [cards, setCards] = useState<Card[]>(() => generateCards("easy"));
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [timer, setTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [locked, setLocked] = useState(false);
  const [rexMessage, setRexMessage] = useState("Match all the pairs!");
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [showComplete, setShowComplete] = useState(false);
  const [perfectMatch, setPerfectMatch] = useState<number | null>(null);
  const [lastFlipTime, setLastFlipTime] = useState(0);

  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
  const completedRef = useRef(false);

  const [bestEasy, setBestEasy] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("memoryScanBestEasy") || "0", 10);
  });
  const [bestHard, setBestHard] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("memoryScanBestHard") || "0", 10);
  });
  const [submitRank, setSubmitRank] = useState<number | null>(null);
  // Leaderboard score: 100 * (maxMoves - moves), where maxMoves = total cards.
  // Fewer moves → higher bonus → higher leaderboard rank (fewer moves is better play).
  // Hard: 24 cards, perfect = 1200. Easy: 16 cards, perfect = 800.
  const bonus = Math.max(0, 100 * (cards.length - moves));

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
      if (bonus > 0) addPoints(bonus);

      // Daily challenge bonus

      trackGameCompletion("memory-scan");
      trackMemoryScanCompletion(moves);
      // Live leaderboard: submit this run's bonus (100 * (cards - moves)),
      // fire-and-forget (submitScore self-handles the player name, auto-
      // creating a guest identity when needed — silent on failure).
      submitScore("memory-scan", bonus).then((r) => {
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
  }, [showComplete, moves, cards.length]);

  // Reset for difficulty change
  const resetGame = useCallback(
    (diff?: Difficulty) => {
      const d = diff ?? difficulty;
      setCards(generateCards(d));
      setFlipped(new Set());
      setMatched(new Set());
      setSelected([]);
      setMoves(0);
      setTimer(0);
      setTimerRunning(false);
      setLocked(false);
      setRexMessage("Match all the pairs!");
      setRexMood("happy");
      setShowComplete(false);
      setPerfectMatch(null);
      setLastFlipTime(0);
    },
    [difficulty]
  );

  useEffect(() => {
    resetGame(difficulty);
  }, [difficulty]);

  const currentBest = difficulty === "easy" ? bestEasy : bestHard;
  // Responsive columns: 4 on narrow screens, 6 on sm+
  const cols = difficulty === "easy" ? 4 : "4 sm:6";
  const rows = difficulty === "easy" ? 4 : "6 sm:4";

  // Card flip handler
  const handleCardClick = useCallback(
    (cardId: number) => {
      if (locked) return;
      if (matched.has(cardId)) return;
      if (flipped.has(cardId)) return;

      if (!timerRunning) setTimerRunning(true);

      const newFlipped = new Set(flipped);
      newFlipped.add(cardId);
      setFlipped(newFlipped);

      const newSelected = [...selected, cardId];
      setSelected(newSelected);

      if (newSelected.length === 2) {
        setMoves((m) => m + 1);
        setLocked(true);

        const [first, second] = newSelected;
        const card1 = cards.find((c) => c.id === first);
        const card2 = cards.find((c) => c.id === second);

        if (card1 && card2 && card1.pairId === card2.pairId) {
          // Match!
          const newMatched = new Set(matched);
          newMatched.add(first);
          newMatched.add(second);
          setMatched(newMatched);
          setSelected([]);
          setLocked(false);

          // Check for "perfect match" (under 3 seconds)
          const now = Date.now();
          if (lastFlipTime > 0 && now - lastFlipTime < 3000) {
            setPerfectMatch(card1.pairId);
            setTimeout(() => setPerfectMatch(null), 1500);
          }
          setLastFlipTime(now);

          setRexMood("excited");
          setRexMessage(
            now - lastFlipTime < 3000 && lastFlipTime > 0
              ? "Perfect match! ⚡"
              : "Nice match!"
          );

          // Check if game complete
          if (newMatched.size === cards.length) {
            setTimerRunning(false);
            setShowComplete(true);
            setRexMood("excited");
            setRexMessage(`Amazing, ${playerName}! You matched all pairs! 🎉`);

            // Save best
            const bestKey = difficulty === "easy" ? "memoryScanBestEasy" : "memoryScanBestHard";
            const current = difficulty === "easy" ? bestEasy : bestHard;
            if (current === 0 || moves + 1 < current) {
              if (difficulty === "easy") {
                setBestEasy(moves + 1);
              } else {
                setBestHard(moves + 1);
              }
              if (typeof window !== "undefined") {
                localStorage.setItem(bestKey, (moves + 1).toString());
              }
            }
          }

          setTimeout(() => {
            if (newMatched.size !== cards.length) {
              setRexMood("happy");
              setRexMessage(
                `${(cards.length - newMatched.size) / 2} pair${(cards.length - newMatched.size) / 2 > 1 ? "s" : ""} left!`
              );
            }
          }, 2000);
        } else {
          // No match
          setRexMood("encouraging");
          setRexMessage("Not a match — try again!");
          setLastFlipTime(0);

          setTimeout(() => {
            const resetFlipped = new Set(flipped);
            resetFlipped.delete(first);
            resetFlipped.delete(second);
            setFlipped(resetFlipped);
            setSelected([]);
            setLocked(false);
            setRexMood("happy");
            setRexMessage("Match all the pairs!");
          }, 800);
        }
      } else {
        // First card selected
        setRexMessage("Now find its match!");
        setLastFlipTime(Date.now());
      }
    },
    [locked, matched, flipped, selected, timerRunning, cards, moves, lastFlipTime, playerName, difficulty, bestEasy, bestHard]
  );

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isCardMatched = (id: number) => matched.has(id);
  const isCardFlipped = (id: number) => flipped.has(id) || matched.has(id);

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

      {/* ── Difficulty Toggle ── */}
      <div className="flex justify-center gap-2 mb-4">
        <button
          className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
            difficulty === "easy"
              ? "bg-secondary text-white shadow-md"
              : "bg-white text-mutedText border border-lightTeal"
          }`}
          onClick={() => setDifficulty("easy")}
        >
          😊 Easy (4×4)
        </button>
        <button
          className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
            difficulty === "hard"
              ? "bg-secondary text-white shadow-md"
              : "bg-white text-mutedText border border-lightTeal"
          }`}
          onClick={() => setDifficulty("hard")}
        >
          💪 Hard (6×4)
        </button>
      </div>

      {/* ── Score & Timer ── */}
      <div className="card mb-3 p-3 flex items-center justify-between">
        <div>
          <span className="text-xs text-mutedText uppercase font-semibold">Moves</span>
          <div className="text-2xl font-bold text-primary">{moves}</div>
        </div>
        <div className="text-center">
          <span className="text-xs text-mutedText uppercase font-semibold">Timer</span>
          <div className="text-2xl font-bold text-secondary">{formatTime(timer)}</div>
        </div>
        <div className="text-right">
          <span className="text-xs text-mutedText uppercase font-semibold">Matched</span>
          <div className="text-2xl font-bold text-primary">
            {matched.size / 2}/{cards.length / 2}
          </div>
        </div>
      </div>

      {/* ── Best Score ── */}
      {currentBest > 0 && (
        <p className="text-center text-xs text-mutedText mb-3">
          🏆 Best ({difficulty}): {currentBest} moves
        </p>
      )}

      {/* ── Card Grid ── */}
      <div
        className={`mb-4 grid gap-2 ${
          difficulty === "easy"
            ? "grid-cols-4"
            : "grid-cols-4 sm:grid-cols-6"
        }`}
      >
        {cards.map((card) => {
          const matched = isCardMatched(card.id);
          const flipped = isCardFlipped(card.id);
          const isPerfect = perfectMatch === card.pairId;

          return (
            <div
              key={card.id}
              className="aspect-square cursor-pointer select-none"
              style={{ perspective: "1000px" }}
              onClick={() => handleCardClick(card.id)}
            >
              <div
                className="relative w-full h-full transition-transform duration-500"
                style={{
                  transformStyle: "preserve-3d",
                  transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >
                {/* Card Back */}
                <div
                  className="absolute inset-0 rounded-xl flex items-center justify-center"
                  style={{
                    backfaceVisibility: "hidden",
                    background: "linear-gradient(135deg, #008C95 0%, #008C95 40%, #00B4C4 100%)",
                    boxShadow: "0 2px 8px rgba(0,140,149,0.3)",
                  }}
                >
                  <span className="text-2xl opacity-80">⚕️</span>
                </div>

                {/* Card Front */}
                <div
                  className={`absolute inset-0 rounded-xl flex flex-col items-center justify-center gap-1 p-1
                    ${matched ? "bg-teal-100" : isPerfect ? "bg-yellow-100" : "bg-white"}
                  `}
                  style={{
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                    boxShadow: matched
                      ? "0 2px 8px rgba(0,140,149,0.2)"
                      : "0 2px 8px rgba(0,0,0,0.08)",
                    border: matched ? "2px solid #008C95" : "1px solid #E0F5F7",
                  }}
                >
                  <span className="text-2xl sm:text-3xl">{card.emoji}</span>
                  <span
                    className={`text-[10px] sm:text-xs font-bold text-center leading-tight ${
                      matched ? "text-secondary" : "text-primary"
                    }`}
                  >
                    {card.label}
                  </span>
                  {isPerfect && (
                    <span className="absolute -top-1 -right-1 text-sm animate-bounce">
                      ⚡
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── New Game Button ── */}
      <div className="flex justify-center gap-3 mb-4">
        <button
          className="btn-secondary text-sm"
          onClick={() => resetGame()}
        >
          🔄 New Game
        </button>
      </div>

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
              All Matched!
            </h2>
            <div className="flex justify-center gap-4 mb-3 text-lg">
              <div>
                <span className="text-mutedText text-xs">Moves</span>
                <div className="font-bold text-primary">{moves}</div>
              </div>
              <div>
                <span className="text-mutedText text-xs">Time</span>
                <div className="font-bold text-primary">{formatTime(timer)}</div>
              </div>
            </div>
            {moves <= currentBest && currentBest > 0 && (
              <p className="text-secondary font-bold mb-4">🏆 New Best! 🏆</p>
            )}
            {currentBest === 0 && (
              <p className="text-secondary font-bold mb-4">First {difficulty} completion!</p>
            )}
            <LeaderboardEntry
              game="memory-scan"
              score={bonus}
              rank={submitRank}
              onRank={setSubmitRank}
            />
            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => resetGame()}
              >
                Play Again
              </button>
              <button
                className="btn-primary flex-1"
                onClick={() => {
                  setDifficulty(difficulty === "easy" ? "hard" : "easy");
                }}
              >
                {difficulty === "easy" ? "Try Hard" : "Try Easy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
