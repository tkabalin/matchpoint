import { registerErrorStatusInterceptor } from "@matchpoint/api-client/error-interceptor";
import { QueryClient } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "@/app.css";
import { UpdatePrompt } from "@/features/pwa/update-prompt";
import { routeTree } from "@/routeTree.gen";

// react-grab lets coding agents select page context to work from. Dev-only — the
// `import.meta.env.DEV` guard means Vite tree-shakes this out of production builds.
if (import.meta.env.DEV) {
  import("react-grab").catch((error: unknown) => {
    console.error("Failed to load react-grab", error);
  });
}

// Lets any thrown query error report its HTTP status (see error-interceptor.ts) —
// needed here, once, rather than per-call site, since it must run after the
// generated client singleton exists.
registerErrorStatusInterceptor();

// Built here rather than in RootLayout: the _authenticated guard's beforeLoad needs
// the same client to call ensureQueryData before RootLayout (or anything else) has
// rendered, and router context is the only thing both a beforeLoad and a component can
// reach.
const queryClient = new QueryClient();
const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Registered here rather than anywhere under src/app.tsx so no test has to stand up a
// service worker that jsdom does not implement. The prompt gets its own root for the same
// reason it is not a route: an update can arrive on any screen, and mounting it outside
// the router keeps it independent of whatever the user is in the middle of. The service
// worker only exists in a build, so this is inert under `vite dev`.
let promptRoot: Root | null = null;

const updateSW = registerSW({
  // Takes the reload away from the plugin, which only reloads when the page already had a
  // controller when `register()` ran — see activateAndReload below for why that is not
  // good enough. An empty handler is how the plugin's own path is turned off.
  onNeedReload() {},
  onNeedRefresh() {
    // registerSW can call this twice for one update: a worker installed by another tab is
    // external, and that fires both the `installed` handler and, 200 ms later, `waiting`.
    // Reusing the one root keeps a second banner from stacking on top of the first.
    if (promptRoot) return;

    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    promptRoot = root;

    root.render(
      <StrictMode>
        <UpdatePrompt
          onReload={() => {
            void activateAndReload();
          }}
          onDismiss={() => {
            promptRoot = null;
            root.unmount();
            container.remove();
          }}
        />
      </StrictMode>,
    );
  },
});

// updateSW's boolean argument does nothing in vite-plugin-pwa 1.3.0 — all the call does is
// tell the waiting worker to skip waiting — so the reload is ours to do. A controlled page
// gets a `controllerchange` once the new worker takes over. An uncontrolled one never
// does: skipWaiting only claims the clients the outgoing worker controlled, and a hard
// reload (which bypasses the worker) leaves the page uncontrolled while still finding the
// waiting worker, so the banner shows with no controller to change. That page reloads
// straight away instead — the navigation is served by whichever worker is active by then.
async function activateAndReload() {
  const { serviceWorker } = navigator;
  const controlled = serviceWorker.controller !== null;

  if (controlled) {
    serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.location.reload();
      },
      { once: true },
    );
  }

  await updateSW();
  if (!controlled) window.location.reload();
}
