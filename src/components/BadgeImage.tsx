interface BadgeImageProps {
  src: string;
  name: string;
  /** Render the badge as locked: grayscale + faded, still aspect-true. */
  locked?: boolean;
  /** Icon size for grid rows. Override for toasts/other contexts. */
  className?: string;
}

/**
 * Shared renderer for badge PNG artwork. The PNG is the badge — no
 * coloured tile/circle wrapper, no crop/stretch/distort. Keeps aspect
 * ratio via object-contain at the given size.
 */
export default function BadgeImage({
  src,
  name,
  locked = false,
  className = "w-12 h-12",
}: BadgeImageProps) {
  return (
    <img
      src={src}
      alt={name}
      draggable={false}
      className={`object-contain select-none shrink-0 ${
        locked ? "grayscale opacity-50" : ""
      } ${className}`}
    />
  );
}