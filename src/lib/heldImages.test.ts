import { describe, expect, it } from "vitest";
import { createHeldImages } from "./heldImages";

describe("heldImages — a picture survives as long as its Undo does", () => {
  it("holds nothing to start with", () => {
    expect(createHeldImages().held()).toEqual([]);
  });

  it("ignores an empty or missing list", () => {
    const h = createHeldImages();
    h.hold(undefined);
    h.hold([]);
    expect(h.held()).toEqual([]);
  });

  it("accumulates across several deletions in one gesture", () => {
    /* Approve-all can drop three duplicates before Undo is armed once —
       every picture among them has to survive until that one Undo goes. */
    const h = createHeldImages();
    h.hold(["a"]);
    h.hold(["b", "c"]);
    expect(h.held()).toEqual(["a", "b", "c"]);
  });

  it("hands the ids over once the undo protecting them is superseded", () => {
    const h = createHeldImages();
    h.hold(["a", "b"]);
    expect(h.release()).toEqual(["a", "b"]);
    /* Released once: a second release must not ask for the same bytes
       again, or a later hold would be destroyed with them. */
    expect(h.release()).toEqual([]);
    expect(h.held()).toEqual([]);
  });

  it("destroys nothing when the undo actually runs", () => {
    /* The whole point: the board is about to point at these again. */
    const h = createHeldImages();
    h.hold(["a"]);
    h.cancel();
    expect(h.held()).toEqual([]);
    expect(h.release()).toEqual([]);
  });

  it("keeps a fresh hold after a cancel", () => {
    const h = createHeldImages();
    h.hold(["a"]);
    h.cancel();
    h.hold(["b"]);
    expect(h.release()).toEqual(["b"]);
  });
});
