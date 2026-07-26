import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import Rex from "~/components/Rex";
import brand from "~/branding";
const BoneBuster = lazy(() => import("~/components/games/BoneBuster"));
const ScanSearch = lazy(() => import("~/components/games/ScanSearch"));
const MemoryScan = lazy(() => import("~/components/games/MemoryScan"));
const FindTheFracture = lazy(() => import("~/components/games/FindTheFracture"));
const PulsePop = lazy(() => import("~/components/games/PulsePop"));
const ScanWords = lazy(() => import("~/components/games/ScanWords"));
const WhatsThatScan = lazy(() => import("~/components/games/WhatsThatScan"));
const ColourRex = lazy(() => import("~/components/games/ColourRex"));
const MriMixup = lazy(() => import("~/components/games/MriMixup"));

export const Route = createFileRoute("/play/$gameId")({
  component: PlayGame,
});

const gameMeta: Record<string, { title: string; emoji: string }> = {
  "bone-buster": { title: "Bone Buster", emoji: "🦴" },
  "scan-search": { title: "Scan Search", emoji: "🔍" },
  "memory-scan": { title: "Memory Scan", emoji: "🧠" },
  crossword: { title: "ScanWords", emoji: "📝" },
  "spot-difference": { title: "Find the Fracture", emoji: "🩻" },
  "mri-mixup": { title: "MRI Mix-Up", emoji: "🧩" },
  "ecg-rhythm": { title: "Pulse Pop", emoji: "💓" },
  "whats-that-scan": { title: "What's That Scan?", emoji: "❓" },
  "colour-rex": { title: "Colour Rex", emoji: "🎨" },
};

function GamePlaceholder({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="page-container flex flex-col items-center justify-center min-h-[60vh] text-center">
      <span className="text-6xl mb-4">{emoji}</span>
      <h1 className="text-2xl font-bold text-primary mb-2">{title}</h1>
      <p className="text-mutedText">Coming soon! Our team is building this experience.</p>
      <div className="mt-8">
        <Rex className="w-16 h-16" mood="happy" />
      </div>
    </div>
  );
}

function PlayGame() {
  const { gameId } = Route.useParams();
  const game = gameMeta[gameId] ?? { title: gameId, emoji: "🎮" };

  return (
    <div className="page-container">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-secondary font-medium mb-4 hover:underline"
      >
        ← Back to games
      </Link>
      <div className="card mb-6 flex items-center gap-4">
        <span className="text-4xl">{game.emoji}</span>
        <div>
          <h1 className="text-xl font-bold text-primary">{game.title}</h1>
          <p className="text-sm text-mutedText">PLAY Experience</p>
        </div>
      </div>
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-[40vh]">
            <div className="text-lg text-mutedText animate-pulse">Loading...</div>
          </div>
        }
      >
        {gameId === "bone-buster" ? (
          <BoneBuster />
        ) : gameId === "scan-search" ? (
          <ScanSearch />
        ) : gameId === "memory-scan" ? (
          <MemoryScan />
        ) : gameId === "crossword" ? (
          <GamePlaceholder emoji="📝" title="ScanWords" />
        ) : gameId === "spot-difference" ? (
          <GamePlaceholder emoji="🩻" title="Find the Fracture" />
        ) : gameId === "mri-mixup" ? (
          <MriMixup />
        ) : gameId === "ecg-rhythm" ? (
          <PulsePop />
        ) : gameId === "whats-that-scan" ? (
          <GamePlaceholder emoji="❓" title="What's That Scan?" />
        ) : gameId === "colour-rex" ? (
          <ColourRex />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
            <span className="text-6xl mb-4">🎮</span>
            <h1 className="text-2xl font-bold text-primary mb-2">Unknown Game</h1>
            <p className="text-mutedText">Game "{gameId}" not found.</p>
          </div>
        )}
      </Suspense>
    </div>
  );
}
