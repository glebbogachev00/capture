/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SYNC_IMAGE_SOURCE_LENGTH,
  pickImageType,
  shouldReencodeImage,
  shrinkDataUrl,
  shrinkFile,
  targetBox,
} from "./shrink";

const oversized = "data:image/png;base64," + "A".repeat(MAX_SYNC_IMAGE_SOURCE_LENGTH);

function loadableImage() {
  class LoadedImage {
    naturalWidth = 800;
    naturalHeight = 600;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", LoadedImage);
}

function canvasWith(options: {
  draw?: () => void;
  encode?: (callback: BlobCallback, type?: string) => void;
} = {}) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: options.draw ?? (() => undefined) }),
    toBlob: (callback: BlobCallback, type?: string) =>
      options.encode
        ? options.encode(callback, type)
        : callback(new Blob(["small"], { type: type ?? "image/webp" })),
  } as unknown as HTMLCanvasElement;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
    tagName === "canvas" ? canvas : realCreate(tagName)
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("targetBox", () => {
  it("leaves a small image untouched", () => {
    expect(targetBox(800, 600)).toEqual({ width: 800, height: 600 });
    expect(targetBox(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("scales the long edge down to the max dimension", () => {
    expect(targetBox(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait image by its long edge too", () => {
    expect(targetBox(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it("honours a custom max dimension", () => {
    expect(targetBox(1000, 500, 400)).toEqual({ width: 400, height: 200 });
  });

  it("never upscales a small image to the max dimension", () => {
    const out = targetBox(300, 300);
    expect(out.width).toBe(300);
    expect(out.height).toBe(300);
  });

  it("never returns a zero dimension", () => {
    expect(targetBox(0, 500)).toEqual({ width: 1, height: 500 });
    expect(targetBox(10, 0)).toEqual({ width: 10, height: 1 });
  });
});

describe("pickImageType", () => {
  it("prefers webp when the browser supports it", () => {
    expect(pickImageType(["image/webp", "image/jpeg"])).toBe("image/webp");
  });

  it("falls back to jpeg without webp", () => {
    expect(pickImageType(["image/jpeg"])).toBe("image/jpeg");
    expect(pickImageType([])).toBe("image/jpeg");
  });
});

describe("sync-safe capture encoding", () => {
  it("re-encodes a small-dimension PNG when its bytes still exceed the image route envelope", () => {
    expect(shouldReencodeImage(oversized, 800, 600)).toBe(true);
    expect(shouldReencodeImage("data:image/jpeg;base64,small", 800, 600)).toBe(false);
  });

  it("bounds an already-small-dimension oversized image when encoding succeeds", async () => {
    loadableImage();
    canvasWith();
    class SuccessfulReader {
      result: string | ArrayBuffer | null = "data:image/webp;base64,small";
      error: DOMException | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("FileReader", SuccessfulReader);

    const result = await shrinkDataUrl(oversized);

    expect(result).toBe("data:image/webp;base64,small");
    expect(result.length).toBeLessThanOrEqual(MAX_SYNC_IMAGE_SOURCE_LENGTH);
  });

  it("keeps the original bytes when canvas.toBlob throws unexpectedly", async () => {
    loadableImage();
    canvasWith({ encode: () => { throw new Error("encoder crashed"); } });

    await expect(shrinkDataUrl(oversized)).resolves.toBe(oversized);
  });

  it("keeps the original bytes when every canvas encode returns null", async () => {
    loadableImage();
    canvasWith({ encode: (callback) => callback(null) });

    await expect(shrinkDataUrl(oversized)).resolves.toBe(oversized);
  });

  it("keeps the original bytes when encoded-blob FileReader throws during conversion", async () => {
    loadableImage();
    canvasWith();
    class ThrowingReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() { throw new Error("conversion failed"); }
    }
    vi.stubGlobal("FileReader", ThrowingReader);

    await expect(shrinkDataUrl(oversized)).resolves.toBe(oversized);
  });

  it("keeps the original bytes when encoded-blob FileReader reports an error", async () => {
    loadableImage();
    canvasWith();
    class ErroringReader {
      result: string | ArrayBuffer | null = null;
      error = new DOMException("read failed", "NotReadableError");
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal("FileReader", ErroringReader);

    await expect(shrinkDataUrl(oversized)).resolves.toBe(oversized);
  });

  it("keeps the original bytes when canvas conversion throws outside the encoder", async () => {
    loadableImage();
    canvasWith({ draw: () => { throw new Error("draw failed"); } });

    await expect(shrinkDataUrl(oversized)).resolves.toBe(oversized);
  });

  it("recovers the selected file bytes when the initial FileReader fails", async () => {
    class ErroringReader {
      result: string | ArrayBuffer | null = null;
      error = new DOMException("read failed", "NotReadableError");
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal("FileReader", ErroringReader);
    class UnreadableImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal("Image", UnreadableImage);
    const file = {
      type: "image/png",
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    } as File;

    await expect(shrinkFile(file)).resolves.toBe("data:image/png;base64,AQID");
  });
});
