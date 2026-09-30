import { describe, expect, it } from "vitest";
import { calendar, normalizeSimpleSort, simpleSortPrompt } from "./simpleSort";
import { settleSimpleSort } from "./simpleSortSettlement";
import { EMPTY, type Board } from "./model";

const threads = [{ id: "rest", name: "Rest day planning" }, { id: "ovid", name: "Ovid" }];
const item = (fields: Record<string, unknown>) => ({ threadId: null, newThread: null, due: null, ...fields });

describe("normalizeSimpleSort", () => {
  it("keeps existing thread ids and maps a 'new' thread that already exists by name", () => {
    expect(normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "Walk and play a game.", threadId: "rest" }),
      item({ kind: "thought", text: "The tower needs rain.", newThread: " ovid " }),
    ] }, { threads })).toEqual([
      { kind: "thought", text: "Walk and play a game.", thread: { id: "rest" } },
      { kind: "thought", text: "The tower needs rain.", thread: { id: "ovid" } },
    ]);
  });

  it("joins parts sent to the same thread into one entry", () => {
    expect(normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "Rest without guilt.", threadId: "rest" }),
      item({ kind: "action", text: "Book the pool" }),
      item({ kind: "thought", text: "Walk in the morning.", threadId: "rest" }),
    ] }, { threads })).toEqual([
      { kind: "thought", text: "Rest without guilt. Walk in the morning.", thread: { id: "rest" } },
      { kind: "action", text: "Book the pool" },
    ]);
  });

  it("accepts omitted null fields, keeps only real ISO dues, and only on actions", () => {
    expect(normalizeSimpleSort({ items: [
      { kind: "action", text: "Check the heater", due: "2026-10-04" },
      { kind: "action", text: "Call back", due: "Friday" },
      { kind: "intention", text: "I rest without guilt.", due: "2026-10-04" },
    ] }, { threads })).toEqual([
      { kind: "action", text: "Check the heater", due: "2026-10-04" },
      { kind: "action", text: "Call back" },
      { kind: "intention", text: "I rest without guilt." },
    ]);
  });

  it("refuses a thought with nowhere to go and an unknown id without a name", () => {
    expect(() => normalizeSimpleSort({ items: [item({ kind: "thought", text: "Somewhere" })] }, { threads })).toThrow();
    expect(() => normalizeSimpleSort({ items: [item({ kind: "thought", text: "x", threadId: "gone" })] }, { threads })).toThrow();
    expect(() => normalizeSimpleSort({ items: [] }, { threads })).toThrow();
  });

  it("keeps a one-thought capture word for word, whatever the model rewrote", () => {
    const raw = "So that is absolutely gone. These three bucks need to be fixed right now.";
    expect(normalizeSimpleSort({ items: [item({ kind: "thought", text: "Three bugs need fixing.", threadId: "rest" })] }, { threads, raw }))
      .toEqual([{ kind: "thought", text: raw, thread: { id: "rest" } }]);
    expect(normalizeSimpleSort({ items: [item({ kind: "action", text: "Fix the bugs" })] }, { threads, raw }))
      .toEqual([{ kind: "action", text: "Fix the bugs" }]);
  });

  it("obeys the person's command over the model's kind", () => {
    expect(normalizeSimpleSort({ items: [item({ kind: "thought", text: "Email Mia", threadId: "rest" })] }, { threads, force: "action" }))
      .toEqual([{ kind: "action", text: "Email Mia" }]);
  });
});

describe("calendar", () => {
  it("names the person's own days, not the server's", () => {
    const lines = calendar(Date.parse("2026-09-30T23:30:00Z"), -420).split("\n");
    expect(lines[0]).toBe("today: Thursday 2026-10-01");
    expect(lines[1]).toBe("tomorrow: Friday 2026-10-02");
    expect(lines).toHaveLength(8);
  });

  it("puts the calendar and the capture in the prompt", () => {
    const prompt = simpleSortPrompt({ raw: "Check the heater Friday", threads: [], now: Date.parse("2026-09-30T05:00:00Z") });
    expect(prompt).toContain("tomorrow: Thursday 2026-10-01");
    expect(prompt).toContain('"Check the heater Friday"');
  });
});

describe("settleSimpleSort", () => {
  const raw = "Check the heater Friday. A magnetic latch might beat screws.";
  const pending = (): Board => ({
    ...EMPTY,
    threads: [{ id: "tank", name: "Aquarium", summary: "", frags: [] }],
    actions: [{ id: "envelope", text: raw, src: raw, done: false, at: 1, updatedAt: 1, unsorted: true, shelf: "keep", expires: null, imgs: [], pendingRevision: 1 }],
    ledger: [{ id: "pending-row", captureId: "cap", at: 1, raw, clean: raw, kind: "pending", source: "typed", targetId: "envelope", pendingRevision: 1, pendingSource: raw }],
  } as Board);

  it("lands every item, consumes the pending capture, and records it for Undo", () => {
    const now = Date.parse("2026-09-30T05:00:00Z");
    const result = settleSimpleSort(pending(), {
      captureId: "cap", revision: 1, now, via: "cerebras",
      items: [
        { kind: "action", text: "Check the heater", due: "2026-10-02" },
        { kind: "thought", text: "A magnetic latch might beat screws.", thread: { id: "tank" } },
        { kind: "thought", text: "Pumps are loud.", thread: { name: "Pump notes" } },
      ],
    });
    if (result.status !== "applied") throw new Error(result.reason);
    const { board } = result;
    expect(board.actions.map((action) => action.text)).toEqual(["Check the heater"]);
    expect(board.actions[0].due).toBeTypeOf("number");
    expect(board.threads.find((thread) => thread.id === "tank")?.frags.map((frag) => frag.text)).toEqual(["A magnetic latch might beat screws."]);
    expect(board.threads.find((thread) => thread.name === "Pump notes")?.frags).toHaveLength(1);
    expect(board.ledger.find((entry) => entry.id === "pending-row")?.undone).toBe(true);
    const landed = board.ledger.filter((entry) => entry.captureId === "cap" && entry.kind !== "pending");
    expect(landed.map((entry) => entry.kind).sort()).toEqual(["action", "thread", "thread"]);
    expect(landed.every((entry) => entry.raw === raw && entry.settledBy === "automatic")).toBe(true);
    expect(result.summaryThreadIds).toHaveLength(2);
    expect(result.tombstones).toEqual([{ kind: "action", id: "envelope", deletedAt: now }]);
  });

  it("never lands twice and never lands a stale revision", () => {
    const first = settleSimpleSort(pending(), { captureId: "cap", revision: 1, now: 10, items: [{ kind: "action", text: "Check the heater" }] });
    if (first.status !== "applied") throw new Error("not applied");
    expect(settleSimpleSort(first.board, { captureId: "cap", revision: 1, now: 11, items: [{ kind: "action", text: "Again" }] }).status).toBe("conflict");
    expect(settleSimpleSort(pending(), { captureId: "cap", revision: 2, now: 10, items: [{ kind: "action", text: "x" }] }).status).toBe("conflict");
  });

  it("refuses a destination that vanished rather than dropping the thought", () => {
    const result = settleSimpleSort(pending(), { captureId: "cap", revision: 1, now: 10,
      items: [{ kind: "thought", text: "Latch", thread: { id: "deleted" } }] });
    expect(result.status).toBe("conflict");
  });
});
