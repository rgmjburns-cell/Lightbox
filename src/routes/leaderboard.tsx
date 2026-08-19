import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import {
  fetchLeaderboard,
  getPlayerName,
  isValidPlayerName,
  setPlayerName,
  GAME_META,
  type LeaderboardEntry,
  type LeaderboardFilter,
} from "~/lib/leaderboard";

export const Route = createFileRoute("/leaderboard")({
  component: Leaderboard,
});

const POLL_MS = 5000;

const FILTERS: { id: LeaderboardFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...GAME_META.map((g) => ({ id: g.id as LeaderboardFilter, label: g.label })),
];

// id → meta lookup for the per-game pills on entry rows.
const GAME_META_BY_ID = Object.fromEntries(
  GAME_META.map((g) => [g.id, g])
) as Record<string, (typeof GAME_META)[number]>;

const MEDALS = ["🏆", "🥈", "🥉"];

function Leaderboard() {
  const [playerName, setPlayerNameState] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getPlayerName()
  );
  const [nameInput, setNameInput] = useState("");
  const [filter, setFilter] = useState<LeaderboardFilter>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearedMsg, setClearedMsg] = useState<string | null>(null);

  // ── Data: fetch on mount + poll every 5s (client-side only) ──
  useEffect(() => {
    let active = true;

    const run = async () => {
      const data = await fetchLeaderboard(filter);
      if (!active) return;
      if (data) {
        setEntries(data.entries);
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
  }, [filter]);

  const refresh = useCallback(() => {
    void fetchLeaderboard(filter).then((data) => {
      if (data) {
        setEntries(data.entries);
        setError(false);
      }
    });
  }, [filter]);

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!isValidPlayerName(trimmed)) return;
    setPlayerName(trimmed);
    setPlayerNameState(trimmed);
    setNameInput("");
    // Their scores may already exist this month — highlight now.
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
        setAdminError("Couldn't clear the board — try again");
        setClearing(false);
        return;
      }
      setClearedMsg("Board cleared");
      setAdminOpen(false);
      setPasscode("");
      setClearing(false);
      refresh();
    } catch {
      setAdminError("Couldn't clear the board — try again");
      setClearing(false);
    }
  };

  const monthLabel =
    typeof window === "undefined"
      ? ""
      : new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  const trimmedPlayer = playerName?.trim().toLowerCase() ?? null;

  const showLoading = entries === null && !error;

  return (
    <div className="page-container">
      {/* Rex intro */}
      <div className="mb-6 mt-2">
        <RexSpeechBubble
          message="The board is live! Beat the top score and the first coffee of the month is on us."
          mood="excited"
        />
      </div>

      {/* ── Name gate ── */}
      {playerName ? (
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
            Enter your first name to play
          </h2>
          <p className="text-xs text-mutedText mb-3">
            We'll use it to save your score and show your place on the
            leaderboard.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="First name"
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
              }}
              className="flex-1 min-w-0 rounded-lg border border-lightTeal px-3 py-2 text-sm text-darkText
                         outline-none focus:border-secondary"
            />
            <button
              type="button"
              onClick={handleSaveName}
              disabled={!isValidPlayerName(nameInput)}
              className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* ── Game filter chips ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-150 active:scale-95 ${
              filter === f.id
                ? "bg-secondary text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

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
            Can't reach the board — try again
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
            No scores yet — be the first to take the crown!
          </p>
        </div>
      )}

      {!showLoading && entries && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => {
            const isYou =
              trimmedPlayer !== null &&
              entry.name.trim().toLowerCase() === trimmedPlayer;
            return (
              <div
                key={`${entry.rank}-${entry.name}`}
                className={`card flex items-center gap-3 py-3 ${
                  isYou ? "border-2 border-secondary" : ""
                }`}
              >
                <span className="text-xl w-8 text-center font-bold text-mutedText shrink-0">
                  {entry.rank <= 3
                    ? MEDALS[entry.rank - 1]
                    : entry.rank.toLocaleString()}
                </span>
                <span className="font-semibold text-darkText flex-1 truncate">
                  {entry.name}
                  {isYou && (
                    <span className="ml-2 inline-block align-middle bg-secondary text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      You
                    </span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-lightTeal text-secondary text-[10px] font-semibold px-2 py-0.5 shrink-0">
                  <span>{GAME_META_BY_ID[entry.game]?.emoji ?? "🎮"}</span>
                  {GAME_META_BY_ID[entry.game]?.label ?? entry.game}
                </span>
                <span className="text-secondary font-bold tabular-nums shrink-0">
                  {entry.score.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {clearedMsg && (
        <p className="text-center text-sm text-secondary font-medium mt-4">
          {clearedMsg}
        </p>
      )}

      <p className="text-xs text-mutedText text-center mt-6">
        Scores reset on the 1st of each month. Play more to climb the ranks!
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
              This wipes all scores — use before a presentation.
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
