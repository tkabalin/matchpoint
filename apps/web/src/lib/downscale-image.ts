// Comfortably inside the 1 MB both Caddy and the API's own body limit enforce, with
// room for the multipart envelope. Nothing about this is the server's stored size —
// that is 512 square, and the server crops to it whatever arrives.
const MAX_EDGE = 1024;
const QUALITY = 0.85;

// WebP everywhere it encodes, which is every browser this app supports; JPEG is the
// fallback because a canvas that cannot encode WebP silently hands back a PNG, and a
// PNG of a photo is larger than the original JPEG was.
const PREFERRED_TYPE = "image/webp";
const FALLBACK_TYPE = "image/jpeg";

/**
 * Shrink a photo before uploading it.
 *
 * A phone photo is several MB and the request body limit is 1 MB, so an untouched
 * upload is refused before it ever reaches the resizing the API does on its own. The
 * bytes dropped here were never going to be stored: the server re-encodes to a 512
 * square regardless, so this only decides how much is sent to be thrown away.
 *
 * Returns the original file unchanged if it is already small and no bigger than the
 * bound, or if the browser cannot encode a canvas at all.
 */
export async function downscaleImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await encode(canvas, PREFERRED_TYPE);
    if (!blob) return file;
    // A browser asked for a type it cannot encode answers with a PNG rather than
    // failing, so trust the blob's own type over the one that was requested.
    const encoded =
      blob.type === PREFERRED_TYPE ? blob : ((await encode(canvas, FALLBACK_TYPE)) ?? blob);

    // Re-encoding an already-small photo can come out larger than it went in.
    if (encoded.size >= file.size) return file;
    return new File([encoded], renameFor(file.name, encoded.type), { type: encoded.type });
  } finally {
    bitmap.close();
  }
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, QUALITY);
  });
}

/** The upload is keyed on its bytes, but a name that lies about them is confusing. */
function renameFor(name: string, type: string): string {
  const stem = name.replace(/\.[^./\\]+$/, "") || "photo";
  return `${stem}.${type === PREFERRED_TYPE ? "webp" : "jpg"}`;
}
