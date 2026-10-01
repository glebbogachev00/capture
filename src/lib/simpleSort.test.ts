import { describe, expect, it } from "vitest";
import { calendar, normalizeSimpleSort, simpleSortPrompt } from "./simpleSort";
import { settleSimpleSort } from "./simpleSortSettlement";
import { EMPTY, type Board } from "./model";
import { parsePersistedBoard } from "./persistedBoard";

const threads = [{ id: "rest", name: "Rest day planning" }, { id: "ovid", name: "Ovid" }, { id: "retake", name: "Retake" }];
const item = (fields: Record<string, unknown>) => ({ threadId: null, newThread: null, due: null, sameAsAction: null, ...fields });

describe("normalizeSimpleSort", () => {
  it("keeps existing thread ids and maps a 'new' thread that already exists by name", () => {
    expect(normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "Walk and play a game.", threadId: "rest" }),
      item({ kind: "thought", text: "The tower needs rain.", newThread: " ovid " }),
      { kind: "thought", text: "Legacy list of ids.", threadIds: ["rest"] },
    ] }, { threads })).toEqual([
      { kind: "thought", text: "Walk and play a game.", threads: [{ id: "rest" }] },
      { kind: "thought", text: "The tower needs rain.", threads: [{ id: "ovid" }] },
      { kind: "thought", text: "Legacy list of ids.", threads: [{ id: "rest" }] },
    ]);
  });

  it("files a thought in one thread, never a copy in each", () => {
    // An older prompt, or a provider without the schema, may still send a list.
    expect(normalizeSimpleSort({ items: [{ kind: "thought", text: "Retake records it for Ovid.", threadIds: ["gone", "retake", "ovid"] }] }, { threads }))
      .toEqual([{ kind: "thought", text: "Retake records it for Ovid.", threads: [{ id: "retake" }] }]);
    expect(normalizeSimpleSort({ items: [{ kind: "thought", text: "x", threadId: "ovid", threadIds: ["retake"] }] }, { threads }))
      .toEqual([{ kind: "thought", text: "x", threads: [{ id: "ovid" }] }]);
  });

  it("drops a second copy of the same words sent to another thread", () => {
    const raw = "I should rest more. Capture can wait.";
    expect(normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "I should rest more. Capture can wait.", threadId: "rest" }),
      item({ kind: "thought", text: "i should rest more.  Capture can wait.", threadId: "retake" }),
    ] }, { threads, raw })).toEqual([{ kind: "thought", text: raw, threads: [{ id: "rest" }] }]);
  });

  it("keeps a real split: two subjects, two parts, two threads", () => {
    expect(normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "Rest days need a walk.", threadId: "rest" }),
      item({ kind: "thought", text: "Retake should trim silences.", threadId: "retake" }),
    ] }, { threads, raw: "Rest days need a walk. Retake should trim silences." })).toEqual([
      { kind: "thought", text: "Rest days need a walk.", threads: [{ id: "rest" }] },
      { kind: "thought", text: "Retake should trim silences.", threads: [{ id: "retake" }] },
    ]);
  });

  it("points a repeated task at the open action instead of a new one", () => {
    const actions = [{ id: "demos", text: "Create 2-3 demos for x" }];
    expect(normalizeSimpleSort({ items: [item({ kind: "action", text: "Make two or three demo videos for X", sameAsAction: "demos" })] }, { threads, actions }))
      .toEqual([{ kind: "action", text: "Make two or three demo videos for X", existingActionId: "demos" }]);
    expect(normalizeSimpleSort({ items: [item({ kind: "action", text: "New task", sameAsAction: "invented" })] }, { threads, actions }))
      .toEqual([{ kind: "action", text: "New task" }]);
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
      .toEqual([{ kind: "thought", text: raw, threads: [{ id: "rest" }] }]);
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
    expect(lines[0]).toBe("Thursday 2026-10-01 (today)");
    expect(lines[1]).toBe("Friday 2026-10-02 (tomorrow)");
    expect(lines[4]).toBe("Monday 2026-10-05");
    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe("End of this month: Saturday 2026-10-31");
  });

  it("asks for one thread per thought and lets 'only save it in X' decide", () => {
    const prompt = simpleSortPrompt({ raw: "x", threads: [] });
    expect(prompt).toContain('"threadId":string|null');
    expect(prompt).not.toContain("threadIds");
    expect(prompt).toContain("Never put the same words in two Threads");
    expect(prompt).toContain("save this only in X");
    expect(prompt).toContain("and nowhere else");
  });

  it("puts the calendar and the capture in the prompt", () => {
    const prompt = simpleSortPrompt({ raw: "Check the heater Friday", threads: [], now: Date.parse("2026-09-30T05:00:00Z") });
    expect(prompt).toContain("Thursday 2026-10-01 (tomorrow)");
    expect(prompt).toContain('"Check the heater Friday"');
  });
});

describe("settleSimpleSort", () => {
  const raw = "Check the heater Friday. A magnetic latch might beat screws.";
  const pending = (): Board => ({
    ...EMPTY,
    threads: [{ id: "tank", name: "Aquarium", summary: "", frags: [] }, { id: "pumps", name: "Pumps", summary: "", frags: [] }],
    actions: [{ id: "demos", text: "Create 2-3 demos for x", done: false, at: 1, updatedAt: 1, shelf: "weeks", expires: null, imgs: [] },
      { id: "envelope", text: raw, src: raw, done: false, at: 1, updatedAt: 1, unsorted: true, shelf: "keep", expires: null, imgs: [], pendingRevision: 1 }],
    ledger: [{ id: "pending-row", captureId: "cap", at: 1, raw, clean: raw, kind: "pending", source: "typed", targetId: "envelope", pendingRevision: 1, pendingSource: raw }],
  } as Board);

  it("lands every item, consumes the pending capture, and records it for Undo", () => {
    const now = Date.parse("2026-09-30T05:00:00Z");
    const result = settleSimpleSort(pending(), {
      captureId: "cap", revision: 1, now, via: "cerebras",
      items: [
        { kind: "action", text: "Check the heater", due: "2026-10-02" },
        { kind: "thought", text: "A magnetic latch might beat screws.", threads: [{ id: "tank" }, { id: "pumps" }] },
        { kind: "thought", text: "Pumps are loud.", threads: [{ name: "Pump notes" }] },
        { kind: "thought", text: "And cheap.", threads: [{ id: "tank" }] },
      ],
    });
    if (result.status !== "applied") throw new Error(result.reason);
    const { board } = result;
    expect(board.actions.map((action) => action.text)).toEqual(["Check the heater", "Create 2-3 demos for x"]);
    expect(board.actions[0].due).toBeTypeOf("number");
    expect(board.threads.find((thread) => thread.id === "tank")?.frags.map((frag) => frag.text)).toEqual(["A magnetic latch might beat screws. And cheap."]);
    expect(board.threads.find((thread) => thread.id === "pumps")?.frags.map((frag) => frag.text)).toEqual(["A magnetic latch might beat screws."]);
    expect(board.threads.find((thread) => thread.name === "Pump notes")?.frags).toHaveLength(1);
    expect(board.ledger.find((entry) => entry.id === "pending-row")?.undone).toBe(true);
    const landed = board.ledger.filter((entry) => entry.captureId === "cap" && entry.kind !== "pending");
    expect(landed.map((entry) => entry.kind).sort()).toEqual(["action", "thread", "thread", "thread"]);
    expect(landed.every((entry) => entry.raw === raw && entry.settledBy === "automatic")).toBe(true);
    expect(result.summaryThreadIds).toHaveLength(3);
    expect(result.tombstones).toEqual([{ kind: "action", id: "envelope", deletedAt: now }]);
    expect(parsePersistedBoard(JSON.parse(JSON.stringify(board)))).not.toBeNull();
  });

  it("never lands twice and never lands a stale revision", () => {
    const first = settleSimpleSort(pending(), { captureId: "cap", revision: 1, now: 10, items: [{ kind: "action", text: "Check the heater" }] });
    if (first.status !== "applied") throw new Error("not applied");
    expect(settleSimpleSort(first.board, { captureId: "cap", revision: 1, now: 11, items: [{ kind: "action", text: "Again" }] }).status).toBe("conflict");
    expect(settleSimpleSort(pending(), { captureId: "cap", revision: 2, now: 10, items: [{ kind: "action", text: "x" }] }).status).toBe("conflict");
  });

  it("refuses a destination that vanished rather than dropping the thought", () => {
    const result = settleSimpleSort(pending(), { captureId: "cap", revision: 1, now: 10,
      items: [{ kind: "thought", text: "Latch", threads: [{ id: "deleted" }] }] });
    expect(result.status).toBe("conflict");
  });

  it("lands a repeated task on the existing action without making it new", () => {
    const result = settleSimpleSort(pending(), { captureId: "cap", revision: 1, now: 10,
      items: [{ kind: "action", text: "Make two or three demo videos for X", existingActionId: "demos" }] });
    if (result.status !== "applied") throw new Error(result.reason);
    expect(result.board.actions.filter((action) => !action.unsorted).map((action) => action.id)).toEqual(["demos"]);
    expect(result.actionIds).toEqual(["demos"]);
    expect(result.board.ledger.some((entry) => entry.targetId === "demos" && entry.captureId === "cap")).toBe(true);
    expect(result.board.routingSettlements).toEqual([]);
    expect(parsePersistedBoard(JSON.parse(JSON.stringify(result.board)))).not.toBeNull();
  });
});

describe("long thoughts and their own tasks (step 2, pending eval:sort)", () => {
  it("asks for the person's own task out of a longer thought, and one action per finishable task", () => {
    const prompt = simpleSortPrompt({ raw: "x", threads: [] });
    expect(prompt).toContain("keep the thought whole as one item AND add that task as its own action");
    expect(prompt).toContain("Never for a wish about how to live");
    expect(prompt).toContain("\"message a creator and offer to help\" is one action");
  });

  it("lands a thought with its own task: the thought keeps its words, the task is an action", () => {
    expect(normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "Most of what I say ends up as threads. I need to send my history to my agent.", threadId: "retake" }),
      item({ kind: "action", text: "Send my history to my agent" }),
    ] }, { threads, raw: "Most of what I say ends up as threads. I need to send my history to my agent." })).toEqual([
      { kind: "thought", text: "Most of what I say ends up as threads. I need to send my history to my agent.", threads: [{ id: "retake" }] },
      { kind: "action", text: "Send my history to my agent" },
    ]);
  });
});
