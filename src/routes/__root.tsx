import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { useState, useEffect, type ReactNode } from "react";
import appCss from "~/styles/app.css?url";
import brand from "~/branding";
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
      { name: "theme-color", content: "#0A1628" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "LightBox" },
      { title: brand.name },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json?v=3" },
      { rel: "icon", href: "/favicon.ico?v=4" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=3" },
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
        {/* ── Top Bar (transparent glass) ── */}
        <header className="sticky top-0 z-30 bg-white/5 backdrop-blur-md safe-area-top">
          <div className="max-w-lg mx-auto flex items-center justify-between h-14 px-4">
            <div className="flex items-center gap-2">
              <img
                src="/welcome-lightbox-logo-opt.png"
                alt="LightBox"
                className="h-14 w-auto"
              />
            </div>
            {playerName && (
              <span className="text-sm font-medium text-white/80 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1">
                Hi, {playerName}
              </span>
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
