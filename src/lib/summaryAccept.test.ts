import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import { acceptSummary, threadFingerprint } from "./summaryAccept";

const thread = (frags: { id: string; text: string; at: number }[], name = "Retake") =>
  ({ id: "t1", name, frags }) as never;

const board = (t: unknown): Board => ({ ...EMPTY, threads: [t] } as Board);

const out = { summary: "Where this stands: the recorder works.", next: "Ship it." };

describe("a stale summary cannot overwrite newer thread inputs", () => {
  it("lands when the thread is exactly what it summarized", () => {
    const t = thread([{ id: "f1", text: "the recorder works", at: 1 }]);
    const fp = threadFingerprint(t as never);
    const next = acceptSummary(board(t), "t1", fp, out)!;
    expect(next.threads[0].summary).toBe(out.summary);
    expect(next.threads[0].next).toBe("Ship it.");
  });

  it("gate 6: a capture landing mid-request rejects the in-flight reply", () => {
    /* The summary left describing one fragment; a second landed while the
       model wrote. Accepting the reply would describe a thread two layers
       ago — and the sorter routes by these descriptions. */
    const sent = thread([{ id: "f1", text: "the recorder works", at: 1 }]);
    const fp = threadFingerprint(sent as never);
    const nowBoard = board(
      thread([
        { id: "f1", text: "the recorder works", at: 1 },
        { id: "f2", text: "rendering is still slow on mobile", at: 2 },
      ])
    );
    expect(acceptSummary(nowBoard, "t1", fp, out)).toBeNull();
  });

  it("a rename mid-request also rejects", () => {
    const sent = thread([{ id: "f1", text: "x", at: 1 }], "Retake");
    const fp = threadFingerprint(sent as never);
    const renamed = board(thread([{ id: "f1", text: "x", at: 1 }], "Retake AI"));
    expect(acceptSummary(renamed, "t1", fp, out)).toBeNull();
  });

  it("a thread merged away rejects instead of resurrecting", () => {
    const sent = thread([{ id: "f1", text: "x", at: 1 }]);
    const fp = threadFingerprint(sent as never);
    expect(acceptSummary({ ...EMPTY }, "t1", fp, out)).toBeNull();
  });
});
