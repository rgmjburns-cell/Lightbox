import { useState, useCallback, useRef } from "react";
import { setPlayerName } from "~/lib/playerIdentity";
import {
  resolvePlayerName,
  restorePlayerName,
  startFreshPlayerName,
} from "~/lib/leaderboard";
import type { ServerPlayerProfile } from "~/lib/profile";
import ProfileRestorePrompt from "~/components/ProfileRestorePrompt";
import Rex from "~/components/Rex";
import brand from "~/lib/brand";

export function getPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("playerName");
}

export { setPlayerName };

interface OnboardingProps {
  onComplete: () => void;
}

const HIGHLIGHT = "#008C95";

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  // Set when the typed nickname matches exactly one existing profile on the
  // server — the installed-PWA case, where this device's storage started empty
  // but the player has been playing somewhere else. The PLAYER decides; nothing
  // is adopted until they tap "Yes, that's me".
  const [found, setFound] = useState<ServerPlayerProfile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const isValid = trimmed.length > 0 && trimmed.length <= 20;

  const finish = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onComplete(), 500);
  }, [onComplete]);

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setPlayerName(trimmed);
    // Who does this nickname belong to? A device with no player id gets the
    // unique-match profile back to confirm; everything else continues straight on.
    const result = await resolvePlayerName(trimmed);
    if (result.status === "confirm") {
      setFound(result.profile);
      setIsSubmitting(false);
      return;
    }
    finish();
  }, [isValid, isSubmitting, trimmed, finish]);

  const handleRestore = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    await restorePlayerName(trimmed);
    setPlayerName(trimmed);
    finish();
  }, [isSubmitting, trimmed, finish]);

  const handleFresh = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    await startFreshPlayerName(trimmed);
    setPlayerName(trimmed);
    finish();
  }, [isSubmitting, trimmed, finish]);

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
          {/* The welcome mark, in the spot the product logo has always occupied
              on this screen, drawn from `brand.welcomeLogoUrl`: the shared Rad
              Games mark on the neutral master, and each pilot brand's own
              artwork (a Rad Games lockup carrying that brand's Rex) on its
              instance. This is the ONE screen that does not use `brand.logoUrl`,
              which stays the shared mark in the header on every brand (owner
              direction, 29 Sep). Every mark is a wide lockup on a transparent
              background, so it is sized by width. */}
          <h1
            className="text-center"
            style={{
              lineHeight: 0,
              margin: "0 auto",
              // The gap between the mark and the headline under it, and the ONLY
              // spacing there is (this h1 is the last thing in its section). It
              // is gated on `welcomeShowsRex` because the two cases end at very
              // different places (owner report, 29 Sep):
              //
              //   - Where Rex is drawn below the mark (the master), his artwork
              //     carries 81 of its 400 rows of transparent padding under his
              //     feet, so pulling the headline up by 8px costs nothing
              //     visible. That is the look the owner approved, so it stays
              //     exactly as it is.
              //   - The pilot brands' welcome marks have no such padding: their
              //     alpha bounding box is the whole 750x537 canvas (the white
              //     "GAMES" letters are the last row), so the same -8px landed
              //     the headline's glyphs ON the mark — 2.5px of overlap at a
              //     390px-wide phone. They get a real gap instead: 2.1vh is
              //     17.7px at 390x844, which leaves the headline's caps 22px
              //     clear of the mark, the same visible clearance the master
              //     already has (measured, not guessed). The mark's measured
              //     width, the copy and everything below the headline are
              //     untouched.
              marginBottom: brand.welcomeShowsRex
                ? "-8px"
                : "clamp(12px, 2.1vh, 26px)",
            }}
          >
            <img
              src={brand.welcomeLogoUrl}
              alt={brand.logoAlt}
              style={{
                width: "clamp(200px, 30vw, 250px)",
                height: "auto",
                display: "block",
                margin: "0 auto",
                filter: "drop-shadow(0 8px 26px rgba(0,140,149,0.35))",
              }}
            />
          </h1>

          {/* The mascot, drawn only where the mark above does NOT already show
              him: the master's shared Rad Games mark has no Rex in it, so the
              master keeps him here exactly as it always has, while the two pilot
              brands' welcome logos contain their own Rex and would otherwise
              show him twice (owner direction: "as they have Rex in them we don't
              need Rex as well on the logo in page"). Wherever he IS drawn he
              comes from the shared component, so he is the instance's own Rex.
              The artwork is square, so width follows the same clamp as the
              height (the wrapper has to be sized explicitly; the image just
              fills it). */}
          {brand.welcomeShowsRex && (
            <Rex
              style={{
                height: "clamp(90px, 20vw, 268px)",
                width: "clamp(90px, 20vw, 268px)",
                marginTop: "0px",
                filter: "drop-shadow(0 12px 34px rgba(0,140,149,0.28))",
              }}
            />
          )}
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
            Enter your nickname
          </label>

          <p
            className="text-white/50 w-full text-left"
            style={{ fontSize: "clamp(0.6rem, 1.4vh, 0.75rem)", lineHeight: 1.5 }}
          >
            We&rsquo;ll save your score and show your nickname on the
            leaderboard. A nickname or alias keeps your real name private.
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
              placeholder="Nickname"
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
            onClick={() => void handleSubmit()}
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

          {/* Played before? (fresh storage: the name is all we have left) */}
          {found && (
            <ProfileRestorePrompt
              profile={found}
              busy={isSubmitting}
              onRestore={() => void handleRestore()}
              onFresh={() => void handleFresh()}
            />
          )}
        </div>

        {/* ══════════════════════════════════════════════
            Footer
            ══════════════════════════════════════════════ */}
        <p
          className="text-white/40 text-center leading-relaxed max-w-[24rem]"
          style={{ fontSize: "clamp(0.55rem, 1.3vh, 0.7rem)" }}
        >
          {brand.tagline} Built to make your wait a little brighter.
        </p>
      </div>
    </div>
  );
}
