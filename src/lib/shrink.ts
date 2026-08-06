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
  if (width >= img.naturalWidth && height >= img.naturalHeight) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, width, height);

  const type = pickImageType(["image/webp", "image/jpeg"]);
  let blob = await encode(canvas, type, quality);
  /* A browser that silently refuses WebP (returns null or a PNG) falls back
     to JPEG before giving up. */
  if (!blob) blob = await encode(canvas, "image/jpeg", quality);
  if (!blob) return dataUrl;

  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Read a picked file as a data URL, then shrink it. */
export async function shrinkFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return shrinkDataUrl(dataUrl);
}
