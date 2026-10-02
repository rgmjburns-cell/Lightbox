/**
 * Rex the Skeleton Mascot
 *
 * Uses the brand's mascot PNG (`brand.rexImageUrl`: the master's navy Rex, or
 * the pilot brand's own Rex), with an SVG fallback if the image fails to load.
 * Size controlled via className on the wrapping element.
 *
 * Because every screen draws Rex through this one component, changing which
 * file the brand points at changes the mascot in the games, the leaderboard, the
 * welcome screen and every modal at once: no screen names the artwork itself.
 *
 * The wrapper is `<span class="relative block ...">` so the caller's sizing and
 * spacing classes land exactly where they always have (Tailwind's reset makes an
 * `<img>` a block box, so the wrapper is a block box too), and it carries the
 * float/sway animation classes: the whole figure moves as one. The artwork is
 * square with the character centred, and the image is drawn with `contain`, so
 * any square slot the caller gives Rex shows him whole and the same size
 * relative to the slot on every brand.
 */
import { useState, type CSSProperties } from "react";
import brand from "~/lib/brand";

interface RexProps {
  className?: string;
  mood?: "happy" | "excited" | "encouraging";
  style?: CSSProperties;
}

export default function Rex({
  className = "w-16 h-16",
  mood = "happy",
  style,
}: RexProps) {
  const [imgError, setImgError] = useState(false);

  // ── PNG image (primary) ──
  if (!imgError) {
    return (
      <span
        className={`relative block welcome-rex-float welcome-rex-cape ${className}`}
        style={style}
      >
        <img
          src={brand.rexImageUrl}
          alt={`${brand.mascotName} the skeleton mascot`}
          className="h-full w-full"
          onError={() => setImgError(true)}
          style={{ objectFit: "contain" }}
        />
      </span>
    );
  }

  // ── SVG fallback (dark-background-friendly colours) ──
  const mouthD =
    mood === "excited"
      ? "M 22 36 Q 30 44 38 36"
      : mood === "encouraging"
        ? "M 24 37 Q 30 43 36 37"
        : "M 24 36 Q 30 42 36 36";

  return (
    <span
      className={`relative block welcome-rex-float welcome-rex-cape ${className}`}
      style={style}
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
        role="img"
        aria-label={`${brand.mascotName} the skeleton mascot`}
      >
        {/* Head outline */}
        <ellipse cx="30" cy="28" rx="18" ry="16" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />
        {/* Eyes */}
        <circle cx="24" cy="26" r="3.5" fill="white" />
        <circle cx="36" cy="26" r="3.5" fill="white" />
        <circle cx="25" cy="25" r="1.2" fill="#0A1628" />
        <circle cx="37" cy="25" r="1.2" fill="#0A1628" />
        {/* Nose */}
        <ellipse cx="30" cy="31" rx="2.5" ry="2" fill="white" />
        {/* Mouth */}
        <path d={mouthD} stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* Blush */}
        <ellipse cx="20" cy="32" rx="3" ry="1.5" fill="#FFD6D6" opacity="0.4" />
        <ellipse cx="40" cy="32" rx="3" ry="1.5" fill="#FFD6D6" opacity="0.4" />
        {/* Cross-bones */}
        <line x1="10" y1="42" x2="50" y2="18" stroke="#008C95" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
        <line x1="10" y1="18" x2="50" y2="42" stroke="#008C95" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
        {/* Body */}
        <line x1="30" y1="44" x2="30" y2="60" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
        <path d="M 22 48 Q 30 44 38 48" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M 22 52 Q 30 48 38 52" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M 22 56 Q 30 52 38 56" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
      </svg>
    </span>
  );
}
