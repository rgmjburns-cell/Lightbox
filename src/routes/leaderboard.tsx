import { createFileRoute } from "@tanstack/react-router";
import RexSpeechBubble from "~/components/RexSpeechBubble";

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
          message="Compete with other patients! Play more to climb the ranks."
          mood="excited"
        />
      </div>

      {/* Leaderboard */}
      <h2 className="text-lg font-bold text-white mb-4">This Month's Leaders</h2>
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
