import { describe, expect, it } from "vitest";
import type { Action, Board } from "./model";
import { EMPTY } from "./model";
import { shareAction, shareableFor } from "./share";
describe("shareAction — one task, on its way to an assistant", () => {
  const act = (over: Partial<Action> = {}): Action => ({
    id: "a1",
    text: "Fix heat map bug",
    done: false,
    at: 1000,
    shelf: "keep",
    expires: null,
    ...over,
  });

  it("carries the original when it says more than the card", () => {
    /* "Fix heat map bug" tells a model nothing; the sentence it came from
       says what is actually wrong. */
    const out = shareAction(
      act({ src: "Heat map seems off: some months are too close together." })
    );
    expect(out.text).toContain("Fix heat map bug");
    expect(out.text).toContain("Context:");
    expect(out.text).toContain("some months are too close together");
  });

  it("does not paste the same sentence twice over a full stop", () => {
    /* The sorter routinely hands back the capture with punctuation added. */
    const out = shareAction(
      act({ text: "Buy running clothes", src: "Buy running clothes." })
    );
    expect(out.text).toBe("Buy running clothes");
    expect(out.text).not.toContain("Context:");
  });

  it("includes a deadline, since it is the first thing anyone asks", () => {
    const out = shareAction(act({ due: Date.UTC(2026, 7, 22) }));
    expect(out.text).toContain("Due:");
  });

  it("stays plain text — this gets pasted into a chat box", () => {
    const out = shareAction(act({ src: "something longer entirely" }));
    expect(out.text.startsWith("#")).toBe(false);
  });
});

describe("a thread travels with its actions", () => {
  it("appends open then done, and nothing when there are none", async () => {
    const { shareThread } = await import("./share");
    const t = { id: "t", name: "Pricing", summary: "", frags: [{ id: "f", at: 1, text: "x" }] } as import("./model").Thread;
    const a = (id: string, done = false) =>
      ({ id, text: id, done, at: 1, imgs: [], shelf: "keep", expires: null }) as import("./model").Action;
    const out = shareThread(t, { open: [a("call the bank")], done: [a("ship it", true)] });
    expect(out.text).toContain("## Actions from this thread");
    expect(out.text).toContain("- [ ] call the bank");
    expect(out.text).toContain("- [x] ship it");
    expect(shareThread(t, { open: [], done: [] }).text).not.toContain("Actions from");
  });
});

describe("the record as a document an agent can pick up cold", () => {
  it("assembles threads with their standing, next step and actions", async () => {
    const { shareRecord } = await import("./share");
    const { EMPTY } = await import("./model");
    const board = {
      ...EMPTY,
      threads: [
        {
          id: "t1",
          name: "Pricing model decisions",
          summary: "Seats or usage-based pricing for small teams.",
          next: "Draft the seats-only page.",
          frags: [{ id: "f1", at: 1, text: "seats vs usage" }],
        },
      ],
      actions: [
        { id: "a1", text: "Draft the usage-based pricing page", done: false, at: 2, imgs: [], shelf: "keep", expires: null },
        { id: "a2", text: "Water the plants", done: false, at: 1, imgs: [], shelf: "keep", expires: null },
      ],
      ledger: [
        { id: "e1", at: 3, raw: "r", clean: "still torn on pricing", kind: "thread", source: "typed", targetId: "t1" },
      ],
    } as import("./model").Board;
    const out = shareRecord(board);
    const i = (needle: string) => out.text.indexOf(needle);
    expect(i("### Pricing model decisions")).toBeGreaterThan(-1);
    expect(i("Next: Draft the seats-only page.")).toBeGreaterThan(i("Seats or usage-based"));
    /* The subject-matched action rides with its thread… */
    expect(i("- [ ] Draft the usage-based pricing page")).toBeGreaterThan(i("### Pricing"));
    /* …and the unrelated one lands in the loose section. */
    expect(i("- [ ] Water the plants")).toBeGreaterThan(i("Actions attached to nothing"));
    expect(i('in "Pricing model decisions": still torn on pricing')).toBeGreaterThan(i("Recent captures"));
  });

  it("marks undone captures and caps the tail", async () => {
    const { shareRecord } = await import("./share");
    const { EMPTY } = await import("./model");
    const e = (id: string, over: object) =>
      ({ id, at: 1, raw: "r", clean: "c", kind: "action", source: "typed", targetId: "", ...over }) as import("./ledger").CaptureEntry;
    const out = shareRecord(
      { ...EMPTY, ledger: [e("1", { undone: true, clean: "oops", at: 2 }), e("2", { clean: "old", at: 1 })] } as import("./model").Board,
      1
    );
    expect(out.text).toContain("undone");
    expect(out.text).not.toContain("old");
  });
});

describe("the header share carries the connections too", () => {
  const board = () =>
    ({
      ...EMPTY,
      threads: [
        {
          id: "t1",
          name: "Pricing model decisions",
          summary: "Seats or usage-based pricing.",
          frags: [{ id: "f1", at: 1, text: "seats vs usage" }],
        },
      ],
      actions: [
        { id: "a1", text: "Draft the usage-based pricing page", done: false, at: 2, imgs: [], shelf: "keep", expires: null },
      ],
    }) as Board;

  it("an open thread shares its actions, like its own Copy does", () => {
    const out = shareableFor(board(), { kind: "thread", id: "t1" }, 10);
    expect(out?.text).toContain("Draft the usage-based pricing page");
  });

  it("the threads tab counts each thread's open actions", () => {
    const out = shareableFor(board(), { kind: "tab", tab: "threads" }, 10);
    expect(out?.text).toContain("1 open action");
  });
});

describe("the record as a diff", () => {
  it("emits only what moved, and nothing when quiet", async () => {
    const { shareRecordSince } = await import("./share");
    const board = {
      ...EMPTY,
      threads: [
        { id: "t1", name: "Moved", summary: "s", frags: [{ id: "f1", at: 200, text: "new frag" }] },
        { id: "t2", name: "Quiet", summary: "s", frags: [{ id: "f2", at: 50, text: "old" }] },
      ],
      actions: [
        { id: "a1", text: "New loose action", done: false, at: 150, imgs: [], shelf: "keep", expires: null },
        { id: "a2", text: "Old action", done: false, at: 10, imgs: [], shelf: "keep", expires: null },
      ],
      ledger: [
        { id: "e1", at: 180, raw: "r", clean: "fresh capture", kind: "thread", source: "typed", targetId: "t1" },
        { id: "e2", at: 20, raw: "r", clean: "stale capture", kind: "action", source: "typed", targetId: "" },
      ],
    } as Board;
    const out = shareRecordSince(board, 100)!;
    expect(out.text).toContain("### Moved");
    expect(out.text).not.toContain("### Quiet");
    expect(out.text).toContain("New loose action");
    expect(out.text).not.toContain("Old action");
    expect(out.text).toContain("fresh capture");
    expect(out.text).not.toContain("stale capture");
    expect(shareRecordSince(board, 1000)).toBeNull();
  });
});
