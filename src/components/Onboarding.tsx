import { useState, useCallback, useRef } from "react";

const STORAGE_KEY = "playerName";

export function getPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setPlayerName(name: string): void {
  localStorage.setItem(STORAGE_KEY, name);
}

interface OnboardingProps {
  onComplete: () => void;
}

const HIGHLIGHT = "#008C95";

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const isValid = trimmed.length > 0 && trimmed.length <= 20;

  const handleSubmit = useCallback(() => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setPlayerName(trimmed);
    setIsExiting(true);
    setTimeout(() => onComplete(), 500);
  }, [isValid, isSubmitting, trimmed, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center ${isExiting ? "onboarding-exit" : ""}`}
      style={{
        background:
          "linear-gradient(180deg, #0A1628 0%, #0F2440 30%, #132D4A 60%, #0A1628 100%)",
        height: "100dvh",
        overflow: "hidden",
        justifyContent: "center",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Background image overlay */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background: "url('/welcome-bg-opt.jpg') center / cover no-repeat",
          opacity: 0.25,
        }}
      />

      {/* Content wrapper */}
      <div
        className="relative z-10 flex flex-col items-center w-full max-w-2xl px-4"
        style={{
          gap: "0px",
          paddingTop: "0px",
          paddingBottom: "0px",
        }}
      >
        {/* ══════════════════════════════════════════════
            SECTION 1: Brand
            ══════════════════════════════════════════════ */}
        <div
          className="flex flex-col items-center"
          style={{ gap: "0px" }}
        >
          {/* LightBox logo */}
          <img
            src="/welcome-lightbox-logo-opt.png?v=3"
            alt="LightBox"
            style={{
              width: "clamp(200px, 30vw, 250px)",
              height: "auto",
              display: "block",
              margin: "0 auto",
              marginBottom: "-15px",
            }}
          />

          {/* Rex — centered between LightBox and IDX */}
          <img
            src="/welcome-rex-opt.png"
            alt="Rex"
            className="welcome-rex-float welcome-rex-cape"
            style={{
              height: "clamp(60px, 14vh, 268px)",
              marginTop: "0px",
              filter: "drop-shadow(0 12px 34px rgba(0,140,149,0.28))",
            }}
          />

          {/* IDX logo */}
          <img
            src="/welcome-idx-logo.png"
            alt="Integral Diagnostics"
            className="w-[84px] h-auto"
          />
        </div>

        {/* ══════════════════════════════════════════════
            SECTION 2: Information
            ══════════════════════════════════════════════ */}
        <div
          className="flex flex-col items-center max-w-[28rem] text-center"
          style={{ gap: "clamp(2px, 0.5vh, 6px)" }}
        >
          <h2
            className="text-white font-bold leading-tight"
            style={{ fontSize: "clamp(0.85rem, 2.2vh, 1.5rem)" }}
          >
            Waiting just became part of the experience.
          </h2>

          <p
            className="text-white/75"
            style={{ fontSize: "clamp(0.65rem, 1.7vh, 0.875rem)", lineHeight: 1.5 }}
          >
            Explore the fascinating world of{" "}
            <span style={{ color: HIGHLIGHT, fontWeight: 600 }}>radiology</span>{" "}
            through fun, interactive games designed to{" "}
            <span style={{ color: HIGHLIGHT, fontWeight: 600 }}>entertain</span>
            ,{" "}
            <span style={{ color: HIGHLIGHT, fontWeight: 600 }}>challenge</span>{" "}
            and help the time pass. Whether you&rsquo;re feeling curious, excited
            or a little nervous,{" "}
            <span style={{ color: HIGHLIGHT, fontWeight: 600 }}>Rex</span> is
            here to keep you company while you wait.
          </p>
        </div>

        {/* ══════════════════════════════════════════════
            SECTION 3: Action
            ══════════════════════════════════════════════ */}
        <div
          className="flex flex-col items-center w-full max-w-[24rem]"
          style={{ gap: "clamp(2px, 0.5vh, 6px)" }}
        >
          <p
            className="text-white/45 text-center"
            style={{ fontSize: "clamp(0.65rem, 1.6vh, 0.875rem)" }}
          >
            Ready to begin?
          </p>

          <label
            className="text-white font-bold w-full text-left"
            style={{ fontSize: "clamp(0.65rem, 1.6vh, 0.875rem)" }}
          >
            Enter your first name
          </label>

          <p
            className="text-white/50 w-full text-left"
            style={{ fontSize: "clamp(0.6rem, 1.4vh, 0.75rem)", lineHeight: 1.5 }}
          >
            We&rsquo;ll use it to save your score and show your place on the
            leaderboard.
          </p>

          {/* Name input */}
          <div className="relative w-full">
            <span className="absolute left-[0.85rem] top-1/2 -translate-y-1/2 text-lg pointer-events-none select-none">
              👤
            </span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First name"
              maxLength={20}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="w-full rounded-xl bg-white text-[#2D2D2D] pl-[2.75rem] pr-3 outline-none border-2 border-secondary/40 box-border"
              style={{
                height: "clamp(38px, 5.5vh, 48px)",
                fontSize: "clamp(0.8rem, 1.8vh, 1rem)",
              }}
            />
          </div>

          {/* Let's Play button */}
          <button
            type="button"
            disabled={!isValid || isSubmitting}
            onClick={handleSubmit}
            className="w-full bg-[#008C95] text-white font-bold rounded-xl border-none shadow-[0_4px_16px_rgba(0,140,149,0.35)] disabled:opacity-50 transition-opacity"
            style={{
              cursor: isValid && !isSubmitting ? "pointer" : "default",
              paddingTop: "clamp(8px, 1.5vh, 12px)",
              paddingBottom: "clamp(8px, 1.5vh, 12px)",
              fontSize: "clamp(0.8rem, 1.8vh, 1rem)",
            }}
          >
            Let&rsquo;s Play
          </button>
        </div>

        {/* ══════════════════════════════════════════════
            Footer
            ══════════════════════════════════════════════ */}
        <p
          className="text-white/40 text-center leading-relaxed max-w-[24rem]"
          style={{ fontSize: "clamp(0.55rem, 1.3vh, 0.7rem)" }}
        >
          Created by Integral Diagnostics to make your waiting experience a
          little brighter.
        </p>
      </div>
    </div>
  );
}
