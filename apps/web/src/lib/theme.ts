import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "matchpoint:theme";
const DEFAULT_THEME: Theme = "light";

const listeners = new Set<() => void>();
let cachedTheme: Theme = readStoredTheme();
// index.html's inline bootstrap script sets .dark on <html> before this module
// ever loads, so this is normally a no-op — but if that script is ever skipped
// or falls out of sync with it (a stale cached copy, for instance), this is
// what keeps the DOM class from disagreeing with what useTheme() reports, which
// is exactly the failure mode where the logo (JS-driven) and the rest of the
// UI (CSS-class-driven) would otherwise show two different themes.
applyTheme(cachedTheme);

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : DEFAULT_THEME;
}

// What the browser paints outside the app's own CSS: the canvas, form controls and
// scrollbars follow color-scheme, and an installed PWA's status bar follows theme-color.
// These values are duplicated in index.html's bootstrap, which must set them before
// first paint; keep the two in step by hand (see .claude/rules/web.md).
const THEME_COLORS: Record<Theme, string> = { light: "#ffffff", dark: "#090B0C" };

/** The only place `.dark` is ever toggled on `<html>` — index.html's inline
 * bootstrap script does the same thing before first paint, deliberately
 * duplicated there since it has to run before any module loads. The two meta tags
 * go with it: set once at boot and never again, a Settings toggle would leave the
 * native chrome in the theme the app had left. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.getElementById("color-scheme-meta")?.setAttribute("content", theme);
  document.getElementById("theme-color-meta")?.setAttribute("content", THEME_COLORS[theme]);
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  cachedTheme = theme;
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return cachedTheme;
}

/**
 * Decided solely by the coach's own choice in Settings (#182, #200) — no
 * `matchMedia`/`prefers-color-scheme` read anywhere, not even as an initial
 * default. Two independent OS-preference reads (this app's own bootstrap
 * script and a separate hook the logo used) used to drift apart under PWA
 * caching, which is what made the logo and the rest of the UI disagree.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [theme, setStoredTheme];
}
