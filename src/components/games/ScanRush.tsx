import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Rex from "~/components/Rex";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import AchievementToast from "~/components/AchievementToast";
import { addPoints } from "~/lib/points";
import {
  checkAchievements,
  trackGameCompletion,
  type Achievement,
} from "~/lib/achievements";
import { submitScore } from "~/lib/leaderboard";
import LeaderboardEntry from "~/components/LeaderboardEntry";

// ── Constants ────────────────────────────────────────────────────────────────

const ROWS = 3;
const COLS = 4;
const BAY_COUNT = ROWS * COLS; // 12 scan bays
const ROUND_SECONDS = 120; // fixed 2:00 round
const FIRST_WAVE_DELAY_MS = 800; // grace before the first wave after Start

// Scoring
const BASE_POINTS = 10; // earned per correct tap = BASE × combo × speedFactor
// speedFactor = 1 + SPEED_MAX × (1 − reactionMs/windowMs), clamped to [1, 1+SPEED_MAX].
// A tap at ~20% of the window ≈ 4.2×, at 80% ≈ 1.8×, right at the timeout edge ≈ 1×.
const SPEED_MAX = 4;
// Show the ⚡ bolt on the float when the tap earned a meaningful speed boost.
const SPEED_BOLT_FACTOR = 1.15;
// Bad tap penalty scales with the combo it breaks: −(rate × combo), floor, cap.
const BAD_PENALTY_RATE = 20;
const BAD_PENALTY_FLOOR = 20;
const BAD_PENALTY_CAP = 200;

// Difficulty ramp — everything interpolated linearly by elapsed fraction t = elapsed/120
const TIME_ON_SCREEN_START = 1100; // ms a lit bay stays up at t = 0
const TIME_ON_SCREEN_END = 500; // ms at t = 1
const WAVE_GAP_START = 300; // ms idle between waves at t = 0 (player-paced: gap runs from wave resolution)
const WAVE_GAP_END = 150; // ms at t = 1
const BAD_PROB_START = 1 / 7; // chance a lit bay is bad at t = 0
const BAD_PROB_END = 1 / 4; // chance at t = 1
const DOUBLE_AFTER_SECONDS = 60; // double bays only in the back half
const DOUBLE_CHANCE_MAX = 0.35; // chance a wave is a double at t = 1

type TileType =
  | "bone"
  | "xray-hand"
  | "xray-chest"
  | "radiation"
  | "xray-skull"
  | "ct-machine";

// All six glossy tile PNGs — the owner wants the full set in rotation.
const TILE_IMAGE: Record<TileType, string> = {
  bone: "/bone.png",
  "xray-hand": "/xray-hand.png",
  "xray-chest": "/xray-chest.png",
  radiation: "/radiation.png",
  "xray-skull": "/xray-skull.png",
  "ct-machine": "/ct-machine.png",
};

// Mirrors Bone Buster's TILE_ACCENT for the five shared tiles, plus a cyan
// accent for the sixth (ct-machine).
const TILE_ACCENT: Record<TileType, { glow: string; particle: string }> = {
  bone: { glow: "rgba(251,191,36,0.55)", particle: "#FBBF24" },
  "xray-hand": { glow: "rgba(59,130,246,0.55)", particle: "#3B82F6" },
  "xray-chest": { glow: "rgba(16,185,129,0.55)", particle: "#10B981" },
  radiation: { glow: "rgba(239,68,68,0.55)", particle: "#EF4444" },
  "xray-skull": { glow: "rgba(236,72,153,0.55)", particle: "#EC4899" },
  "ct-machine": { glow: "rgba(6,182,212,0.55)", particle: "#06B6D4" },
};

const TILE_TYPES: TileType[] = [
  "bone",
  "xray-hand",
  "xray-chest",
  "radiation",
  "xray-skull",
  "ct-machine",
];

const COMBO_THRESHOLDS = [
  { min: 5, text: "On Fire!", color: "#F97316" },
  { min: 10, text: "Unstoppable!", color: "#EAB308" },
  { min: 20, text: "Supernova!", color: "#A855F7" },
  { min: 35, text: "Radiology Legend!", color: "#008C95" },
];

const SCORE_KEY = "scanRushHighScore";

// ── Types ────────────────────────────────────────────────────────────────────

type GamePhase = "idle" | "playing" | "done";

interface Bay {
  kind: "good" | "bad" | null;
  type: TileType | null;
  state: "idle" | "lit" | "tapped" | "expired";
  expiresAt: number;
  litAt: number; // timestamp the bay lit — reaction = tapTime − litAt
  windowMs: number; // time-on-screen this bay was spawned with (its speed window)
  fxId: number; // bumped each time a bay lights so animations re-trigger
}

interface FloatFx {
  id: number;
  row: number;
  col: number;
  text: string;
  color: string;
  born: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const makeIdleBay = (): Bay => ({
  kind: null,
  type: null,
  state: "idle",
  expiresAt: 0,
  litAt: 0,
  windowMs: 0,
  fxId: 0,
});

const formatTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function comboColor(combo: number): string {
  if (combo >= 35) return "#008C95";
  if (combo >= 20) return "#A855F7";
  if (combo >= 10) return "#EAB308";
  if (combo >= 5) return "#F97316";
  return "#2D2D2D";
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScanRush() {
  // ── UI state ──
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [bays, setBays] = useState<Bay[]>(() =>
    Array.from({ length: BAY_COUNT }, makeIdleBay)
  );
  const [floats, setFloats] = useState<FloatFx[]>([]);
  const [callout, setCallout] = useState<{
    id: number;
    text: string;
    color: string;
  } | null>(null);
  const [rexMessage, setRexMessage] = useState(
    "Ready to scan? Tap the lit bays — and don't tap the red ones!"
  );
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">(
    "happy"
  );
  const [shake, setShake] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  // Rank returned by the leaderboard submit for this round (null until known).
  const [submitRank, setSubmitRank] = useState<number | null>(null);
  const [toastAchievement, setToastAchievement] =
    useState<Achievement | null>(null);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem(SCORE_KEY) || "0", 10);
  });

  // ── Game refs (authoritative state; React state mirrors for rendering) ──
  const baysRef = useRef<Bay[]>(Array.from({ length: BAY_COUNT }, makeIdleBay));
  const litRef = useRef<Set<number>>(new Set());
  const phaseRef = useRef<GamePhase>("idle");
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const floatsRef = useRef<FloatFx[]>([]);
  const startedAtRef = useRef(0);
  const endTimeRef = useRef(0);
  const nextWaveAtRef = useRef(0);
  const lastSecsLeftRef = useRef(ROUND_SECONDS);
  const fxIdRef = useRef(0);
  const floatIdRef = useRef(0);
  const calloutIdRef = useRef(0);
  const completionHandledRef = useRef(false);
  const highScoreAtStartRef = useRef(0);

  // ── Ramp helpers (linear interpolation by elapsed fraction) ──
  const timeOnScreen = (elapsed: number) =>
    lerp(
      TIME_ON_SCREEN_START,
      TIME_ON_SCREEN_END,
      clamp01(elapsed / ROUND_SECONDS)
    );
  const waveGap = (elapsed: number) =>
    lerp(WAVE_GAP_START, WAVE_GAP_END, clamp01(elapsed / ROUND_SECONDS));
  const badProb = (elapsed: number) =>
    lerp(BAD_PROB_START, BAD_PROB_END, clamp01(elapsed / ROUND_SECONDS));
  const doubleChance = (elapsed: number) =>
    elapsed < DOUBLE_AFTER_SECONDS
      ? 0
      : DOUBLE_CHANCE_MAX *
        clamp01((elapsed - DOUBLE_AFTER_SECONDS) / (ROUND_SECONDS - DOUBLE_AFTER_SECONDS));

  // ── Effects ──

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Persist high score live (mirrors Bone Buster's SCORE_KEY handling)
  useEffect(() => {
    if (score > highScore && typeof window !== "undefined") {
      setHighScore(score);
      localStorage.setItem(SCORE_KEY, score.toString());
    }
  }, [score, highScore]);

  // Completion → points + tracking + achievements (mirrors Bone Buster)
  useEffect(() => {
    if (phase !== "done") return;
    if (completionHandledRef.current) return;
    completionHandledRef.current = true;
    addPoints(score);
    trackGameCompletion("scan-rush");
    // Live leaderboard: fire-and-forget submit (submitScore self-handles the
    // player name, auto-creating a guest identity when needed — silent on
    // failure — never breaks the game).
    submitScore("scan-rush", score).then((r) => {
      if (r) setSubmitRank(r.rank);
    });
    const newAchievements = checkAchievements();
    if (newAchievements.length > 0) {
      setToastAchievement(newAchievements[0]);
    }
  }, [phase, score]);

  // ── Floating score / callout helpers ──

  const addFloat = useCallback(
    (idx: number, text: string, color: string, now: number) => {
      const f: FloatFx = {
        id: ++floatIdRef.current,
        row: Math.floor(idx / COLS),
        col: idx % COLS,
        text,
        color,
        born: now,
      };
      floatsRef.current = [...floatsRef.current, f];
      setFloats(floatsRef.current);
    },
    []
  );

  const triggerCallout = useCallback((comboVal: number) => {
    const th = COMBO_THRESHOLDS.find((t) => t.min === comboVal);
    if (!th) return;
    const id = ++calloutIdRef.current;
    setCallout({ id, text: th.text, color: th.color });
    setRexMessage(th.text);
    setRexMood("excited");
    window.setTimeout(() => {
      setCallout((prev) => (prev && prev.id === id ? null : prev));
    }, 1400);
  }, []);

  // ── Wave lifecycle ──

  const resetAllBays = useCallback((now: number) => {
    const baysArr = baysRef.current;
    for (const b of baysArr) {
      b.kind = null;
      b.type = null;
      b.state = "idle";
      b.expiresAt = 0;
      b.litAt = 0;
      b.windowMs = 0;
    }
    litRef.current.clear();
    const elapsed = (now - startedAtRef.current) / 1000;
    nextWaveAtRef.current = now + waveGap(elapsed);
    setBays([...baysArr]);
  }, []);

  const spawnWave = useCallback(() => {
    const now = Date.now();
    const elapsed = (now - startedAtRef.current) / 1000;
    const t = clamp01(elapsed / ROUND_SECONDS);
    const baysArr = baysRef.current;
    const lit = litRef.current;
    lit.clear();

    // Back half: occasionally two bays light at once (ramps 0 → 30%)
    const count = Math.random() < doubleChance(elapsed) ? 2 : 1;
    const indices: number[] = [];
    while (indices.length < count) {
      const i = Math.floor(Math.random() * BAY_COUNT);
      if (!indices.includes(i)) indices.push(i);
    }

    const pb = badProb(elapsed);
    const windowMs = timeOnScreen(elapsed);
    const expiresAt = now + windowMs;

    for (const i of indices) {
      const bay = baysArr[i];
      bay.kind = Math.random() < pb ? "bad" : "good";
      bay.type =
        bay.kind === "bad"
          ? null
          : TILE_TYPES[Math.floor(Math.random() * TILE_TYPES.length)];
      bay.state = "lit";
      bay.expiresAt = expiresAt;
      bay.litAt = now; // exact lit timestamp — reaction is measured from this
      bay.windowMs = windowMs; // the speed window this bay was spawned with
      bay.fxId = ++fxIdRef.current;
      lit.add(i);
    }
    setBays([...baysArr]);
  }, []);

  const finishGame = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    phaseRef.current = "done";
    // Resolve any still-lit bays silently
    litRef.current.clear();
    const baysArr = baysRef.current;
    for (const b of baysArr) if (b.state === "lit") b.state = "expired";
    setBays([...baysArr]);
    setTimeLeft(0);
    setIsNewBest(scoreRef.current > highScoreAtStartRef.current);
    setPhase("done");
  }, []);

  // Main loop: 50ms tick while playing
  const tick = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const now = Date.now();

    // Timer ends cleanly, even mid-wave
    if (now >= endTimeRef.current) {
      finishGame();
      return;
    }

    const secsLeft = Math.max(0, Math.ceil((endTimeRef.current - now) / 1000));
    if (secsLeft !== lastSecsLeftRef.current) {
      lastSecsLeftRef.current = secsLeft;
      setTimeLeft(secsLeft);
    }

    // Expire lit bays whose window has passed
    const baysArr = baysRef.current;
    const lit = litRef.current;
    let changed = false;
    let comboBroken = false;
    for (const idx of [...lit]) {
      const bay = baysArr[idx];
      if (bay.state === "lit" && now >= bay.expiresAt) {
        bay.state = "expired";
        if (bay.kind === "good") {
          // A missed good bay: no penalty, but the chain resets
          comboBroken = comboRef.current >= 3;
          if (comboRef.current > 0) {
            comboRef.current = 0;
            setCombo(0);
          }
        }
        lit.delete(idx);
        changed = true;
      }
    }
    if (changed) {
      if (comboBroken) {
        setRexMessage("Too slow — chain broken!");
        setRexMood("encouraging");
      }
      setBays([...baysArr]);
    }

    // Wave lifecycle: all lit bays resolved → reset → schedule next wave
    if (lit.size === 0) {
      if (baysArr.some((b) => b.state !== "idle")) {
        resetAllBays(now);
      } else if (now >= nextWaveAtRef.current) {
        spawnWave();
      }
    }

    // Prune finished floating scores
    const fl = floatsRef.current;
    if (fl.length > 0 && now - fl[0].born >= 1000) {
      const kept = fl.filter((f) => now - f.born < 1000);
      floatsRef.current = kept;
      setFloats(kept);
    }
  }, [finishGame, resetAllBays, spawnWave]);

  useEffect(() => {
    if (phase !== "playing") return;
    const iv = setInterval(tick, 50);
    return () => clearInterval(iv);
  }, [phase, tick]);

  // ── Tap handling ──

  const handleTap = useCallback(
    (idx: number) => {
      if (phaseRef.current !== "playing") return;
      const bay = baysRef.current[idx];
      if (!bay || bay.state !== "lit") return; // no double-taps / resolved bays

      const now = Date.now();
      if (bay.kind === "good" && bay.type) {
        bay.state = "tapped";
        litRef.current.delete(idx);
        const newCombo = comboRef.current + 1;
        comboRef.current = newCombo;

        // Speed-scaled scoring: reaction measured from the exact lit timestamp
        // (same timestamps the timeout logic uses), relative to this bay's window.
        const windowMs = bay.windowMs;
        const reaction = Math.min(Math.max(now - bay.litAt, 0), windowMs);
        const speedFactor = 1 + SPEED_MAX * (1 - reaction / windowMs);
        const earned = Math.round(BASE_POINTS * newCombo * speedFactor);
        scoreRef.current += earned;
        setScore(scoreRef.current);
        setCombo(newCombo);
        addFloat(
          idx,
          `+${earned}${speedFactor > SPEED_BOLT_FACTOR ? "⚡" : ""}`,
          TILE_ACCENT[bay.type].particle,
          now
        );
        triggerCallout(newCombo);
        if (newCombo >= 10) setRexMood("excited");
      } else {
        // Bad tap: penalty scales with the combo it breaks (combo still resets)
        const penalty = Math.max(
          BAD_PENALTY_FLOOR,
          Math.min(BAD_PENALTY_CAP, BAD_PENALTY_RATE * comboRef.current)
        );
        bay.state = "tapped";
        litRef.current.delete(idx);
        comboRef.current = 0;
        setCombo(0);
        scoreRef.current = Math.max(0, scoreRef.current - penalty);
        setScore(scoreRef.current);
        addFloat(idx, `−${penalty}`, "#DC2626", now);
        setShake(true);
        window.setTimeout(() => setShake(false), 450);
        setRexMessage("Ouch! That was a trap bay!");
        setRexMood("encouraging");
      }
      setBays([...baysRef.current]);
    },
    [addFloat, triggerCallout]
  );

  // ── Start / restart ──

  const startGame = useCallback(() => {
    const now = Date.now();
    const freshBays = Array.from({ length: BAY_COUNT }, makeIdleBay);
    baysRef.current = freshBays;
    litRef.current.clear();
    scoreRef.current = 0;
    comboRef.current = 0;
    floatsRef.current = [];
    lastSecsLeftRef.current = ROUND_SECONDS;
    setBays(freshBays);
    setScore(0);
    setCombo(0);
    setTimeLeft(ROUND_SECONDS);
    setFloats([]);
    setCallout(null);
    setShake(false);
    setIsNewBest(false);
    setRexMessage("GO! Tap the lit bays — don't tap the red ones!");
    setRexMood("happy");
    startedAtRef.current = now;
    endTimeRef.current = now + ROUND_SECONDS * 1000;
    nextWaveAtRef.current = now + FIRST_WAVE_DELAY_MS;
    completionHandledRef.current = false;
    setSubmitRank(null);
    highScoreAtStartRef.current =
      typeof window !== "undefined"
        ? parseInt(localStorage.getItem(SCORE_KEY) || "0", 10)
        : 0;
    phaseRef.current = "playing";
    setPhase("playing");
  }, []);

  // ── Render ──

  const progress = Math.max(
    0,
    Math.min(100, ((ROUND_SECONDS - timeLeft) / ROUND_SECONDS) * 100)
  );

  return (
    <div className="page-container max-w-lg mx-auto">
      <style>{`
        @keyframes srPopIn {
          0% { transform: scale(0.3); opacity: 0; }
          60% { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes srGlowPulse {
          0%, 100% { box-shadow: 0 0 8px var(--glow), 0 0 16px var(--glow); transform: scale(1); }
          50% { box-shadow: 0 0 16px var(--glow), 0 0 34px var(--glow); transform: scale(1.05); }
        }
        @keyframes srWarnPulse {
          0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.75), 0 0 18px rgba(239,68,68,0.5); transform: scale(1); }
          50% { box-shadow: 0 0 18px rgba(239,68,68,0.95), 0 0 36px rgba(239,68,68,0.6); transform: scale(1.06); }
        }
        @keyframes srFloatUp {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1.25); }
          30% { transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -140%) scale(1); }
        }
        @keyframes srCallout {
          0% { opacity: 0; transform: translateY(10px) scale(0.4); }
          15% { opacity: 1; transform: translateY(0) scale(1.15); }
          30% { transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-30px) scale(1); }
        }
        @keyframes srTapPop {
          0% { transform: scale(1); opacity: 1; }
          30% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(0); opacity: 0; }
        }
        @keyframes srBadFlash {
          0% { opacity: 0.9; }
          100% { opacity: 0; }
        }
      `}</style>

      <AchievementToast
        achievement={toastAchievement}
        onDismiss={() => setToastAchievement(null)}
      />

      {/* ── Rex message ── */}
      <div className="mb-3">
        <RexSpeechBubble message={rexMessage} mood={rexMood} />
      </div>

      {/* ── HUD: score + time + combo + round progress ── */}
      <div className="card mb-3 p-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-mutedText font-bold">
              Score
            </p>
            <p className="text-4xl font-extrabold text-primary tabular-nums leading-none">
              {score.toLocaleString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-mutedText font-bold">
              Time
            </p>
            <p
              className={`text-4xl font-extrabold tabular-nums leading-none ${
                timeLeft <= 10
                  ? "text-red-500 animate-pulse"
                  : timeLeft <= 30
                    ? "text-red-500"
                    : "text-secondary"
              }`}
            >
              {formatTime(timeLeft)}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center min-w-[52px] rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums text-white transition-opacity duration-200"
            style={{ backgroundColor: comboColor(combo), opacity: combo > 0 ? 1 : 0.45 }}
          >
            ×{combo}
          </span>
          <div className="flex-1 h-1.5 bg-lightTeal rounded-full overflow-hidden">
            <div
              className="h-full bg-secondary rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Start panel ── */}
      {phase === "idle" && (
        <div className="card mb-3 text-center">
          <h2 className="text-lg font-extrabold text-primary mb-1">⚡ Scan Rush</h2>
          <p className="text-sm text-mutedText mb-3">
            Tap the lit bays to score — fast! Chain taps for combos. Don't tap
            the red ⚠ bays!
          </p>
          <button className="btn-primary w-full text-lg" onClick={startGame}>
            Start Rush
          </button>
        </div>
      )}

      {/* ── Board ── */}
      <div className={`relative ${shake ? "animate-[shake_0.4s_ease-out]" : ""}`}>
        <div className="grid grid-cols-4 gap-2 p-2 bg-white rounded-2xl shadow-lg border border-lightTeal/50">
          {bays.map((bay, idx) => {
            const isLit = bay.state === "lit";
            const isTapped = bay.state === "tapped";
            const accent = bay.type ? TILE_ACCENT[bay.type] : null;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleTap(idx)}
                disabled={phase !== "playing"}
                aria-label={
                  isLit
                    ? bay.kind === "good"
                      ? `Scan bay ${idx + 1}: tap it!`
                      : `Scan bay ${idx + 1}: trap — do not tap`
                    : `Scan bay ${idx + 1}`
                }
                className="relative aspect-square rounded-xl overflow-hidden select-none touch-manipulation transition-transform duration-75 active:scale-95 disabled:cursor-default"
                style={{
                  background: "linear-gradient(180deg,#EEF3F6,#DFE7EC)",
                  boxShadow: "inset 0 2px 4px rgba(31,41,55,0.08)",
                }}
              >
                {/* Lit good bay: glossy tile + accent glow */}
                {isLit && bay.kind === "good" && bay.type && accent && (
                  <span
                    key={bay.fxId}
                    className="absolute inset-0"
                    style={{ animation: "srPopIn 0.18s ease-out" }}
                  >
                    <img
                      src={TILE_IMAGE[bay.type]}
                      alt=""
                      width={64}
                      height={64}
                      draggable={false}
                      className="w-[76%] h-[76%] object-contain rounded-lg pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                      style={
                        {
                          "--glow": accent.glow,
                          animation: "srGlowPulse 0.55s ease-in-out infinite",
                        } as CSSProperties
                      }
                    />
                  </span>
                )}

                {/* Lit bad bay: red glossy warning tile */}
                {isLit && bay.kind === "bad" && (
                  <span
                    key={bay.fxId}
                    className="absolute inset-0"
                    style={{ animation: "srPopIn 0.18s ease-out" }}
                  >
                    <span
                      className="absolute inset-0 flex items-center justify-center rounded-xl"
                      style={{
                        background:
                          "radial-gradient(circle at 32% 28%, #FCA5A5 0%, #EF4444 48%, #B91C1C 100%)",
                        boxShadow: "inset 0 2px 8px rgba(0,0,0,0.35)",
                        animation: "srWarnPulse 0.5s ease-in-out infinite",
                      }}
                    >
                      <span
                        className="absolute"
                        style={{
                          top: "10%",
                          left: "12%",
                          width: "52%",
                          height: "26%",
                          borderRadius: "9999px",
                          background:
                            "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.2))",
                          transform: "rotate(-20deg)",
                        }}
                      />
                      <span className="text-[26px] leading-none font-bold drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]">
                        ⚠️
                      </span>
                    </span>
                  </span>
                )}

                {/* Tapped good: pop and vanish */}
                {isTapped && bay.kind === "good" && bay.type && (
                  <img
                    src={TILE_IMAGE[bay.type]}
                    alt=""
                    width={64}
                    height={64}
                    draggable={false}
                    className="w-[76%] h-[76%] object-contain rounded-lg pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ animation: "srTapPop 0.35s ease-out forwards" }}
                  />
                )}

                {/* Tapped bad: red flash */}
                {isTapped && bay.kind === "bad" && (
                  <span
                    className="absolute inset-0 rounded-xl"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(239,68,68,0.95), rgba(185,28,28,0.75))",
                      animation: "srBadFlash 0.4s ease-out forwards",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Combo callout */}
        {callout && (
          <div
            key={callout.id}
            className="absolute inset-x-0 top-8 z-20 pointer-events-none flex justify-center"
          >
            <span
              className="font-extrabold text-4xl drop-shadow-lg"
              style={{
                color: callout.color,
                animation: "srCallout 1.4s ease-out forwards",
              }}
            >
              {callout.text}
            </span>
          </div>
        )}

        {/* Floating +N / −N */}
        {floats.map((f) => (
          <span
            key={f.id}
            className="absolute z-30 pointer-events-none font-extrabold tabular-nums"
            style={{
              left: `${((f.col + 0.5) / COLS) * 100}%`,
              top: `${((f.row + 0.5) / ROWS) * 100}%`,
              color: f.color,
              fontSize: f.text.length > 6 ? "1.05rem" : "1.4rem",
              whiteSpace: "nowrap",
              textShadow: "0 2px 6px rgba(0,0,0,0.35)",
              animation: "srFloatUp 0.9s ease-out forwards",
            }}
          >
            {f.text}
          </span>
        ))}
      </div>

      {/* ── Rex cheering ── */}
      {phase === "playing" && (
        <div className="flex justify-center mt-4">
          <Rex className="w-10 h-10" mood={rexMood} />
        </div>
      )}

      {/* ── Result modal ── */}
      {phase === "done" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="excited" />
            <h2 className="text-2xl font-extrabold text-primary mb-1">
              Time's Up!
            </h2>
            <p className="text-sm text-mutedText mb-2">Final Score</p>
            <p className="text-5xl font-extrabold text-primary mb-3 tabular-nums">
              {score.toLocaleString()}
            </p>
            {isNewBest && (
              <p className="text-sm font-bold text-secondary mb-4 animate-pulse">
                🏆 New Best Score!
              </p>
            )}
            <LeaderboardEntry
              game="scan-rush"
              score={score}
              rank={submitRank}
              onRank={setSubmitRank}
            />
            <button className="btn-primary w-full text-lg" onClick={startGame}>
              🔄 Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
