import { describe, expect, it } from "vitest";
import { applySorted, photoNotesFor, type SortResult } from "./boardOps";
import { applyCombine } from "./combine";
import { EMPTY, type Board, type Thread } from "./model";
import { shareRecordDay, shareThread } from "./share";

const sorted = (over: Partial<SortResult> = {}): SortResult => ({
  clean: "Pricing tiers sketch", kind: "thread", title: "Pricing", shelfLife: "keep", threadId: null, threadName: "Pricing", ...over,
});

describe("a photo's description", () => {
  it("is paired with its photo by position, and only when every photo has one", () => {
    expect(photoNotesFor(["a", "b"], ["Whiteboard sketch", "Receipt"])).toEqual({ a: "Whiteboard sketch", b: "Receipt" });
    expect(photoNotesFor(["a", "b"], ["Whiteboard sketch"])).toBeUndefined();
    expect(photoNotesFor(["a"], null)).toBeUndefined();
  });

  it("is kept on the note that holds the photo when a photo capture is sorted", () => {
    const board: Board = { ...EMPTY, principles: [] };
    const { next } = applySorted(sorted({ photoNotes: ["A whiteboard sketch of three pricing tiers"] }), ["img1"], 100, board);
    const frag = next.threads[0].frags[0];
    expect(frag.imgs).toEqual(["img1"]);
    expect(frag.imgNotes).toEqual({ img1: "A whiteboard sketch of three pricing tiers" });
  });
});

describe("sharing", () => {
  const thread: Thread = {
    id: "t", name: "Pricing", summary: "", frags: [
      { id: "f1", at: Date.parse("2026-10-14T09:00:00Z"), text: "Three tiers feel right.", imgs: ["img1", "img2"], imgNotes: { img1: "A whiteboard sketch of three pricing tiers" } },
      { id: "f2", at: Date.parse("2026-10-14T10:00:00Z"), text: "No photo here." },
    ],
  };

  it("describes each photo in a thread instead of sending it, and still marks one with no description", () => {
    const text = shareThread(thread).text;
    expect(text).toContain("Three tiers feel right.\nPhoto: A whiteboard sketch of three pricing tiers\nPhoto");
    expect(text.match(/^Photo/gm)).toHaveLength(2);
    expect(text).not.toContain("img1");
  });

  it("describes the photos under a record day's capture", () => {
    const at = Date.parse("2026-10-14T09:00:00");
    const day = shareRecordDay([{
      id: "e", at, raw: "", clean: "Pricing tiers", kind: "thread", source: "image", targetId: "t",
      imgs: ["img1"], imgNotes: { img1: "A whiteboard sketch of three pricing tiers" },
    }], "2026-10-14")!;
    expect(day.text).toContain("  Photo: A whiteboard sketch of three pricing tiers");
  });

  it("keeps the descriptions when two notes are combined", () => {
    const board: Board = { ...EMPTY, principles: [], threads: [thread] };
    const out = applyCombine(board, [{ key: "k", threadId: "t", threadName: "Pricing", frags: thread.frags, combined: "Three tiers, no photo needed.", reason: "same idea" }], 1)!;
    expect(out.board.threads[0].frags[0].imgNotes).toEqual({ img1: "A whiteboard sketch of three pricing tiers" });
  });
});
