import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  MAX_SORT_IMAGE_BYTES,
  parseSortImageDataUrl,
  SUPPORTED_SORT_IMAGE_MIMES,
} from "./sortImageDataUrl";

const source = (mime: string, bytes: number[]) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

const valid = {
  "image/png": source("image/png", [137, 80, 78, 71, 13, 10, 26, 10, 0]),
  "image/jpeg": source("image/jpeg", [255, 216, 255, 224, 0]),
  "image/webp": source("image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
  "image/gif": source("image/gif", [...Buffer.from("GIF89a"), 0]),
} as const;

describe("sort image data URLs", () => {
  it("accepts every raster format emitted or preserved by current image intake", () => {
    expect(SUPPORTED_SORT_IMAGE_MIMES).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
    for (const [mime, dataUrl] of Object.entries(valid)) {
      expect(parseSortImageDataUrl(dataUrl)).toMatchObject({ mime });
    }
  });

  it.each([
    ["bad base64 length", "data:image/png;base64,AAA"],
    ["bad base64 padding", "data:image/png;base64,AAAA==="],
    ["bad base64 characters", "data:image/png;base64,AA*A"],
    ["empty bytes", "data:image/png;base64,"],
    ["unsupported MIME", source("image/svg+xml", [...Buffer.from("<svg>")])],
  ])("rejects %s", (_case, dataUrl) => {
    expect(parseSortImageDataUrl(dataUrl)).toBeNull();
  });

  it("rejects arbitrary non-image bytes under an image MIME", () => {
    expect(parseSortImageDataUrl(
      `data:image/png;base64,${Buffer.from("plain text").toString("base64")}`,
    )).toBeNull();
  });

  it("rejects a valid image signature declared as the wrong MIME", () => {
    const jpegBytes = Buffer.from(valid["image/jpeg"].split(",")[1], "base64");
    expect(parseSortImageDataUrl(
      `data:image/png;base64,${jpegBytes.toString("base64")}`,
    )).toBeNull();
  });

  it("rejects decoded image bytes above the bounded sort limit", () => {
    const bytes = Buffer.alloc(MAX_SORT_IMAGE_BYTES + 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    expect(parseSortImageDataUrl(
      `data:image/png;base64,${bytes.toString("base64")}`,
    )).toBeNull();
  });
});
