import { createFileRoute } from "@tanstack/react-router";
import { getPlayerName, setPlayerName } from "~/components/Onboarding";
import { deletePlayerData, setPlayerId } from "~/lib/leaderboard";
import brand from "~/branding";
import { useState } from "react";
import { useVisit } from "~/lib/metrics";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  useVisit("/settings");
  const playerName = typeof window !== "undefined" ? getPlayerName() : "";
  const [editName, setEditName] = useState(false);
  const [nameValue, setNameValue] = useState(playerName || "");
  const [clearError, setClearError] = useState("");
  const [clearing, setClearing] = useState(false);

  const handleSaveName = () => {
    const trimmed = nameValue.trim();
    if (trimmed) {
      setPlayerName(trimmed);
      setEditName(false);
      window.location.reload();
    }
  };

  /**
   * "Clear All Data" has to mean all of it, and part of the player's data lives
   * on the server: their rows on the shared monthly leaderboard, their identity
   * and their profile. So the server erase comes FIRST and the device is only
   * wiped once it has confirmed. A failed call leaves everything as it was and
   * says so, rather than reloading into a "cleared" state that is not true.
   * Order: server delete, then the id cookie (which would otherwise identify the
   * device again on its next visit), then local storage, then reload.
   */
  const handleClearData = async () => {
    const confirmed = window.confirm(
      "Remove your scores from the leaderboard and clear all data saved on this " +
        "device? This cannot be undone.",
    );
    if (!confirmed || clearing) return;
    setClearing(true);
    setClearError("");
    const deleted = await deletePlayerData();
    if (!deleted) {
      setClearing(false);
      setClearError(
        "Could not remove your scores from the leaderboard. Check your connection and try again.",
      );
      return;
    }
    // Erase the identity itself: expiring the cookie (path=/) is what stops this
    // device being recognised again after the reload.
    setPlayerId(null);
    try {
      localStorage.clear();
    } catch {
      // Storage can be unavailable (private mode); the server side is already gone.
    }
    window.location.reload();
  };

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-primary mb-6 mt-2">Settings</h1>

      {/* Player Name */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-mutedText mb-2">Player Name</h3>
        {editName ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              maxLength={30}
              className="flex-1 rounded-lg border border-lightTeal px-3 py-2 text-sm
                         outline-none focus:border-secondary"
              autoFocus
            />
            <button onClick={handleSaveName} className="btn-primary text-sm py-2">
              Save
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-darkText font-medium">{playerName || "Not set"}</span>
            <button
              onClick={() => setEditName(true)}
              className="text-secondary text-sm font-medium hover:underline"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* About */}
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-mutedText mb-2">About</h3>
        <p className="text-sm text-darkText">
          {brand.name} is a patient engagement platform for radiology waiting rooms.
          Play games, earn achievements, and compete on the leaderboard while you
          wait for your scan.
        </p>
        <p className="text-xs text-mutedText mt-2">
          Powered by {brand.logo.text}
        </p>
      </div>

      {/* Danger Zone */}
      <div className="card border border-red-200">
        <h3 className="text-sm font-semibold text-red-500 mb-2">Data</h3>
        <p className="text-xs text-mutedText mb-3">
          Removes your scores from the leaderboard and all saved data on this device.
          This cannot be undone.
        </p>
        {clearError && (
          <p role="alert" className="text-xs text-red-500 mb-3">
            {clearError}
          </p>
        )}
        <button
          onClick={() => void handleClearData()}
          disabled={clearing}
          className="text-sm text-red-500 font-medium border border-red-300 rounded-lg px-4 py-2
                     hover:bg-red-50 active:scale-95 transition-all disabled:opacity-60"
        >
          {clearing ? "Clearing..." : "Clear All Data"}
        </button>
      </div>
    </div>
  );
}
