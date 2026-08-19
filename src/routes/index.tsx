import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Rex from "~/components/Rex";
import InstallBanner from "~/components/InstallBanner";
import { getPlayerName } from "~/components/Onboarding";
import { getTotalPoints } from "~/lib/points";
import brand from "~/branding";

export const Route = createFileRoute("/")({
  component: Home,
});

const playExperiences = [
  {
    id: "scan-rush",
    title: "Scan Rush",
    subtitle: "Tap the lit bay — fast!",
    icon: "/icons/icon-scan-rush.png",
    color: "from-secondary to-primary/60",
    built: true,
  },
  {
    id: "bone-buster",
    title: "Bone Buster",
    subtitle: "Match-3 puzzle",
    icon: "/icons/icon-bone-buster.png",
    color: "from-secondary to-secondary/70",
    built: true,
  },
  {
    id: "memory-scan",
    title: "Memory Scan",
    subtitle: "Match X-ray pairs",
    icon: "/icons/icon-memory-scan.png",
    color: "from-primary/80 to-secondary/70",
    built: true,
  },
  {
    id: "mri-mixup",
    title: "MRI Mix-Up",
    subtitle: "Sliding puzzle",
    icon: "/icons/icon-mri-mixup.png",
    color: "from-primary/70 to-secondary/60",
    built: true,
  },
  {
    id: "ecg-rhythm",
    title: "Pulse Pop",
    subtitle: "ECG rhythm game",
    icon: "/icons/icon-pulse-pop.png",
    color: "from-secondary to-primary/50",
    built: true,
  },
  {
    id: "colour-rex",
    title: "Colour Rex",
    subtitle: "Colour the mascot",
    icon: "/icons/icon-colour-rex.png",
    color: "from-secondary/80 to-primary/50",
    built: true,
  },
  {
    id: "film-stack",
    title: "Film Stack",
    subtitle: "Mahjong solitaire",
    icon: "/icons/icon-film-stack.png",
    color: "from-primary/60 to-secondary/50",
    built: true,
  },
  {
    id: "scan-search",
    title: "Scan Search",
    subtitle: "Find radiology terms",
    icon: "/icons/icon-scan-search.png",
    color: "from-primary to-primary/70",
    built: true,
  },
];

function Home() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : null;
  const [totalScore, setTotalScore] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setTotalScore(getTotalPoints());
  }, []);

  return (
    <div className="page-container">
      {/* ── Header with Rex ── */}
      <div className="mb-6 mt-2 flex items-center gap-4">
        <Rex className="w-16 h-16 shrink-0" mood="happy" />
        <div>
          <h1 className="text-xl font-bold text-white">
            {playerName ? `Hi, ${playerName}!` : "LightBox PLAY"}
          </h1>
          <p className="text-sm text-white/70">
            {playerName ? "Ready to play?" : brand.welcomeMessage}
          </p>
        </div>
      </div>

      {/* ── Score Bar ── */}
      {playerName && (
        <div className="card mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-mutedText uppercase tracking-wide">Total Score</p>
            <p className="text-2xl font-bold text-primary">{totalScore.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-mutedText uppercase tracking-wide">Next Badge</p>
            <p className="text-sm font-medium text-secondary">🩻 First Scan</p>
          </div>
        </div>
      )}

      {/* ── Leaderboard Teaser ── */}
      {playerName && (
        <Link to="/leaderboard" className="card mb-4 flex items-center gap-3 hover:shadow-md transition-shadow">
          <span className="text-2xl">🏆</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-primary">Monthly Leaderboard</p>
            <p className="text-xs text-mutedText">See who's on top this month!</p>
          </div>
          <span className="text-secondary text-sm font-medium">View →</span>
        </Link>
      )}

      {/* ── Section Title ── */}
      <h2 className="text-lg font-bold text-white mb-4">PLAY Experiences</h2>

      {/* ── Game Grid ── */}
      <div className="grid grid-cols-2 gap-3">
        {playExperiences.map((game) =>
          game.built ? (
            <Link
              key={game.id}
              to="/play/$gameId"
              params={{ gameId: game.id }}
              className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${game.color}
                          p-4 shadow-md active:scale-95 transition-all duration-150
                          min-h-[120px] flex flex-col justify-between`}
            >
              <img
                src={game.icon}
                alt={game.title}
                draggable={false}
                className="w-12 h-12 rounded-xl object-contain select-none"
              />
              <div>
                <h3 className="text-white font-bold text-sm">{game.title}</h3>
                <p className="text-white/70 text-xs mt-0.5">{game.subtitle}</p>
              </div>
              <div className="absolute inset-0 bg-white/0 group-active:bg-white/10 transition-colors" />
            </Link>
          ) : (
            <div
              key={game.id}
              className="relative overflow-hidden rounded-2xl bg-lightGrey border border-dashed border-mutedText/30
                          p-4 min-h-[120px] flex flex-col justify-between opacity-60"
            >
              <img
                src={game.icon}
                alt={game.title}
                draggable={false}
                className="w-12 h-12 rounded-xl object-contain grayscale opacity-60 select-none"
              />
              <div>
                <h3 className="text-primary font-bold text-sm">{game.title}</h3>
                <p className="text-mutedText text-xs mt-0.5">Coming Soon</p>
              </div>
            </div>
          )
        )}
      </div>

      {/* PWA Install Banner */}
      <InstallBanner />

    </div>
  );
}
