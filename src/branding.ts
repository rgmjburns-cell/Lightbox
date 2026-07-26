/**
 * LightBox PLAY — Branding Configuration
 *
 * Central branding config. To rebrand for a different radiology network
 * (Capital Radiology, Lake Imaging, etc.), swap the values here.
 *
 * Tailwind v4 consumes these via the CSS @theme block in app.css.
 */

const brand = {
  name: "LightBox",
  shortName: "LightBox",

  // ── Integral Diagnostics Brand Palette ──
  colors: {
    primary: "#2D2D2D", // Deep Charcoal
    secondary: "#008C95", // IDX Teal — primary accent
    lightTeal: "#E0F5F7",
    white: "#FFFFFF",
    lightGrey: "#F5F5F5",
    darkText: "#1A1A1A",
    mutedText: "#6B7280",
  },

  // ── Mascot ──
  mascot: {
    name: "Rex",
    description: "A friendly skeleton who loves radiology!",
  },

  // ── Welcome ──
  welcomeMessage: "Welcome to LightBox PLAY! I'm Rex — your friendly radiology buddy. Pick a game and have fun while you wait!",

  // ── Logo ──
  logo: {
    alt: "Integral Diagnostics",
    text: "Integral Diagnostics",
    src: "/idx-logo.png",
  },

  // ── Rewards ──
  rewards: {
    monthlyPrize: "Glory and bragging rights for the top spot!",
  },
} as const;

export default brand;
