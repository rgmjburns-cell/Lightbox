import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { useState, useEffect, type ReactNode } from "react";
import appCss from "~/styles/app.css?url";
import brand from "~/branding";
import NavBar from "~/components/NavBar";
import Onboarding, { getPlayerName } from "~/components/Onboarding";

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
      { rel: "manifest", href: "/manifest.json?v=2" },
      { rel: "icon", href: "/favicon.ico?v=2" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2" },
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
  const [onboarded, setOnboarded] = useState(true);
  const [playerName, setPlayerNameState] = useState<string | null>(null);

  useEffect(() => {
    const name = getPlayerName();
    setPlayerNameState(name);
    if (!name) {
      setOnboarded(false);
    }
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
          <Outlet />
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
