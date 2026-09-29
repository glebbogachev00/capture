import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import { captureUndoSnapshot } from "./captureTransaction";
import { applyFragMove, applyFragResolve } from "./fragOps";
import { captureUndoOutcome, restoreCapture, tombstonesAfterUndo, undoLearningKind } from "./undoOps";

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

describe("Undo learning authority", () => {
  const entry = (settledBy: "manual" | "automatic") => ({
    id: settledBy,
    at: 1,
    raw: "Captured words",
    clean: "Captured words",
    kind: "action" as const,
    source: "typed" as const,
    targetId: "action",
    settledBy,
  });

  it("aggregates every automatic settlement row before deciding Undo learning", () => {
    const automatic = (id: string, kind: "action" | "thread" | "intention") => ({
      ...entry("automatic"),
      id,
      kind,
      targetId: `${kind}-target`,
    });
    expect(captureUndoOutcome([
      automatic("planned-action", "action"),
      automatic("planned-thread", "thread"),
    ])).toMatchObject({ kind: "both", learningKind: null });
    expect(captureUndoOutcome([
      automatic("action-one", "action"),
      automatic("action-two", "action"),
    ])).toMatchObject({ kind: "action", learningKind: "action" });
    expect(captureUndoOutcome([automatic("thread", "thread")]))
      .toMatchObject({ kind: "thread", learningKind: "thread" });
    expect(captureUndoOutcome([automatic("intention", "intention")]))
      .toMatchObject({ kind: "intention", learningKind: "intention" });
    expect(captureUndoOutcome([
      automatic("automatic", "action"),
      { ...automatic("manual", "action"), settledBy: "manual" as const },
    ])).toMatchObject({ kind: "action", learningKind: null });
  });

  it("does not treat Undo of a manual settlement as a rejected model decision", () => {
    expect(undoLearningKind(entry("manual"))).toBeNull();
  });

  it("keeps normal model-misfile learning for automatic settlements", () => {
    expect(undoLearningKind(entry("automatic"))).toBe("action");
  });
});

describe("same-id inverse field changes", () => {
  it.each([
    { beforeFields: { faded: false, fadedAt: null }, landedFields: { faded: true, fadedAt: 20 } },
    { beforeFields: { faded: undefined }, landedFields: {} },
    { beforeFields: {}, landedFields: { faded: undefined } },
    { beforeFields: { faded: false }, landedFields: {} },
  ])("restores exact field presence for $beforeFields → $landedFields", ({ beforeFields, landedFields }) => {
    const before: Board = { ...base(), actions: [{ ...base().actions[0], ...beforeFields }] };
    const after: Board = { ...before, actions: [{ ...base().actions[0], ...landedFields }] };
    const snap = captureUndoSnapshot(before, [], after, []);
    expect(restoreCapture(structuredClone(after), snap, NOW).actions).toStrictEqual(before.actions);
  });

  it("does not mistake a later explicit undefined for an owned field deletion", () => {
    const before: Board = { ...base(), actions: [{ ...base().actions[0], faded: false }] };
    const after = base();
    const live: Board = { ...after, actions: [{ ...after.actions[0], faded: undefined }] };
    expect(restoreCapture(live, captureUndoSnapshot(before, [], after, []), NOW).actions)
      .toStrictEqual(live.actions);
  });

  it.each([false, true])("preserves later action edits while conditionally undoing let_go (same-field conflict: %s)", (conflict) => {
    const before: Board = { ...base(), actions: [{ ...base().actions[0], src: "Raw source", imgs: ["photo"] }] };
    const after: Board = { ...before, actions: [{ ...before.actions[0], faded: true, fadedAt: 20, updatedAt: 20 }] };
    const snap = captureUndoSnapshot(before, [], after, []);
    const live: Board = { ...after, actions: [{
      ...after.actions[0], text: "Newer text", imgs: ["photo", "new-photo"], updatedAt: 30,
      ...(conflict ? { faded: false, fadedAt: 30 } : {}),
    }] };
    const out = restoreCapture(live, snap, NOW);
    expect(out.actions).toStrictEqual(conflict ? live.actions : [{
      ...before.actions[0], text: "Newer text", imgs: ["photo", "new-photo"], updatedAt: 30,
    }]);
    expect(restoreCapture({ ...live, actions: [] }, snap, NOW).actions).toEqual([]);
  });

  it("reverses a nested owned field without overwriting a later sibling edit", () => {
    const before: Board = { ...base(), actions: [{ ...base().actions[0], shot: { threadId: "a", fragId: "f" } }] };
    const after: Board = { ...before, actions: [{ ...before.actions[0], shot: { threadId: "b", fragId: "f" } }] };
    const snap = captureUndoSnapshot(before, [], after, []);
    const live: Board = { ...after, actions: [{ ...after.actions[0], shot: { threadId: "b", fragId: "later" } }] };
    expect(restoreCapture(live, snap, NOW).actions[0].shot).toStrictEqual({ threadId: "a", fragId: "later" });
    expect(live.actions[0].shot).toStrictEqual({ threadId: "b", fragId: "later" });
    const conflict: Board = { ...live, actions: [{ ...live.actions[0], shot: { threadId: "c", fragId: "later" } }] };
    expect(restoreCapture(conflict, snap, NOW).actions).toStrictEqual(conflict.actions);
  });

  it.each([false, true])("compares array fields by value, preserving a later conflicting array (%s)", (laterEdit) => {
    const before: Board = { ...base(), actions: [{ ...base().actions[0], src: "Verbatim raw", imgs: ["old"] }] };
    const after: Board = { ...before, actions: [{ ...before.actions[0], imgs: ["landed"], faded: true }] };
    const snap = captureUndoSnapshot(before, [], after, []);
    // A hydrated/synced array is not the snapshot's object reference.
    const live: Board = { ...after, actions: [{
      ...after.actions[0], imgs: laterEdit ? ["landed", "newer"] : ["landed"], text: "Later edit",
    }] };
    const out = restoreCapture(live, snap, NOW);
    expect(out.actions).toStrictEqual([{ ...before.actions[0], text: "Later edit",
      imgs: laterEdit ? ["landed", "newer"] : ["old"],
    }]);
    expect(live.actions[0].imgs).toEqual(laterEdit ? ["landed", "newer"] : ["landed"]);
  });

  it("reverses owned thread metadata and principle fields but keeps later conflicting fields", () => {
    const before: Board = { ...base(),
      threads: [{ id: "t", name: "Original", summary: "Old summary", next: "Old step", frags: [] }],
      principles: [{ id: "p", name: "Principle", description: "Original", enabled: true }],
    };
    const after: Board = { ...before,
      threads: [{ ...before.threads[0], name: "Landed", summary: "Landed summary", next: null }],
      principles: [{ ...before.principles[0], enabled: false, description: "Landed" }],
    };
    const snap = captureUndoSnapshot(before, [], after, []);
    const live: Board = { ...after,
      threads: [{ ...after.threads[0], name: "Later rename", frags: [{ id: "new", at: 30, text: "Foreign" }] }],
      principles: [{ ...after.principles[0], description: "Later description" }],
    };
    const out = restoreCapture(live, snap, NOW);
    expect(out.threads).toStrictEqual([{ ...live.threads[0], summary: "Old summary", next: "Old step" }]);
    expect(out.principles).toStrictEqual([{ ...live.principles[0], enabled: true }]);
  });

  it("undoes revisit_intention unless a later edit changed its timestamp", () => {
    const before: Board = { ...base(), intentions: [{
      id: "i", number: 1, rawInput: "Original raw", expandedIntention: "I am present",
      recommendedActions: ["Listen"], counterIntentions: ["Rush"], imgs: ["photo"],
      at: 1, updatedAt: 1,
    }] };
    const after: Board = { ...before, intentions: [{ ...before.intentions[0], updatedAt: 20 }] };
    const snap = captureUndoSnapshot(before, [], after, [], {}, false);
    expect(restoreCapture(after, snap, NOW).intentions).toStrictEqual(before.intentions);

    const live: Board = { ...after, intentions: [{
      ...after.intentions[0], expandedIntention: "A newer edit", updatedAt: 30,
    }] };
    expect(restoreCapture(live, snap, NOW).intentions).toStrictEqual(live.intentions);
  });

  it("undoes looks_done on the same fragment without dropping later notes or edits", () => {
    const before: Board = {
      ...base(),
      threads: [{ id: "t", name: "Before", summary: "", frags: [
        { id: "f", text: "Original words", at: 1, imgs: ["original-photo"] },
      ] }],
    };
    const after = applyFragResolve(before, "t", "f", 20)!.board;
    const snap = captureUndoSnapshot(before, [], after, [], {}, false);
    const live: Board = {
      ...after,
      threads: [{ ...after.threads[0], name: "Remote rename", frags: [
        { ...after.threads[0].frags[0], text: "Newer words", imgs: ["new-photo"], updatedAt: 30 },
        { id: "foreign", text: "Later note", at: 30 },
      ] }],
    };

    const out = restoreCapture(live, snap, NOW);
    expect(out.threads[0]).toStrictEqual({ ...live.threads[0], frags: [
      { id: "f", text: "Newer words", at: 1, imgs: ["new-photo"], updatedAt: 30 },
      live.threads[0].frags[1],
    ] });
    expect(restoreCapture(after, snap, NOW).threads).toStrictEqual(before.threads);
    const relabeled: Board = { ...live, threads: [{ ...live.threads[0], frags: [
      { ...live.threads[0].frags[0], resolvedAt: 30 }, live.threads[0].frags[1],
    ] }] };
    expect(restoreCapture(relabeled, snap, NOW).threads).toStrictEqual(relabeled.threads);
  });

  it("undoes let_go back to the original faded, fadedAt and updatedAt presence", () => {
    const before = base();
    const after: Board = {
      ...before,
      actions: before.actions.map((action) => ({
        ...action, faded: true, fadedAt: 20, updatedAt: 20,
      })),
    };
    const snap = captureUndoSnapshot(before, [], after, [], {}, false);

    const out = restoreCapture(after, snap, NOW);
    expect(out.actions).toStrictEqual(before.actions);
    expect(out.actions[0]).not.toHaveProperty("faded");
    expect(out.actions[0]).not.toHaveProperty("fadedAt");
    expect(after.actions[0]).toMatchObject({ faded: true, fadedAt: 20, updatedAt: 20 });
  });
});

describe("restoring after an undo", () => {
  it("preserves current non-owned tombstones, retired pending envelopes, and newer same-id remote deletes", () => {
    const owned = [{ kind: "action" as const, id: "removed-by-tidy", deletedAt: 10 }];
    const current = [
      ...owned,
      { kind: "action" as const, id: "pending-envelope", deletedAt: 11 },
      { kind: "thread" as const, id: "remote-thread", deletedAt: 12 },
      { kind: "action" as const, id: "removed-by-tidy", deletedAt: 13 },
    ];
    const generated = [{ kind: "action" as const, id: "capture-created", deletedAt: 20 }];

    expect(tombstonesAfterUndo(current, owned, generated, 20)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pending-envelope", deletedAt: 11 }),
      expect.objectContaining({ id: "remote-thread", deletedAt: 12 }),
      expect.objectContaining({ id: "removed-by-tidy", deletedAt: 13 }),
      expect.objectContaining({ id: "capture-created", deletedAt: 20 }),
    ]));
    expect(tombstonesAfterUndo(owned, owned, [], 20)).toEqual([]);
  });

  it("keeps import reconciliation receipts and unknown recovered fields across Undo", () => {
    const snap = { board: { ...base(), historyImports: { batch: "pending" as const } } };
    const live = { ...base(), historyImports: { batch: "accepted" as const }, futureField: { original: true } };
    expect(restoreCapture(live, snap, NOW)).toMatchObject({ historyImports: live.historyImports, futureField: live.futureField });
  });
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

  it("preserves a post-snapshot remote edit to a pre-existing same-id artifact", () => {
    const snap = { board: base(), addedIds: new Set(["mine"]) };
    const live: Board = {
      ...base(),
      actions: [act("mine", "the capture"), act("old", "edited remotely after landing", NOW - 1)],
    };

    expect(restoreCapture(live, snap, NOW).actions).toEqual([
      expect.objectContaining({ id: "old", text: "edited remotely after landing", updatedAt: NOW - 1 }),
    ]);
  });

  it("does not resurrect a remotely deleted pre-existing artifact unless this Undo owns its removal", () => {
    const snap = { board: base(), addedIds: new Set<string>(), removedIds: new Set<string>() };
    const live: Board = { ...base(), actions: [] };

    expect(restoreCapture(live, snap, NOW).actions).toEqual([]);
  });

  it("never resurrects retired pending envelopes or pending ledger rows", () => {
    const pending = act("pending", "waiting") as Board["actions"][number];
    pending.unsorted = true;
    const snapBoard: Board = {
      ...base(),
      actions: [pending, ...base().actions],
      ledger: [{
        id: "pending-row", captureId: "capture", at: 1, raw: "waiting", clean: "waiting",
        kind: "pending", source: "typed", targetId: "pending", pendingRevision: 1,
      }, ...base().ledger] as never,
    };
    const live: Board = { ...base(), actions: [] };

    const restored = restoreCapture(live, {
      board: snapBoard,
      removedIds: new Set(["pending"]),
      ledgerIds: ["settlement"],
    }, NOW);
    expect(restored.actions.some((action) => action.id === "pending")).toBe(false);
    expect(restored.ledger.some((entry) => entry.id === "pending-row" && !entry.undone)).toBe(false);
  });

  it("bumps what the capture removed, so it out-ages its own tombstone", () => {
    /* A re-sort replaces the raw action; undoing must bring it back NEWER
       than the tombstone the capture pushed, or the next pull re-deletes
       it. */
    const snap = {
      board: base(),
      addedIds: new Set(["sorted"]),
      removedIds: new Set(["old"]),
    };
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

  it("keeps the current synced profile when undoing an older capture", () => {
    const snap = { board: base(), addedIds: new Set<string>() };
    const live: Board = {
      ...base(),
      profile: {
        name: "Gleb",
        imageId: "profile-photo",
        showSignature: true,
        updatedAt: NOW - 1,
      },
    };

    expect(restoreCapture(live, snap, NOW).profile).toEqual(live.profile);
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
  it.each(["moved", "deleted"] as const)("does not resurrect the old fragment in a revived source after it was later %s", (later) => {
    const before: Board = { ...base(), threads: [
      { id: "a", name: "A", summary: "", frags: [{ id: "f", at: 1, text: "Original" }] },
      { id: "b", name: "B", summary: "", frags: [] },
      { id: "c", name: "C", summary: "", frags: [] },
    ] };
    const after = applyFragMove(before, "a", "f", "b", 20)!.board;
    const snap = captureUndoSnapshot(before, [], after, []);
    const live: Board = later === "moved"
      ? applyFragMove(after, "b", "f", "c", 30)!.board
      : { ...after, threads: after.threads.map((thread) => ({ ...thread, frags: [] })) };
    const out = restoreCapture(live, snap, NOW);
    expect(out.threads.find((thread) => thread.id === "a")?.frags ?? []).toEqual([]);
    expect(out.threads.flatMap((thread) => thread.frags)).toHaveLength(later === "moved" ? 1 : 0);
    if (later === "moved") expect(out.threads.find((thread) => thread.id === "c")!.frags)
      .toStrictEqual(live.threads.find((thread) => thread.id === "c")!.frags);
  });

  it.each([false, true])("keeps newer fragment fields when reversing a move (emptied source: %s)", (emptied) => {
    const before: Board = { ...base(), threads: [
      { id: "a", name: "A", summary: "", frags: [
        { id: "f", at: 1, text: "Original", imgs: ["photo"] },
        ...(emptied ? [] : [{ id: "stay", at: 1, text: "Stay" }]),
      ] },
      { id: "b", name: "B", summary: "", frags: [] },
    ] };
    const after = applyFragMove(before, "a", "f", "b", 20)!.board;
    const snap = captureUndoSnapshot(before, [], after, []);
    const newer = { id: "f", at: 1, text: "Newer words", imgs: ["new-photo"], updatedAt: 30 };
    const live: Board = { ...after, threads: after.threads.map((thread) => thread.id === "b"
      ? { ...thread, frags: [newer, { id: "foreign", at: 30, text: "Other capture" }] }
      : thread) };
    const out = restoreCapture(live, snap, NOW);
    expect(out.threads.find((thread) => thread.id === "a")!.frags.find((frag) => frag.id === "f"))
      .toStrictEqual(newer);
    expect(out.threads.find((thread) => thread.id === "b")!.frags.map((frag) => frag.id)).toEqual(["foreign"]);
    expect(out.threads.flatMap((thread) => thread.frags).filter((frag) => frag.id === "f")).toHaveLength(1);
  });

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

    const out = restoreCapture(after, {
      board: before,
      addedIds: new Set(),
      movedFragIds: new Set(["f1"]),
    }, 999);

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
