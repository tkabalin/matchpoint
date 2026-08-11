import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/app.css";
import { routeTree } from "@/routeTree.gen";

// react-grab lets coding agents select page context to work from. Dev-only — the
// `import.meta.env.DEV` guard means Vite tree-shakes this out of production builds.
if (import.meta.env.DEV) {
  import("react-grab").catch((error: unknown) => {
    console.error("Failed to load react-grab", error);
  });
}

const router = createRouter({ routeTree });

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
