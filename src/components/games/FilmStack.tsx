import { useState, useEffect, useCallback, useMemo } from "react";
import Rex from "~/components/Rex";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import { getPlayerName } from "~/components/Onboarding";

type TileType = "bone" | "xray-hand" | "xray-chest" | "mri" | "xray-skull";
interface Tile { id: number; pairId: number; type: TileType; col: number; row: number; layer: number; cleared: boolean; inHand: boolean; }
const TILE_TYPES: TileType[] = ["bone", "xray-hand", "xray-chest", "mri", "xray-skull"];
const TILE_IMAGES: Record<TileType, string> = { bone: "/bone.png", "xray-hand": "/xray-hand.png", "xray-chest": "/xray-chest.png", mri: "/mri-puzzle.png", "xray-skull": "/xray-skull.png" };
const TILE_LABELS: Record<TileType, string> = { bone: "BONE", "xray-hand": "HAND", "xray-chest": "CHEST", mri: "MRI", "xray-skull": "SKULL" };
const COLS = 8, ROWS = 7, MAX_LAYERS = 3;
// 1.5x the original 56x66 tile. The board scales down as one unit on narrow phones.
const CELL_W = 72, CELL_H = 87, LAYER_OFFSET_X = 36, LAYER_OFFSET_Y = 43.5;
const TILE_W = 84, TILE_H = 99, TOTAL_TILES = 48, HAND_SIZE = 4;
const COMPLETIONS_KEY = "filmStackCompletions";
function shuffleArray<T>(arr: T[]) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function getAllPositions() { const out: { col: number; row: number; layer: number }[] = []; for (let layer = 0; layer < MAX_LAYERS; layer++) for (let col = 0; col < COLS - layer; col++) for (let row = 0; row < ROWS - layer; row++) out.push({ col, row, layer }); return out; }
function generateTiles(): Tile[] {
  const chosen = shuffleArray(getAllPositions()).slice(0, TOTAL_TILES);
  const types: TileType[] = []; for (let i = 0; i < TOTAL_TILES / 2; i++) { const t = TILE_TYPES[i % TILE_TYPES.length]; types.push(t, t); }
  const shuffled = shuffleArray(types); const pairIds: number[] = []; const counts = new Map<TileType, number>(); let pid = 0;
  for (const type of shuffled) { const count = counts.get(type) || 0; if (count % 2 === 0) pid++; pairIds.push(pid); counts.set(type, count + 1); }
  return chosen.map((p, i) => ({ ...p, id: i, pairId: pairIds[i], type: shuffled[i], cleared: false, inHand: false }));
}
function tilePos(t: { col: number; row: number; layer: number }) { return { x: t.col * CELL_W + t.layer * LAYER_OFFSET_X, y: t.row * CELL_H + t.layer * LAYER_OFFSET_Y }; }
function box(t: { col: number; row: number; layer: number }) { const p = tilePos(t); return { left: p.x, right: p.x + TILE_W, top: p.y, bottom: p.y + TILE_H }; }
function covers(a: Tile, b: Tile) { if (a.layer <= b.layer) return false; const x = box(a), y = box(b); const w = Math.min(x.right, y.right) - Math.max(x.left, y.left); const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top); return w > 0 && h > 0 && w * h >= TILE_W * TILE_H * .25; }
function selectable(tile: Tile, all: Tile[]) {
  if (tile.cleared || tile.inHand) return false;
  if (all.some(t => !t.cleared && !t.inHand && t.id !== tile.id && covers(t, tile))) return false;
  const left = all.some(t => !t.cleared && !t.inHand && t.layer === tile.layer && t.row === tile.row && t.col === tile.col - 1);
  const right = all.some(t => !t.cleared && !t.inHand && t.layer === tile.layer && t.row === tile.row && t.col === tile.col + 1);
  return !left || !right;
}

export default function FilmStack() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "Player";
  const [tiles, setTiles] = useState<Tile[]>(() => generateTiles());
  const [handIds, setHandIds] = useState<number[]>([]);
  const [matchAnimIds, setMatchAnimIds] = useState<number[]>([]);
  const [rexMessage, setRexMessage] = useState("Tap an uncovered tile to add it to your hand!");
  const [rexMood, setRexMood] = useState<"happy" | "excited" | "encouraging">("happy");
  const [showWin, setShowWin] = useState(false), [locked, setLocked] = useState(false);
  const [completions, setCompletions] = useState(0), [shufflesUsed, setShufflesUsed] = useState(0);
  const [shakingTileId, setShakingTileId] = useState<number | null>(null);
  useEffect(() => { const n = parseInt(localStorage.getItem(COMPLETIONS_KEY) || "0", 10); setCompletions(Number.isNaN(n) ? 0 : n); }, []);
  useEffect(() => { if (shakingTileId !== null) { const t = setTimeout(() => setShakingTileId(null), 320); return () => clearTimeout(t); } }, [shakingTileId]);
  const remainingTiles = useMemo(() => tiles.filter(t => !t.cleared).length, [tiles]);
  const selectableIds = useMemo(() => new Set(tiles.filter(t => selectable(t, tiles)).map(t => t.id)), [tiles]);
  const boardDims = useMemo(() => { let w = 0, h = 0; tiles.forEach(t => { const p = tilePos(t); w = Math.max(w, p.x + TILE_W); h = Math.max(h, p.y + TILE_H); }); return { w, h }; }, [tiles]);
  const scaleFactor = typeof window === "undefined" ? 1 : Math.min(1, (window.innerWidth - 32) / boardDims.w);
  const newGame = useCallback(() => { setTiles(generateTiles()); setHandIds([]); setMatchAnimIds([]); setShowWin(false); setLocked(false); setShufflesUsed(0); setShakingTileId(null); setRexMessage("Tap an uncovered tile to add it to your hand!"); setRexMood("happy"); }, []);
  const shuffleRemaining = useCallback(() => {
    setTiles(prev => { const active = prev.filter(t => !t.cleared && !t.inHand), positions = shuffleArray(active.map(t => ({ col: t.col, row: t.row, layer: t.layer }))); return prev.map(t => { const i = active.findIndex(a => a.id === t.id); return i < 0 ? t : { ...t, ...positions[i] }; }); });
    setShufflesUsed(n => n + 1); setRexMessage("Board shuffled — keep filling your hand!"); setRexMood("encouraging");
  }, []);
  const completeIfNeeded = useCallback((nextTiles: Tile[]) => {
    if (nextTiles.every(t => t.cleared)) { setShowWin(true); setRexMessage("Board complete! Amazing! 🎉"); setRexMood("excited"); const current = parseInt(localStorage.getItem(COMPLETIONS_KEY) || "0", 10); const next = (Number.isNaN(current) ? 0 : current) + 1; localStorage.setItem(COMPLETIONS_KEY, String(next)); setCompletions(next); }
  }, []);
  const handleTileClick = useCallback((id: number) => {
    if (locked) return; const tile = tiles.find(t => t.id === id); if (!tile || tile.cleared || tile.inHand) return;
    if (!selectableIds.has(id)) { setShakingTileId(id); return; }
    if (handIds.length >= HAND_SIZE) { setRexMessage("Your hand is full — send one tile back first."); setRexMood("encouraging"); return; }
    const nextHand = [...handIds, id]; const match = nextHand.findIndex((otherId) => otherId !== id && tiles.find(t => t.id === otherId)?.type === tile.type);
    setTiles(prev => prev.map(t => t.id === id ? { ...t, inHand: true } : t));
    if (match >= 0) {
      const firstId = nextHand[match]; setLocked(true); setMatchAnimIds([firstId, id]); setHandIds(nextHand.filter(x => x !== firstId && x !== id)); setRexMessage("Smash! Nice match!"); setRexMood("excited");
      setTimeout(() => { setTiles(prev => { const updated = prev.map(t => t.id === firstId || t.id === id ? { ...t, cleared: true, inHand: false } : t); completeIfNeeded(updated); return updated; }); setMatchAnimIds([]); setLocked(false); }, 520);
    } else { setHandIds(nextHand); setRexMessage(`${HAND_SIZE - nextHand.length} hand slot${HAND_SIZE - nextHand.length === 1 ? "" : "s"} left`); setRexMood("happy"); }
  }, [locked, tiles, selectableIds, handIds, completeIfNeeded]);
  const returnFromHand = useCallback((id: number) => {
    if (locked || handIds.length < HAND_SIZE) return;
    setHandIds(ids => ids.filter(x => x !== id)); setTiles(prev => prev.map(t => t.id === id ? { ...t, inHand: false } : t)); setRexMessage("Tile returned to the board — make room for a match!"); setRexMood("encouraging");
  }, [locked, handIds.length]);
  const sorted = useMemo(() => [...tiles].sort((a, b) => a.layer - b.layer || a.row - b.row || a.col - b.col), [tiles]);
  return <div className="page-container max-w-lg mx-auto overflow-x-hidden">
    <div className="mb-4"><RexSpeechBubble message={rexMessage} mood={rexMood} /></div>
    <div className="card mb-3 p-3 flex items-center justify-between"><div className="text-center flex-1"><span className="text-xs text-mutedText uppercase font-semibold">Tiles Left</span><div className="text-2xl font-bold text-primary">{remainingTiles}</div></div><div className="text-center flex-1"><span className="text-xs text-mutedText uppercase font-semibold">Boards Done</span><div className="text-2xl font-bold text-secondary">{completions}</div></div></div>
    <div className="flex justify-center gap-2 mb-4"><button className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 text-white border border-white/20 hover:bg-white/20 active:scale-95" onClick={shuffleRemaining}>🔀 Shuffle</button><button className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 text-white border border-white/20 hover:bg-white/20 active:scale-95" onClick={newGame}>🔄 New</button></div>
    <div className="flex justify-center mb-3 w-full"><div className="relative" style={{ width: boardDims.w * scaleFactor, height: boardDims.h * scaleFactor }}><div className="absolute top-0 left-1/2" style={{ width: boardDims.w, height: boardDims.h, transform: `translateX(-50%) scale(${scaleFactor})`, transformOrigin: "top center" }}>{sorted.filter(t => !t.cleared && !t.inHand).map(tile => { const p = tilePos(tile), can = selectableIds.has(tile.id), smash = matchAnimIds.includes(tile.id); return <div key={tile.id} className={`absolute cursor-pointer ${smash ? "animate-[tileSmash_0.52s_ease-in_forwards]" : ""} ${!can ? "opacity-65" : ""}`} style={{ left: p.x, top: p.y, width: TILE_W, height: TILE_H, zIndex: tile.layer * 100 + tile.row * 10 + tile.col, animation: shakingTileId === tile.id ? "tileWiggle .3s ease-in-out" : undefined }} onClick={() => handleTileClick(tile.id)}><div className="w-full h-full rounded-lg flex items-center justify-center p-2" style={{ background: "linear-gradient(135deg,#f8fafc,#e2e8f0)", border: "1px solid rgba(255,255,255,.4)", boxShadow: `0 ${2 + tile.layer}px ${6 + tile.layer * 3}px rgba(0,0,0,.${15 + tile.layer * 5})` }}><img src={TILE_IMAGES[tile.type]} alt={TILE_LABELS[tile.type]} className="w-12 h-12 object-contain" draggable={false} /></div></div>; })}</div></div></div>
    <section className="rounded-2xl p-3 mb-4 border border-white/15 bg-slate-900/60 shadow-inner"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold text-white uppercase tracking-wide">Tile hand</h3><span className="text-xs text-white/60">{handIds.length}/{HAND_SIZE}</span></div><div className="grid grid-cols-4 gap-2">{Array.from({ length: HAND_SIZE }, (_, slot) => { const tile = tiles.find(t => t.id === handIds[slot]); return <button key={slot} aria-label={tile ? `Return ${TILE_LABELS[tile.type]} tile` : "Empty hand slot"} disabled={!tile || handIds.length < HAND_SIZE} onClick={() => tile && returnFromHand(tile.id)} className={`h-[76px] rounded-xl flex items-center justify-center border transition-all ${tile ? "bg-slate-100 border-white/50" : "bg-white/5 border-dashed border-white/20"} ${tile && handIds.length === HAND_SIZE ? "hover:scale-105 cursor-pointer" : "cursor-default"}`}>{tile && <img src={TILE_IMAGES[tile.type]} alt={TILE_LABELS[tile.type]} className="w-11 h-11 object-contain" draggable={false} />}</button>; })}</div><p className="text-center text-[11px] text-white/55 mt-2">When full, tap a tile to return it to the board</p></section>
    <div className="flex justify-center mb-20"><Rex className="w-10 h-10" mood={rexMood} /></div>
    {showWin && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"><div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-[scaleIn_.4s_ease-out]"><Rex className="w-20 h-20 mx-auto mb-4" mood="excited" /><h2 className="text-2xl font-extrabold text-primary mb-2">Board Complete!</h2><p className="text-mutedText mb-1">You cleared all the tiles!</p><p className="text-sm text-secondary font-medium mb-4">Boards completed: {completions}</p><button className="btn-primary w-full" onClick={newGame}>Play Again</button></div></div>}
    <style>{`@keyframes scaleIn{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}} @keyframes tileSmash{0%{transform:scale(1);opacity:1}45%{transform:scale(1.35);opacity:1;filter:brightness(1.5)}100%{transform:scale(0);opacity:0}}`}</style>
  </div>;
}
