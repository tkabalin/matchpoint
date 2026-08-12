import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { pwaOptions } from "./pwa-config";

// fileURLToPath rather than handing readFileSync a URL: the jsdom environment replaces the
// global URL with its own, which Node's fs does not accept.
const icons = join(dirname(fileURLToPath(import.meta.url)), "../../../public");

/**
 * Dimensions and transparency straight out of the PNG header, so this needs no image
 * library. IHDR is always the first chunk: width and height are big-endian uint32s at
 * bytes 16 and 20, and the colour type is byte 25. Types 4 and 6 carry an alpha channel;
 * a palette image (3) would carry it in a separate tRNS chunk instead, but the Chromium
 * scripts/gen-icons.mjs renders with only ever emits RGB or RGBA.
 */
function readIcon(name: string) {
  const png = readFileSync(join(icons, name));
  return {
    size: `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,
    transparent: [4, 6].includes(png.readUInt8(25)),
  };
}

// Left as "autoUpdate" — the plugin's default posture — a deploy activates the new worker
// and reloads the page on its own, which on the capture screen lands between two taps,
// mid-match. This is the assertion the comment in pwa-config.ts is asking for.
test("prompts for an update instead of reloading the page itself", () => {
  expect(pwaOptions.registerType).toBe("prompt");
});

// navigateFallback answers navigations from the cached index.html, so without the denylist
// an installed client browsing to /api/docs is served the SPA. Workbox matches these
// against pathname + search, which is why a bare /api and /api?x=1 have to match too.
test("keeps the API out of the offline navigation fallback", () => {
  const denied = (path: string) =>
    pwaOptions.workbox.navigateFallbackDenylist.some((pattern) => pattern.test(path));

  expect(denied("/api")).toBe(true);
  expect(denied("/api/")).toBe(true);
  expect(denied("/api?x=1")).toBe(true);
  expect(denied("/api/docs")).toBe(true);

  expect(denied("/apihelp")).toBe(false);
  expect(denied("/players")).toBe(false);
});

// Nothing regenerates the icons from icon.svg, so a rename, a deletion, or a size that was
// changed in the manifest but never re-rendered is invisible until an install shows it.
test("ships an icon file at every size the manifest declares", () => {
  for (const icon of pwaOptions.manifest.icons) {
    expect(readIcon(icon.src).size, icon.src).toBe(icon.sizes);
  }
});

test("keeps the masked icon opaque and the full-bleed ones transparent", () => {
  for (const icon of pwaOptions.manifest.icons) {
    // Android masks the maskable icon to its own shape and composites it over its own
    // background, so alpha there shows through as a hole; the full-bleed pair are drawn
    // over whatever the launcher puts behind them and have to keep theirs.
    const maskable = "purpose" in icon && icon.purpose === "maskable";
    expect(readIcon(icon.src).transparent, icon.src).toBe(!maskable);
  }

  // Linked from index.html rather than the manifest, so it is not in the loop above: iOS
  // composites home screen icons over white, which would otherwise show through the
  // mark's rounded corners.
  expect(readIcon("apple-touch-icon.png")).toEqual({ size: "180x180", transparent: false });
});
