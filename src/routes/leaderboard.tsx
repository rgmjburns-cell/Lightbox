import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import { RankIcon } from "~/components/RankBadge";
import ProfileRestorePrompt from "~/components/ProfileRestorePrompt";
import {
  fetchLeaderboard,
  getPlayerName,
  isGuestName,
  isValidPlayerName,
  resolvePlayerName,
  restorePlayerName,
  startFreshPlayerName,
  upgradePlayerName,
  type LeaderboardEntry,
  type LeaderboardPosition,
} from "~/lib/leaderboard";
import type { ServerPlayerProfile } from "~/lib/profile";
import { useVisit } from "~/lib/metrics";

export const Route = createFileRoute("/leaderboard")({
  component: Leaderboard,
});

const POLL_MS = 5000;

/** One board row — identical styling for the Top 5 and the player's own row. */
function BoardRow({
  rank,
  name,
  score,
  isYou,
}: {
  rank: number;
  name: string;
  score: number;
  isYou: boolean;
}) {
  return (
    <div
      className={`card flex items-center gap-3 py-3 ${
        isYou ? "border-2 border-secondary" : ""
      }`}
    >
      {rank <= 3 ? (
        <span className="w-8 text-center shrink-0">
          <RankIcon rank={rank} className="w-8 h-8" />
        </span>
      ) : (
        <span className="text-xl w-8 text-center font-bold text-mutedText shrink-0">
          {rank.toLocaleString()}
        </span>
      )}
      <span className="font-semibold text-darkText flex-1 truncate">
        {name}
        {isYou && (
          <span className="ml-2 inline-block align-middle bg-secondary text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            You
          </span>
        )}
      </span>
      <span className="text-secondary font-bold tabular-nums shrink-0">
        {score.toLocaleString()}
      </span>
    </div>
  );
}

function Leaderboard() {
  useVisit("/leaderboard");
  const [playerName, setPlayerNameState] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getPlayerName()
  );
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  // A profile the server matched to the typed nickname, waiting for the player
  // to confirm ("that's me") before anything is adopted.
  const [confirmProfile, setConfirmProfile] = useState<ServerPlayerProfile | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  // The stored player's own row, returned by the API when they have any score
  // this month — used to show their place under the Top 5 when they are not on
  // it (never to render positions 6+).
  const [you, setYou] = useState<LeaderboardPosition | null>(null);
  const [error, setError] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearedMsg, setClearedMsg] = useState<string | null>(null);

  // ── Data: one combined board — the Top 5 players by total points earned this
  // month, plus the player's own position. Fetch on mount + poll every 5s
  // (client-side only) ──
  useEffect(() => {
    let active = true;

    const run = async () => {
      const data = await fetchLeaderboard();
      if (!active) return;
      if (data) {
        setEntries(data.entries);
        setYou(data.you);
        setError(false);
      } else {
        setError(true);
      }
    };

    void run();
    const id = setInterval(() => void run(), POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const refresh = useCallback(() => {
    void fetchLeaderboard().then((data) => {
      if (data) {
        setEntries(data.entries);
        setYou(data.you);
        setError(false);
      }
    });
  }, []);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!isValidPlayerName(trimmed) || saving) return;
    setSaving(true);
    // Guest → real name: parks the guest as pending-previous so the player's
    // next game submission merges their guest rows into this name.
    upgradePlayerName(trimmed);
    // Ask the server who this nickname belongs to. On a device that has no
    // identity yet and whose typed name matches exactly one existing player (the
    // installed-PWA case) this comes back as a question, not a decision.
    const result = await resolvePlayerName(trimmed);
    if (result.status === "confirm") {
      setConfirmProfile(result.profile);
      setSaving(false);
      return;
    }
    setPlayerNameState(trimmed);
    setNameInput("");
    setSaving(false);
    // Their scores may already exist this month — highlight now.
    refresh();
  };

  const handleRestore = async () => {
    if (saving) return;
    setSaving(true);
    const name = nameInput.trim();
    await restorePlayerName(name);
    setPlayerNameState(name);
    setConfirmProfile(null);
    setNameInput("");
    setSaving(false);
    refresh();
  };

  const handleFresh = async () => {
    if (saving) return;
    setSaving(true);
    const name = nameInput.trim();
    await startFreshPlayerName(name);
    setPlayerNameState(name);
    setConfirmProfile(null);
    setNameInput("");
    setSaving(false);
    refresh();
  };

  const handleClear = async () => {
    if (clearing) return;
    setClearing(true);
    setAdminError(null);
    try {
      const res = await fetch("/api/leaderboard/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.status === 403) {
        setAdminError("Wrong passcode");
        setClearing(false);
        return;
      }
      const data = (await res.json()) as { ok: boolean; cleared?: number };
      if (!res.ok || !data.ok) {
        setAdminError("Couldn't clear the board. Try again.");
        setClearing(false);
        return;
      }
      setClearedMsg("Board cleared");
      setAdminOpen(false);
      setPasscode("");
      setClearing(false);
      refresh();
    } catch {
      setAdminError("Couldn't clear the board. Try again.");
      setClearing(false);
    }
  };

  const monthLabel =
    typeof window === "undefined"
      ? ""
      : new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  const trimmedPlayer = playerName?.trim().toLowerCase() ?? null;

  // Name gate: show the prompt when no name is stored OR when the stored name
  // is still a guest identity (guests can upgrade to a real name here).
  const needsName = !playerName || isGuestName(playerName);

  const showLoading = entries === null && !error;

  /**
   * Is this board row the caller's own? The SERVER decides, from the caller's
   * player id — not from the displayed name — so two players called "Sarah" each
   * see their own row highlighted. (The name comparison is only a fallback for
   * an older server that does not send the flag.)
   */
  const isYouRow = (entry: LeaderboardEntry) =>
    entry.isYou ??
    (trimmedPlayer !== null && entry.name.trim().toLowerCase() === trimmedPlayer);

  // Is the player already shown on the board? Then their rank line is the
  // existing row — no second one.
  const playerOnBoard = (entries ?? []).some(isYouRow);
  const showYourPosition =
    !showLoading && !error && you !== null && !playerOnBoard;

  return (
    <div className="page-container">
      {/* Rex intro */}
      <div className="mb-6 mt-2">
        <RexSpeechBubble
          message="The board is live! Beat the top score and take the crown this month."
          mood="excited"
        />
      </div>

      {/* ── Name gate ── */}
      {!needsName ? (
        <div className="card mb-4 flex items-center justify-between py-3">
          <p className="text-sm text-mutedText">
            Playing as{" "}
            <span className="font-semibold text-darkText">{playerName}</span>
          </p>
          <button
            type="button"
            onClick={() => setPlayerNameState(null)}
            className="text-secondary text-sm font-medium hover:underline"
            aria-label="Change player name"
          >
            ✏️ Edit
          </button>
        </div>
      ) : (
        <div className="card mb-4">
          <h2 className="text-sm font-semibold text-darkText mb-1">
            Enter your nickname to play
          </h2>
          <p className="text-xs text-mutedText mb-3">
            {playerName
              ? `You're playing as ${playerName}. Enter a nickname to be shown as yourself and carry your scores over.`
              : "We'll use it to save your score and show your place on the leaderboard."}
          </p>
          {confirmProfile ? (
            <ProfileRestorePrompt
              profile={confirmProfile}
              busy={saving}
              title="Played before?"
              onRestore={() => void handleRestore()}
              onFresh={() => void handleFresh()}
            />
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Nickname"
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveName();
                }}
                className="flex-1 min-w-0 rounded-lg border border-lightTeal px-3 py-2 text-sm text-darkText
                           outline-none focus:border-secondary"
              />
              <button
                type="button"
                onClick={() => void handleSaveName()}
                disabled={!isValidPlayerName(nameInput) || saving}
                className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Board ── */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-bold text-white">This Month's Leaders</h2>
        {monthLabel && (
          <span className="text-sm text-mutedText">{monthLabel}</span>
        )}
      </div>

      {showLoading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="card flex items-center gap-4 py-3 animate-pulse"
            >
              <div className="w-8 h-6 bg-gray-200 rounded" />
              <div className="flex-1 h-4 bg-gray-200 rounded" />
              <div className="w-16 h-4 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      )}

      {error && entries === null && (
        <div className="card text-center py-6">
          <p className="text-lg mb-3">📡</p>
          <p className="text-sm text-darkText mb-3">
            Can't reach the board. Try again.
          </p>
          <button
            type="button"
            onClick={refresh}
            className="btn-secondary text-sm px-6 py-2"
          >
            Retry
          </button>
        </div>
      )}

      {!showLoading && !error && entries && entries.length === 0 && (
        <div className="card text-center py-8">
          <p className="text-3xl mb-2">👑</p>
          <p className="text-sm text-darkText font-medium">
            No scores yet. Be the first to take the crown!
          </p>
        </div>
      )}

      {!showLoading && entries && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => {
            const isYou = isYouRow(entry);
            return (
              <BoardRow
                key={`${entry.rank}-${entry.name}`}
                rank={entry.rank}
                name={entry.name}
                score={entry.score}
                isYou={isYou}
              />
            );
          })}

          {/* Outside the Top 5: their own row, under a divider — never the
              positions in between (no 6–11 padding to reach 12). */}
          {showYourPosition && you && (
            <>
              <p
                className="text-center text-mutedText text-lg leading-none select-none"
                aria-hidden="true"
              >
                •••
              </p>
              <p className="text-xs text-mutedText tracking-wide mt-1">
                YOUR POSITION
              </p>
              <BoardRow
                rank={you.rank}
                name={you.name}
                score={you.score}
                isYou
              />
            </>
          )}
        </div>
      )}

      {clearedMsg && (
        <p className="text-center text-sm text-secondary font-medium mt-4">
          {clearedMsg}
        </p>
      )}

      <p className="text-xs text-mutedText text-center mt-6">
        Every completed game adds to your monthly total. Scores reset on the 1st
        of each month.
      </p>

      {/* ── Admin clear (discreet — presentation prep only) ── */}
      <div className="flex justify-center mt-6">
        <button
          type="button"
          onClick={() => setAdminOpen(true)}
          className="text-mutedText/50 hover:text-mutedText text-sm transition-colors"
          aria-label="Admin: clear the board"
        >
          🔒
        </button>
      </div>

      {adminOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={() => setAdminOpen(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center animate-[scaleIn_0.3s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-darkText mb-2">
              Clear the leaderboard
            </h3>
            <p className="text-sm text-mutedText mb-4">
              This wipes all scores. Use before a presentation.
            </p>
            <input
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
                setAdminError(null);
              }}
              placeholder="Passcode"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleClear();
              }}
              className="w-full rounded-lg border border-lightTeal px-3 py-2 text-sm text-darkText
                         outline-none focus:border-secondary mb-3"
              autoFocus
            />
            {adminError && (
              <p className="text-sm text-red-500 font-medium mb-3">
                {adminError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdminOpen(false);
                  setAdminError(null);
                  setPasscode("");
                }}
                className="flex-1 btn-secondary text-sm py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={clearing || passcode.length === 0}
                className="flex-1 bg-red-500 text-white font-semibold rounded-xl px-4 py-2 text-sm
                           shadow-md active:scale-95 transition-all duration-150 hover:brightness-110
                           disabled:opacity-50"
              >
                {clearing ? "Clearing…" : "Clear the board"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
