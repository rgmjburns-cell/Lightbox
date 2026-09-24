import { useState } from "react";
import { RankIcon } from "~/components/RankBadge";
import {
  claimPlayerName,
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
 *  - real name stored + rank known → medal art for ranks 1-3 (via RankIcon),
 *    plain numeric "#N this month" for rank 4+;
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
    if (rank <= 3) {
      return (
        <p className="text-sm font-semibold text-secondary mb-4 flex items-center justify-center gap-1.5">
          <RankIcon rank={rank} className="w-6 h-6" />
          <span>
            #{rank.toLocaleString()} this month
          </span>
        </p>
      );
    }
    return (
      <p className="text-sm font-semibold text-secondary mb-4">
        #{rank.toLocaleString()} this month
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
    // Get the identity for this name before banking the round: the server
    // issues a hidden player id for a first real name (or hands back the one
    // this player already has, so their profile follows them onto a new
    // device). Without it the round would land on a name-only row.
    await claimPlayerName(trimmed);
    // The board is ADDITIVE, and the game's own completion effect already banked
    // this round under the guest name. Re-sending the real score here would
    // count the SAME round twice: once merged in from the guest's rows, once as
    // this POST's own score. So a guest upgrade submits 0 — the score is a
    // no-op for the total, while prevName still triggers the guest→real merge
    // (which carries this round's points over). Only when there was no stored
    // name at all does this POST have to bank the round itself.
    const result = await submitScore(game, isGuest ? 0 : score, {
      // A guest upgrade re-sends a round the game already reported, so it must not
      // log a second "round finished" for the same round (usage analytics).
      roundEnd: !isGuest,
    });
    if (result) onRank(result.rank);
    setSaving(false);
  };

  return (
    <div className="mb-4">
      <p className="text-sm text-mutedText mb-2">
        {isGuest
          ? `Enter your nickname to be shown as (you're currently ${storedName})`
          : "Enter your nickname to join the leaderboard"}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Nickname"
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
