import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "matchpoint:theme";
const DEFAULT_THEME: Theme = "light";

const listeners = new Set<() => void>();
let cachedTheme: Theme = readStoredTheme();

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : DEFAULT_THEME;
}

/** The only place `.dark` is ever toggled on `<html>` — index.html's inline
 * bootstrap script does the same thing before first paint, deliberately
 * duplicated there since it has to run before any module loads. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
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
