import { createFileRoute } from "@tanstack/react-router";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import brand from "~/branding";

export const Route = createFileRoute("/leaderboard")({
  component: Leaderboard,
});

// Placeholder leaderboard data
const placeholderScores = [
  { rank: 1, name: "Sarah", score: 2840, emoji: "🏆" },
  { rank: 2, name: "Mike", score: 2610, emoji: "🥈" },
  { rank: 3, name: "Jess", score: 2380, emoji: "🥉" },
  { rank: 4, name: "Alex", score: 1950, emoji: "⭐" },
  { rank: 5, name: "Sam", score: 1720, emoji: "⭐" },
];

function Leaderboard() {
  return (
    <div className="page-container">
      {/* Rex intro */}
      <div className="mb-6 mt-2">
        <RexSpeechBubble
          message={`Compete with other patients! ${brand.rewards.monthlyPrize}`}
          mood="excited"
        />
      </div>

      {/* Prize banner */}
      <div className="card mb-6 bg-gradient-to-r from-secondary to-secondary/80 text-white">
        <div className="flex items-center gap-3">
          <span className="text-3xl">☕</span>
          <div>
            <p className="font-bold">Monthly Prize</p>
            <p className="text-sm text-white/80">Glory and bragging rights!</p>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <h2 className="text-lg font-bold text-primary mb-4">This Month's Leaders</h2>
      <div className="flex flex-col gap-2">
        {placeholderScores.map((entry) => (
          <div
            key={entry.rank}
            className="card flex items-center gap-4 py-3"
          >
            <span className="text-xl w-8 text-center font-bold text-mutedText">
              {entry.emoji}
            </span>
            <span className="font-semibold text-darkText flex-1">{entry.name}</span>
            <span className="text-secondary font-bold">{entry.score.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-mutedText text-center mt-6">
        Scores reset on the 1st of each month. Play more to climb the ranks!
      </p>
    </div>
  );
}
