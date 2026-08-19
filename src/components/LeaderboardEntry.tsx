import { useState } from "react";
import {
  getPlayerName,
  isGuestName,
  isValidPlayerName,
  submitScore,
  upgradePlayerName,
  type LeaderboardGame,
} from "~/lib/leaderboard";

interface LeaderboardEntryProps {
  game: LeaderboardGame;
  /** The just-finished score to submit. */
  score: number;
  /**
   * Rank returned by the game's own auto-submit (fired in its completion
   * effect). null = no rank yet (or the submit failed / hasn't landed yet).
   */
  rank: number | null;
  /** Lift a rank back to the game (from a submit after saving a name here). */
  onRank: (rank: number) => void;
}

/**
 * Small inline leaderboard hook for game result modals:
 *  - real name stored + rank known → subtle "🏅 #N this month" line;
 *  - real name stored + rank pending/failed → nothing (silent; the game's
 *    auto-submit already covers it — every round submits under a guaranteed
 *    name now);
 *  - no name stored OR a guest identity ("Guest NNNN") → "Enter your first
 *    name" input; saving upgrades the guest to the real name and submits the
 *    just-finished score (which tells the server to merge the guest's rows).
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

  const storedName = getPlayerName();
  const isGuest = storedName !== null && isGuestName(storedName);

  if (rank !== null && rank > 0) {
    return (
      <p className="text-sm font-semibold text-secondary mb-4">
        🏅 #{rank.toLocaleString()} this month
      </p>
    );
  }

  // A real (non-guest) name is already stored — the game's auto-submit covers
  // it; show nothing rather than a second prompt.
  if (storedName && !isGuest) return null;

  const trimmed = nameInput.trim();
  const valid = isValidPlayerName(trimmed);

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    // Upgrade guest → real name (parks the guest as pending-previous) BEFORE
    // submitting, so the POST carries prevName and the server merges the
    // guest's rows into this name's row.
    upgradePlayerName(trimmed);
    const result = await submitScore(game, score);
    if (result) onRank(result.rank);
    setSaving(false);
  };

  return (
    <div className="mb-4">
      <p className="text-sm text-mutedText mb-2">
        {isGuest
          ? `Enter your first name to be shown as (you're currently ${storedName})`
          : "Enter your first name to join the leaderboard"}
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
