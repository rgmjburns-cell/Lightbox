import { createFileRoute } from "@tanstack/react-router";
import { getPlayerName, setPlayerName } from "~/components/Onboarding";
import brand from "~/branding";
import { useState } from "react";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  const playerName = typeof window !== "undefined" ? getPlayerName() : "";
  const [editName, setEditName] = useState(false);
  const [nameValue, setNameValue] = useState(playerName || "");

  const handleSaveName = () => {
    const trimmed = nameValue.trim();
    if (trimmed) {
      setPlayerName(trimmed);
      setEditName(false);
      window.location.reload();
    }
  };

  const handleClearData = () => {
    if (window.confirm("This will clear all your game data. Are you sure?")) {
      localStorage.clear();
      window.location.reload();
    }
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
          All your data is stored on this device only. Clear it to start fresh.
        </p>
        <button
          onClick={handleClearData}
          className="text-sm text-red-500 font-medium border border-red-300 rounded-lg px-4 py-2
                     hover:bg-red-50 active:scale-95 transition-all"
        >
          Clear All Data
        </button>
      </div>
    </div>
  );
}
