import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

function PendingComponent() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 animate-pulse">
          <img
            src="/rex.png"
            alt="Loading..."
            className="w-full h-full object-contain opacity-70"
            style={{ animation: "pulse 1.5s ease-in-out infinite" }}
          />
        </div>
        <p className="text-sm text-white/50">Loading...</p>
      </div>
    </div>
  );
}

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPendingComponent: PendingComponent,
    defaultPendingMs: 200,
    defaultNotFoundComponent: () => <p>Not found</p>,
  });
}
