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
import TermsGate from "~/components/TermsGate";
import {
  getPlayerId,
  getPlayerName,
  syncPlayerIdCookie,
} from "~/lib/playerIdentity";
import { rehydratePlayerProfile } from "~/lib/leaderboard";
import { acceptToU, isToUAccepted } from "~/lib/tou";

/**
 * The one route exempt from the Terms of Use gate: a player has to be able to
 * READ the terms before agreeing to them. That page carries its own accept
 * button for a first-time visitor, so it is not a way around the gate.
 */
const GATE_EXEMPT_PATHS = ["/terms", "/terms/"];

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
  // Terms of Use acceptance, per device (`src/lib/tou.ts`). Optimistic start, the
  // same way the name gate starts: the check is a synchronous localStorage read,
  // so a returned player sees no change at all, and a first-time visitor gets the
  // gate a frame later. Presentation is the gate's own business.
  const [termsAccepted, setTermsAccepted] = useState(true);

  useEffect(() => {
    setTermsAccepted(isToUAccepted());
  }, []);

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

  /**
   * Accepting the terms stores the versioned device flag and reveals the app.
   * Nothing else is required first: acceptance is deliberately independent of
   * the nickname flow, and a brand new player simply meets the name gate next.
   */
  const handleAcceptTerms = () => {
    acceptToU();
    setTermsAccepted(true);
  };

  // The gate replaces the whole app rather than covering it, so a first-time
  // visitor cannot reach a game (or the leaderboard) behind it, not even by
  // deep-linking straight to one.
  const isTermsPage = GATE_EXEMPT_PATHS.includes(routerState.location.pathname);
  const showTermsGate = !termsAccepted && !isTermsPage;

  return (
    <RootDocument>
      {showTermsGate ? (
        <TermsGate onAccept={handleAcceptTerms} />
      ) : (
        <>
          {/* The nickname gate asks AFTER the terms, never instead of them: a
              player who tapped "Read the full terms" gets to read the page, and
              meets the name prompt when they accept and land back in the app. */}
          {!onboarded && !isTermsPage && (
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
                  {/* The brand's own mark, from the brand config. */}
                  <img
                    src={brand.logoUrl}
                    alt={brand.logoAlt}
                    className="h-12 w-auto"
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
        </>
      )}
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
