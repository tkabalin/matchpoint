import { afterEach, expect, test, vi } from "vitest";

import { detectPlatform, isRunningInstalled } from "./device-platform";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile";
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0";

test("detects an iPhone from its user agent", () => {
  expect(detectPlatform(IPHONE_UA, 0)).toBe("ios");
});

test("detects an iPad from its user agent", () => {
  expect(detectPlatform(IPAD_UA, 5)).toBe("ios");
});

// iPadOS 13+ reports itself as a Mac, distinguished only by touch support.
test("detects an iPad browsing in desktop mode by its touch support", () => {
  expect(detectPlatform(MAC_UA, 5)).toBe("ios");
});

test("does not mistake an actual Mac (no touch) for an iPad", () => {
  expect(detectPlatform(MAC_UA, 0)).toBe("other");
});

test("detects Android", () => {
  expect(detectPlatform(ANDROID_UA, 5)).toBe("android");
});

test("falls back to other for a desktop browser", () => {
  expect(detectPlatform(DESKTOP_CHROME_UA, 0)).toBe("other");
});

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("isRunningInstalled is false when neither platform check matches", () => {
  stubMatchMedia(false);

  expect(isRunningInstalled()).toBe(false);
});

test("isRunningInstalled is true when display-mode is standalone", () => {
  stubMatchMedia(true);

  expect(isRunningInstalled()).toBe(true);
});

test("isRunningInstalled is true on iOS Safari's navigator.standalone", () => {
  stubMatchMedia(false);
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });

  expect(isRunningInstalled()).toBe(true);

  // @ts-expect-error -- non-standard iOS-only property, test cleanup only
  delete navigator.standalone;
});
