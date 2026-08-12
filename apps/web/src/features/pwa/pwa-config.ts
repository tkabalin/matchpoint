import type { VitePWAOptions } from "vite-plugin-pwa";

/**
 * The vite-plugin-pwa options, kept beside the prompt they configure rather than inline in
 * vite.config.ts so pwa-config.test.ts can assert on them. Nothing in the app imports this,
 * so it never reaches the client bundle — vite.config.ts is its only consumer, and it must
 * import it by relative path: the `@/` alias does not exist inside the config's own module
 * graph, which esbuild bundles before `resolve.alias` is applied.
 *
 * `satisfies` rather than a type annotation, so `registerType` stays the literal "prompt"
 * and `manifest.icons` stays non-optional for the test to read.
 */
export const pwaOptions = {
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
} satisfies Partial<VitePWAOptions>;
