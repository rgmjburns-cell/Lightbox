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

interface QuizQuestion {
  bodyPart: string;
  correctScan: string;
  options: string[];
  svgPath: string;
}

type GamePhase = "intro" | "playing" | "roundComplete" | "complete";

// ── Question Bank ──
// All questions have ONE unambiguously correct answer.
// No breast/mammogram content.

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    bodyPart: "Skull / Head",
    correctScan: "CT Scan",
    options: ["CT Scan", "Ultrasound", "X-Ray", "MRI"],
    svgPath: "skull",
  },
  {
    bodyPart: "Chest / Lungs",
    correctScan: "Chest X-Ray",
    options: ["Chest X-Ray", "MRI", "Ultrasound", "CT Scan"],
    svgPath: "chest",
  },
  {
    bodyPart: "Broken Arm Bone",
    correctScan: "X-Ray",
    options: ["MRI", "Ultrasound", "X-Ray", "PET Scan"],
    svgPath: "arm",
  },
  {
    bodyPart: "Unborn Baby (Pregnancy)",
    correctScan: "Ultrasound",
    options: ["X-Ray", "Ultrasound", "CT Scan", "MRI"],
    svgPath: "baby",
  },
  {
    bodyPart: "Brain (detailed soft tissue)",
    correctScan: "MRI",
    options: ["CT Scan", "X-Ray", "MRI", "Ultrasound"],
    svgPath: "brain",
  },
  {
    bodyPart: "Knee Joint (ligaments & cartilage)",
    correctScan: "MRI",
    options: ["X-Ray", "Ultrasound", "MRI", "CT Scan"],
    svgPath: "knee",
  },
  {
    bodyPart: "Spine / Back (discs & nerves)",
    correctScan: "MRI",
    options: ["X-Ray", "CT Scan", "Ultrasound", "MRI"],
    svgPath: "spine",
  },
  {
    bodyPart: "Dental / Teeth",
    correctScan: "X-Ray",
    options: ["Ultrasound", "MRI", "X-Ray", "CT Scan"],
    svgPath: "teeth",
  },
  {
    bodyPart: "Heart (using sound waves)",
    correctScan: "Echocardiogram",
    options: ["X-Ray", "CT Scan", "Echocardiogram", "Angiography"],
    svgPath: "heart",
  },
  {
    bodyPart: "Blood Vessels (needs contrast dye)",
    correctScan: "Angiography",
    options: ["X-Ray", "Angiography", "Ultrasound", "MRI"],
    svgPath: "vessels",
  },
  {
    bodyPart: "Abdomen / Stomach (checking organs)",
    correctScan: "Ultrasound",
    options: ["X-Ray", "CT Scan", "Ultrasound", "MRI"],
    svgPath: "abdomen",
  },
  {
    bodyPart: "Hip Bone after a fall",
    correctScan: "X-Ray",
    options: ["MRI", "X-Ray", "CT Scan", "Ultrasound"],
    svgPath: "pelvis",
  },
  {
    bodyPart: "Foot / Ankle (suspected fracture)",
    correctScan: "X-Ray",
    options: ["Ultrasound", "X-Ray", "MRI", "CT Scan"],
    svgPath: "foot",
  },
  {
    bodyPart: "Shoulder Joint (rotator cuff tear)",
    correctScan: "MRI",
    options: ["X-Ray", "Ultrasound", "MRI", "CT Scan"],
    svgPath: "shoulder",
  },
  {
    bodyPart: "Blood flow in neck arteries",
    correctScan: "Doppler Ultrasound",
    options: ["X-Ray", "CT Scan", "Doppler Ultrasound", "MRI"],
    svgPath: "vessels",
  },
];

const ROUND_SIZE = 10;

// ── Simple SVG Body Part Illustrations ──

function BodyPartSVG({ part }: { part: string }) {
  const baseStyles: React.CSSProperties = {
    width: "100%",
    maxWidth: "160px",
    height: "auto",
  };

  switch (part) {
    case "skull":
      return (
        <svg viewBox="0 0 100 100" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="#2D2D2D" />
          <ellipse cx="50" cy="45" rx="25" ry="23" fill="white" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <ellipse cx="50" cy="50" rx="3" ry="2" fill="#2D2D2D" />
          <line x1="50" y1="73" x2="50" y2="95" stroke="#2D2D2D" strokeWidth="2" />
        </svg>
      );
    case "chest":
      return (
        <svg viewBox="0 0 100 100" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <rect x="30" y="75" width="40" height="20" rx="5" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <path d="M 30 60 Q 50 55 70 60" stroke="#008C95" strokeWidth="1.5" fill="none" opacity="0.5" />
          <path d="M 30 66 Q 50 61 70 66" stroke="#008C95" strokeWidth="1.5" fill="none" opacity="0.5" />
          <path d="M 30 72 Q 50 67 70 72" stroke="#008C95" strokeWidth="1.5" fill="none" opacity="0.5" />
        </svg>
      );
    case "arm":
      return (
        <svg viewBox="0 0 100 160" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <rect x="55" y="75" width="18" height="50" rx="9" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <line x1="58" y1="95" x2="70" y2="100" stroke="#FF4444" strokeWidth="2" strokeDasharray="4,2" />
        </svg>
      );
    case "baby":
      return (
        <svg viewBox="0 0 100 120" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 45 55 Q 50 60 55 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <ellipse cx="50" cy="85" rx="22" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <ellipse cx="50" cy="85" rx="10" ry="14" fill="#E0F5F7" stroke="#008C95" strokeWidth="1.5" />
          <circle cx="47" cy="82" r="2" fill="#2D2D2D" />
          <circle cx="53" cy="82" r="2" fill="#2D2D2D" />
        </svg>
      );
    case "brain":
      return (
        <svg viewBox="0 0 100 100" style={baseStyles}>
          <ellipse cx="50" cy="50" rx="28" ry="32" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <path d="M 30 35 Q 40 30 50 38 Q 60 46 70 33" stroke="#008C95" strokeWidth="2" fill="none" />
          <path d="M 28 48 Q 38 42 48 50 Q 58 58 72 45" stroke="#008C95" strokeWidth="2" fill="none" />
          <path d="M 30 60 Q 40 55 50 62 Q 60 69 68 58" stroke="#008C95" strokeWidth="2" fill="none" />
          <line x1="50" y1="82" x2="50" y2="95" stroke="#2D2D2D" strokeWidth="2" />
        </svg>
      );
    case "knee":
      return (
        <svg viewBox="0 0 100 140" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <rect x="42" y="75" width="16" height="25" rx="8" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="50" cy="105" r="10" fill="#E0F5F7" stroke="#008C95" strokeWidth="2" />
          <line x1="42" y1="100" x2="58" y2="110" stroke="#2D2D2D" strokeWidth="1.5" />
          <rect x="41" y="115" width="8" height="20" rx="4" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <rect x="51" y="115" width="8" height="20" rx="4" fill="white" stroke="#2D2D2D" strokeWidth="2" />
        </svg>
      );
    case "spine":
      return (
        <svg viewBox="0 0 100 160" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          {[75, 85, 95, 105, 115, 125, 135, 145].map((y, i) => (
            <rect key={i} x="44" y={y} width="12" height="8" rx="2" fill="#E0F5F7" stroke="#008C95" strokeWidth="1.5" />
          ))}
          <line x1="50" y1="75" x2="50" y2="152" stroke="#2D2D2D" strokeWidth="1" />
        </svg>
      );
    case "teeth":
      return (
        <svg viewBox="0 0 100 100" style={baseStyles}>
          <ellipse cx="50" cy="50" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="45" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="45" r="5" fill="#2D2D2D" />
          <ellipse cx="50" cy="60" rx="18" ry="10" fill="#2D2D2D" />
          {[36, 42, 48, 54, 60, 66].map((x, i) => (
            <rect key={`u${i}`} x={x} y="57" width="4" height="6" rx="1" fill="white" />
          ))}
          {[36, 42, 48, 54, 60, 66].map((x, i) => (
            <rect key={`l${i}`} x={x} y="63" width="4" height="6" rx="1" fill="white" />
          ))}
          <line x1="50" y1="78" x2="50" y2="95" stroke="#2D2D2D" strokeWidth="2" />
        </svg>
      );
    case "vessels":
      return (
        <svg viewBox="0 0 100 100" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <path d="M 50 72 C 50 68 42 68 42 72 C 42 78 50 84 50 84 C 50 84 58 78 58 72 C 58 68 50 68 50 72Z" fill="#FF6B6B" stroke="#CC4444" strokeWidth="1.5" />
          <path d="M 50 72 Q 40 80 25 85" stroke="#CC4444" strokeWidth="2" fill="none" />
          <path d="M 50 72 Q 60 80 75 85" stroke="#CC4444" strokeWidth="2" fill="none" />
          <path d="M 50 72 Q 45 82 40 92" stroke="#CC4444" strokeWidth="2" fill="none" />
          <path d="M 50 72 Q 55 82 60 92" stroke="#CC4444" strokeWidth="2" fill="none" />
        </svg>
      );
    case "abdomen":
      return (
        <svg viewBox="0 0 100 120" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <ellipse cx="50" cy="85" rx="22" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <ellipse cx="50" cy="78" rx="10" ry="8" fill="#E0F5F7" stroke="#008C95" strokeWidth="1" />
          <circle cx="40" cy="90" r="5" fill="#E0F5F7" stroke="#008C95" strokeWidth="1" />
          <circle cx="60" cy="88" r="4" fill="#E0F5F7" stroke="#008C95" strokeWidth="1" />
        </svg>
      );
    case "pelvis":
      return (
        <svg viewBox="0 0 100 140" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <rect x="42" y="75" width="16" height="20" rx="8" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <path d="M 25 100 Q 30 85 50 88 Q 70 85 75 100 L 65 105 Q 50 108 35 105 Z" fill="#E0F5F7" stroke="#008C95" strokeWidth="2" />
          <circle cx="38" cy="100" r="6" fill="white" stroke="#2D2D2D" strokeWidth="1.5" />
          <circle cx="62" cy="100" r="6" fill="white" stroke="#2D2D2D" strokeWidth="1.5" />
        </svg>
      );
    case "foot":
      return (
        <svg viewBox="0 0 100 140" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <rect x="42" y="75" width="16" height="30" rx="8" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <ellipse cx="35" cy="118" rx="14" ry="8" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <ellipse cx="65" cy="118" rx="14" ry="8" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="38" cy="108" r="4" fill="#E0F5F7" stroke="#008C95" strokeWidth="1.5" />
          <circle cx="62" cy="108" r="4" fill="#E0F5F7" stroke="#008C95" strokeWidth="1.5" />
        </svg>
      );
    case "heart":
      return (
        <svg viewBox="0 0 100 100" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <path d="M 50 70 C 50 64 38 64 38 70 C 38 80 50 90 50 90 C 50 90 62 80 62 70 C 62 64 50 64 50 70Z" fill="#FF6B6B" stroke="#CC4444" strokeWidth="2" />
          <path d="M 30 70 Q 28 75 30 80" stroke="#008C95" strokeWidth="1.5" fill="none" opacity="0.6" />
          <path d="M 27 67 Q 24 75 27 83" stroke="#008C95" strokeWidth="1.5" fill="none" opacity="0.4" />
        </svg>
      );
    case "shoulder":
      return (
        <svg viewBox="0 0 100 120" style={baseStyles}>
          <ellipse cx="50" cy="45" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <circle cx="40" cy="42" r="5" fill="#2D2D2D" />
          <circle cx="60" cy="42" r="5" fill="#2D2D2D" />
          <path d="M 43 55 Q 50 62 57 55" stroke="#2D2D2D" strokeWidth="2" fill="none" />
          <circle cx="30" cy="75" r="10" fill="#E0F5F7" stroke="#008C95" strokeWidth="2" />
          <circle cx="70" cy="75" r="10" fill="#E0F5F7" stroke="#008C95" strokeWidth="2" />
          <rect x="20" y="85" width="18" height="30" rx="9" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <rect x="62" y="85" width="18" height="30" rx="9" fill="white" stroke="#2D2D2D" strokeWidth="2" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 100 100" style={baseStyles}>
          <ellipse cx="50" cy="50" rx="30" ry="28" fill="white" stroke="#2D2D2D" strokeWidth="2" />
          <text x="50" y="55" textAnchor="middle" fontSize="12" fill="#2D2D2D">?</text>
        </svg>
      );
  }
}

// ── Helpers ──

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Component ──

export default function WhatsThatScan() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";

  const [phase, setPhase] = useState<GamePhase>("intro");
  const [round, setRound] = useState(1);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

  const [score, setScore] = useState(0);
  const [roundScores, setRoundScores] = useState<number[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [timer, setTimer] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [feedbackMsg, setFeedbackMsg] = useState("");

  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
  const completedRef = useRef(false);

  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("quizHighScore") || "0", 10);
  });

  const totalRounds = 3;
  const currentQuestion = questions[questionIndex] || null;

  // Start game
  const startGame = useCallback(() => {
    const selected = shuffleArray(QUIZ_QUESTIONS).slice(0, ROUND_SIZE);
    setQuestions(selected);
    setRound(1);
    setQuestionIndex(0);
    setScore(0);
    setRoundScores([]);
    setSelectedAnswer(null);
    setIsCorrect(null);
    setTimer(0);
    setQuestionStartTime(Date.now());
    setTimerRunning(true);
    setPhase("playing");
    setRexMood("happy");
    setFeedbackMsg("");
  }, []);

  // Timer
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  // Track completion
  useEffect(() => {
    if (phase === "complete" && !completedRef.current) {
      completedRef.current = true;
      addPoints(score);

      trackGameCompletion("whats-that-scan");
      const newAchievements = checkAchievements();
      if (newAchievements.length > 0) {
        setToastAchievement(newAchievements[0]);
      }
    }
    if (phase !== "complete") {
      completedRef.current = false;
    }
  }, [phase, score]);

  // Handle answer selection
  const handleAnswer = (answer: string) => {
    if (selectedAnswer !== null || !currentQuestion) return;

    setSelectedAnswer(answer);
    const correct = answer === currentQuestion.correctScan;
    setIsCorrect(correct);

    // Calculate speed bonus
    const responseTime = (Date.now() - questionStartTime) / 1000;
    const speedBonus = Math.max(0, Math.floor(50 - responseTime * 5));
    const earned = correct ? 100 + speedBonus : 0;

    if (correct) {
      setScore((s) => s + earned);
      setRexMood("excited");
      setFeedbackMsg(`Correct! +${earned} pts`);
    } else {
      setRexMood("encouraging");
      setFeedbackMsg(`The correct answer was: ${currentQuestion.correctScan}`);
    }

    // Move to next after delay
    setTimeout(() => {
      if (questionIndex + 1 < questions.length) {
        setQuestionIndex((i) => i + 1);
        setSelectedAnswer(null);
        setIsCorrect(null);
        setFeedbackMsg("");
        setQuestionStartTime(Date.now());
        setRexMood("happy");
      } else {
        // End of round
        setRoundScores((prev) => [...prev, score]);
        if (round < totalRounds) {
          setPhase("roundComplete");
        } else {
          setTimerRunning(false);
          const finalScore = score;
          if (finalScore > highScore) {
            setHighScore(finalScore);
            if (typeof window !== "undefined") {
              localStorage.setItem("quizHighScore", finalScore.toString());
            }
          }
          setPhase("complete");
          setRexMood("excited");
        }
      }
    }, 1500);
  };

  // Next round
  const nextRound = () => {
    const newQuestions = shuffleArray(QUIZ_QUESTIONS).slice(0, ROUND_SIZE);
    setQuestions(newQuestions);
    setRound((r) => r + 1);
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setIsCorrect(null);
    setQuestionStartTime(Date.now());
    setTimerRunning(true);
    setPhase("playing");
    setRexMood("happy");
    setFeedbackMsg("");
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── Intro Screen ──
  if (phase === "intro") {
    return (
      <div className="page-container max-w-lg mx-auto flex flex-col items-center text-center">
        <Rex className="w-24 h-24 mb-6" mood="happy" />
        <h2 className="text-2xl font-bold text-primary mb-2">What's That Scan?</h2>
        <p className="text-mutedText mb-2">
          Test your radiology knowledge! Identify which scan type is used for each body part.
        </p>
        <p className="text-sm text-mutedText mb-6">
          3 rounds × 10 questions. Score 100 pts per correct answer + speed bonus!
        </p>
        {highScore > 0 && (
          <p className="text-sm text-secondary font-bold mb-4">
            🏆 Best Score: {highScore.toLocaleString()}
          </p>
        )}
        <button className="btn-primary text-lg px-8" onClick={startGame}>
          Start Quiz
        </button>
        <div className="flex justify-center mt-8">
          <Rex className="w-10 h-10" mood="happy" />
        </div>
      </div>
    );
  }

  // ── Playing ──
  if (phase === "playing" && currentQuestion) {
    return (
      <div className="page-container max-w-lg mx-auto">
        <AchievementToast
          achievement={toastAchievement}
          onDismiss={() => setToastAchievement(null)}
        />

        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <Rex className="w-10 h-10" mood={rexMood} />
          <div className="bg-white rounded-2xl px-4 py-2 shadow-sm text-sm text-primary font-medium">
            {feedbackMsg || `Round ${round}/${totalRounds} — Question ${questionIndex + 1}/${questions.length}`}
          </div>
        </div>

        {/* Score & Timer */}
        <div className="card mb-3 p-3 flex items-center justify-between">
          <div>
            <span className="text-xs text-mutedText uppercase font-semibold">Score</span>
            <div className="text-2xl font-bold text-primary">{score.toLocaleString()}</div>
          </div>
          <div className="text-center">
            <span className="text-xs text-mutedText uppercase font-semibold">Round</span>
            <div className="text-2xl font-bold text-secondary">{round}/{totalRounds}</div>
          </div>
          <div className="text-right">
            <span className="text-xs text-mutedText uppercase font-semibold">Q</span>
            <div className="text-2xl font-bold text-primary">{questionIndex + 1}/{questions.length}</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4 h-1.5 bg-lightGrey rounded-full overflow-hidden">
          <div
            className="h-full bg-secondary rounded-full transition-all duration-300"
            style={{ width: `${((questionIndex) / questions.length) * 100}%` }}
          />
        </div>

        {/* Body Part Illustration */}
        <div className="card mb-4 p-6 flex flex-col items-center">
          <BodyPartSVG part={currentQuestion.svgPath} />
          <h3 className="text-lg font-bold text-primary mt-4">
            What type of scan is used for the{" "}
            <span className="text-secondary">{currentQuestion.bodyPart}</span>?
          </h3>
        </div>

        {/* Answer Options */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {currentQuestion.options.map((option) => {
            let btnStyle = "bg-white border-lightTeal text-primary hover:bg-lightTeal/20";
            if (selectedAnswer !== null) {
              if (option === currentQuestion.correctScan) {
                btnStyle = "bg-teal-100 border-secondary text-secondary font-bold";
              } else if (option === selectedAnswer && !isCorrect) {
                btnStyle = "bg-red-50 border-red-300 text-red-500";
              } else {
                btnStyle = "bg-white border-lightTeal/50 text-mutedText opacity-50";
              }
            }
            return (
              <button
                key={option}
                className={`rounded-xl border-2 p-4 text-sm font-semibold transition-all active:scale-95 ${btnStyle} ${
                  selectedAnswer !== null ? "pointer-events-none" : ""
                }`}
                onClick={() => handleAnswer(option)}
                disabled={selectedAnswer !== null}
              >
                {option}
              </button>
            );
          })}
        </div>

        {/* Rex */}
        <div className="flex justify-center mb-20">
          <Rex className="w-10 h-10" mood={rexMood} />
        </div>
      </div>
    );
  }

  // ── Round Complete ──
  if (phase === "roundComplete") {
    return (
      <div className="page-container max-w-lg mx-auto flex flex-col items-center text-center">
        <Rex className="w-24 h-24 mb-4" mood="excited" />
        <h2 className="text-2xl font-bold text-primary mb-2">Round {round} Complete!</h2>
        <p className="text-lg text-mutedText mb-1">
          Score so far: <span className="font-bold text-primary">{score.toLocaleString()}</span>
        </p>
        <p className="text-sm text-mutedText mb-6">
          {round + 1 <= totalRounds ? `Round ${round + 1} of ${totalRounds} coming up!` : "Final round done!"}
        </p>
        <button className="btn-primary text-lg px-8" onClick={nextRound}>
          {round < totalRounds ? `Start Round ${round + 1}` : "See Results"}
        </button>
        <div className="flex justify-center mt-8">
          <Rex className="w-10 h-10" mood="happy" />
        </div>
      </div>
    );
  }

  // ── Complete ──
  return (
    <div className="page-container max-w-lg mx-auto">
      <AchievementToast
        achievement={toastAchievement}
        onDismiss={() => setToastAchievement(null)}
      />

      <div className="flex flex-col items-center text-center">
        <Rex className="w-24 h-24 mb-4" mood="excited" />
        <h2 className="text-2xl font-bold text-primary mb-2">Quiz Complete!</h2>
        <p className="text-lg text-mutedText mb-1">
          Final Score: <span className="font-bold text-primary">{score.toLocaleString()}</span>
        </p>
        <p className="text-sm text-mutedText mb-2">Time: {formatTime(timer)}</p>

        {score >= highScore && score > 0 && (
          <p className="text-secondary font-bold mb-4">🏆 New High Score! 🏆</p>
        )}

        {/* Round Breakdown */}
        <div className="card w-full mb-4 p-4">
          <h3 className="text-sm font-bold text-secondary mb-2">Round Breakdown</h3>
          <div className="flex justify-center gap-4">
            {roundScores.map((rs, i) => (
              <div key={i} className="text-center">
                <div className="text-xs text-mutedText">Round {i + 1}</div>
                <div className="text-lg font-bold text-primary">{rs.toLocaleString()}</div>
              </div>
            ))}
            {roundScores.length < totalRounds && (
              <div className="text-center">
                <div className="text-xs text-mutedText">Round {roundScores.length + 1}</div>
                <div className="text-lg font-bold text-primary">{score.toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>

        <button className="btn-primary w-full text-lg mb-3" onClick={startGame}>
          Play Again
        </button>
      </div>

      <div className="flex justify-center mt-6 mb-20">
        <Rex className="w-10 h-10" mood="happy" />
      </div>
    </div>
  );
}
