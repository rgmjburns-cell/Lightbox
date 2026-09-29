import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useGameRound } from "~/lib/metrics";
import brand from "~/lib/brand";
const BoneBuster = lazy(() => import("~/components/games/BoneBuster"));
const ScanSearch = lazy(() => import("~/components/games/ScanSearch"));
const MemoryScan = lazy(() => import("~/components/games/MemoryScan"));
const PulsePop = lazy(() => import("~/components/games/PulsePop"));
const ColourRex = lazy(() => import("~/components/games/ColourRex"));
const MriMixup = lazy(() => import("~/components/games/MriMixup"));
const FilmStack = lazy(() => import("~/components/games/FilmStack"));
const ScanRush = lazy(() => import("~/components/games/ScanRush"));
export const Route = createFileRoute("/play/$gameId")({
  component: PlayGame,
});
const gameMeta: Record<string, { title: string; icon: string }> = {
  "bone-buster": { title: "Bone Buster", icon: "/icons/icon-bone-buster.png" },
  "scan-search": { title: "Scan Search", icon: "/icons/icon-scan-search.png" },
  "memory-scan": { title: "Memory Scan", icon: "/icons/icon-memory-scan.png" },
  "mri-mixup": { title: "MRI Mix-Up", icon: "/icons/icon-mri-mixup.png" },
  "ecg-rhythm": { title: "Pulse Pop", icon: "/icons/icon-pulse-pop.png" },
  "colour-rex": { title: "Colour Rex", icon: "/icons/icon-colour-rex.png" },
  "film-stack": { title: "Film Stack", icon: "/icons/icon-film-stack.png" },
  "scan-rush": { title: "Scan Quest", icon: "/icons/icon-scan-rush.png" },
};
function PlayGame() {
  const { gameId } = Route.useParams();
  useGameRound(gameMeta[gameId] ? gameId : null);
  const game = gameMeta[gameId] ?? { title: gameId, icon: "" };
  return (
    <div className="page-container">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-secondary font-medium mb-4 hover:underline"
      >
        ← Back to games
      </Link>
      {/* The title tile: the game's icon and name on the left, this brand's mark
          right-aligned inside the tile. The mark is drawn at one fixed height
          (`h-8`, 32 CSS px) with `w-auto`, so every brand's artwork sits on the
          same baseline and scales by its own ratio, and it is capped by width so
          a very wide lockup can never push the game name. The card's own `p-5`
          keeps it clear of the tile edge; `ml-auto` pins it right whatever the
          game name's width. */}
      <div className="card mb-6 flex items-center gap-4">
        {game.icon ? (
          <img src={game.icon} alt={game.title} draggable={false} className="w-14 h-14 rounded-xl object-contain select-none" />
        ) : (
          <span className="text-4xl">🎮</span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-primary whitespace-nowrap">{game.title}</h1>
          <p className="text-sm text-mutedText">Game</p>
        </div>
        <img
          src={brand.tileLogoUrl}
          alt={brand.brandName}
          draggable={false}
          className="ml-auto h-8 w-auto max-w-[34%] shrink-0 object-contain object-right select-none"
        />
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
        ) : gameId === "mri-mixup" ? (
          <MriMixup />
        ) : gameId === "ecg-rhythm" ? (
          <PulsePop />
        ) : gameId === "colour-rex" ? (
          <ColourRex />
        ) : gameId === "film-stack" ? (
          <FilmStack />
        ) : gameId === "scan-rush" ? (
          <ScanRush />
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
