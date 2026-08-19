import { useState, useEffect, useCallback, useRef } from "react";
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
  type Achievement,
} from "~/lib/achievements";
// ── Level Config ──

interface LevelDef {
  bpm: number;
  label: string;
}

const LEVELS: LevelDef[] = [
  { bpm: 60, label: "Resting" },
  { bpm: 75, label: "Walking" },
  { bpm: 90, label: "Jogging" },
  { bpm: 105, label: "Sprinting" },
];

const BEAT_INTERVAL_MULTIPLIER = 1.3;

const OBSTACLES_PER_LEVEL = 20;
const CANVAS_HEIGHT = 400;

// ── Physics ──

const GRAVITY = 3000; // px/s²
const JUMP_VELOCITY = -850; // px/s upward (clears obstacles comfortably)
const PLAYER_X_RATIO = 0.25; // player at 25% from left
const GROUND_Y_RATIO = 0.82; // ground line
const PLAYER_RADIUS = 16;
const OBSTACLE_HALF_WIDTH = 12;
const OBSTACLE_HEIGHT = 72;

// ── Types ──

type GamePhase = "idle" | "countdown" | "playing" | "levelComplete" | "gameComplete";

interface Obstacle {
  x: number; // center x of obstacle
  cleared: boolean;
  perfect: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
}

// ── Component ──

export default function PulsePop() {
  const playerName =
    typeof window !== "undefined" ? getPlayerName() : "Player";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const heartImgRef = useRef<HTMLImageElement | null>(null);

  // ── Game state refs (mutable, avoid re-render pressure) ──
  const g = useRef({
    phase: "idle" as GamePhase,
    playerY: 0,
    playerVY: 0,
    obstacles: [] as Obstacle[],
    particles: [] as Particle[],
    level: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    cleared: 0,
    perfects: 0,
    misses: 0,
    obstacleTimer: 0,
    lastTimestamp: 0,
    groundY: 0,
    playerX: 0,
    canvasW: 800,
    canvasH: CANVAS_HEIGHT,
    flashText: "",
    flashTimer: 0,
    isOnGround: true,
    beatInterval: 1,
    scrollSpeed: 0,
    currentMinPlayerY: 0, // tracks highest point player reached this obstacle cycle
  });

  // ── React UI state ──
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [perfects, setPerfects] = useState(0);
  const [misses, setMisses] = useState(0);
  const [countdownVal, setCountdownVal] = useState(3);
  const [finalScore, setFinalScore] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);

  const [rexMessage, setRexMessage] = useState(
    "Tap to jump over the ECG spikes!"
  );
  const [rexMood, setRexMood] = useState<
    "happy" | "excited" | "encouraging"
  >("happy");

  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(
    null
  );
  const completedRef = useRef(false);

  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("pulsePopHighScore") || "0", 10);
  });
  const [submitRank, setSubmitRank] = useState<number | null>(null);

  // ── Sync snapshots of key values for UI ──
  const uiRef = useRef({ score: 0, combo: 0, cleared: 0, perfects: 0, misses: 0 });
  const syncUI = useCallback(() => {
    const gv = g.current;
    if (
      uiRef.current.score !== gv.score ||
      uiRef.current.combo !== gv.combo ||
      uiRef.current.cleared !== gv.cleared ||
      uiRef.current.perfects !== gv.perfects ||
      uiRef.current.misses !== gv.misses
    ) {
      uiRef.current = {
        score: gv.score,
        combo: gv.combo,
        cleared: gv.cleared,
        perfects: gv.perfects,
        misses: gv.misses,
      };
      setScore(gv.score);
      setCombo(gv.combo);
      setCleared(gv.cleared);
      setPerfects(gv.perfects);
      setMisses(gv.misses);
    }
  }, []);

  // ── Spawn particles ──
  const spawnParticles = useCallback(
    (x: number, y: number, colorHue: number, count: number) => {
      const gv = g.current;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 200;
        gv.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 60,
          life: 0.4 + Math.random() * 0.5,
          maxLife: 0.4 + Math.random() * 0.5,
          hue: colorHue + (Math.random() - 0.5) * 40,
          size: 3 + Math.random() * 5,
        });
      }
    },
    []
  );

  // ── Start a level ──
  const startLevel = useCallback(
    (lvl: number) => {
      const gv = g.current;
      const canvas = canvasRef.current;
      const w = canvas ? canvas.clientWidth : 800;
      const h = CANVAS_HEIGHT;

      gv.canvasW = w;
      gv.canvasH = h;
      gv.groundY = h * GROUND_Y_RATIO;
      gv.playerX = w * PLAYER_X_RATIO;
      gv.playerY = gv.groundY - PLAYER_RADIUS;
      gv.playerVY = 0;
      gv.obstacles = [];
      gv.particles = [];
      gv.level = lvl;
      gv.score = 0; // per-level score; we accumulate across levels
      gv.combo = 0;
      gv.maxCombo = 0;
      gv.cleared = 0;
      gv.perfects = 0;
      gv.misses = 0;
      gv.obstacleTimer = 0;
      gv.lastTimestamp = 0;
      gv.flashText = "";
      gv.flashTimer = 0;
      gv.isOnGround = true;
      gv.currentMinPlayerY = gv.playerY; // reset per-level
      gv.phase = "playing";

      const bpm = LEVELS[lvl].bpm;
      gv.beatInterval = (60 / bpm) * BEAT_INTERVAL_MULTIPLIER; // seconds per beat
      // scroll speed: obstacle must travel from right edge to playerX in beatInterval
      const travelDist = w - gv.playerX - OBSTACLE_HALF_WIDTH;
      gv.scrollSpeed = travelDist / gv.beatInterval;

      uiRef.current = { score: 0, combo: 0, cleared: 0, perfects: 0, misses: 0 };
      setPhase("playing");
      setScore(0);
      setCombo(0);
      setCleared(0);
      setPerfects(0);
      setMisses(0);
      setShowOverlay(false);

      setRexMood("happy");
      setRexMessage(
        `Level ${lvl + 1}: ${LEVELS[lvl].label} (${bpm} BPM) — Tap to jump!`
      );
    },
    []
  );

  // ── Full game reset (restart from scratch) ──
  const resetGame = useCallback(() => {
    const canvas = canvasRef.current;
    const w = canvas ? canvas.clientWidth : 800;
    const h = CANVAS_HEIGHT;

    const gv = g.current;
    gv.phase = "idle";
    gv.playerY = h * GROUND_Y_RATIO - PLAYER_RADIUS;
    gv.playerVY = 0;
    gv.obstacles = [];
    gv.particles = [];
    gv.level = 0;
    gv.score = 0;
    gv.combo = 0;
    gv.maxCombo = 0;
    gv.cleared = 0;
    gv.perfects = 0;
    gv.misses = 0;
    gv.obstacleTimer = 0;
    gv.lastTimestamp = 0;
    gv.groundY = h * GROUND_Y_RATIO;
    gv.playerX = w * PLAYER_X_RATIO;
    gv.canvasW = w;
    gv.canvasH = h;
    gv.flashText = "";
    gv.flashTimer = 0;
    gv.isOnGround = true;
    gv.currentMinPlayerY = gv.playerY; // reset for new game
    gv.beatInterval = (60 / LEVELS[0].bpm) * BEAT_INTERVAL_MULTIPLIER;
    const travelDist = w - gv.playerX - OBSTACLE_HALF_WIDTH;
    gv.scrollSpeed = travelDist / gv.beatInterval;

    uiRef.current = { score: 0, combo: 0, cleared: 0, perfects: 0, misses: 0 };
    setPhase("idle");
    setLevel(0);
    setScore(0);
    setCombo(0);
    setCleared(0);
    setPerfects(0);
    setMisses(0);
    setFinalScore(0);
    setShowOverlay(false);
    setRexMessage("Tap to jump over the ECG spikes!");
    setRexMood("happy");
    completedRef.current = false;

    // Force a redraw immediately so canvas isn't blank
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drawing ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gv = g.current;
    const w = gv.canvasW;
    const h = gv.canvasH;
    const dpr = window.devicePixelRatio || 1;

    // Resize backing store if needed
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const groundY = gv.groundY;
    const playerX = gv.playerX;
    const playerY = gv.playerY;

    // ── Background ──
    ctx.fillStyle = "#1A1A24";
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    const gridSpacing = 40;
    for (let gy = 0; gy < h; gy += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
    for (let gx = 0; gx < w; gx += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }

    // ── ECG waveform ground line ──
    const beatWidth = gv.scrollSpeed * gv.beatInterval;
    const ecgAmp = 16; // amplitude for sub-R waves
    const ecgGetY = (x: number): number => {
      const phase = ((x % beatWidth) + beatWidth) % beatWidth;
      const t = phase / beatWidth; // 0..1 within one cardiac cycle

      // P wave: small bump up at ~0.10-0.22
      if (t >= 0.10 && t <= 0.22) {
        const pt = (t - 0.10) / 0.12;
        return groundY - ecgAmp * 0.55 * Math.sin(pt * Math.PI);
      }
      // Q dip: small dip down at ~0.38-0.44
      if (t >= 0.38 && t <= 0.44) {
        const qt = (t - 0.38) / 0.06;
        return groundY + ecgAmp * 0.35 * Math.sin(qt * Math.PI);
      }
      // S dip: small dip down at ~0.56-0.62
      if (t >= 0.56 && t <= 0.62) {
        const st = (t - 0.56) / 0.06;
        return groundY + ecgAmp * 0.45 * Math.sin(st * Math.PI);
      }
      // T wave: medium bump up at ~0.68-0.88
      if (t >= 0.68 && t <= 0.88) {
        const tt = (t - 0.68) / 0.20;
        return groundY - ecgAmp * 0.75 * Math.sin(tt * Math.PI);
      }
      // Flat / isoelectric otherwise (R-wave spike is the obstacle)
      return groundY;
    };

    // Draw the ECG waveform path
    ctx.save();
    ctx.shadowColor = "#008C95";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = "#008C95";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const step = 3; // pixel step for smooth curve
    let started = false;
    for (let x = 0; x <= w; x += step) {
      const y = ecgGetY(x);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Dimmer second pass for depth / glow
    ctx.shadowBlur = 4;
    ctx.strokeStyle = "rgba(0,229,255,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    started = false;
    for (let x = 0; x <= w; x += step) {
      const y = ecgGetY(x);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // ── Obstacles (ECG spike triangles) ──
    const obsH = OBSTACLE_HEIGHT;
    const obsHW = OBSTACLE_HALF_WIDTH;

    for (const obs of gv.obstacles) {
      const ox = obs.x;
      if (ox < -obsHW || ox > w + obsHW) continue;

      // Main triangle
      ctx.save();
      ctx.shadowColor = "#008C95";
      ctx.shadowBlur = 10;
      ctx.fillStyle = obs.perfect ? "#00FFAA" : "#008C95";
      ctx.beginPath();
      ctx.moveTo(ox, groundY); // base center
      ctx.lineTo(ox - obsHW, groundY - 2); // base left
      ctx.lineTo(ox, groundY - obsH); // peak
      ctx.lineTo(ox + obsHW, groundY - 2); // base right
      ctx.closePath();
      ctx.fill();

      // Glow outline
      ctx.shadowBlur = 4;
      ctx.strokeStyle = "rgba(0,229,255,0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Small glow dot at peak
      ctx.beginPath();
      ctx.arc(ox, groundY - obsH, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#00E5FF";
      ctx.fill();
    }

    // ── Player (glowing heart-circle) ──
    const py = playerY;
    ctx.save();
    // Outer glow
    const glowGrad = ctx.createRadialGradient(playerX, py, PLAYER_RADIUS * 0.5, playerX, py, PLAYER_RADIUS * 2.5);
    glowGrad.addColorStop(0, "rgba(255, 68, 102, 0.6)");
    glowGrad.addColorStop(0.5, "rgba(255, 68, 102, 0.15)");
    glowGrad.addColorStop(1, "rgba(255, 68, 102, 0)");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(playerX, py, PLAYER_RADIUS * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Body circle
    const bodyGrad = ctx.createRadialGradient(
      playerX - 3, py - 3, 2,
      playerX, py, PLAYER_RADIUS
    );
    bodyGrad.addColorStop(0, "#FF6688");
    bodyGrad.addColorStop(0.7, "#FF3355");
    bodyGrad.addColorStop(1, "#CC1144");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(playerX, py, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Heart image inside
    const heartImg = heartImgRef.current;
    const heartSize = PLAYER_RADIUS * 2.5;
    if (heartImg) {
      ctx.drawImage(
        heartImg,
        playerX - heartSize,
        py - heartSize,
        heartSize * 2,
        heartSize * 2
      );
    }
    ctx.restore();

    // ── Particles ──
    for (const p of gv.particles) {
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsl(${p.hue}, 90%, 60%)`;
      ctx.shadowColor = `hsl(${p.hue}, 90%, 60%)`;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Flash text ──
    if (gv.flashTimer > 0) {
      const alpha = Math.min(1, gv.flashTimer / 0.4);
      const yOff = (1 - gv.flashTimer / 0.6) * 30;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#00FFAA";
      ctx.shadowColor = "#00FFAA";
      ctx.shadowBlur = 12;
      ctx.fillText(gv.flashText, playerX, py - PLAYER_RADIUS - 20 - yOff);
      ctx.restore();
    }

    // ── HUD (top bar) ──
    const bpm = LEVELS[gv.level].bpm;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${bpm} BPM · ${LEVELS[gv.level].label}`, 14, 20);

    ctx.textAlign = "right";
    ctx.fillText(
      `${gv.cleared}/${OBSTACLES_PER_LEVEL}`,
      w - 14,
      20
    );

    // Combo indicator
    if (gv.combo > 1) {
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${gv.combo}x COMBO`, w / 2, 20);
    }
  }, []);

  // ── Game loop ──
  const gameLoop = useCallback(
    (timestamp: number) => {
      const gv = g.current;
      if (gv.phase !== "playing") {
        animRef.current = requestAnimationFrame(gameLoop);
        draw();
        return;
      }

      if (gv.lastTimestamp === 0) {
        gv.lastTimestamp = timestamp;
      }

      let dt = (timestamp - gv.lastTimestamp) / 1000;
      gv.lastTimestamp = timestamp;

      // Clamp dt to avoid huge jumps
      if (dt > 0.1) dt = 0.1;
      if (dt <= 0) dt = 0.016;

      const groundY = gv.groundY;
      const playerX = gv.playerX;

      // ── Player physics ──
      gv.playerVY += GRAVITY * dt;
      gv.playerY += gv.playerVY * dt;

      const floorY = groundY - PLAYER_RADIUS;
      if (gv.playerY >= floorY) {
        gv.playerY = floorY;
        gv.playerVY = 0;
        gv.isOnGround = true;
      } else {
        gv.isOnGround = false;
      }

      // Track highest point reached this obstacle cycle (smaller Y = higher)
      if (gv.playerY < gv.currentMinPlayerY) {
        gv.currentMinPlayerY = gv.playerY;
      }

      // ── Obstacle spawning ──
      gv.obstacleTimer += dt;
      if (
        gv.obstacleTimer >= gv.beatInterval &&
        gv.obstacles.length < OBSTACLES_PER_LEVEL
      ) {
        gv.obstacleTimer -= gv.beatInterval;
        gv.obstacles.push({
          x: gv.canvasW + OBSTACLE_HALF_WIDTH,
          cleared: false,
          perfect: false,
        });
        // Reset jump-height tracking for the new obstacle cycle
        gv.currentMinPlayerY = gv.playerY;
      }

      // ── Move obstacles ──
      for (const obs of gv.obstacles) {
        obs.x -= gv.scrollSpeed * dt;
      }

      // ── Collision detection ──
      const obsHW = OBSTACLE_HALF_WIDTH;
      const obsH = OBSTACLE_HEIGHT;
      const playerBottom = gv.playerY + PLAYER_RADIUS;
      const obstacleTop = groundY - obsH;

      for (const obs of gv.obstacles) {
        if (obs.cleared) continue;

        // Check if obstacle has fully passed the player
        if (obs.x < playerX - PLAYER_RADIUS - obsHW - 4) {
          // Player successfully jumped over — clear!
          // Height-based perfect: player must have jumped ≥ 50px above floor
          const jumpHeight = floorY - gv.currentMinPlayerY;
          const nearPeak = jumpHeight > 50;
          obs.cleared = true;
          obs.perfect = nearPeak;
          gv.cleared++;
          gv.combo++;
          if (gv.combo > gv.maxCombo) gv.maxCombo = gv.combo;
          const levelMult = gv.level + 1;

          if (nearPeak) {
            gv.perfects++;
            gv.score += 25 * levelMult * Math.min(gv.combo, 8);
            gv.flashText = "PERFECT!";
            gv.flashTimer = 0.7;
            spawnParticles(obs.x, groundY - obsH, 140, 20);
          } else {
            gv.score += 10 * levelMult * Math.min(gv.combo, 8);
            spawnParticles(obs.x, groundY - obsH * 0.5, 170, 10);
          }
          continue;
        }

        // Check for active collision (overlap in both x and y)
        const dx = Math.abs(playerX - obs.x);
        const overlapX = dx < PLAYER_RADIUS + obsHW - 2;
        const overlapY = playerBottom > obstacleTop + 4;

        if (overlapX && overlapY) {
          // Collision = miss!
          obs.cleared = true;
          obs.perfect = false;
          gv.misses++;
          gv.combo = 0;
          gv.flashText = "MISS";
          gv.flashTimer = 0.5;
          // Red particles for miss
          spawnParticles(obs.x, groundY - obsH * 0.5, 0, 6);
        }
      }

      // Remove way-off-screen obstacles
      gv.obstacles = gv.obstacles.filter((o) => o.x > -60);

      // ── Update particles ──
      for (const p of gv.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 200 * dt; // particle gravity
        p.life -= dt;
      }
      gv.particles = gv.particles.filter((p) => p.life > 0);

      // ── Flash timer ──
      if (gv.flashTimer > 0) {
        gv.flashTimer -= dt;
      }

      // ── Check level complete ──
      const totalResolved = gv.cleared + gv.misses;
      if (totalResolved >= OBSTACLES_PER_LEVEL && gv.phase === "playing") {
        gv.phase = "levelComplete";
        setPhase("levelComplete");
        setShowOverlay(true);

        const clearRate = gv.cleared / OBSTACLES_PER_LEVEL;
        const perfectRate = gv.perfects / Math.max(1, gv.cleared);

        if (gv.level < LEVELS.length - 1 && clearRate >= 0.7) {
          setRexMood("excited");
          setRexMessage(
            `Level ${gv.level + 1} passed! ${Math.round(perfectRate * 100)}% perfect clears!`
          );
        } else if (gv.level >= LEVELS.length - 1) {
          setRexMood("excited");
          setRexMessage(
            `All levels cleared! Amazing, ${playerName}! 🎉`
          );
        } else {
          setRexMood("encouraging");
          setRexMessage(
            `Keep practicing! Cleared ${gv.cleared}/${OBSTACLES_PER_LEVEL} — need 70% to advance.`
          );
        }
        setFinalScore(gv.score);
        // Keep the animation loop alive so level transitions work.
        // Phase is now "levelComplete", so the loop will just draw
        // without updating physics until startLevel() sets it to "playing".
        syncUI();
        draw();
        animRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      // ── Sync UI ──
      syncUI();

      draw();
      animRef.current = requestAnimationFrame(gameLoop);
    },
    [draw, syncUI, spawnParticles, playerName]
  );

  // ── Start / stop game loop ──
  useEffect(() => {
    animRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [gameLoop]);

  // ── Load heart image ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const img = new Image();
    img.src = "/heart-player.png";
    img.onload = () => {
      heartImgRef.current = img;
    };
    return () => {
      heartImgRef.current = null;
    };
  }, []);

  // ── Handle resize ──
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const gv = g.current;
      gv.canvasW = canvas.clientWidth;
      gv.canvasH = CANVAS_HEIGHT;
      gv.groundY = gv.canvasH * GROUND_Y_RATIO;
      gv.playerX = gv.canvasW * PLAYER_X_RATIO;
      // Recalculate scroll speed
      const bpm = LEVELS[gv.level].bpm;
      gv.beatInterval = (60 / bpm) * BEAT_INTERVAL_MULTIPLIER;
      const travelDist = gv.canvasW - gv.playerX - OBSTACLE_HALF_WIDTH;
      gv.scrollSpeed = travelDist / gv.beatInterval;

      // Snap player to ground
      if (gv.playerY > gv.groundY - PLAYER_RADIUS) {
        gv.playerY = gv.groundY - PLAYER_RADIUS;
      }
      draw();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  // ── Tap / jump handler ──
  const handleJump = useCallback(() => {
    const gv = g.current;
    if (gv.phase !== "playing") return;
    // Only jump if on or near ground
    if (gv.playerY >= gv.groundY - PLAYER_RADIUS - 5) {
      gv.playerVY = JUMP_VELOCITY;
      gv.isOnGround = false;
    }
  }, []);

  // ── Countdown logic ──
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdownVal <= 0) {
      // "Go!" phase
      const timer = setTimeout(() => {
        setCountdownVal(3);
        startLevel(level);
      }, 500);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setCountdownVal((v) => v - 1);
    }, 700);
    return () => clearTimeout(timer);
  }, [phase, countdownVal, level, startLevel]);

  // ── Completion tracking ──
  useEffect(() => {
    if (
      (phase === "levelComplete" || phase === "gameComplete") &&
      !completedRef.current
    ) {
      completedRef.current = true;
      addPoints(finalScore);

      trackGameCompletion("ecg-rhythm");
      const newAchievements = checkAchievements();
      if (newAchievements.length > 0) {
        setToastAchievement(newAchievements[0]);
      }

      if (finalScore > highScore) {
        setHighScore(finalScore);
        if (typeof window !== "undefined") {
          localStorage.setItem("pulsePopHighScore", finalScore.toString());
        }
      }
      // Live leaderboard: submit the stored best, fire-and-forget
      // (submitScore self-handles the player name, auto-creating a guest
      // identity when needed — silent on failure). max() = the value just
      // persisted above.
      submitScore("ecg-rhythm", Math.max(highScore, finalScore)).then((r) => {
        if (r) setSubmitRank(r.rank);
      });
    }
    if (phase !== "levelComplete" && phase !== "gameComplete") {
      completedRef.current = false;
    }
  }, [phase, finalScore, highScore]);

  // ── Accuracy ──
  const totalResolved = cleared + misses;
  const clearRate = totalResolved > 0 ? cleared / OBSTACLES_PER_LEVEL : 0;
  const perfectRate = cleared > 0 ? Math.round((perfects / cleared) * 100) : 0;
  const displayAccuracy = Math.round(clearRate * 100);

  const levelDef = LEVELS[level];
  const canAdvance = clearRate >= 0.7;
  const isLastLevel = level >= LEVELS.length - 1;
  const showFinal = phase === "gameComplete" || (phase === "levelComplete" && (!canAdvance || isLastLevel));

  // If showing final but phase hasn't been set to gameComplete, treat it as game complete
  const effectiveFinal = showFinal;

  return (
    <div className="page-container max-w-lg mx-auto">
      {/* Achievement Toast */}
      <AchievementToast
        achievement={toastAchievement}
        onDismiss={() => setToastAchievement(null)}
      />

      {/* Rex Header */}
      <div className="mb-4">
        <RexSpeechBubble message={rexMessage} mood={rexMood} />
      </div>

      {/* Score + Level Bar */}
      <div className="card mb-3 p-3 flex items-center justify-between">
        <div>
          <span className="text-xs text-mutedText uppercase font-semibold">
            Score
          </span>
          <div className="text-2xl font-bold text-primary">
            {score.toLocaleString()}
          </div>
        </div>
        <div className="text-center">
          <span className="text-xs text-mutedText uppercase font-semibold">
            Level
          </span>
          <div className="text-2xl font-bold text-secondary">
            {level + 1}
            <span className="text-xs text-mutedText">/4</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-mutedText uppercase font-semibold">
            Combo
          </span>
          <div className="text-2xl font-bold text-primary">
            {combo > 1 ? `${combo}x` : "—"}
          </div>
        </div>
      </div>

      {/* BPM & Progress */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs text-mutedText">
          <span className="text-secondary font-bold">
            {levelDef.bpm} BPM
          </span>{" "}
          · {levelDef.label}
        </span>
        <span className="text-xs text-mutedText">
          Beat {Math.min(totalResolved + 1, OBSTACLES_PER_LEVEL)}/
          {OBSTACLES_PER_LEVEL}
          {" · "}
          <span
            className={displayAccuracy >= 70 ? "text-green-500" : "text-red-400"}
          >
            {displayAccuracy}% cleared
          </span>
        </span>
      </div>

      {/* Canvas */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-lg mb-3 cursor-pointer active:scale-[0.99] transition-transform select-none"
        style={{ touchAction: "manipulation" }}
        onPointerDown={(e) => {
          e.preventDefault();
          handleJump();
        }}
        onClick={(e) => {
          e.preventDefault();
          handleJump();
        }}
      >
        <canvas
          ref={canvasRef}
          className="w-full block"
          style={{ height: `${CANVAS_HEIGHT}px`, background: "#1A1A24" }}
        />

        {/* Idle overlay */}
        {phase === "idle" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <button
              className="bg-[#008C95] text-white px-8 py-4 rounded-2xl font-bold text-xl shadow-lg hover:bg-[#007780] active:scale-95 transition-all"
              onClick={(e) => {
                e.stopPropagation();
                g.current.phase = "countdown";
                setPhase("countdown");
                setCountdownVal(3);
              }}
            >
              💓 Tap to Start
            </button>
          </div>
        )}

        {/* Countdown */}
        {phase === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div
              key={countdownVal}
              className="text-8xl font-extrabold text-white drop-shadow-[0_0_20px_rgba(0,229,255,0.6)] animate-[scaleIn_0.3s_ease-out]"
            >
              {countdownVal > 0 ? countdownVal : "Go!"}
            </div>
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex justify-center gap-4 mb-4 text-xs">
        <span className="text-green-400">
          Perfect: {perfects}
        </span>
        <span className="text-red-400">
          Miss: {misses}
        </span>
        <span className="text-mutedText">
          Combo best: {g.current.maxCombo}x
        </span>
      </div>

      {/* Rex */}
      <div className="flex justify-center mb-20">
        <Rex className="w-10 h-10" mood={rexMood} />
      </div>

      {/* Level Complete Modal */}
      {phase === "levelComplete" && !showFinal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="excited" />
            <div className="text-4xl mb-2">
              {clearRate >= 0.9 ? "⭐⭐⭐" : clearRate >= 0.8 ? "⭐⭐" : "⭐"}
            </div>
            <h2 className="text-2xl font-extrabold text-primary mb-2">
              Level {level + 1} Complete!
            </h2>
            <p className="text-lg text-mutedText mb-1">
              Cleared:{" "}
              <span className="font-bold text-primary">{displayAccuracy}%</span>
              {" · "}Perfect: {perfectRate}%
            </p>
            <p className="text-sm text-mutedText mb-1">
              Perfect: {perfects} · Miss: {misses}
            </p>
            <p className="text-lg text-mutedText mb-4">
              Score:{" "}
              <span className="font-bold text-primary">
                {score.toLocaleString()}
              </span>
            </p>
            <button
              className="btn-primary w-full text-lg"
              onClick={() => {
                const nextLvl = level + 1;
                g.current.level = nextLvl;
                g.current.phase = "playing";
                setLevel(nextLvl);
                setShowOverlay(false);
                setPhase("playing");
                startLevel(nextLvl);
              }}
            >
              Next Level → {LEVELS[level + 1].bpm} BPM
            </button>
          </div>
        </div>
      )}

      {/* Game Complete / Final Modal */}
      {effectiveFinal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_0.4s_ease-out]">
            <Rex
              className="w-20 h-20 mx-auto mb-4"
              mood={
                canAdvance || isLastLevel ? "excited" : "encouraging"
              }
            />
            <div className="text-4xl mb-2">
              {clearRate >= 0.9
                ? "⭐⭐⭐"
                : clearRate >= 0.8
                  ? "⭐⭐"
                  : clearRate >= 0.7
                    ? "⭐"
                    : "💪"}
            </div>
            <h2 className="text-2xl font-extrabold text-primary mb-2">
              {isLastLevel
                ? "All Clear! 🎉"
                : canAdvance
                  ? "Keep Going!"
                  : "Keep Practicing!"}
            </h2>
            <p className="text-lg text-mutedText mb-1">
              Final Score:{" "}
              <span className="font-bold text-primary">
                {finalScore.toLocaleString()}
              </span>
            </p>
            <p className="text-sm text-mutedText mb-1">
              Cleared: {displayAccuracy}% · Perfect: {perfectRate}% (need 70% to advance)
            </p>
            <p className="text-sm text-mutedText mb-2">
              Perfect: {perfects} · Miss: {misses}
            </p>
            {finalScore >= highScore && finalScore > 0 && (
              <p className="text-secondary font-bold mb-4">
                🏆 New High Score! 🏆
              </p>
            )}
            <LeaderboardEntry
              game="ecg-rhythm"
              score={Math.max(highScore, finalScore)}
              rank={submitRank}
              onRank={setSubmitRank}
            />
            <div className="flex gap-3">
              {!canAdvance && !isLastLevel ? (
                <>
                  <button
                    className="btn-secondary flex-1 text-lg"
                    onClick={() => {
                      resetGame();
                    }}
                  >
                    Restart
                  </button>
                  <button
                    className="btn-primary flex-1 text-lg"
                    onClick={() => {
                      g.current.level = level;
                      setShowOverlay(false);
                      setPhase("playing");
                      startLevel(level);
                    }}
                  >
                    Try Again
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-secondary flex-1 text-lg"
                    onClick={() => {
                      resetGame();
                    }}
                  >
                    Restart
                  </button>
                  {canAdvance && !isLastLevel && (
                    <button
                      className="btn-primary flex-1 text-lg"
                      onClick={() => {
                        const nextLvl = level + 1;
                        g.current.level = nextLvl;
                        setLevel(nextLvl);
                        setShowOverlay(false);
                        setPhase("playing");
                        startLevel(nextLvl);
                      }}
                    >
                      Level {level + 2} →
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* High Score */}
      {highScore > 0 && (
        <p className="text-center text-xs text-mutedText mb-4">
          🏆 Best Score: {highScore.toLocaleString()}
        </p>
      )}
    </div>
  );
}
