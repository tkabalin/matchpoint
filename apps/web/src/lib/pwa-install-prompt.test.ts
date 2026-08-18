import { afterEach, expect, test } from "vitest";

import { dismissInstallPrompt, hasDismissedInstallPrompt } from "./pwa-install-prompt";

afterEach(() => {
  localStorage.clear();
});

test("has not been dismissed until dismissInstallPrompt is called", () => {
  expect(hasDismissedInstallPrompt()).toBe(false);
});

test("stays dismissed once set", () => {
  dismissInstallPrompt();

  expect(hasDismissedInstallPrompt()).toBe(true);
});
