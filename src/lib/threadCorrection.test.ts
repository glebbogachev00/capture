import { describe, expect, it } from "vitest";
import type { Thread } from "@/lib/model";
import { hasAlternativeThread } from "./threadCorrection";

const thread = (id: string): Thread => ({ id, name: id, summary: "", frags: [] });

describe("hasAlternativeThread", () => {
  it("offers correction when Undo removed the newly created wrong Thread", () => {
    expect(hasAlternativeThread([thread("harbor")], "wrong-new-thread")).toBe(true);
  });

  it("does not offer an empty picker when the wrong Thread is the only destination", () => {
    expect(hasAlternativeThread([thread("harbor")], "harbor")).toBe(false);
  });
});