import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { useState, useEffect, type ReactNode } from "react";
import appCss from "~/styles/app.css?url";
import brand from "~/lib/brand";
import NavBar from "~/components/NavBar";
import Onboarding from "~/components/Onboarding";
import {
  getPlayerId,
  getPlayerName,
  syncPlayerIdCookie,
} from "~/lib/playerIdentity";
import { rehydratePlayerProfile } from "~/lib/leaderboard";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no",
      },
      { name: "theme-color", content: brand.colors.themeColor },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: brand.productName },
      { name: "brand-id", content: brand.brandId },
      { title: brand.productName },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json?v=3" },
      { rel: "icon", href: "/favicon.ico?v=4" },
      // iOS takes the home-screen icon from here, not from the manifest, so the
      // brand's own icon is set alongside the manifest's icons.
      { rel: "apple-touch-icon", href: brand.appleTouchIconUrl },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-white/70 text-lg">Page not found</p>
    </div>
  ),
  component: RootComponent,
});

function RootComponent() {
  const routerState = useRouterState();
  const [onboarded, setOnboarded] = useState(true);
  const [playerName, setPlayerNameState] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Migration for players recognised before the cookie mirror existed: their id
    // lives only in localStorage, so write it into the cookie now. A later install
    // (empty localStorage, cookies kept) can then rehydrate instead of re-asking.
    syncPlayerIdCookie();
    const name = getPlayerName();
    if (name) {
      setPlayerNameState(name);
      // Recognised device: refresh the mirrored profile (name, per-game bests,
      // stats, badges) in the background. Silent — a failure just keeps what the
      // device already has.
      void rehydratePlayerProfile();
      return;
    }
    if (!getPlayerId()) {
      setOnboarded(false);
      return;
    }
    // The player id survived but the rest of local storage did not (an installed
    // PWA, or a wiped profile): restore the name and everything else from the id
    // BEFORE asking for a name again.
    void rehydratePlayerProfile().then((profile) => {
      if (!active) return;
      const restored = getPlayerName();
      if (profile && restored) {
        setPlayerNameState(restored);
        return;
      }
      setOnboarded(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleOnboardingComplete = () => {
    const name = getPlayerName();
    setPlayerNameState(name);
    setOnboarded(true);
    window.location.href = "/";
  };

  return (
    <RootDocument>
      {!onboarded && (
        <Onboarding onComplete={handleOnboardingComplete} />
      )}
      <div
        className="flex flex-col min-h-dvh relative"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/*
          ── Top Bar ──

          Owner direction, 1 Oct (final): "It actually looks better how we
          originally had it." The bar is back to the one it has always had —
          `bg-white/5 backdrop-blur-md`, the ORIGINAL faint glass — as ONE
          unconditional class string, the same string the neutral master never
          stopped using. The whiter bands tried in between (white/25, then
          white/90) did not pop the way the owner hoped, so both pilot instances
          wear the original glass again and the master is byte-for-byte unchanged.

          BOTH bar marks are drawn as their OWN ARTWORK, unfiltered — no
          brightness/contrast/grayscale/invert/saturate utility anywhere on this
          bar. The owner supplied the real logos on 1 Oct and rejected the
          black-silhouette treatment this bar briefly used ("The logos weren't
          supposed to change I just wanted the background to be whiter"): the
          shared Rad Games mark keeps its teal/navy artwork on every instance, and
          a pilot instance's own mark keeps its brand colours.

          The right-hand slot is per brand, and reads the mark comparison below —
          never a brand id and never a per-brand colour, so both pilot instances
          get the identical treatment. A brand whose own mark differs from the
          shared one on the left draws it here; the master leaves the two EQUAL,
          so its shared mark sits on the left only and the "Hi, <name>" chip keeps
          the right-hand slot.

          The element carries NO corner clip. It briefly did: on 1 Oct the owner
          asked for the pilot mark's corners to be rounded "the same as the whole
          app does on its tiles", so the <img> carried `rounded-2xl` (the home
          screen's tile radius, `src/routes/index.tsx`, Tailwind's 1rem = 16px).
          That clip is now REMOVED (owner direction, 2 Oct): The Xray Group's logo
          is a square-cornered file, and rounding it on the element left it looking
          cut off. The clip was dropped unconditionally rather than per brand —
          Imaging Queensland's artwork has its rounded corners baked into the file
          itself, so its look is unchanged. The artwork is never cropped or masked,
          with or without the clip.
        */}
        <header className="sticky top-0 z-30 bg-white/5 backdrop-blur-md safe-area-top">
          <div className="max-w-lg mx-auto flex items-center justify-between h-14 px-4">
            <div className="flex items-center gap-2">
              {/*
                The shared Rad Games mark, from the brand config, drawn as its own
                artwork on every instance: one file and one class, the same mark on
                the master's navy glass and on a pilot instance's glass. (The
                owner's 1 Oct artwork is the teal/navy lockup; the black silhouette
                this bar briefly applied to it is gone.)
              */}
              <img src={brand.logoUrl} alt={brand.logoAlt} className="h-12 w-auto" />
            </div>
            {/*
              The right-hand slot. A brand whose OWN mark differs from the shared
              one above (`logoUrl`) draws it here — pilot instances sign their top
              bar with their own logo (owner direction, 30 Sep). The neutral master
              keeps `homeLogoUrl === logoUrl`, so its shared mark is already on the
              left and this slot stays the "Hi, <nickname>" chip it has always been
              rather than showing the same mark twice. Only the artwork differs: one
              fixed slot height (`h-9`, 36 CSS px on a 56 CSS px bar), the same on
              every instance, and a width cap plus `object-contain` so a very wide
              lockup shrinks instead of overflowing at 320 CSS px.

              The mark is drawn as supplied — no filter and no corner clip, exactly
              like the shared mark on the left: the owner's artwork carries its own
              brand colours and its own corners on the original glass bar. (The
              `rounded-2xl` clip this slot carried for a day, added 1 Oct, was
              removed on 2 Oct when the owner's square-cornered The Xray Group logo
              arrived — see the note above the bar.) The PNG is untouched either way.
            */}
            {brand.homeLogoUrl !== brand.logoUrl ? (
              <img
                src={brand.homeLogoUrl}
                alt={brand.logoAlt}
                draggable={false}
                className="h-9 w-auto max-w-[45%] shrink-0 object-contain object-right select-none"
              />
            ) : (
              playerName && (
                <span className="text-sm font-medium text-white/80 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1">
                  Hi, {playerName}
                </span>
              )
            )}
          </div>
        </header>

        {/* ── Main Content ── */}
        <main className="flex-1 relative z-10">
          <div className="route-enter" key={routerState.location.pathname}>
            <Outlet />
          </div>
        </main>

        {/* ── Bottom Nav ── */}
        {onboarded && <NavBar />}
      </div>
      <Scripts />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="text-white/90">
        {children}
      </body>
    </html>
  );
}
