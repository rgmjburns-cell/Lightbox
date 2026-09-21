import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Rex from "~/components/Rex";
import brand from "~/branding";
import { useVisit } from "~/lib/metrics";

export const Route = createFileRoute("/qr")({
  component: AddToPhonePage,
});

/* ── Platform / browser detection ── */

type Platform = "ios" | "android";
type IosBrowser = "safari" | "chrome";
type AndroidBrowser = "chrome" | "samsung";

function detectPlatform(ua: string): Platform {
  return /iPhone|iPad|iPod/.test(ua) ? "ios" : "android";
}

function detectIosBrowser(ua: string): IosBrowser {
  return /CriOS/.test(ua) ? "chrome" : "safari";
}

function detectAndroidBrowser(ua: string): AndroidBrowser {
  return /SamsungBrowser/.test(ua) ? "samsung" : "chrome";
}

/* ── Per-device instructions ── */

interface Step {
  text: string;
  icon: "share" | "menu" | "home" | "check";
}

const IOS_SAFARI_STEPS: Step[] = [
  {
    text: "Open LightBox in Safari.",
    icon: "share",
  },
  {
    text: 'Tap the Share button (the square with the arrow up) at the bottom of the screen.',
    icon: "share",
  },
  {
    text: 'Scroll down and tap "Add to Home Screen".',
    icon: "home",
  },
  {
    text: 'Tap "Add" in the top-right corner.',
    icon: "check",
  },
];

const IOS_CHROME_STEPS: Step[] = [
  {
    text: "Open LightBox in Chrome.",
    icon: "menu",
  },
  {
    text: "Tap the \u22EF (three-dot) menu at the bottom of the screen.",
    icon: "menu",
  },
  {
    text: 'Tap "Add to Home Screen".',
    icon: "home",
  },
  {
    text: 'Tap "Add".',
    icon: "check",
  },
];

const ANDROID_CHROME_STEPS: Step[] = [
  {
    text: "Open LightBox in Chrome.",
    icon: "menu",
  },
  {
    text: "Tap the \u22EF (three-dot) menu at the top right.",
    icon: "menu",
  },
  {
    text: 'Tap "Add to Home screen".',
    icon: "home",
  },
  {
    text: 'Tap "Add" on the pop-up.',
    icon: "check",
  },
];

const ANDROID_SAMSUNG_STEPS: Step[] = [
  {
    text: "Open LightBox in Samsung Internet.",
    icon: "menu",
  },
  {
    text: "Tap the \u22EF (three-dot) menu at the bottom.",
    icon: "menu",
  },
  {
    text: 'Tap "Add to Home screen".',
    icon: "home",
  },
  {
    text: 'Tap "Add" on the pop-up.',
    icon: "check",
  },
];

const DONE_COPY =
  "YOU'RE DONE! Look for Rex on your Home Screen. Tap him anytime to open LightBox.";

function AddToPhonePage() {
  useVisit("/qr");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [iosBrowser, setIosBrowser] = useState<IosBrowser>("safari");
  const [androidBrowser, setAndroidBrowser] = useState<AndroidBrowser>("chrome");

  useEffect(() => {
    const ua = navigator.userAgent;
    setPlatform(detectPlatform(ua));
    setIosBrowser(detectIosBrowser(ua));
    setAndroidBrowser(detectAndroidBrowser(ua));
  }, []);

  // Until detection runs, default the view to iPhone/Safari.
  const activePlatform: Platform = platform ?? "ios";
  const activeBrowser: IosBrowser | AndroidBrowser =
    activePlatform === "ios" ? iosBrowser : androidBrowser;

  const steps =
    activePlatform === "ios"
      ? activeBrowser === "safari"
        ? IOS_SAFARI_STEPS
        : IOS_CHROME_STEPS
      : activeBrowser === "chrome"
        ? ANDROID_CHROME_STEPS
        : ANDROID_SAMSUNG_STEPS;

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="flex flex-col items-center text-center mb-5">
        <Rex className="w-16 h-16 mb-2" mood="happy" />
        <h1 className="text-2xl font-bold text-white tracking-wide">
          KEEP LIGHTBOX ONE TAP AWAY
        </h1>
        <p className="text-sm text-white/70 mt-2 max-w-md">
          Add LightBox to your Home Screen and open it just like an app.
        </p>
        <p className="text-xs text-white/40 mt-3 max-w-sm">
          No need to do this to play. Games work right here, straight away.
          This just puts a LightBox shortcut on your Home Screen for next time.
        </p>
      </div>

      {/* ── Device toggle ── */}
      <div className="flex items-center justify-center gap-2 bg-white/10 backdrop-blur-sm rounded-full p-1.5 w-fit mx-auto mb-4">
        <ToggleButton
          active={activePlatform === "ios"}
          onClick={() => setPlatform("ios")}
          label="iPhone"
          icon={<IphoneIcon color={activePlatform === "ios" ? "#FFFFFF" : "#9CA3AF"} />}
        />
        <ToggleButton
          active={activePlatform === "android"}
          onClick={() => setPlatform("android")}
          label="Android"
          icon={<AndroidIcon color={activePlatform === "android" ? "#FFFFFF" : "#9CA3AF"} />}
        />
      </div>

      {/* ── Browser sub-selector ── */}
      <div className="card p-4 mb-4">
        <h2 className="text-sm font-semibold text-mutedText mb-3 text-center">
          Which browser do you use?
        </h2>
        <div className="flex items-center justify-center gap-2">
          {activePlatform === "ios" ? (
            <>
              <ToggleButton
                active={iosBrowser === "safari"}
                onClick={() => setIosBrowser("safari")}
                label="Safari"
                icon={<SafariIcon color={iosBrowser === "safari" ? "#FFFFFF" : "#6B7280"} />}
              />
              <ToggleButton
                active={iosBrowser === "chrome"}
                onClick={() => setIosBrowser("chrome")}
                label="Chrome"
                icon={<ChromeIcon color={iosBrowser === "chrome" ? "#FFFFFF" : "#6B7280"} />}
              />
            </>
          ) : (
            <>
              <ToggleButton
                active={androidBrowser === "chrome"}
                onClick={() => setAndroidBrowser("chrome")}
                label="Chrome"
                icon={<ChromeIcon color={androidBrowser === "chrome" ? "#FFFFFF" : "#6B7280"} />}
              />
              <ToggleButton
                active={androidBrowser === "samsung"}
                onClick={() => setAndroidBrowser("samsung")}
                label="Samsung Internet"
                icon={<SamsungIcon color={androidBrowser === "samsung" ? "#FFFFFF" : "#6B7280"} />}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Numbered steps ── */}
      <div className="card p-5 mb-4">
        <ol className="space-y-4">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-secondary text-white text-sm font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <span className="text-darkText text-[15px] leading-snug pt-0.5">
                {step.text}
              </span>
              <span className="shrink-0 ml-auto pl-2">
                <StepIcon name={step.icon} />
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Final step: done ── */}
      <div className="card p-5 flex flex-col items-center text-center">
        <img
          src="/icon-512.png"
          alt="Rex Home Screen icon"
          className="w-20 h-20 rounded-2xl shadow-md mb-3"
        />
        <p className="text-darkText font-bold text-[15px] leading-snug">{DONE_COPY}</p>
        <p className="text-xs text-mutedText mt-2">
          {brand.name} keeps your scores and progress, however you open it.
        </p>
      </div>
    </div>
  );
}

/* ── Small building blocks ── */

function ToggleButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
        active ? "bg-secondary text-white shadow" : "text-white/70 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StepIcon({ name }: { name: "share" | "menu" | "home" | "check" }) {
  const stroke = "#008C95";
  switch (name) {
    case "share":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          <path d="M12 3v13m0 0l-4-4m4 4l4-4" />
        </svg>
      );
    case "menu":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" color={stroke}>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      );
    case "home":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "check":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
  }
}

/* ── Brand/device icons (stroke-based, same style as nav icons) ── */

function IphoneIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

function AndroidIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10v6" />
      <path d="M20 10v6" />
      <path d="M5.5 10h13v6a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3v-6z" />
      <path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3" />
      <path d="M9.5 15.5h5" />
    </svg>
  );
}

function SafariIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </svg>
  );
}

function ChromeIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 7.79 4.5L12 14.5" />
      <path d="M12 21a9 9 0 0 1-7.79-4.5L12 9.5" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function SamsungIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
    </svg>
  );
}