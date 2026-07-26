import { useState, useEffect } from "react";
import brand from "~/branding";

const STORAGE_KEY = "installBannerDismissed";

function isMobileSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // iOS Safari (not Chrome, not standalone)
  return (
    /iPhone|iPad|iPod/.test(ua) &&
    !/CriOS|FxiOS/.test(ua) &&
    !window.matchMedia("(display-mode: standalone)").matches
  );
}

function isAndroidChrome(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /Android/.test(ua) &&
    /Chrome/.test(ua) &&
    !/Edge/.test(ua) &&
    !window.matchMedia("(display-mode: standalone)").matches
  );
}

export default function InstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show on mobile Safari or Android Chrome
    if (!isMobileSafari() && !isAndroidChrome()) return;
    // Respect dismissal
    if (localStorage.getItem(STORAGE_KEY) === "true") return;

    // Delay to not compete with onboarding
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  };

  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 max-w-lg mx-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-lightTeal p-4 flex items-start gap-3 animate-[slideUp_0.3s_ease-out]">
        <span className="text-3xl shrink-0">📱</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-primary">
            Add {brand.shortName} to your home screen
          </p>
          <p className="text-xs text-mutedText mt-0.5">
            Tap the share button{" "}
            <span className="inline-block align-middle mx-0.5">
              <svg
                className="w-4 h-4 inline text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 12v6a2 2 0 002 2h12a2 2 0 002-2v-6M12 3v13m0 0l-4-4m4 4l4-4"
                />
              </svg>
            </span>{" "}
            then &ldquo;Add to Home Screen&rdquo;
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-mutedText hover:text-primary p-1 -mr-1 -mt-1"
          aria-label="Dismiss"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
