"use client";

// ──────────────────────────────────────────────────────────────────
// Shrink a photo before it ever leaves the phone.
//
// Daksh, Nov 2026: "when we upload image it should automatically
// compress the image so it will not give too much load to system."
//
// A phone camera hands you 4–12 MB and 4000px across. The tool card
// shows that picture at about 120px. Sending the original means the
// man at the cupboard waits on a shed's worth of signal to upload
// twelve megabytes, the bucket fills with them, and every screen that
// lists tools then pulls them back down again.
//
// So the browser does the work: longest edge capped, re-encoded as
// JPEG, and the ORIGINAL kept if the shrink somehow made it bigger
// (which happens with small PNG line art). Anything that is not an
// image, or any browser step that fails, falls through to the
// original file — a photo that will not compress must not cost
// somebody the tool they were adding.
// ──────────────────────────────────────────────────────────────────

/** Longest edge after shrinking. 1280 is comfortably more than any
 *  screen shows a tool at, and survives a pinch-zoom. */
const MAX_EDGE = 1280;

/** JPEG quality. 0.82 is the usual knee: past it the file grows fast
 *  and a photograph of a drill bit looks no different. */
const QUALITY = 0.82;

/** Below this, leave it alone — re-encoding a small file mostly just
 *  loses detail. */
const SKIP_UNDER_BYTES = 300 * 1024;

export type Shrunk = {
  file: File;
  /** Did anything actually change? Drives the "4.1 MB → 240 KB" line. */
  changed: boolean;
  beforeBytes: number;
  afterBytes: number;
};

export function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function shrinkImage(file: File): Promise<Shrunk> {
  const untouched: Shrunk = {
    file,
    changed: false,
    beforeBytes: file.size,
    afterBytes: file.size,
  };

  if (!file.type.startsWith("image/")) return untouched;
  if (file.size <= SKIP_UNDER_BYTES) return untouched;
  if (typeof document === "undefined") return untouched;

  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return untouched;
    // White underneath: a transparent PNG flattened to JPEG goes black
    // otherwise, and a black square is not a photo of a tool.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size === 0 || blob.size >= file.size) return untouched;

    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return {
      file: new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() }),
      changed: true,
      beforeBytes: file.size,
      afterBytes: blob.size,
    };
  } catch {
    // HEIC the browser cannot decode, a canvas the OS would not give
    // us, memory pressure on an old phone. Send the original.
    return untouched;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // The browser applies the EXIF rotation for us, so a photo taken
      // sideways does not arrive on its side.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
