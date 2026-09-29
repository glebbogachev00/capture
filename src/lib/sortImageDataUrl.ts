import { Buffer } from "node:buffer";

export const SUPPORTED_SORT_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SortImageMime = typeof SUPPORTED_SORT_IMAGE_MIMES[number];

/** Keep the existing route envelope bound while applying it to decoded data. */
export const MAX_SORT_IMAGE_SOURCE_BYTES = 2_000_000;
export const MAX_SORT_IMAGE_BYTES = 1_499_000;

const PREFIX = /^data:(image\/(?:png|jpeg|webp|gif));base64,/;

function signatureMatches(bytes: Buffer, mime: SortImageMime): boolean {
  if (mime === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  if (mime === "image/webp") {
    return bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  }
  return bytes.length >= 6 &&
    (bytes.toString("ascii", 0, 6) === "GIF87a" ||
      bytes.toString("ascii", 0, 6) === "GIF89a");
}

/**
 * Parse one bounded canonical Base64 raster data URL. The MIME declaration is
 * accepted only when the decoded bytes carry that format's signature. Returning
 * null is intentionally categorical so routes expose one stable bad-request
 * response and no provider receives malformed or spoofed bytes.
 */
export function parseSortImageDataUrl(
  source: unknown,
): { mime: SortImageMime; bytes: Uint8Array } | null {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > MAX_SORT_IMAGE_SOURCE_BYTES) {
    return null;
  }
  const match = PREFIX.exec(source);
  if (!match) return null;
  const encoded = source.slice(match[0].length);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) return null;

  const bytes = Buffer.from(encoded, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_SORT_IMAGE_BYTES ||
    bytes.toString("base64") !== encoded ||
    !signatureMatches(bytes, match[1] as SortImageMime)
  ) return null;
  return { mime: match[1] as SortImageMime, bytes };
}
