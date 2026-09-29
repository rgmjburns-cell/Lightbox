/**
 * The first-run Terms of Use gate.
 *
 * Rad Games asks every device to accept the terms once before the games (or the
 * leaderboard) are reachable, and this is that screen: a short intro, the three
 * plain points a patient actually needs to know, and one button
 * ("I agree, let's play"). One tap and it is gone; the player never sees it
 * again on that device until the wording changes.
 *
 * Why a full-screen overlay: nothing in the app submits data until the player
 * has agreed, and the games must not be reachable behind a half-covered screen.
 * The gate is drawn by the root route (`src/routes/__root.tsx`) either way, so
 * the acceptance check is in ONE place and cannot be bypassed by a deep link
 * into a game page. It is deliberately NOT drawn on `/terms`: a player must be
 * able to read the terms before agreeing to them, and that page carries its own
 * accept button for the player who reads them first.
 *
 * The wording lives in `src/lib/tou.ts` (one copy source for all brands, with
 * the network's name interpolated); this component only lays it out.
 */
import { Link } from "@tanstack/react-router";
import brand from "~/lib/brand";
import { TOU_GATE_POINTS, touFor } from "~/lib/tou";

interface TermsGateProps {
  /** The player accepted: the caller stores the flag and reveals the app. */
  onAccept: () => void;
}

export default function TermsGate({ onAccept }: TermsGateProps) {
  const tou = touFor();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background:
          "linear-gradient(180deg, #0A1628 0%, #0F2440 30%, #132D4A 60%, #0A1628 100%)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Same fixed background photo overlay as the welcome screen. */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background: "url('/welcome-bg-opt.jpg') center / cover no-repeat",
          opacity: 0.25,
        }}
      />

      <div className="relative z-10 w-full max-w-[26rem] max-h-full overflow-y-auto py-4">
        <div className="flex justify-center">
          <img
            src={brand.logoUrl}
            alt={brand.logoAlt}
            style={{
              width: "clamp(150px, 26vw, 200px)",
              height: "auto",
              filter: "drop-shadow(0 8px 26px rgba(0,140,149,0.35))",
            }}
          />
        </div>

        <div className="card mt-4">
          <h1 className="text-lg font-bold text-primary">{tou.title}</h1>
          <p className="text-xs text-mutedText mt-1">
            Last updated {tou.updated}
          </p>

          <p className="text-sm text-darkText mt-3 leading-relaxed">
            {tou.intro}
          </p>

          {/* The three points that matter at this moment. Kept in the copy
              source with the rest of the wording (and pinned by tests) so the
              summary can never drift from the page it summarises. */}
          <ul className="mt-3 space-y-1.5">
            {TOU_GATE_POINTS.map((point) => (
              <li key={point} className="flex gap-2 text-sm text-darkText">
                <span aria-hidden="true" className="text-secondary font-bold">
                  •
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={onAccept}
            className="btn-primary w-full mt-5"
          >
            I agree, let&rsquo;s play
          </button>

          <Link
            to="/terms"
            className="block text-center text-xs text-secondary font-medium mt-3 underline"
          >
            Read the full terms
          </Link>
        </div>

        <p className="text-white/40 text-center text-[0.6rem] mt-3 leading-relaxed">
          {brand.tagline}
        </p>
      </div>
    </div>
  );
}
