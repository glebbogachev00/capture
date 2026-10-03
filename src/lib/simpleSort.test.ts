import { describe, expect, it } from "vitest";
import { calendar, normalizeSimpleSort, onlyThreadIds, ownWords, simpleSortPrompt, snapToNamedWeekday } from "./simpleSort";
import { settleSimpleSort } from "./simpleSortSettlement";
import { EMPTY, type Board } from "./model";
import { parsePersistedBoard } from "./persistedBoard";

const threads = [{ id: "rest", name: "Rest day planning" }, { id: "ovid", name: "Ovid" }, { id: "retake", name: "Retake" }];
const item = (fields: Record<string, unknown>) => ({ threadIds: [], newThread: null, due: null, sameAsAction: null, ...fields });

describe("normalizeSimpleSort", () => {
  it("keeps existing thread ids and maps a 'new' thread that already exists by name", () => {
    expect(normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "Walk and play a game.", threadIds: ["rest"] }),
      item({ kind: "thought", text: "The tower needs rain.", newThread: " ovid " }),
      { kind: "thought", text: "Legacy single id.", threadId: "rest" },
    ] }, { threads })).toEqual([
      { kind: "thought", text: "Walk and play a game.", threads: [{ id: "rest" }] },
      { kind: "thought", text: "The tower needs rain.", threads: [{ id: "ovid" }] },
      { kind: "thought", text: "Legacy single id.", threads: [{ id: "rest" }] },
    ]);
  });

  it("files a thought in one Thread, never a copy in a second", () => {
    expect(normalizeSimpleSort({ items: [item({ kind: "thought", text: "Retake records it for Ovid.", threadIds: ["gone", "retake", "ovid"] })] }, { threads }))
      .toEqual([{ kind: "thought", text: "Retake records it for Ovid.", threads: [{ id: "retake" }] }]);
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
    expect(() => normalizeSimpleSort({ items: [item({ kind: "thought", text: "x", threadIds: ["gone"] })] }, { threads })).toThrow();
    expect(() => normalizeSimpleSort({ items: [] }, { threads })).toThrow();
  });

  it("keeps a one-thought capture word for word, whatever the model rewrote", () => {
    const raw = "So that is absolutely gone. These three bucks need to be fixed right now.";
    expect(normalizeSimpleSort({ items: [item({ kind: "thought", text: "Three bugs need fixing.", threadIds: ["rest"] })] }, { threads, raw }))
      .toEqual([{ kind: "thought", text: raw, threads: [{ id: "rest" }] }]);
    expect(normalizeSimpleSort({ items: [item({ kind: "action", text: "Fix the bugs" })] }, { threads, raw }))
      .toEqual([{ kind: "action", text: "Fix the bugs" }]);
  });

  it("obeys the person's command over the model's kind", () => {
    expect(normalizeSimpleSort({ items: [item({ kind: "thought", text: "Email Mia", threadIds: ["rest"] })] }, { threads, force: "action" }))
      .toEqual([{ kind: "action", text: "Email Mia" }]);
  });
});

describe("snapToNamedWeekday", () => {
  // Thursday 2026-10-01, 9am in California (UTC-7).
  const now = Date.parse("2026-10-01T16:00:00Z");
  const snap = (due: string, raw: string) => snapToNamedWeekday(due, raw, now, 420);

  it("moves a date one day off the named weekday onto it", () => {
    expect(snap("2026-10-08", "Call the landlord next Wednesday.")).toBe("2026-10-07");
    expect(snap("2026-10-06", "send it wednesday")).toBe("2026-10-07");
  });

  it("leaves every other date alone", () => {
    expect(snap("2026-10-07", "Call the landlord next Wednesday.")).toBe("2026-10-07");
    expect(snap("2026-10-02", "Tomorrow buy milk, and on Wednesday call the landlord.")).toBe("2026-10-02");
    expect(snap("2026-10-06", "By Friday draft it, then send it Monday.")).toBe("2026-10-06");
    expect(snap("2026-10-31", "Sunday rest; the guide can wait until the end of the month.")).toBe("2026-10-31");
    expect(snap("2026-10-08", "Call the landlord next week.")).toBe("2026-10-08");
  });

  it("lands through the sorter", () => {
    expect(normalizeSimpleSort({ items: [item({ kind: "action", text: "Call the landlord", due: "2026-10-08" })] },
      { threads, raw: "Call the landlord next Wednesday.", now, tzOffset: 420 }))
      .toEqual([{ kind: "action", text: "Call the landlord", due: "2026-10-07" }]);
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
    expect(board.threads.find((thread) => thread.id === "tank")?.frags.map((frag) => frag.text)).toEqual(["A magnetic latch might beat screws.\n\nAnd cheap."]);
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

describe("onlyThreadIds", () => {
  const board = [{ id: "friction", name: "Reducing friction strategy" }, { id: "retake", name: "Retake" }, { id: "capture", name: "Capture." }];
  const said = "I've built retake, but I'm not using it. And for this capture, I want you to only save it in the friction, removing friction strategy, threat if possible.";

  it("finds the Thread named after 'only'", () => {
    expect(onlyThreadIds(said, board)).toEqual(["friction"]);
    expect(onlyThreadIds("Obsession is the problem. This should only go to Retake.", board)).toEqual(["retake"]);
  });

  it("finds nothing when the capture gives no such instruction", () => {
    expect(onlyThreadIds("Retake is the only tool I trust for demos.", board)).toEqual([]);
    expect(onlyThreadIds("Only save it somewhere sensible.", board)).toEqual([]);
  });

  it("drops the other Threads the model added, and moves nothing it did not pick", () => {
    expect(normalizeSimpleSort({ items: [item({ kind: "thought", text: "t", threadIds: ["retake", "capture", "friction"] })] }, { threads: board, raw: said }))
      .toEqual([{ kind: "thought", text: said, threads: [{ id: "friction" }] }]);
    expect(normalizeSimpleSort({ items: [item({ kind: "thought", text: "t", threadIds: ["retake"] })] }, { threads: board, raw: said }))
      .toEqual([{ kind: "thought", text: said, threads: [{ id: "retake" }] }]);
  });
});

it("starts every action with a capital, keeping its words", () => {
  expect(normalizeSimpleSort({ items: [item({ kind: "action", text: "set up facebook integration" })] }, { threads }))
    .toEqual([{ kind: "action", text: "Set up facebook integration" }]);
});

describe("only save it in X", () => {
  it("sends every part of the capture to X, not just the part that named it", () => {
    const board = [{ id: "friction", name: "Reducing friction strategy" }, { id: "retake", name: "Retake" }];
    const raw = "I built Retake but I don't use it.\n\nI need workflows that reduce friction. Only save it in the friction strategy thread.";
    const out = normalizeSimpleSort({ items: [
      item({ kind: "thought", text: "I built Retake but I don't use it.", threadIds: ["retake"] }),
      item({ kind: "thought", text: "I need workflows that reduce friction. Only save it in the friction strategy thread.", threadIds: ["friction"] }),
    ] }, { threads: board, raw });
    expect(out.map((part) => part.threads)).toEqual([[{ id: "friction" }], [{ id: "friction" }]]);
  });
});

describe("ownWords", () => {
  const raw = "I have two problems: obsession and desire. Reality creation can solve them.\n\nTomorrow I need to email Marcel about the limit.\n\nOur standing rule: keep things simple. Complex solutions need maintenance.\n\nJIM JANNARD / SCOPE\n\nHe founded Oakley in 1975.\n\nHe founded RED in 2005, see https://www.wired.com/2008/08/ff-redcamera/ for more.";
  const thought = (text: string, id: string) => ({ kind: "thought" as const, text, threads: [{ id }] });

  it("gives each sentence to one part, in the person's words, and keeps what the model cut", () => {
    expect(ownWords(raw, [
      thought("Two problems, obsession and desire, which reality creation can solve.", "reality"),
      { kind: "action", text: "Email Marcel about the limit" },
      // The model repeated the reality sentences here and summarised the research.
      thought("I have two problems: obsession and desire. Reality creation can solve them. Standing rule: keep things simple; complex solutions need maintenance.", "friction"),
      thought("JIM JANNARD / SCOPE. He founded Oakley.", "jim"),
    ])).toEqual([
      thought("I have two problems: obsession and desire. Reality creation can solve them.", "reality"),
      { kind: "action", text: "Email Marcel about the limit" },
      thought("Our standing rule: keep things simple. Complex solutions need maintenance.", "friction"),
      thought("JIM JANNARD / SCOPE\n\nHe founded Oakley in 1975.\n\nHe founded RED in 2005, see https://www.wired.com/2008/08/ff-redcamera/ for more.", "jim"),
    ]);
  });

  it("drops a part whose every sentence belongs to another", () => {
    expect(ownWords("Ovid's rain loops. It needs a longer recording.", [
      thought("Ovid's rain loops. It needs a longer recording.", "ovid"),
      thought("Ovid's rain loops.", "retake"),
    ])).toEqual([thought("Ovid's rain loops.", "retake"), thought("It needs a longer recording.", "ovid")].reverse());
  });
});
