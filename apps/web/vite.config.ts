/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Relative, not `@/`: the alias is applied to the app's module graph, not to the config
// itself, which esbuild bundles before `resolve.alias` below exists.
import { pwaOptions } from "./src/features/pwa/pwa-config.ts";

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
    VitePWA(pwaOptions),
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
      // Bootstrap with no logic of its own, test infrastructure, the router
      // plugin's generated route tree, and vendored shadcn components: none of
      // these are code we wrote or would write tests for, so counting them would
      // only depress the figure with work nobody intends to do.
      exclude: [
        "src/main.tsx",
        "src/test-setup.ts",
        "src/routeTree.gen.ts",
        "src/components/ui/**",
      ],
    },
  },
});
