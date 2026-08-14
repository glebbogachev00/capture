import { describe, expect, it } from "vitest";
import type { Board } from "./model";
import { isSafeImageId, referencedImageIds } from "./imgSync";

const board = (over: Partial<Board> = {}): Board => ({
  actions: [],
  threads: [],
  intentions: [],
  principles: [],
  ledger: [],
  corrections: [],
  ...over,
});

describe("referencedImageIds", () => {
  it("collects ids from actions and from fragments inside threads", () => {
    const b = board({
      actions: [
        { id: "a1", text: "x", done: false, at: 0, shelf: "keep", expires: null, imgs: ["i1", "i2"] },
        { id: "a2", text: "y", done: false, at: 0, shelf: "keep", expires: null },
      ],
      threads: [
        {
          id: "t1",
          name: "T",
          summary: "",
          frags: [
            { id: "f1", at: 0, text: "n", imgs: ["i3"] },
            { id: "f2", at: 0, text: "n" },
          ],
        },
      ],
    });
    expect(referencedImageIds(b).sort()).toEqual(["i1", "i2", "i3"]);
  });

  it("de-duplicates an image referenced twice", () => {
    const b = board({
      actions: [
        { id: "a1", text: "x", done: false, at: 0, shelf: "keep", expires: null, imgs: ["same"] },
      ],
      threads: [
        { id: "t1", name: "T", summary: "", frags: [{ id: "f1", at: 0, text: "n", imgs: ["same"] }] },
      ],
    });
    expect(referencedImageIds(b)).toEqual(["same"]);
  });

  it("is empty on a board with no photos", () => {
    expect(referencedImageIds(board())).toEqual([]);
  });
});

describe("isSafeImageId", () => {
  it("accepts the ids the app actually mints", () => {
    expect(isSafeImageId("k3j4h5g6")).toBe(true);
    expect(isSafeImageId("a-b_c123")).toBe(true);
  });

  it("rejects anything that could climb out of the directory", () => {
    for (const bad of ["../secret", "a/b", "..", "", "a".repeat(65), "a.b", "a b"]) {
      expect(isSafeImageId(bad), bad).toBe(false);
    }
  });
});
