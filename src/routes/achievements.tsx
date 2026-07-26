import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import RexSpeechBubble from "~/components/RexSpeechBubble";
import {
  getAchievements,
  type Achievement,
  type AchievementState,
} from "~/lib/achievements";

export const Route = createFileRoute("/achievements")({
  component: Achievements,
});

type AchievementWithState = Achievement & AchievementState;

function Achievements() {
  const [allAchievements, setAllAchievements] = useState<AchievementWithState[]>(
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAllAchievements(getAchievements());
  }, []);

  const earned = allAchievements.filter((a) => a.unlocked);
  const locked = allAchievements.filter((a) => !a.unlocked);

  const earnedCount = earned.length;
  const totalCount = allAchievements.length;

  return (
    <div className="page-container">
      <div className="mb-6 mt-2">
        <RexSpeechBubble
          message={`You've earned ${earnedCount} of ${totalCount} badges! Can you collect them all?`}
          mood="encouraging"
        />
      </div>

      {/* ── Progress bar ── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-primary">Progress</span>
          <span className="text-sm font-bold text-secondary">
            {earnedCount}/{totalCount}
          </span>
        </div>
        <div className="h-2 bg-lightTeal rounded-full overflow-hidden">
          <div
            className="h-full bg-secondary rounded-full transition-all duration-500"
            style={{ width: `${(earnedCount / totalCount) * 100}%` }}
          />
        </div>
      </div>

      {/* Earned */}
      {earned.length > 0 && (
        <>
          <h2 className="text-lg font-bold text-primary mb-3">
            Earned ({earned.length})
          </h2>
          <div className="flex flex-col gap-2 mb-6">
            {earned.map((a) => (
              <div key={a.id} className="card flex items-center gap-4 py-3">
                <span className="text-2xl">{a.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold text-darkText text-sm">
                    {a.name}
                  </p>
                  <p className="text-xs text-mutedText">{a.description}</p>
                  {a.unlockedAt && (
                    <p className="text-[10px] text-secondary mt-0.5">
                      Unlocked{" "}
                      {new Date(a.unlockedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  )}
                </div>
                <span className="text-secondary text-lg">✓</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Locked */}
      {locked.length > 0 && (
        <>
          <h2 className="text-lg font-bold text-mutedText mb-3">
            Locked ({locked.length})
          </h2>
          <div className="flex flex-col gap-2">
            {locked.map((a) => (
              <div
                key={a.id}
                className="card flex items-center gap-4 py-3 opacity-60"
              >
                <span className="text-2xl grayscale">{a.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold text-darkText text-sm">
                    {a.name}
                  </p>
                  <p className="text-xs text-mutedText">{a.description}</p>
                  <p className="text-[10px] text-mutedText/70 mt-0.5 italic">
                    {a.hint}
                  </p>
                </div>
                <span className="text-mutedText text-lg">🔒</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
