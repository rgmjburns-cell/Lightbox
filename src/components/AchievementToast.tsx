import { useEffect, useState } from "react";
import type { Achievement } from "~/lib/achievements";

interface AchievementToastProps {
  achievement: Achievement | null;
  onDismiss: () => void;
}

export default function AchievementToast({
  achievement,
  onDismiss,
}: AchievementToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!achievement) {
      setVisible(false);
      return;
    }

    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));

    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 400); // wait for exit animation
    }, 3000);

    return () => clearTimeout(timer);
  }, [achievement, onDismiss]);

  if (!achievement) return null;

  return (
    <div
      className={`
        fixed top-4 left-1/2 z-[100] -translate-x-1/2
        transition-all duration-400 ease-out
        ${visible ? "translate-y-0 opacity-100 scale-100" : "-translate-y-8 opacity-0 scale-90"}
      `}
    >
      <div
        className="
          flex items-center gap-3
          bg-[#008C95] text-white
          rounded-2xl shadow-xl px-5 py-3
          min-w-[280px] max-w-[90vw]
        "
      >
        {/* Badge icon */}
        <span className="text-3xl">{achievement.icon}</span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold leading-tight truncate">
            {achievement.name}
          </p>
          <p className="text-xs text-white/80 mt-0.5">Unlocked! 🎉</p>
        </div>

        {/* Close button */}
        <button
          onClick={() => {
            setVisible(false);
            setTimeout(onDismiss, 400);
          }}
          className="text-white/70 hover:text-white text-lg leading-none"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
