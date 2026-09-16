import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { applyTheme, setStoredTheme } from "./theme";

/** The two tags index.html's bootstrap sets before first paint. */
function installMetaTags() {
  document.head.innerHTML = `
    <meta name="color-scheme" content="light" id="color-scheme-meta" />
    <meta name="theme-color" content="#ffffff" id="theme-color-meta" />
  `;
}

function contentOf(id: string) {
  return document.getElementById(id)?.getAttribute("content");
}

beforeEach(() => {
  installMetaTags();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
});

describe("applyTheme", () => {
  test("dark sets the class and both meta tags the browser paints from", () => {
    applyTheme("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(contentOf("color-scheme-meta")).toBe("dark");
    expect(contentOf("theme-color-meta")).toBe("#090B0C");
  });

  test("light puts all three back", () => {
    applyTheme("dark");
    applyTheme("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(contentOf("color-scheme-meta")).toBe("light");
    expect(contentOf("theme-color-meta")).toBe("#ffffff");
  });

  // The tags are only there because index.html put them there, and a test harness or
  // an older cached shell may not have.
  test("survives the tags being absent", () => {
    document.head.innerHTML = "";

    expect(() => {
      applyTheme("dark");
    }).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("module load", () => {
  // Dark mode is deactivated: the module always resolves light as it loads,
  // regardless of a "dark" value some coach's browser still has stored from
  // before the Settings toggle was removed — the class and tags still agree
  // with useTheme() even when index.html's bootstrap did not run. The static
  // import above evaluated before beforeEach put the tags there, so only a
  // re-import exercises the tag half of that path.
  test("resolves light even with a stale stored 'dark' value", async () => {
    localStorage.setItem("matchpoint:theme", "dark");
    vi.resetModules();

    await import("./theme");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(contentOf("color-scheme-meta")).toBe("light");
    expect(contentOf("theme-color-meta")).toBe("#ffffff");
  });
});

describe("setStoredTheme", () => {
  // The toggle in Settings goes through here, and it is the path that used to leave
  // the native chrome behind until the next reload.
  test("carries the choice through to the meta tags, not just the class", () => {
    setStoredTheme("dark");

    expect(localStorage.getItem("matchpoint:theme")).toBe("dark");
    expect(contentOf("color-scheme-meta")).toBe("dark");
    expect(contentOf("theme-color-meta")).toBe("#090B0C");
  });
});
