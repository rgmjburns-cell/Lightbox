import { useState, useEffect, useCallback, useRef } from "react";
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

// ── Colours ──
const COLORS = [
  { name: "teal", hex: "#008C95" },
  { name: "pink", hex: "#FF6B9D" },
  { name: "blue", hex: "#4A90D9" },
  { name: "green", hex: "#4CAF50" },
  { name: "purple", hex: "#9B59B6" },
  { name: "orange", hex: "#FF9800" },
  { name: "yellow", hex: "#FFD600" },
  { name: "red", hex: "#E53935" },
];

// ── Canvas internal resolution ──
const CANVAS_WIDTH = 500;
// Height computed from image aspect ratio (1086×1448)

interface UndoEntry {
  imageData: ImageData;
  filledMask: Uint8Array;
  filledPixelsCount: number;
}

const MAX_UNDO = 15;

// ── Helpers ──

/** Parse a hex colour like "#008C95" into [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

/** Check if a pixel is "dark" (outline) — R+G+B <= 300. */
function isDark(r: number, g: number, b: number): boolean {
  return r + g + b <= 300;
}

/**
 * Blend fill colour with original pixel at 50% opacity.
 * All arguments are integers 0–255.
 */
function blend(fg: number, bg: number): number {
  return Math.round(fg * 0.5 + bg * 0.5);
}

/**
 * Run a stack-based flood fill on the visible canvas.
 * Only fills pixels that match the target colour (the colour at the tap point),
 * are not dark (outlines), and are not already marked as filled.
 * Returns the number of newly filled pixels.
 */
function floodFill(
  visibleCtx: CanvasRenderingContext2D,
  hiddenCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillHex: string,
  filledMask: Uint8Array,
): number {
  // Clamp start coords
  startX = Math.max(0, Math.min(width - 1, Math.round(startX)));
  startY = Math.max(0, Math.min(height - 1, Math.round(startY)));

  const maskIdx = startY * width + startX;

  // Already filled — bail
  if (filledMask[maskIdx] === 1) return 0;

  // Read target colour at tap point
  const visibleImageData = visibleCtx.getImageData(0, 0, width, height);
  const visiblePixels = visibleImageData.data;
  const startIdx4 = maskIdx * 4;
  const targetR = visiblePixels[startIdx4];
  const targetG = visiblePixels[startIdx4 + 1];
  const targetB = visiblePixels[startIdx4 + 2];

  // Don't fill dark outlines
  if (isDark(targetR, targetG, targetB)) return 0;

  // Read hidden (original) pixels for blending reference
  const hiddenImageData = hiddenCtx.getImageData(0, 0, width, height);
  const hiddenPixels = hiddenImageData.data;

  // Parse fill colour
  const [fr, fg, fb] = hexToRgb(fillHex);

  // Check if target pixel is already this fill colour (blended)
  const expectedR = blend(fr, hiddenPixels[startIdx4]);
  const expectedG = blend(fg, hiddenPixels[startIdx4 + 1]);
  const expectedB = blend(fb, hiddenPixels[startIdx4 + 2]);
  // Allow tolerance for anti-aliased/scaled image artifacts
  if (
    Math.abs(targetR - expectedR) <= 15 &&
    Math.abs(targetG - expectedG) <= 15 &&
    Math.abs(targetB - expectedB) <= 15
  ) {
    return 0;
  }

  // Stack-based flood fill
  const stack: [number, number][] = [[startX, startY]];
  let filledCount = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;

    // Bounds check
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = y * width + x;
    const idx4 = idx * 4;

    // Check mask
    if (filledMask[idx] === 1) continue;

    // Check if pixel matches target colour (the colour we're replacing)
    const pr = visiblePixels[idx4];
    const pg = visiblePixels[idx4 + 1];
    const pb = visiblePixels[idx4 + 2];

    if (isDark(pr, pg, pb)) continue;

    // Must match target colour (within tolerance — wide to handle
    // anti-aliased edge pixels from scaled-down line art)
    if (
      Math.abs(pr - targetR) > 60 ||
      Math.abs(pg - targetG) > 60 ||
      Math.abs(pb - targetB) > 60
    ) {
      continue;
    }

    // Fill the pixel — blend with original
    visiblePixels[idx4] = blend(fr, hiddenPixels[idx4]);
    visiblePixels[idx4 + 1] = blend(fg, hiddenPixels[idx4 + 1]);
    visiblePixels[idx4 + 2] = blend(fb, hiddenPixels[idx4 + 2]);
    // Alpha stays as-is from original

    filledMask[idx] = 1;
    filledCount++;

    // Push neighbours
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  // Write back modified pixels
  visibleCtx.putImageData(visibleImageData, 0, 0);

  return filledCount;
}

export default function ColourRex() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";

  const [selectedColor, setSelectedColor] = useState(COLORS[0].hex);
  const [rexMessage, setRexMessage] = useState("Choose a colour, then tap Rex to fill!");
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [showComplete, setShowComplete] = useState(false);
  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
  const completedRef = useRef(false);

  // ── Canvas refs ──
  const visibleCanvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageLoadedRef = useRef(false);
  const canvasHeightRef = useRef(0);
  const totalFillableRef = useRef(0);
  const filledPixelsCountRef = useRef(0);
  const filledMaskRef = useRef<Uint8Array | null>(null);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const [, setUndoCount] = useState(0); // trigger re-renders for undo button

  // ── Container ref for sizing ──
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasDisplaySize, setCanvasDisplaySize] = useState({ w: 0, h: 0 });

  const [bestScore, setBestScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("colourRexBest") || "0", 10);
  });

  // ── Progress ──
  const filledCount = filledPixelsCountRef.current;
  const totalFillable = totalFillableRef.current;
  const progressPct = totalFillable > 0 ? Math.round((filledCount / totalFillable) * 100) : 0;

  // ── Load image and initialise canvases ──
  useEffect(() => {
    const img = new Image();
    img.src = "/rex-colouring.png";
    img.onload = () => {
      const naturalW = img.naturalWidth; // 1086
      const naturalH = img.naturalHeight; // 1448
      const canvasW = CANVAS_WIDTH;
      const canvasH = Math.round((naturalH / naturalW) * CANVAS_WIDTH);
      canvasHeightRef.current = canvasH;

      // Create hidden canvas
      const hidden = document.createElement("canvas");
      hidden.width = canvasW;
      hidden.height = canvasH;
      const hiddenCtx = hidden.getContext("2d")!;
      hiddenCtx.drawImage(img, 0, 0, canvasW, canvasH);
      hiddenCanvasRef.current = hidden;

      // Draw onto visible canvas
      const visible = visibleCanvasRef.current;
      if (!visible) return;
      visible.width = canvasW;
      visible.height = canvasH;
      const visibleCtx = visible.getContext("2d")!;
      visibleCtx.drawImage(img, 0, 0, canvasW, canvasH);

      // Count total fillable pixels (non-dark)
      const imageData = hiddenCtx.getImageData(0, 0, canvasW, canvasH);
      const pixels = imageData.data;
      let fillableCount = 0;
      for (let i = 0; i < canvasW * canvasH; i++) {
        const idx4 = i * 4;
        const r = pixels[idx4];
        const g = pixels[idx4 + 1];
        const b = pixels[idx4 + 2];
        if (!isDark(r, g, b)) fillableCount++;
      }
      totalFillableRef.current = fillableCount;

      // Initialise filled mask
      filledMaskRef.current = new Uint8Array(canvasW * canvasH);
      filledPixelsCountRef.current = 0;
      undoStackRef.current = [];
      setUndoCount(0);

      // Update display size
      updateCanvasDisplaySize();
      imageLoadedRef.current = true;
    };
  }, []);

  // ── Update canvas display size on resize ──
  const updateCanvasDisplaySize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerW = container.clientWidth;
    const naturalW = 1086;
    const naturalH = 1448;
    const displayH = Math.round((naturalH / naturalW) * containerW);
    setCanvasDisplaySize({ w: containerW, h: displayH });
  }, []);

  useEffect(() => {
    updateCanvasDisplaySize();
    const handleResize = () => updateCanvasDisplaySize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateCanvasDisplaySize]);

  // ── Save undo snapshot ──
  const saveUndoSnapshot = useCallback(() => {
    const visible = visibleCanvasRef.current;
    const mask = filledMaskRef.current;
    if (!visible || !mask) return;

    const ctx = visible.getContext("2d")!;
    const imageData = ctx.getImageData(0, 0, visible.width, visible.height);
    const maskCopy = new Uint8Array(mask);

    const entry: UndoEntry = {
      imageData,
      filledMask: maskCopy,
      filledPixelsCount: filledPixelsCountRef.current,
    };

    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > MAX_UNDO) {
      undoStackRef.current.shift();
    }
    setUndoCount((c) => c + 1);
  }, []);

  // ── Handle canvas tap (pointer event) ──
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (showComplete || !imageLoadedRef.current) return;

      const canvas = visibleCanvasRef.current;
      const hidden = hiddenCanvasRef.current;
      const mask = filledMaskRef.current;
      if (!canvas || !hidden || !mask) return;

      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      // Scale from CSS coords to canvas internal coords
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = Math.round(cssX * scaleX);
      const canvasY = Math.round(cssY * scaleY);

      // Save undo snapshot before modifying
      saveUndoSnapshot();

      const ctx = canvas.getContext("2d")!;
      const hiddenCtx = hidden.getContext("2d")!;

      const newFilled = floodFill(
        ctx,
        hiddenCtx,
        canvas.width,
        canvas.height,
        canvasX,
        canvasY,
        selectedColor,
        mask,
      );

      if (newFilled > 0) {
        filledPixelsCountRef.current += newFilled;

        // Update Rex message
        const totalFilled = filledPixelsCountRef.current;
        if (totalFilled === newFilled) {
          // First fill
          setRexMood("excited");
          setRexMessage("Great start! Keep colouring!");
          setTimeout(() => setRexMood("happy"), 2000);
        } else {
          setRexMood("happy");
          setRexMessage(`Nice! ${totalFilled} pixels coloured so far.`);
        }

        // Force re-render to update progress
        setUndoCount((c) => c + 1);
      }
    },
    [showComplete, selectedColor, saveUndoSnapshot],
  );

  // ── Undo ──
  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;

    const entry = stack.pop()!;
    const canvas = visibleCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(entry.imageData, 0, 0);
    filledMaskRef.current = entry.filledMask;
    filledPixelsCountRef.current = entry.filledPixelsCount;

    setUndoCount((c) => c + 1);
    setRexMood("encouraging");
    setRexMessage("Undo! Try a different colour.");
    setTimeout(() => {
      setRexMood("happy");
      setRexMessage("Choose a colour, then tap Rex to fill!");
    }, 2000);
  }, []);

  // ── Clear ──
  const handleClear = useCallback(() => {
    const canvas = visibleCanvasRef.current;
    const hidden = hiddenCanvasRef.current;
    if (!canvas || !hidden) return;

    const ctx = canvas.getContext("2d")!;
    const hiddenCtx = hidden.getContext("2d")!;
    const imageData = hiddenCtx.getImageData(0, 0, hidden.width, hidden.height);
    ctx.putImageData(imageData, 0, 0);

    const w = canvas.width;
    const h = canvas.height;
    filledMaskRef.current = new Uint8Array(w * h);
    filledPixelsCountRef.current = 0;
    undoStackRef.current = [];
    setUndoCount((c) => c + 1);

    setRexMessage("All clear! Start again.");
    setRexMood("encouraging");
    setTimeout(() => {
      setRexMood("happy");
      setRexMessage("Choose a colour, then tap Rex to fill!");
    }, 2000);
  }, []);

  // ── Finish ──
  const handleFinish = useCallback(() => {
    const total = totalFillableRef.current;
    const filled = filledPixelsCountRef.current;
    const minPct = 10;
    const actualPct = total > 0 ? Math.round((filled / total) * 100) : 0;

    if (actualPct < minPct) {
      setRexMood("encouraging");
      setRexMessage(
        `Colour at least ${minPct}% of Rex to finish! You've done ${actualPct}%.`,
      );
      setTimeout(() => setRexMood("happy"), 3000);
      return;
    }
    setShowComplete(true);
  }, []);

  // ── Track completion ──
  useEffect(() => {
    if (showComplete && !completedRef.current) {
      completedRef.current = true;
      const points = 500;
      addPoints(points);

      trackGameCompletion("colour-rex");
      const newAchievements = checkAchievements();
      if (newAchievements.length > 0) {
        setToastAchievement(newAchievements[0]);
      }

      if (points > bestScore) {
        setBestScore(points);
        if (typeof window !== "undefined") {
          localStorage.setItem("colourRexBest", points.toString());
        }
      }
    }
    if (!showComplete) {
      completedRef.current = false;
    }
  }, [showComplete, bestScore]);

  return (
    <div className="page-container max-w-lg mx-auto">
      <AchievementToast achievement={toastAchievement} onDismiss={() => setToastAchievement(null)} />

      {/* Rex header */}
      <div className="mb-4">
        <RexSpeechBubble message={rexMessage} mood={rexMood} />
      </div>

      {/* ── Canvas area ── */}
      <div
        ref={containerRef}
        className="relative bg-white rounded-2xl shadow-lg overflow-hidden mb-4"
        style={{
          width: "100%",
          aspectRatio: `${1086} / ${1448}`,
        }}
      >
        {/* Visible canvas — flood fill target */}
        <canvas
          ref={visibleCanvasRef}
          className="absolute inset-0 w-full h-full select-none touch-none"
          style={{ touchAction: "none" }}
          onPointerDown={handleCanvasPointerDown}
        />
      </div>

      {/* ── Colour palette ── */}
      <div className="flex flex-wrap justify-center gap-3 mb-3">
        {COLORS.map((c) => (
          <button
            key={c.hex}
            onClick={() => setSelectedColor(c.hex)}
            className={`w-10 h-10 rounded-full shadow-md transition-all duration-150 active:scale-90 ${
              selectedColor === c.hex ? "ring-3 ring-secondary ring-offset-2 scale-110" : ""
            }`}
            style={{ backgroundColor: c.hex }}
            aria-label={c.name}
          />
        ))}
      </div>

      {/* Selected colour indicator */}
      <div className="flex justify-center mb-3">
        <span className="text-xs text-mutedText">
          Selected:{" "}
          <span
            className="inline-block w-3 h-3 rounded-full align-middle mx-1"
            style={{ backgroundColor: selectedColor }}
          />{" "}
          {COLORS.find((c) => c.hex === selectedColor)?.name}
        </span>
      </div>

      {/* ── Actions ── */}
      <div className="flex justify-center gap-3 mb-3">
        <button
          onClick={handleUndo}
          disabled={undoStackRef.current.length === 0}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            undoStackRef.current.length === 0
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95"
          }`}
        >
          ↩ Undo
        </button>
        <button
          onClick={handleClear}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-100 text-red-600 hover:bg-red-200 active:scale-95 transition-all"
        >
          ✕ Clear
        </button>
      </div>

      <div className="flex justify-center mb-4">
        <button onClick={handleFinish} className="btn-primary text-lg px-8">
          ✓ Finish
        </button>
      </div>

      {/* ── Progress ── */}
      <p className="text-center text-xs text-mutedText mb-4">
        {progressPct}% coloured
        {progressPct < 10 && ` (need 10% for points)`}
      </p>

      {/* ── Rex ── */}
      <div className="flex justify-center mb-20">
        <Rex className="w-10 h-10" mood={rexMood} />
      </div>

      {/* ── Complete Modal ── */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center">
            <Rex className="w-20 h-20 mx-auto mb-4" mood="excited" />
            <h2 className="text-2xl font-extrabold text-primary mb-2">Masterpiece!</h2>
            <p className="text-lg text-mutedText mb-1">
              You coloured {progressPct}% of Rex!
            </p>
            <p className="text-2xl font-bold text-secondary mb-4">+500 pts</p>
            {500 >= bestScore && <p className="text-sm text-secondary font-bold mb-4">🏆 New Best!</p>}
            <button
              className="btn-primary w-full text-lg"
              onClick={() => {
                setShowComplete(false);
                handleClear();
              }}
            >
              Colour Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
