import { useState } from "react";
import {
  getPlayerName,
  isValidPlayerName,
  setPlayerName,
  submitScore,
  type LeaderboardGame,
} from "~/lib/leaderboard";

interface LeaderboardEntryProps {
  game: LeaderboardGame;
  /** The just-finished score to submit. */
  score: number;
  /**
   * Rank returned by the game's own auto-submit (fired in its completion
   * effect). null = no rank yet (or no name was stored at game end).
   */
  rank: number | null;
  /** Lift a rank back to the game (from a submit after saving a name here). */
  onRank: (rank: number) => void;
}

/**
 * Small inline leaderboard hook for game result modals:
 *  - name already stored + rank known → subtle "🏅 #N this month" line;
 *  - name already stored + rank pending/failed → nothing (silent);
 *  - no name stored → "Enter your first name" input + save; saving stores the
 *    name and submits the just-finished score.
 * Never blocks the surrounding modal's primary action (Play Again / Next).
 */
export default function LeaderboardEntry({
  game,
  score,
  rank,
  onRank,
}: LeaderboardEntryProps) {
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);

  if (rank !== null && rank > 0) {
    return (
      <p className="text-sm font-semibold text-secondary mb-4">
        🏅 #{rank.toLocaleString()} this month
      </p>
    );
  }

  // Name exists but no rank surfaced yet — the game's auto-submit may still be
  // in flight or failed; show nothing rather than a second prompt.
  if (getPlayerName()) return null;

  const trimmed = nameInput.trim();
  const valid = isValidPlayerName(trimmed);

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setPlayerName(trimmed);
    const result = await submitScore(game, score);
    if (result) onRank(result.rank);
    setSaving(false);
  };

  return (
    <div className="mb-4">
      <p className="text-sm text-mutedText mb-2">
        Enter your first name to join the leaderboard
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="First name"
          maxLength={20}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
          className="flex-1 min-w-0 rounded-lg border border-lightTeal px-3 py-2 text-sm text-darkText
                     outline-none focus:border-secondary"
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!valid || saving}
          className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
