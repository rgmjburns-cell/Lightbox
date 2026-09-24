import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { brandConfig, manifestFor, resolveBrandId } from "./src/lib/brand";

/**
 * The PWA manifest is generated from the brand config (`src/lib/brand.ts`) so a
 * per-brand instance cannot end up installed under another brand's name. There is
 * deliberately no `public/manifest.json` any more: one source, served in dev by
 * the middleware below and written into the build as an asset.
 *
 * The brand id comes from VITE_BRAND_ID, read here (the config runs in Node, where
 * Vite's own import.meta.env does not exist yet) with the same fallback the app
 * uses, so the manifest and the UI can never disagree.
 */
function brandManifest(): Plugin {
  const manifest = manifestFor(brandConfig(resolveBrandId(process.env.VITE_BRAND_ID)));
  const json = JSON.stringify(manifest, null, 2);
  return {
    name: "brand-manifest",
    configureServer(server) {
      server.middlewares.use(
        (
          req: { url?: string },
          res: { setHeader: (name: string, value: string) => void; end: (body: string) => void },
          next: () => void,
        ) => {
          if (req.url?.split("?")[0] !== "/manifest.json") return next();
          res.setHeader("Content-Type", "application/manifest+json");
          res.setHeader("Cache-Control", "no-cache");
          res.end(json);
        },
      );
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: json });
    },
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: true,
    // The site is reverse-proxied behind <label>.<PUBLIC_SITE_DOMAIN>; the proxy
    // masks the Host to localhost:3000, but accept any host so a dev server never
    // rejects a proxied request with "Blocked request".
    allowedHosts: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    brandManifest(),
    tanstackStart(),
    viteReact(),
  ],
});
