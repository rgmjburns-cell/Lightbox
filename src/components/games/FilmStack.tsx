import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Rex from "~/components/Rex";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import { getPlayerName } from "~/components/Onboarding";
import { submitScore } from "~/lib/leaderboard";
import LeaderboardEntry from "~/components/LeaderboardEntry";
import { Link } from "@tanstack/react-router";
import {
  LABELS,
  TILE_H,
  HAND_SIZE,
  boardSize,
  fitScale,
  displayRect,
  dealBoard,
  shufflePositions,
  selectable,
  matchForPick,
  validateMatch,
  handLayout,
  convergeOffset,
  type BoardDims,
  type FilmTile,
  type HandTile,
} from "~/lib/filmStack";

const COMPLETIONS = "filmStackCompletions", LEVEL_KEY = "filmStackLevel";
/** Pre-measure fallback: 393px viewport minus page padding. */
const FALLBACK_W = 361;
/** Same with every reload: a fresh deal, regardless of previous session. */
const SSR_SEEDED_RAND = () => 0.42;

/**
 * Top-level result overlay: portalled into document.body (z-[80]) so no game
 * element — board tiles, tile hand, Rex, animations, floating/explosion FX —
 * can ever paint above it. The backdrop is (near-)opaque so the board can
 * never be seen behind or around the result popup either.
 * Scroll-safe on small screens so text/buttons are never cut off.
 */
function FilmStackModal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/95 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center my-auto max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default function FilmStack() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";
  void playerName;
  // Level persists; the BOARD never does. A reload always deals a fresh,
  // winnable board for the saved level — mid-game tiles/hand are never
  // rehydrated from a previous session (fixes stale-tile state bug).
  const [level, setLevel] = useState(() =>
    typeof window === "undefined" ? 1 : Math.min(10, Math.max(1, Number(localStorage.getItem(LEVEL_KEY) || 1))),
  );
  const [tiles, setTiles] = useState<FilmTile[]>(() =>
    typeof window === "undefined"
      ? dealBoard(level, FALLBACK_W, SSR_SEEDED_RAND)
      : dealBoard(level, FALLBACK_W),
  );
  const [hand, setHand] = useState<number[]>([]);
  const [flying, setFlying] = useState<number | null>(null);
  const [match, setMatch] = useState<number[]>([]);
  const [fragments, setFragments] = useState(false);
  const [scorePop, setScorePop] = useState(false);
  const [shake, setShake] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [win, setWin] = useState(false);
  // Board just cleared (level < 10): success modal blocks progression until
  // the player presses NEXT LEVEL. Holds the completed level number.
  const [levelClear, setLevelClear] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [completions, setCompletions] = useState(0);
  const [message, setMessage] = useState("Tap an uncovered tile to add it to your hand!");
  const [mood, setMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const initialCompletionsRef = useRef(0);
  const submitFiredRef = useRef(false);
  const [submitRank, setSubmitRank] = useState<number | null>(null);

  // Actual available board width, measured from the container (not the window).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const widthRef = useRef(FALLBACK_W);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) {
        widthRef.current = w;
        setContainerW(w);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const effW = containerW > 0 ? containerW : FALLBACK_W;

  // Fresh-tile mirror so delayed match validation reads committed state.
  const tilesRef = useRef(tiles);
  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);

  useEffect(() => {
    const n = Number(localStorage.getItem(COMPLETIONS) || 0);
    const v = Number.isFinite(n) ? n : 0;
    setCompletions(v);
    initialCompletionsRef.current = v;
  }, []);
  useEffect(() => {
    if (!gameOver && !win) return;
    if (submitFiredRef.current) return;
    submitFiredRef.current = true;
    const run = completions - initialCompletionsRef.current;
    if (run <= 0) return;
    submitScore("film-stack", run).then((r) => {
      if (r) setSubmitRank(r.rank);
    });
  }, [gameOver, win, completions]);

  const selectableIds = useMemo(() => new Set(tiles.filter((t) => selectable(t, tiles)).map((t) => t.id)), [tiles]);
  const remaining = tiles.filter((t) => !t.cleared).length;
  const runCompletions = Math.max(0, completions - initialCompletionsRef.current);

  // Overall-fit scale only; per-tile clamping (displayRect) is the real fix.
  const { w: boardW, h: boardH } = useMemo(() => boardSize(tiles), [tiles]);
  const scale = fitScale(boardW, effW);
  // realW = the ACTUAL measured box width, so even the pre-measurement frame
  // (effW falls back to FALLBACK_W) clamps tiles inside the real container.
  const dims: BoardDims = { boardW, containerW: effW, scale, realW: widthRef.current };
  // Compact centred hand row; slots shrink only to fit narrow panels.
  const layout = useMemo(() => handLayout(Math.max(0, effW - 16)), [effW]);

  const reset = useCallback(
    (newLevel = level) => {
      setLevel(newLevel);
      localStorage.setItem(LEVEL_KEY, String(newLevel));
      setTiles(dealBoard(newLevel, widthRef.current || FALLBACK_W));
      setHand([]);
      setMatch([]);
      setFlying(null);
      setGameOver(false);
      setWin(false);
      setLevelClear(null);
      setLocked(false);
      setFragments(false);
      setScorePop(false);
      setShake(false);
      setMessage("Tap an uncovered tile to add it to your hand!");
      setMood("happy");
    },
    [level],
  );
  const complete = useCallback(
    (updated: FilmTile[]) => {
      if (!updated.some((t) => !t.cleared)) {
        const n = Number(localStorage.getItem(COMPLETIONS) || 0) + 1;
        localStorage.setItem(COMPLETIONS, String(n));
        setCompletions(n);
        if (level < 10) {
          setMessage(`Level ${level} complete! Next level unlocked.`);
          setMood("excited");
          // No auto-advance: the BOARD CLEARED modal owns progression —
          // NEXT LEVEL is the only path to reset(level + 1).
          setLevelClear(level);
        } else {
          setWin(true);
          setMessage("All ten levels complete! 🎉");
          setMood("excited");
        }
      }
    },
    [level, reset],
  );
  const click = useCallback(
    (id: number) => {
      if (locked || gameOver || win || levelClear !== null || flying !== null) return;
      const tile = tiles.find((t) => t.id === id);
      if (!tile || tile.cleared || tile.inHand) return;
      if (!selectableIds.has(id)) {
        setShake(true);
        setTimeout(() => setShake(false), 280);
        return;
      }
      if (hand.length >= HAND_SIZE) {
        setMessage("Your hand is full — return a tile first.");
        return;
      }
      setLocked(true);
      setFlying(id);
      setTimeout(() => {
        setFlying(null);
        setTiles((prev) => prev.map((t) => (t.id === id ? { ...t, inHand: true } : t)));
        const pickedImageId = tile.imageId;
        const next = [...hand, id];
        const handTiles: HandTile[] = next.map((x) => ({
          id: x,
          imageId: x === id ? pickedImageId : (tiles.find((t) => t.id === x)?.imageId ?? 0),
        }));
        const ids = matchForPick(handTiles, pickedImageId);
        if (ids !== null) {
          setHand(next);
          setMatch(ids);
          setFragments(false);
          setScorePop(true);
          setShake(true);
          setMessage("SMASH! Perfect match! +100");
          setMood("excited");
          setTimeout(() => {
            // Re-validate immediately before animating/removing: exactly 2
            // tiles, both in hand, both sharing one identifier.
            const cur = tilesRef.current;
            const inHandNow: HandTile[] = next.map((x) => {
              const t = cur.find((p) => p.id === x);
              return { id: x, imageId: t && t.inHand && !t.cleared ? t.imageId : -1 };
            });
            if (!validateMatch(inHandNow, ids)) {
              // Invalid: remove nothing from the board, return hand tiles and
              // safely clear the stale selection/match state.
              setTiles((prev) => prev.map((t) => (next.includes(t.id) ? { ...t, inHand: false } : t)));
              setHand([]);
              setMatch([]);
              setScorePop(false);
              setShake(false);
              setLocked(false);
              setMessage("Hmm — that set didn't check out. Tiles returned, keep going!");
              setMood("encouraging");
              return;
            }
            setTiles((prev) => {
              const u = prev.map((t) => (ids.includes(t.id) ? { ...t, cleared: true, inHand: false } : t));
              complete(u);
              return u;
            });
            setHand((h) => h.filter((x) => !ids.includes(x)));
            setMatch([]);
            setFragments(true);
            setTimeout(() => setFragments(false), 500);
            setScorePop(false);
            setShake(false);
            setLocked(false);
          }, 650);
        } else {
          setHand(next);
          if (next.length === HAND_SIZE) {
            const unique = new Set(handTiles.map((h) => h.imageId));
            if (unique.size === HAND_SIZE) {
              setGameOver(true);
              setMessage("Game over — hand is full of different tiles!");
              setMood("encouraging");
            } else setMessage("A pair is ready in your hand — tap it to return a tile and keep playing!");
          } else setMessage(`${HAND_SIZE - next.length} hand slot${HAND_SIZE - next.length === 1 ? "" : "s"} left`);
          setLocked(false);
        }
      }, 380);
    },
    [locked, gameOver, win, levelClear, flying, tiles, selectableIds, hand, complete],
  );
  const returnTile = (id: number) => {
    if (locked || hand.length < HAND_SIZE || gameOver) return;
    setHand((h) => h.filter((x) => x !== id));
    setTiles((ts) => ts.map((t) => (t.id === id ? { ...t, inHand: false } : t)));
    setMessage("Tile returned — choose wisely!");
  };
  const shuffleBoard = () => {
    if (gameOver || win || levelClear !== null || locked || flying !== null) return;
    // Positions only — identifiers never move; stale match state cleared.
    setTiles((ts) => shufflePositions(ts, Math.random, widthRef.current || FALLBACK_W));
    setMatch([]);
    setMessage("Board shuffled — your hand is safe.");
  };
  const sorted = [...tiles].sort((a, b) => a.layer - b.layer || a.row - b.row || a.col - b.col);

  return (
    <div className={`page-container max-w-lg mx-auto overflow-x-hidden ${shake ? "film-screen-shake" : ""}`}>
      <div className="mb-2">
        <RexSpeechBubble message={message} mood={mood} />
      </div>
      <div className="card mb-2 p-2 flex items-center justify-between">
        <div className="text-center flex-1">
          <span className="text-xs text-mutedText uppercase font-semibold">Tiles Left</span>
          <div className="text-2xl font-bold text-primary">{remaining}</div>
        </div>
        <div className="text-center flex-1">
          <span className="text-xs text-mutedText uppercase font-semibold">Level</span>
          <div className="text-2xl font-bold text-primary">{level}/10</div>
        </div>
        <div className="text-center flex-1">
          <span className="text-xs text-mutedText uppercase font-semibold">Boards Done</span>
          <div className="text-2xl font-bold text-secondary">{completions}</div>
        </div>
      </div>
      <div className="flex justify-center gap-2 mb-2">
        <button
          className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 text-white border border-white/20"
          onClick={shuffleBoard}
        >
          🔀 Shuffle
        </button>
        <button
          className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 text-white border border-white/20"
          onClick={() => {
            initialCompletionsRef.current = completions;
            submitFiredRef.current = false;
            reset();
          }}
        >
          🔄 New
        </button>
      </div>
      <div className="flex justify-center mb-2">
        <div ref={wrapRef} className="relative w-full" style={{ height: boardH * scale }}>
          {sorted
            .filter((t) => !t.cleared && (!t.inHand || t.id === flying))
            .map((t) => {
              const r = displayRect(t, dims);
              return (
                <div
                  key={t.id}
                  onClick={() => click(t.id)}
                  className={`film-board-tile absolute ${flying === t.id ? "film-tile-flying" : ""}`}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: t.layer * 100 + t.row * 10 + t.col }}
                >
                  <div className="film-tile-art w-full h-full">
                    <img src={t.art} alt={LABELS[t.type]} className="w-full h-full object-contain" draggable={false} />
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      <section className="rounded-2xl p-2 mb-2 border border-white/15 bg-slate-900/60">
        <div className="flex justify-between mb-2">
          <h3 className="text-sm font-bold text-white uppercase">Tile hand</h3>
          <span className="text-xs text-white/60">
            {hand.length}/{HAND_SIZE}
          </span>
        </div>
        <div className="flex justify-center" style={{ gap: layout.gap }}>
          {Array.from({ length: HAND_SIZE }, (_, slot) => {
            const t = tiles.find((x) => x.id === hand[slot]);
            const matched = !!t && match.includes(t.id);
            return (
              <button
                key={slot}
                disabled={!t || hand.length < HAND_SIZE}
                onClick={() => t && returnTile(t.id)}
                className={`film-hand-slot rounded-xl flex items-center justify-center border ${
                  t ? "border-transparent" : "bg-white/5 border-dashed border-white/20"
                } ${matched ? "film-tile-smash" : ""}`}
                style={{
                  width: layout.slot,
                  height: layout.slot,
                  aspectRatio: "1 / 1",
                  ["--smash-x" as string]: matched ? `${convergeOffset(slot, layout)}px` : "0px",
                }}
              >
                {t && (
                  <img
                    src={t.art}
                    alt={LABELS[t.type]}
                    className="object-contain"
                    style={{ width: layout.slot - 8, height: layout.slot - 8 }}
                    draggable={false}
                  />
                )}
              </button>
            );
          })}
        </div>
      </section>
      <div className="flex justify-center mb-8">
        <Rex className="w-10 h-10" mood={mood} />
      </div>
      {(gameOver || win) && (
        <FilmStackModal>
          {gameOver ? (
            <>
              <h2 className="text-2xl font-extrabold text-primary mb-2">Bad luck!</h2>
              <p className="text-mutedText mb-5">Your hand is full of different tiles — nice try!</p>
              {runCompletions > 0 && (
                <LeaderboardEntry game="film-stack" score={runCompletions} rank={submitRank} onRank={setSubmitRank} />
              )}
              <button
                className="btn-primary w-full"
                onClick={() => {
                  initialCompletionsRef.current = completions;
                  submitFiredRef.current = false;
                  reset();
                }}
              >
                Try Again
              </button>
              <Link to="/" className="btn-secondary w-full text-lg mt-4 block">
                Back to Games
              </Link>
            </>
          ) : (
            <>
              <Rex className="w-16 h-16 mx-auto mb-3" mood="excited" />
              <h2 className="text-2xl font-extrabold text-primary mb-1">FILM STACK COMPLETE!</h2>
              <p className="text-mutedText mb-1">All ten levels cleared</p>
              <p className="text-lg font-bold text-secondary mb-5">
                Boards completed this sitting: {runCompletions}
              </p>
              {runCompletions > 0 && (
                <LeaderboardEntry game="film-stack" score={runCompletions} rank={submitRank} onRank={setSubmitRank} />
              )}
              <button
                className="btn-primary w-full"
                onClick={() => {
                  initialCompletionsRef.current = completions;
                  submitFiredRef.current = false;
                  reset(1);
                }}
              >
                Play Again
              </button>
              <Link to="/" className="btn-secondary w-full text-lg mt-4 block">
                Back to Games
              </Link>
            </>
          )}
        </FilmStackModal>
      )}
      {levelClear !== null && (
        <FilmStackModal>
          <Rex className="w-16 h-16 mx-auto mb-3" mood="excited" />
          <p className="text-sm text-secondary font-bold mb-1" aria-hidden="true">
            <span className="inline-block">✧</span> <span className="inline-block">✦</span>
          </p>
          <h2 className="text-2xl font-extrabold text-primary mb-1">BOARD CLEARED!</h2>
          <p className="text-mutedText mb-5">Level {levelClear} Complete</p>
          <button className="btn-primary w-full text-lg" onClick={() => reset(levelClear + 1)}>
            Next Level
          </button>
          <Link to="/" className="btn-secondary w-full text-lg mt-4 block">
            Back to Games
          </Link>
        </FilmStackModal>
      )}
      {scorePop && <div className="film-score-popup">+100</div>}
      {fragments && (
        <div className="film-explosion" aria-hidden="true">
          <div className="film-explosion-ring" />
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ "--particle-angle": `${i * 25.7}deg` } as React.CSSProperties}>
              {i % 2 ? "✧" : "✦"}
            </i>
          ))}
        </div>
      )}
      <style>{`.film-tile-art{width:100%;height:100%}.film-tile-art img{display:block;width:100%;height:100%;object-fit:contain;background:transparent;filter:drop-shadow(0 3px 3px rgba(0,0,0,.35))}.film-board-tile:hover{transform:scale(1.06)}.film-board-tile:hover .film-tile-art img{filter:brightness(1.08) drop-shadow(0 4px 5px rgba(0,0,0,.4))}.film-board-tile:active .film-tile-art img{filter:brightness(.93)}.film-board-tile{cursor:pointer;transition:transform .3s ease-out}.film-tile-flying{animation:filmFly .38s ease-out forwards;pointer-events:none}.film-tile-smash{animation:filmSmash .65s ease-in forwards;z-index:3}@keyframes filmFly{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(0,clamp(190px,43vh,440px)) scale(.68);opacity:0}}@keyframes filmSmash{0%{transform:translateX(0) scale(1)}28%{transform:translateX(var(--smash-x)) scale(1.5);filter:brightness(2.2) saturate(1.4)}52%{transform:translateX(var(--smash-x)) scale(1.75);filter:brightness(5) saturate(1.8)}100%{transform:translateX(var(--smash-x)) scale(0);opacity:0}}.film-screen-shake{animation:filmShake .42s ease-out}@keyframes filmShake{20%{transform:translate(-12px,3px)}40%{transform:translate(13px,-4px)}60%{transform:translate(-10px,2px)}80%{transform:translate(7px,-2px)}}.film-score-popup{position:fixed;z-index:60;left:50%;top:55%;font-size:2rem;font-weight:900;color:#fbbf24;text-shadow:0 2px 5px #000;animation:scoreUp .7s ease-out forwards}@keyframes scoreUp{to{transform:translateY(-70px);opacity:0}}.film-explosion{position:fixed;z-index:59;left:50%;top:54%;width:20px;height:20px;pointer-events:none}.film-explosion-ring{position:absolute;inset:-8px;border:4px solid #67e8f9;border-radius:999px;box-shadow:0 0 18px #fff,0 0 30px #22d3ee;animation:ringBurst .6s ease-out forwards}.film-explosion i{position:absolute;left:0;top:0;font-style:normal;font-size:1.35rem;font-weight:900;color:#a5f3fc;text-shadow:0 0 8px #fff,0 0 14px #06b6d4;animation:particleBurst .65s cubic-bezier(.15,.7,.25,1) forwards;transform:rotate(var(--particle-angle)) translateY(0)}@keyframes particleBurst{to{transform:rotate(var(--particle-angle)) translateY(-105px) scale(.3);opacity:0}}@keyframes ringBurst{to{transform:scale(7);opacity:0}}`}</style>
    </div>
  );
}
