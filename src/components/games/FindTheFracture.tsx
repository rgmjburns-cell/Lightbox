import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import RexSpeechBubble from "~/components/RexSpeechBubble";
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

interface Difference {
  id: number;
  label: string;
  /** Clickable zone in SVG coordinates (viewBox units) */
  zone: { x: number; y: number; w: number; h: number };
}

interface RoundConfig {
  name: string;
  /** Unique key for the body part */
  bodyPart: string;
  /** SVG viewBox */
  viewBox: string;
  /** The 5 differences */
  differences: Difference[];
  /** Render the base SVG paths (all visible in left panel) */
  renderBase: (highlighted: Set<number>) => React.ReactNode;
  /** Render the modified SVG (missing/changed elements; right panel) */
  renderModified: (highlighted: Set<number>) => React.ReactNode;
}

// ── SVG Paths & Drawing Helpers ──

const teal = "#008C95";
const charcoal = "#2D2D2D";
const lightGrey = "#E5E5E5";
const boneFill = "#F5F5F5";
const boneStroke = "#2D2D2D";

// ── Round 1: Hand X-Ray ──

function HandBase(highlighted: Set<number>) {
  const hl = (id: number) => highlighted.has(id);
  return (
    <g>
      {/* Wrist bones */}
      <rect x="70" y="190" width="60" height="30" rx="5" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Palm */}
      <rect x="72" y="130" width="56" height="65" rx="8" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Thumb */}
      <path d="M72 170 L50 155 L40 140" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <rect x="38" y="128" width="22" height="10" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="48" y="142" width="20" height="8" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Index finger */}
      <rect x="80" y="92" width="10" height="40" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="80" y="70" width="10" height="24" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="80" y="52" width="10" height="20" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Middle finger */}
      <rect x="95" y="86" width="10" height="46" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="95" y="60" width="10" height="28" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="95" y="40" width="10" height="22" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Ring finger */}
      <rect x="110" y="90" width="10" height="42" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="110" y="68" width="10" height="24" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="110" y="48" width="10" height="22" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Pinky */}
      <rect x="124" y="105" width="8" height="28" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="124" y="86" width="8" height="22" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="124" y="68" width="8" height="20" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Joint lines */}
      <line x1="80" y1="115" x2="90" y2="115" stroke={boneStroke} strokeWidth="0.8" />
      <line x1="95" y1="110" x2="105" y2="110" stroke={boneStroke} strokeWidth="0.8" />
      <line x1="110" y1="112" x2="120" y2="112" stroke={boneStroke} strokeWidth="0.8" />
    </g>
  );
}

function HandModified(highlighted: Set<number>) {
  const hl = (id: number) => highlighted.has(id);
  return (
    <g>
      {/* Wrist bones - Diff #1: extra bone spur */}
      <rect x="70" y="190" width="60" height="30" rx="5" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {!hl(1) && <circle cx="65" cy="200" r="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />}
      {/* Palm */}
      <rect x="72" y="130" width="56" height="65" rx="8" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Thumb */}
      <path d="M72 170 L50 155 L40 140" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <rect x="38" y="128" width="22" height="10" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Diff #2: missing thumb phalanx segment */}
      {!hl(2) && <rect x="48" y="142" width="20" height="8" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />}
      {/* Index finger */}
      <rect x="80" y="92" width="10" height="40" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="80" y="70" width="10" height="24" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="80" y="52" width="10" height="20" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Diff #3: index finger tip bone shorter (different y) */}
      {hl(3) ? (
        <rect x="80" y="52" width="10" height="20" rx="4" fill={boneFill} stroke={teal} strokeWidth="2" />
      ) : (
        <rect x="80" y="56" width="10" height="16" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      )}
      {/* Middle finger */}
      <rect x="95" y="86" width="10" height="46" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="95" y="60" width="10" height="28" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="95" y="40" width="10" height="22" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Ring finger - Diff #4: shifted bone */}
      {hl(4) ? (
        <rect x="110" y="90" width="10" height="42" rx="4" fill={boneFill} stroke={teal} strokeWidth="2" />
      ) : (
        <rect x="112" y="88" width="10" height="44" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      )}
      <rect x="110" y="68" width="10" height="24" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="110" y="48" width="10" height="22" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {/* Pinky - Diff #5: extra line (bone spur) */}
      <rect x="124" y="105" width="8" height="28" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="124" y="86" width="8" height="22" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      <rect x="124" y="68" width="8" height="20" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      {!hl(5) && <line x1="124" y1="75" x2="120" y2="72" stroke={boneStroke} strokeWidth="1.5" strokeLinecap="round" />}
      {/* Joint lines */}
      <line x1="80" y1="115" x2="90" y2="115" stroke={boneStroke} strokeWidth="0.8" />
      <line x1="95" y1="110" x2="105" y2="110" stroke={boneStroke} strokeWidth="0.8" />
      <line x1="110" y1="112" x2="120" y2="112" stroke={boneStroke} strokeWidth="0.8" />
    </g>
  );
}

// ── Round 2: Chest X-Ray ──

function ChestBase(highlighted: Set<number>) {
  return (
    <g>
      {/* Spine */}
      <rect x="95" y="30" width="10" height="170" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Individual vertebrae */}
      {[40, 55, 70, 85, 100, 115, 130, 145, 160, 175].map((y, i) => (
        <rect key={i} x="93" y={y} width="14" height="12" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      ))}
      {/* Ribs - left */}
      <path d="M95 45 Q70 40 50 55" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 60 Q65 52 45 70" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 75 Q65 65 42 85" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 90 Q65 80 45 100" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 105 Q65 95 48 112" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 120 Q65 112 50 125" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Ribs - right */}
      <path d="M105 45 Q130 40 150 55" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 60 Q135 52 155 70" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 75 Q135 65 158 85" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 90 Q135 80 155 100" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 105 Q135 95 152 112" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 120 Q135 112 150 125" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Clavicles */}
      <path d="M95 35 Q80 28 55 30" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 35 Q120 28 145 30" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Heart shadow */}
      <ellipse cx="88" cy="130" rx="22" ry="28" fill="none" stroke={boneStroke} strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
      {/* Trachea */}
      <line x1="100" y1="15" x2="100" y2="35" stroke={boneStroke} strokeWidth="1.5" />
    </g>
  );
}

function ChestModified(highlighted: Set<number>) {
  const hl = (id: number) => highlighted.has(id);
  return (
    <g>
      {/* Spine */}
      <rect x="95" y="30" width="10" height="170" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Individual vertebrae - Diff #1: missing one vertebra */}
      {[40, 55, 70, 85, 100, 115, 130, 160, 175].map((y, i) => (
        <rect key={i} x="93" y={y} width="14" height="12" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1" />
      ))}
      {hl(1) && (
        <rect x="93" y="145" width="14" height="12" rx="3" fill={boneFill} stroke={teal} strokeWidth="2" />
      )}
      {/* Ribs - left */}
      <path d="M95 45 Q70 40 50 55" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 60 Q65 52 45 70" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Diff #2: missing 3rd left rib */}
      {!hl(2) && <path d="M95 75 Q65 65 42 85" stroke={boneStroke} strokeWidth="1.5" fill="none" />}
      <path d="M95 90 Q65 80 45 100" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 105 Q65 95 48 112" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M95 120 Q65 112 50 125" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Ribs - right */}
      <path d="M105 45 Q130 40 150 55" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 60 Q135 52 155 70" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 75 Q135 65 158 85" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Diff #3: extra right rib */}
      {!hl(3) && <path d="M105 82 Q130 78 153 88" stroke={boneStroke} strokeWidth="1.5" fill="none" />}
      <path d="M105 90 Q135 80 155 100" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 105 Q135 95 152 112" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M105 120 Q135 112 150 125" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Clavicles */}
      <path d="M95 35 Q80 28 55 30" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Diff #4: right clavicle shifted */}
      {hl(4) ? (
        <path d="M105 35 Q120 28 145 30" stroke={teal} strokeWidth="2" fill="none" />
      ) : (
        <path d="M105 38 Q120 32 145 35" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      )}
      {/* Heart shadow - Diff #5: different size */}
      {hl(5) ? (
        <ellipse cx="88" cy="130" rx="22" ry="28" fill="none" stroke={teal} strokeWidth="2" strokeDasharray="4 2" opacity="0.8" />
      ) : (
        <ellipse cx="88" cy="128" rx="18" ry="22" fill="none" stroke={boneStroke} strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
      )}
      {/* Trachea */}
      <line x1="100" y1="15" x2="100" y2="35" stroke={boneStroke} strokeWidth="1.5" />
    </g>
  );
}

// ── Round 3: Knee X-Ray ──

function KneeBase(highlighted: Set<number>) {
  return (
    <g>
      {/* Femur */}
      <rect x="80" y="20" width="40" height="70" rx="5" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      <path d="M80 35 Q70 30 75 20" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M120 35 Q130 30 125 20" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Femoral condyles */}
      <ellipse cx="88" cy="92" rx="14" ry="10" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      <ellipse cx="112" cy="92" rx="14" ry="10" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Joint space */}
      <line x1="75" y1="102" x2="125" y2="102" stroke={boneStroke} strokeWidth="1" strokeDasharray="3 2" />
      {/* Tibia */}
      <rect x="85" y="106" width="30" height="60" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Tibial plateau */}
      <rect x="82" y="104" width="36" height="8" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Fibula */}
      <rect x="118" y="112" width="14" height="50" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      <path d="M118 130 Q110 125 110 118" stroke={boneStroke} strokeWidth="1" fill="none" />
      {/* Patella */}
      <circle cx="100" cy="88" r="10" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      <circle cx="100" cy="88" r="6" fill="none" stroke={boneStroke} strokeWidth="0.8" strokeDasharray="2 2" />
    </g>
  );
}

function KneeModified(highlighted: Set<number>) {
  const hl = (id: number) => highlighted.has(id);
  return (
    <g>
      {/* Femur */}
      <rect x="80" y="20" width="40" height="70" rx="5" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      <path d="M80 35 Q70 30 75 20" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      <path d="M120 35 Q130 30 125 20" stroke={boneStroke} strokeWidth="1.5" fill="none" />
      {/* Femoral condyles - Diff #1: left condyle wider */}
      {hl(1) ? (
        <ellipse cx="88" cy="92" rx="14" ry="10" fill={boneFill} stroke={teal} strokeWidth="2" />
      ) : (
        <ellipse cx="88" cy="92" rx="18" ry="10" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      )}
      <ellipse cx="112" cy="92" rx="14" ry="10" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Joint space - Diff #2: wider joint gap */}
      {hl(2) ? (
        <line x1="75" y1="102" x2="125" y2="102" stroke={teal} strokeWidth="2" strokeDasharray="3 2" />
      ) : (
        <line x1="75" y1="108" x2="125" y2="108" stroke={boneStroke} strokeWidth="1" strokeDasharray="3 2" />
      )}
      {/* Tibia */}
      <rect x="85" y="106" width="30" height="60" rx="4" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Tibial plateau */}
      <rect x="82" y="104" width="36" height="8" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      {/* Fibula - Diff #3: fibula shifted outward */}
      {hl(3) ? (
        <rect x="118" y="112" width="14" height="50" rx="3" fill={boneFill} stroke={teal} strokeWidth="2" />
      ) : (
        <rect x="122" y="112" width="14" height="50" rx="3" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      )}
      <path d="M118 130 Q110 125 110 118" stroke={boneStroke} strokeWidth="1" fill="none" />
      {/* Patella - Diff #4: patella shifted */}
      {hl(4) ? (
        <circle cx="100" cy="88" r="10" fill={boneFill} stroke={teal} strokeWidth="2" />
      ) : (
        <circle cx="92" cy="84" r="10" fill={boneFill} stroke={boneStroke} strokeWidth="1.5" />
      )}
      <circle cx="100" cy="88" r="6" fill="none" stroke={boneStroke} strokeWidth="0.8" strokeDasharray="2 2" />
      {/* Diff #5: bone fragment near joint */}
      {!hl(5) && <circle cx="130" cy="100" r="4" fill={boneFill} stroke={boneStroke} strokeWidth="1" />}
    </g>
  );
}

// ── Round Definitions ──

const ROUNDS: RoundConfig[] = [
  {
    name: "Hand X-Ray",
    bodyPart: "hand",
    viewBox: "0 0 200 230",
    differences: [
      { id: 1, label: "Extra bone spur on wrist", zone: { x: 55, y: 190, w: 25, h: 25 } },
      { id: 2, label: "Missing thumb segment", zone: { x: 38, y: 135, w: 32, h: 22 } },
      { id: 3, label: "Shorter fingertip bone", zone: { x: 72, y: 48, w: 26, h: 30 } },
      { id: 4, label: "Shifted ring finger bone", zone: { x: 105, y: 80, w: 25, h: 60 } },
      { id: 5, label: "Bone spur on pinky", zone: { x: 110, y: 65, w: 25, h: 20 } },
    ],
    renderBase: HandBase,
    renderModified: HandModified,
  },
  {
    name: "Chest X-Ray",
    bodyPart: "chest",
    viewBox: "0 0 200 200",
    differences: [
      { id: 1, label: "Missing vertebra", zone: { x: 85, y: 140, w: 30, h: 25 } },
      { id: 2, label: "Missing rib on left", zone: { x: 38, y: 68, w: 60, h: 25 } },
      { id: 3, label: "Extra rib on right", zone: { x: 100, y: 74, w: 58, h: 22 } },
      { id: 4, label: "Shifted right clavicle", zone: { x: 100, y: 25, w: 52, h: 22 } },
      { id: 5, label: "Smaller heart shadow", zone: { x: 60, y: 100, w: 50, h: 55 } },
    ],
    renderBase: ChestBase,
    renderModified: ChestModified,
  },
  {
    name: "Knee X-Ray",
    bodyPart: "knee",
    viewBox: "0 0 200 180",
    differences: [
      { id: 1, label: "Wider left condyle", zone: { x: 65, y: 78, w: 35, h: 28 } },
      { id: 2, label: "Wider joint gap", zone: { x: 68, y: 95, w: 65, h: 22 } },
      { id: 3, label: "Fibula shifted outward", zone: { x: 112, y: 108, w: 30, h: 60 } },
      { id: 4, label: "Patella shifted down", zone: { x: 78, y: 70, w: 30, h: 30 } },
      { id: 5, label: "Extra bone fragment", zone: { x: 126, y: 92, w: 20, h: 20 } },
    ],
    renderBase: KneeBase,
    renderModified: KneeModified,
  },
];

// ── Component ──

export default function FindTheFracture() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";

  const [round, setRound] = useState(0);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [score, setScore] = useState(0);
  const [timer, setTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [rexMessage, setRexMessage] = useState("Can you spot the 5 differences?");
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [showComplete, setShowComplete] = useState(false);
  const [roundScore, setRoundScore] = useState<number | null>(null);
  const [tapFeedback, setTapFeedback] = useState<{ x: number; y: number; found: boolean } | null>(null);

  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
  const completedRef = useRef(false);

  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("spotDiffHighScore") || "0", 10);
  });

  const currentRound = ROUNDS[round];

  // Timer
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  // Track completion for points & achievements
  useEffect(() => {
    if (showComplete && !completedRef.current) {
      completedRef.current = true;
      addPoints(score);

      trackGameCompletion("spot-difference");
      const newAchievements = checkAchievements();
      if (newAchievements.length > 0) {
        setToastAchievement(newAchievements[0]);
      }

      if (score > highScore) {
        setHighScore(score);
        if (typeof window !== "undefined") {
          localStorage.setItem("spotDiffHighScore", score.toString());
        }
      }
    }
    if (!showComplete) {
      completedRef.current = false;
    }
  }, [showComplete, score, highScore]);

  const handleTap = useCallback(
    (diffId: number, e: React.MouseEvent) => {
      if (showComplete || found.has(diffId)) return;
      if (!timerRunning) setTimerRunning(true);

      const rect = (e.currentTarget as HTMLElement).closest(".panel-container")?.getBoundingClientRect();
      const x = rect ? e.clientX - rect.left : e.clientX;
      const y = rect ? e.clientY - rect.top : e.clientY;

      const newFound = new Set(found);
      newFound.add(diffId);
      setFound(newFound);

      // Score: 100 per difference
      const earned = 100;
      setScore((s) => s + earned);

      setTapFeedback({ x, y, found: true });
      setTimeout(() => setTapFeedback(null), 600);

      setRexMood("excited");
      const diffLabel = currentRound.differences.find((d) => d.id === diffId)?.label || "";
      setRexMessage(`Found it! ${diffLabel} (+${earned} pts)`);

      if (newFound.size === 5) {
        // All 5 found in this round - add bonus
        const bonus = 500;
        setScore((s) => s + bonus);
        setRoundScore(earned + bonus);

        if (round < 2) {
          setRexMessage(`All 5 found! +${bonus} bonus! Next round...`);
          setTimeout(() => {
            setRound((r) => r + 1);
            setFound(new Set());
            setTapFeedback(null);
            setRoundScore(null);
            setRexMood("happy");
            setRexMessage("Can you spot the 5 differences?");
          }, 1800);
        } else {
          // Game complete
          setTimerRunning(false);
          setShowComplete(true);
          setRexMood("excited");
          setRexMessage(`Incredible, ${playerName}! You found all fractures! 🎉`);
        }
      } else {
        setTimeout(() => {
          setRexMood("happy");
          setRexMessage(`${5 - newFound.size} more to find!`);
        }, 1500);
      }
    },
    [found, showComplete, timerRunning, round, currentRound, playerName]
  );

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const totalScore = score;

  // Stars based on time per round
  const getStars = (): number => {
    // Average time per round: faster = more stars
    const avgTime = round > 0 ? timer / (round + 1) : timer;
    if (avgTime < 20) return 3;
    if (avgTime < 45) return 2;
    return 1;
  };

  return (
    <div className="page-container max-w-2xl mx-auto">
      {/* Achievement Toast */}
      <AchievementToast
        achievement={toastAchievement}
        onDismiss={() => setToastAchievement(null)}
      />

      {/* Rex Header */}
      <div className="mb-4">
        <RexSpeechBubble message={rexMessage} mood={rexMood} />
      </div>

      {/* Score & Timer Card */}
      <div className="card mb-3 p-3 flex items-center justify-between">
        <div>
          <span className="text-xs text-mutedText uppercase font-semibold">Score</span>
          <div className="text-2xl font-bold text-primary">{totalScore.toLocaleString()}</div>
        </div>
        <div className="text-center">
          <span className="text-xs text-mutedText uppercase font-semibold">Round</span>
          <div className="text-2xl font-bold text-secondary">
            {Math.min(round + 1, 3)} of 3
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-mutedText uppercase font-semibold">Found</span>
          <div className="text-2xl font-bold text-primary">{found.size} / 5</div>
        </div>
      </div>

      {/* Timer */}
      <div className="text-center text-sm text-white/70 mb-3">
        ⏱ {formatTime(timer)}
      </div>

      {/* Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Left Panel - Original */}
        <div className="panel-container relative bg-white rounded-2xl border-2 border-lightGrey shadow-md overflow-hidden">
          <div className="absolute top-2 left-2 bg-lightGrey text-mutedText text-xs px-2 py-0.5 rounded-full z-10">
            Original
          </div>
          <svg
            viewBox={currentRound.viewBox}
            className="w-full h-auto"
            preserveAspectRatio="xMidYMid meet"
          >
            {currentRound.renderBase(found)}
          </svg>
          {/* Clickable zones */}
          {currentRound.differences.map((diff) => (
            <button
              key={`left-${diff.id}`}
              className={`absolute transition-all duration-300 ${
                found.has(diff.id)
                  ? "border-2 border-[#008C95] rounded-full bg-[#008C95]/10 animate-[scaleIn_0.3s_ease-out]"
                  : "hover:bg-[#008C95]/5"
              }`}
              style={{
                left: `${(diff.zone.x / 200) * 100}%`,
                top: `${(diff.zone.y / (currentRound.bodyPart === "knee" ? 180 : currentRound.bodyPart === "chest" ? 200 : 230)) * 100}%`,
                width: `${(diff.zone.w / 200) * 100}%`,
                height: `${(diff.zone.h / (currentRound.bodyPart === "knee" ? 180 : currentRound.bodyPart === "chest" ? 200 : 230)) * 100}%`,
              }}
              onClick={(e) => handleTap(diff.id, e)}
              aria-label={`Difference ${diff.id}`}
              disabled={found.has(diff.id) || showComplete}
            />
          ))}
          {/* Tap feedback */}
          {tapFeedback && tapFeedback.found && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: tapFeedback.x - 20,
                top: tapFeedback.y - 20,
              }}
            >
              <div className="w-10 h-10 rounded-full border-2 border-[#008C95] animate-[ping_0.6s_ease-out]" />
            </div>
          )}
        </div>

        {/* Right Panel - Modified */}
        <div className="panel-container relative bg-white rounded-2xl border-2 border-lightGrey shadow-md overflow-hidden">
          <div className="absolute top-2 left-2 bg-[#008C95]/10 text-[#008C95] text-xs px-2 py-0.5 rounded-full z-10">
            This Scan
          </div>
          <svg
            viewBox={currentRound.viewBox}
            className="w-full h-auto"
            preserveAspectRatio="xMidYMid meet"
          >
            {currentRound.renderModified(found)}
          </svg>
          {/* Same clickable zones */}
          {currentRound.differences.map((diff) => (
            <button
              key={`right-${diff.id}`}
              className={`absolute transition-all duration-300 ${
                found.has(diff.id)
                  ? "border-2 border-[#008C95] rounded-full bg-[#008C95]/10 animate-[scaleIn_0.3s_ease-out]"
                  : "hover:bg-[#008C95]/5"
              }`}
              style={{
                left: `${(diff.zone.x / 200) * 100}%`,
                top: `${(diff.zone.y / (currentRound.bodyPart === "knee" ? 180 : currentRound.bodyPart === "chest" ? 200 : 230)) * 100}%`,
                width: `${(diff.zone.w / 200) * 100}%`,
                height: `${(diff.zone.h / (currentRound.bodyPart === "knee" ? 180 : currentRound.bodyPart === "chest" ? 200 : 230)) * 100}%`,
              }}
              onClick={(e) => handleTap(diff.id, e)}
              aria-label={`Difference ${diff.id}`}
              disabled={found.has(diff.id) || showComplete}
            />
          ))}
          {tapFeedback && tapFeedback.found && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: tapFeedback.x - 20,
                top: tapFeedback.y - 20,
              }}
            >
              <div className="w-10 h-10 rounded-full border-2 border-[#008C95] animate-[ping_0.6s_ease-out]" />
            </div>
          )}
        </div>
      </div>

      {/* Round label */}
      <div className="text-center mb-4">
        <span className="inline-block px-4 py-1 bg-lightTeal text-secondary rounded-full text-sm font-semibold">
          {currentRound.name}
        </span>
      </div>

      {/* Hint */}
      <p className="text-center text-xs text-white/70 mb-6">
        Tap the differences on either panel — there are 5 subtle changes in the right scan
      </p>

      {/* Best Score */}
      {highScore > 0 && (
        <p className="text-center text-xs text-white/70 mb-4">
          🏆 Best Score: {highScore.toLocaleString()}
        </p>
      )}

      {/* Rex */}
      <div className="flex justify-center mb-20">
        <Rex className="w-10 h-10" mood={rexMood} />
      </div>

      {/* Complete Modal */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="excited" />
            <div className="text-4xl mb-2">
              {getStars() >= 3 ? "⭐⭐⭐" : getStars() >= 2 ? "⭐⭐" : "⭐"}
            </div>
            <h2 className="text-2xl font-extrabold text-primary mb-2">
              {getStars() >= 3
                ? "Radiology Expert!"
                : getStars() >= 2
                  ? "Great Eye!"
                  : "Well Done!"}
            </h2>
            <p className="text-lg text-mutedText mb-1">
              You found all 15 differences!
            </p>
            <p className="text-lg text-mutedText mb-1">
              Score:{" "}
              <span className="font-bold text-primary">
                {totalScore.toLocaleString()}
              </span>
            </p>
            <p className="text-sm text-mutedText mb-2">
              Time: {formatTime(timer)}
            </p>
            {totalScore >= highScore && totalScore > 0 && (
              <p className="text-secondary font-bold mb-4">🏆 New High Score! 🏆</p>
            )}
            <button
              className="btn-primary w-full text-lg"
              onClick={() => {
                setRound(0);
                setFound(new Set());
                setScore(0);
                setTimer(0);
                setTimerRunning(false);
                setShowComplete(false);
                setRexMessage("Can you spot the 5 differences?");
                setRexMood("happy");
              }}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
