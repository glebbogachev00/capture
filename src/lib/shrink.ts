/**
 * Shrinking media at capture time (Sprint 4 — media capture + shrink).
 *
 * A phone photo comes in at 12 megapixels; read as a data URL it is a
 * ~15-20MB base64 string, and a handful of those go straight past
 * IndexedDB comfort (and the 5MB localStorage ceiling the old design
 * avoided). The fix is to shrink the moment a file is picked: downscale to
 * at most 1600px on the long edge and re-encode as WebP (falling back to
 * JPEG where WebP isn't available). A 12MP photo becomes a ~300KB string
 * before it ever touches storage.
 *
 * Browser-native on purpose — no compression library, no new dependency.
 * `canvas.toBlob` does the encode; the pure helpers below are unit-tested
 * and the canvas part is thin.
 */

export const SHRINK_MAX_DIM = 1600;
export const SHRINK_QUALITY = 0.82;
export { MAX_SYNC_IMAGE_SOURCE_LENGTH } from "./imageLimits";
import { MAX_SYNC_IMAGE_SOURCE_LENGTH } from "./imageLimits";

export type ShrinkOpts = {
  maxDim?: number;
  quality?: number;
};

/** The box an image of w×h shrinks to fit inside maxDim on its long edge.
    Never upscales; never returns 0. */
export function targetBox(
  w: number,
  h: number,
  maxDim = SHRINK_MAX_DIM
): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: Math.max(1, w), height: Math.max(1, h) };
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = maxDim / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Which encode to ask canvas for. WebP is smaller; anything without it
    (very old browsers) gets JPEG, which every canvas supports. */
export function pickImageType(
  supported: readonly string[]
): "image/webp" | "image/jpeg" {
  return supported.includes("image/webp") ? "image/webp" : "image/jpeg";
}

export function shouldReencodeImage(
  dataUrl: string,
  width: number,
  height: number,
  maxDim = SHRINK_MAX_DIM,
): boolean {
  return dataUrl.length > MAX_SYNC_IMAGE_SOURCE_LENGTH || width > maxDim || height > maxDim;
}

function load(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image couldn't be read."));
    img.src = dataUrl;
  });
}

function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Image conversion produced no data URL."));
    reader.onerror = () => reject(reader.error ?? new Error("Image conversion failed."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Shrink a data-URL image in place. Returns the same string when the image
 * is already small enough — the capture path must never make things worse.
 * A failure to decode or encode falls back to the original rather than
 * dropping the photo.
 */
export async function shrinkDataUrl(
  dataUrl: string,
  opts: ShrinkOpts = {}
): Promise<string> {
  const maxDim = opts.maxDim ?? SHRINK_MAX_DIM;
  const quality = opts.quality ?? SHRINK_QUALITY;
  let img: HTMLImageElement;
  try {
    img = await load(dataUrl);
  } catch {
    return dataUrl;
  }
  const { width, height } = targetBox(
    img.naturalWidth,
    img.naturalHeight,
    maxDim
  );
  if (!shouldReencodeImage(dataUrl, img.naturalWidth, img.naturalHeight, maxDim)) {
    return dataUrl;
  }

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    const type = pickImageType(["image/webp", "image/jpeg"]);
    let box = { width, height };
    const qualities = [...new Set([quality, 0.7, 0.55, 0.4])];
    for (let scaleAttempt = 0; scaleAttempt < 5; scaleAttempt += 1) {
      canvas.width = box.width;
      canvas.height = box.height;
      ctx.drawImage(img, 0, 0, box.width, box.height);
      for (const candidateQuality of qualities) {
        let blob = await encode(canvas, type, candidateQuality);
        /* A browser that silently refuses WebP (returns null or another type)
           falls back to JPEG before giving up. */
        if (!blob || (type === "image/webp" && blob.type !== "image/webp")) {
          blob = await encode(canvas, "image/jpeg", candidateQuality);
        }
        if (!blob) continue;
        const candidate = await dataUrlOf(blob);
        if (candidate.length <= MAX_SYNC_IMAGE_SOURCE_LENGTH) return candidate;
      }
      box = {
        width: Math.max(1, Math.round(box.width * 0.8)),
        height: Math.max(1, Math.round(box.height * 0.8)),
      };
    }
  } catch {
    /* The original data URL is already authoritative local bytes. Encoder,
       canvas, and conversion failures may make Cloud sync pending, but may
       never turn a selected image into an omitted attachment. */
    return dataUrl;
  }
  /* Never discard or replace the local image with an unverified truncation.
     Sync will report this original as pending if the browser cannot compress it. */
  return dataUrl;
}

/** Read a picked file as a data URL, then shrink it. FileReader is the broadest
 * browser path; if it fails after selection, recover the same bytes through
 * Blob.arrayBuffer rather than silently omitting the attachment. */
export async function shrinkFile(file: File): Promise<string> {
  let dataUrl: string;
  try {
    dataUrl = await dataUrlOf(file);
  } catch {
    const bytes = new Uint8Array(
      typeof file.arrayBuffer === "function"
        ? await file.arrayBuffer()
        : await new Response(file).arrayBuffer()
    );
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    dataUrl = `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
  }
  return shrinkDataUrl(dataUrl);
}
