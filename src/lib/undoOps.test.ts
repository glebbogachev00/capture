import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import { restoreCapture } from "./undoOps";

/**
 * Every rule here is a shipped incident, replayed as an assertion. The
 * restore used to live inline in the hook, testable only by reading it —
 * which is how one Undo deleted every wrap and tick receipt on a device,
 * and how the same field-drop class shipped five separate times.
 */

const NOW = 1_000_000;

const act = (id: string, text: string, updatedAt = 1) =>
  ({ id, text, done: false, at: 1, updatedAt }) as never;

const base = (): Board => ({
  ...EMPTY,
  actions: [act("old", "was here before")],
  ledger: [
    { id: "L0", at: 1, raw: "was here", clean: "was here", kind: "action", source: "typed", targetId: "old" },
  ] as never,
});

describe("restoring after an undo", () => {
  it("removes only what this capture created", () => {
    const snap = { board: base(), addedIds: new Set(["mine"]), ledgerIds: ["L1"] };
    const live: Board = {
      ...base(),
      actions: [act("mine", "the capture"), act("theirs", "another device's"), act("old", "was here before")],
    };
    const out = restoreCapture(live, snap, NOW);
    const ids = out.actions.map((a: { id: string }) => a.id);
    expect(ids).not.toContain("mine");
    /* The other device's capture survives — an undo HERE must never delete
       a capture made THERE. */
    expect(ids).toContain("theirs");
    expect(ids).toContain("old");
  });

  it("bumps what the capture removed, so it out-ages its own tombstone", () => {
    /* A re-sort replaces the raw action; undoing must bring it back NEWER
       than the tombstone the capture pushed, or the next pull re-deletes
       it. */
    const snap = { board: base(), addedIds: new Set(["sorted"]) };
    const live: Board = { ...base(), actions: [act("sorted", "the replacement")] };
    const out = restoreCapture(live, snap, NOW);
    const old = out.actions.find((a: { id: string }) => a.id === "old") as { updatedAt?: number };
    expect(old.updatedAt).toBe(NOW);
  });

  it("keeps the snapshot's version unbumped when both sides hold it", () => {
    /* Present on both sides means the capture never touched it — bumping
       would make every undo advertise a change that did not happen. */
    const snap = { board: base(), addedIds: new Set<string>() };
    const live = base();
    const out = restoreCapture(live, snap, NOW);
    const old = out.actions.find((a: { id: string }) => a.id === "old") as { updatedAt?: number };
    expect(old.updatedAt).toBe(1);
  });

  it("marks the capture's ledger entries undone — never deletes them", () => {
    const snap = { board: base(), addedIds: new Set(["mine"]), ledgerIds: ["L1"] };
    const live: Board = {
      ...base(),
      ledger: [
        ...base().ledger,
        { id: "L1", at: 2, raw: "the capture", clean: "the capture", kind: "action", source: "typed", targetId: "mine" },
        { id: "L2", at: 3, raw: "someone else's", clean: "someone else's", kind: "action", source: "typed", targetId: "theirs" },
      ] as never,
    };
    const out = restoreCapture(live, snap, NOW);
    const l1 = out.ledger!.find((e) => e.id === "L1")!;
    const l2 = out.ledger!.find((e) => e.id === "L2")!;
    expect(l1.undone).toBe(true);
    expect(l2.undone).toBeFalsy();
  });

  it("wraps, completions, and the epoch survive — the incident that started all this", () => {
    /* One Undo used to destroy every wrap and tick receipt on the device,
       silently, because the rebuild did not name them. */
    const snap = { board: base(), addedIds: new Set<string>() };
    const live: Board = {
      ...base(),
      wraps: [{ day: "2026-08-29", text: "yesterday, in short", at: 5 }] as never,
      completions: [{ id: "c1", at: 6 }] as never,
      historyEpoch: 3,
    };
    const out = restoreCapture(live, snap, NOW);
    expect(out.wraps).toHaveLength(1);
    expect(out.completions).toHaveLength(1);
    expect(out.historyEpoch).toBe(3);
  });

  it("a foreign fragment inside a snapped thread survives", () => {
    const thread = (frags: { id: string; text: string; at: number }[]) =>
      ({ id: "t1", name: "T", at: 1, frags }) as never;
    const snap = {
      board: { ...EMPTY, threads: [thread([{ id: "f1", text: "before", at: 1 }])] } as Board,
      addedIds: new Set<string>(),
    };
    const live: Board = {
      ...EMPTY,
      threads: [thread([
        { id: "f1", text: "before", at: 1 },
        { id: "f2", text: "arrived from the other device", at: 2 },
      ])],
    };
    const out = restoreCapture(live, snap, NOW);
    const frags = (out.threads[0] as { frags: { id: string }[] }).frags.map((f) => f.id);
    expect(frags).toContain("f2");
  });

  it("restores every field the Board has — none may go missing silently", () => {
    /* The class guard: a future Board field left out of the restore is the
       five-times-shipped bug. The restore must produce a value for every
       key EMPTY declares. */
    const out = restoreCapture(base(), { board: base() }, NOW) as unknown as Record<string, unknown>;
    for (const key of Object.keys(EMPTY)) {
      expect(out[key], `restore dropped Board.${key}`).toBeDefined();
    }
  });
});

describe("undoing a tidy change that MOVED a note", () => {
  const T = (id: string, frags: { id: string; at: number; text: string }[]) => ({
    id,
    name: id,
    summary: "",
    frags,
  });
  const board = (threads: Board["threads"]): Board => ({ ...EMPTY, threads });

  it("takes the note out of the thread it was moved into", () => {
    /* Organize's move_fragment keeps the fragment's id, so the copy in the
       destination is indistinguishable from another device's work if
       foreignness is judged one thread at a time. It was, and Undo left the
       note in BOTH threads — the repair duplicating the record it repaired. */
    const before = board([
      T("a", [{ id: "f1", at: 1, text: "note" }]),
      T("b", []),
    ]);
    const after = board([
      T("a", []),
      T("b", [{ id: "f1", at: 1, text: "note" }]),
    ]);

    const out = restoreCapture(after, { board: before, addedIds: new Set() }, 999);

    expect(out.threads.map((t) => t.frags.map((f) => f.id))).toEqual([
      ["f1"],
      [],
    ]);
  });

  it("still keeps a fragment another device added while the tidy ran", () => {
    /* The guard the rule above must not break: an id the snapshot has never
       seen anywhere is genuinely foreign and survives the undo. */
    const before = board([T("a", [{ id: "f1", at: 1, text: "mine" }])]);
    const after = board([
      T("a", [
        { id: "f1", at: 1, text: "mine" },
        { id: "elsewhere", at: 2, text: "from the other device" },
      ]),
    ]);

    const out = restoreCapture(after, { board: before, addedIds: new Set() }, 999);

    expect(out.threads[0].frags.map((f) => f.id)).toEqual(["f1", "elsewhere"]);
  });
});
