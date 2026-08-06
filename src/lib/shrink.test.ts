import { describe, expect, it } from "vitest";
import { pickImageType, targetBox } from "./shrink";

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
