/**
 * Renders the raster icons in public/ from icon.svg.
 *
 *   pnpm --filter @matchpoint/web gen-icons
 *
 * Nothing runs this automatically — re-run it after editing icon.svg and commit the
 * output. public/favicon.svg is not generated here; it ships as SVG.
 *
 * Each icon is rendered straight at its output size rather than resampled down from
 * one large bitmap: resampling antialiases the court's line work twice, which smears
 * the service lines into grey halos at the smaller sizes. The rasteriser is the
 * Chromium already installed for the Playwright e2e suite, so this needs no tooling
 * of its own — and it is the same engine that draws favicon.svg, which keeps the two
 * versions of the mark consistent.
 */
import playwright from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = playwright;

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const courtGreen = "#0E3B2C";

const targets = [
  { file: "pwa-192x192.png", size: 192 },
  { file: "pwa-512x512.png", size: 512 },
  // Android masks icons to its own shape and only the central ~80% survives, so the
  // mark is inset on an opaque tile instead of running full-bleed.
  { file: "pwa-maskable-512x512.png", size: 512, mark: 400, background: courtGreen },
  // iOS composites home screen icons over white, which would otherwise show through
  // the mark's rounded corners.
  { file: "apple-touch-icon.png", size: 180, background: courtGreen },
];

// Drop icon.svg's leading comment block — it would land in the page as markup.
const source = await readFile(join(webRoot, "icon.svg"), "utf8");
const svg = source.slice(source.indexOf("<svg"));

const browser = await chromium.launch();

for (const { file, size, mark = size, background } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Sizing the <svg> in CSS overrides its width/height attributes, so the mark is
  // laid out at the target size and rasterised once.
  await page.setContent(
    `<style>
       html, body { margin: 0; height: 100%; }
       body {
         display: flex;
         align-items: center;
         justify-content: center;
         background: ${background ?? "transparent"};
       }
       svg { display: block; width: ${mark}px; height: ${mark}px; }
     </style>${svg}`,
  );
  await writeFile(
    join(webRoot, "public", file),
    await page.screenshot({ omitBackground: !background }),
  );
  await page.close();
  console.log(`${file} — ${size}x${size}, mark at ${mark}px`);
}

await browser.close();
