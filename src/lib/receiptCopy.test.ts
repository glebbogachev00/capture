import { describe, expect, it } from "vitest";
import { receiptLines } from "./receiptCopy";

describe("receiptLines", () => {
  it("turns a split capture into a readable destination list", () => {
    expect(receiptLines(
      "Retake video URL feature · a new thread · Capture Article Outline",
    )).toEqual([
      "New thread: Retake video URL feature",
      "Thread: Capture Article Outline",
    ]);
  });

  it("explains existing and new thread destinations without product jargon", () => {
    expect(receiptLines("Espresso setup · a new layer")).toEqual([
      "Added to thread: Espresso setup",
    ]);
    expect(receiptLines("2 actions · a new thread — Launch plan")).toEqual([
      "2 actions",
      "New thread: Launch plan",
    ]);
  });

  it("keeps actions, intentions, pictures, and pending work understandable", () => {
    expect(receiptLines("3 actions · kept")).toEqual(["3 actions"]);
    expect(receiptLines("Intention 02")).toEqual(["Intention 02"]);
    expect(receiptLines("1 action · picture kept in Receipts")).toEqual([
      "1 action",
      "Picture saved in: Receipts",
    ]);
    expect(receiptLines("Actions, unsorted — sort it when the model is back")).toEqual([
      "Actions — waiting to be sorted",
    ]);
  });
});
