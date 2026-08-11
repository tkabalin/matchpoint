/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The generated client calls /api/* on its own origin, which is how production serves
// it (Caddy strips the prefix and proxies to the API). This makes that true in dev too,
// so no environment ever needs a different base URL — and same-origin means no CORS
// anywhere. Shared by `server` and `preview`: preview serves the production build
// locally, and without the proxy every request from it 404s against the static server.
const apiProxy = {
  "/api": {
    target: "http://localhost:8000",
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  // tanstackRouter must run before react() — it generates routeTree.gen.ts from
  // src/routes/ that react()'s Babel transform then compiles.
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt", not "autoUpdate": autoUpdate activates a new service worker and reloads
      // the page by itself, which on the capture screen means a deploy can reload mid-match
      // between two taps. This puts the reload where the user chooses it — see
      // src/features/pwa/update-prompt.tsx for the affordance that choice needs.
      registerType: "prompt",
      manifest: {
        name: "MatchPoint",
        short_name: "MatchPoint",
        description: "Track live tennis match statistics and analyse player performance.",
        display: "standalone",
        start_url: "/",
        // Both agree with index.html's theme-color meta and --background in src/app.css;
        // if they drift, the installed title bar disagrees with the page under it.
        theme_color: "#ffffff",
        background_color: "#ffffff",
        // All generated from icon.svg by scripts/gen-icons.mjs; re-run it after editing that file.
        // The maskable variant is padded instead of full-bleed: Android masks icons to its
        // own shape and only the central ~80% survives, so the court would lose its edges.
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // The default glob stops at js/css/html/ico/png/svg, which would leave the font
        // files out of the precache and the shell falling back to a system font offline.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // navigateFallback answers navigations from the cached index.html, which is what
        // makes an unvisited route work offline. It only intercepts navigations, so the
        // generated client's fetch calls are unaffected — but browsing to /api/docs is a
        // navigation, and without this it would be served the SPA instead of the API. The
        // pattern is matched against pathname + search, so it has to cover a bare /api and
        // /api?x=1 too: those reach Caddy's `redir /api /api/` only while uninstalled.
        navigateFallbackDenylist: [/^\/api(?:[/?]|$)/],
      },
    }),
  ],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      // text-summary prints the one totals block CI's coverage regex reads; the
      // default text reporter only emits a per-file table.
      reporter: ["text", "text-summary", "html"],
      // Without an explicit include, the v8 provider only instruments files a
      // test imported, so a module with no test at all is absent from the report
      // rather than counted as uncovered — which reads as 100% and is scraped by
      // CI as the headline figure. Naming the source tree makes untested files
      // count against the number.
      include: ["src/**/*.{ts,tsx}"],
      // Bootstrap with no logic of its own, test infrastructure, and vendored
      // shadcn components: none of these are code we wrote or would write tests
      // for, so counting them would only depress the figure with work nobody
      // intends to do.
      exclude: ["src/main.tsx", "src/test-setup.ts", "src/components/ui/**"],
    },
  },
});
