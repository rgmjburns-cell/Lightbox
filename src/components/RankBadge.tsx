/**
 * LightBox PLAY — single shared source for competition/ranking artwork.
 *
 * Every place that shows a rank medal or a winner/"new best" trophy must
 * reference this module so the art stays consistent app-wide:
 *  - rank 1 → gold medal, rank 2 → silver, rank 3 → bronze, rank 4+ → numeric
 *  - general winner / leaderboard / "new best" contexts → the trophy
 *
 * Assets live in public/leaderboard/ (downscaled inline copies, aspect
 * ratios preserved — never cropped or stretched here either).
 */

export const GOLD_MEDAL_SRC = "/leaderboard/gold.png";
export const SILVER_MEDAL_SRC = "/leaderboard/silver.png";
export const BRONZE_MEDAL_SRC = "/leaderboard/bronze.png";
export const TROPHY_SRC = "/leaderboard/trophy.png";

/** Medal image for a podium rank, or null for rank 4+ (shown numeric). */
export function rankMedalSrc(rank: number): string | null {
  if (rank === 1) return GOLD_MEDAL_SRC;
  if (rank === 2) return SILVER_MEDAL_SRC;
  if (rank === 3) return BRONZE_MEDAL_SRC;
  return null;
}

const MEDAL_LABEL: Record<number, string> = {
  1: "Gold medal",
  2: "Silver medal",
  3: "Bronze medal",
};

interface RankIconProps {
  rank: number;
  /** Size classes — must keep equal w/h so the art never stretches. */
  className?: string;
}

/**
 * Inline podium medal for rank 1–3; renders nothing for rank 4+
 * (callers show a plain numeric "#N" there instead).
 */
export function RankIcon({ rank, className = "w-8 h-8" }: RankIconProps) {
  const src = rankMedalSrc(rank);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={MEDAL_LABEL[rank] ?? `Rank ${rank}`}
      draggable={false}
      className={`${className} object-contain shrink-0 select-none`}
    />
  );
}

interface TrophyIconProps {
  className?: string;
  label?: string;
}

/**
 * Small inline trophy for winner / leaderboard / "new best" lines.
 * Renders at text-adjacent size with aspect preserved — never stretched.
 */
export function TrophyIcon({
  className = "inline-block w-5 h-5 -mt-0.5",
  label = "Trophy",
}: TrophyIconProps) {
  return (
    <img
      src={TROPHY_SRC}
      alt={label}
      draggable={false}
      aria-hidden={label === "" ? true : undefined}
      className={`${className} object-contain shrink-0 select-none`}
    />
  );
}
