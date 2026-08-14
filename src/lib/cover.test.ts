import { describe, expect, it } from "vitest";
import {
  TONES,
  TONE_NAMES,
  imgValue,
  parseCover,
  toneColour,
  toneValue,
} from "./cover";

describe("parseCover", () => {
  it("reads a tone", () => {
    expect(parseCover("tone:sage")).toEqual({ kind: "tone", tone: "sage" });
  });

  it("reads a photo cover", () => {
    expect(parseCover("img:k3j4h5g6")).toEqual({ kind: "img", id: "k3j4h5g6" });
  });

  it("round-trips what the writers produce", () => {
    for (const t of TONE_NAMES) {
      expect(parseCover(toneValue(t))).toEqual({ kind: "tone", tone: t });
    }
    expect(parseCover(imgValue("abc123"))).toEqual({ kind: "img", id: "abc123" });
  });

  it("reads no cover as none, never as something broken", () => {
    for (const bad of [null, undefined, "", "sage", "tone:", "tone:neon", "img:", "img:../x", "nonsense"]) {
      expect(parseCover(bad), String(bad)).toBeNull();
    }
  });

  it("refuses an image id that could climb out of the directory", () => {
    expect(parseCover("img:../../sync.json")).toBeNull();
  });
});

describe("toneColour", () => {
  it("paints a tone and leaves photos alone", () => {
    expect(toneColour({ kind: "tone", tone: "clay" })).toBe(TONES.clay);
    expect(toneColour({ kind: "img", id: "x" })).toBeNull();
    expect(toneColour(null)).toBeNull();
  });

  it("every tone is a real colour", () => {
    for (const t of TONE_NAMES) {
      expect(TONES[t], t).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
