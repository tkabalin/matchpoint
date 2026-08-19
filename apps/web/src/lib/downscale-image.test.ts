import { afterEach, expect, test, vi } from "vitest";

import { downscaleImage } from "./downscale-image";

/** jsdom implements neither createImageBitmap nor canvas encoding, so both are
 * stubbed directly — this is testing downscaleImage's own decision logic (which type
 * wins, when the original is kept), not the browser's actual image codecs. */
function stubBitmap(width: number, height: number) {
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width, height, close: vi.fn() }));
}

function stubCanvasEncoding(makeBlob: (type: string) => Blob | null) {
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return realCreateElement(tag);
    const canvas = realCreateElement("canvas") as HTMLCanvasElement;
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(canvas, "toBlob").mockImplementation((callback, type) => {
      callback(makeBlob(type ?? "image/png"));
    });
    return canvas;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("returns a smaller file when encoding succeeds at the preferred type", async () => {
  stubBitmap(4000, 3000);
  stubCanvasEncoding((type) => new Blob([new Uint8Array(100)], { type }));
  const original = new File([new Uint8Array(5_000_000)], "photo.jpg", { type: "image/jpeg" });

  const result = await downscaleImage(original);

  expect(result).not.toBe(original);
  expect(result.type).toBe("image/webp");
  expect(result.name).toBe("photo.webp");
  expect(result.size).toBeLessThan(original.size);
});

test("falls back to JPEG when the canvas cannot encode WebP", async () => {
  stubBitmap(4000, 3000);
  // A canvas that can't encode a type answers with a PNG instead of failing.
  stubCanvasEncoding((type) =>
    type === "image/webp"
      ? new Blob([new Uint8Array(100)], { type: "image/png" })
      : new Blob([new Uint8Array(80)], { type }),
  );
  const original = new File([new Uint8Array(5_000_000)], "photo.jpg", { type: "image/jpeg" });

  const result = await downscaleImage(original);

  expect(result.type).toBe("image/jpeg");
  expect(result.name).toBe("photo.jpg");
});

test("keeps the original file when the canvas cannot get a 2d context", async () => {
  stubBitmap(4000, 3000);
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return realCreateElement(tag);
    const canvas = realCreateElement("canvas") as HTMLCanvasElement;
    vi.spyOn(canvas, "getContext").mockReturnValue(null);
    return canvas;
  });
  const original = new File([new Uint8Array(5_000_000)], "photo.jpg", { type: "image/jpeg" });

  const result = await downscaleImage(original);

  expect(result).toBe(original);
});

test("keeps the original file when the re-encode is not actually smaller", async () => {
  stubBitmap(200, 150);
  const original = new File([new Uint8Array(50)], "photo.jpg", { type: "image/jpeg" });
  stubCanvasEncoding((type) => new Blob([new Uint8Array(500)], { type }));

  const result = await downscaleImage(original);

  expect(result).toBe(original);
});
