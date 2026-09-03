import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, Board } from "./model";
import { EMPTY } from "./model";
import { shareAction, shareableFor, shareRecordDay, shareText } from "./share";
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

describe("the Record header shares the selected day only", () => {
  const at = (day: number, hour: number) => new Date(2026, 7, day, hour).getTime();

  const board = {
    ...EMPTY,
    threads: [
      {
        id: "thread-outside-record",
        name: "Unrelated thread name",
        summary: "Unrelated thread summary",
        frags: [{ id: "f1", at: at(20, 9), text: "Unrelated thread fragment" }],
      },
    ],
    actions: [
      {
        id: "action-outside-record",
        text: "Unrelated open action",
        done: false,
        at: at(20, 10),
        imgs: [],
        shelf: "keep",
        expires: null,
      },
    ],
    intentions: [
      {
        id: "intention-outside-record",
        number: 1,
        at: at(20, 11),
        updatedAt: at(20, 11),
        rawInput: "Unrelated intention raw input",
        expandedIntention: "Unrelated intention",
        recommendedActions: [],
        counterIntentions: [],
      },
    ],
    ledger: [
      { id: "day-a", at: at(25, 9), raw: "Day A capture", clean: "Day A capture", kind: "thread", source: "typed", targetId: "thread-outside-record" },
      { id: "day-b", at: at(26, 9), raw: "Day B capture", clean: "Day B capture", kind: "action", source: "typed", targetId: "" },
      { id: "other-day", at: at(27, 9), raw: "Other day capture", clean: "Other day capture", kind: "intention", source: "typed", targetId: "" },
    ],
  } as Board;

  it("switches the header payload with the heat-map day and never falls back to the board", () => {
    const dayA = "2026-08-25";
    const dayB = "2026-08-26";
    const excluded = [
      "Day B capture",
      "Other day capture",
      "Unrelated thread name",
      "Unrelated thread summary",
      "Unrelated thread fragment",
      "Unrelated open action",
      "Unrelated intention",
    ];

    const a = shareableFor(board, { kind: "record", day: dayA }, at(28, 12));
    expect(a?.text).toContain("Day A capture");
    for (const text of excluded) expect(a?.text).not.toContain(text);

    const b = shareableFor(board, { kind: "record", day: dayB }, at(28, 12));
    expect(b?.text).toContain("Day B capture");
    for (const text of ["Day A capture", ...excluded.filter((text) => text !== "Day B capture")]) {
      expect(b?.text).not.toContain(text);
    }
  });

  it("has no header payload for a quiet selected day", () => {
    expect(
      shareableFor(board, { kind: "record", day: "2026-08-28" }, at(28, 12))
    ).toBeNull();
  });
});

describe("selected-day Record handoff", () => {
  const at = new Date(2026, 8, 2, 9, 30).getTime();
  const entry = (over: Partial<import("./ledger").CaptureEntry> = {}) => ({
    id: "record-entry",
    at,
    raw: "Buy oat milk tomorrow morning.",
    clean: "Buy oat milk tomorrow morning.",
    kind: "action" as const,
    source: "typed" as const,
    targetId: "",
    ...over,
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the dated text heading as the one Web Share title and keeps it in clipboard text", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, clipboard: { writeText: vi.fn() } });

    const handoff = shareRecordDay([entry()], "2026-09-02")!;
    expect(handoff.title).toBe("");
    expect(handoff.text).toMatch(/^# The record — Sep 2, 2026/m);

    await expect(shareText(handoff)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: handoff.text });
  });

  it.each([
    ["Buy oat milk tomorrow morning.", "Buy oat milk tomorrow morning"],
    [
      "I need to examine why the capture app lags so much.",
      "i need to examine why the capture app lags so much",
    ],
    ["Clean up settings...", "Cleanup settings..."],
  ])("does not emit said for cosmetic-only rewrite: %s", (filed, said) => {
    const handoff = shareRecordDay(
      [entry({ clean: filed, transcript: said })],
      "2026-09-02"
    )!;

    expect(handoff.text).toContain(`: ${filed}`);
    expect(handoff.text).not.toContain("said:");
  });

  it("preserves the original when the filed version lost distinct intent", () => {
    const handoff = shareRecordDay(
      [
        entry({
          clean: "Write a note about the espresso machine grinder.",
          transcript: "Undo test: write a note about the espresso machine grinder",
        }),
        entry({
          id: "decision-fatigue",
          at: new Date(2026, 8, 2, 10, 30).getTime(),
          clean: "Write about the monthly review.",
          transcript:
            "Write about the monthly review and why I am not saving anything because of decision fatigue.",
        }),
      ],
      "2026-09-02"
    )!;

    expect(handoff.text).toContain(
      "said: Undo test: write a note about the espresso machine grinder"
    );
    expect(handoff.text).toContain(
      "said: Write about the monthly review and why I am not saving anything because of decision fatigue."
    );
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
