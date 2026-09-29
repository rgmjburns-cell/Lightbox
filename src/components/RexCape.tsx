/**
 * Rex's cape, in the instance's brand colour.
 *
 * The mascot is one raster PNG (`public/welcome-rex-opt.png`) with a navy cape
 * painted in, so a brand cannot change the cape by editing a CSS colour.
 * Instead `public/rex-cape-mask.png` holds just the cape, derived from that same
 * artwork by `scripts/rex-cape-assets.mjs`: its alpha is 1 inside the cape, 0
 * outside, and slightly under 1 in the deep folds so the shading survives.
 *
 * This element paints the brand colour through that mask and sits directly on
 * top of the artwork, so the cape takes the brand colour, keeps its folds, and
 * every other pixel of Rex (bones, eyes, chest badge) is untouched. Brands
 * without `rexCapeColor` render nothing at all and keep the navy in the drawing,
 * which is the neutral master.
 *
 * The mask and sizing live in `src/styles/app.css` under `.rex-cape` (gated on
 * `@supports`, so a browser that cannot mask shows the navy cape rather than a
 * solid brand-coloured square). All this component passes down is the colour.
 *
 * It must be a sibling of the mascot image inside a `relative` wrapper, and both
 * the image and the mask are square 400x400 assets drawn with `contain` +
 * `center`, so the cape lands on the shoulders at any size the caller gives Rex.
 * See `Rex.tsx`, which is the only place that builds this pairing.
 */
import type { CSSProperties } from "react";
import { brand, type BrandConfig } from "~/lib/brand";

/** The mascot artwork the cape mask is derived from. */
export const REX_ART_URL = "/welcome-rex-opt.png";
/** The cape-only mask, regenerated from the artwork by scripts/rex-cape-assets.mjs. */
export const REX_CAPE_MASK_URL = "/rex-cape-mask.png";
/** The CSS custom property the `.rex-cape` rule reads its colour from. */
export const REX_CAPE_COLOR_VAR = "--rex-cape-color";

/**
 * The style that hands the brand's cape colour to the `.rex-cape` rule, or null
 * when the brand has no cape colour (nothing is drawn and the artwork's own navy
 * cape shows). Kept apart from the component so the wiring is testable without a
 * DOM.
 */
export function rexCapeStyle(config: BrandConfig = brand): CSSProperties | null {
  if (!config.rexCapeColor) return null;
  return { [REX_CAPE_COLOR_VAR]: config.rexCapeColor } as CSSProperties;
}

interface RexCapeProps {
  className?: string;
}

export default function RexCape({ className = "" }: RexCapeProps) {
  const style = rexCapeStyle(brand);
  if (!style) return null;

  return (
    <span
      aria-hidden="true"
      data-testid="rex-cape"
      className={`rex-cape pointer-events-none absolute inset-0 ${className}`}
      style={style}
    />
  );
}
