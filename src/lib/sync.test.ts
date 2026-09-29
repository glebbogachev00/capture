import { describe, expect, it } from "vitest";
import {
  boardSignature,
  applyTombstones,
  mergeBoards,
  mergeSync,
  mergeTombstones,
  reconcileActionShotHomes,
  stampChanges,
  TOMBSTONE_TTL,
  type Tombstone,
} from "@/lib/sync";
import type { Action, Board, Frag, Thread } from "@/lib/model";

const action = (id: string, over: Partial<Action> = {}): Action => ({
  id,
  text: "do the thing",
  done: false,
  at: 1000,
  shelf: "keep",
  expires: null,
  updatedAt: 1000,
  ...over,
});

const frag = (id: string, over: Partial<Frag> = {}): Frag => ({
  id,
  at: 1000,
  text: "a note",
  updatedAt: 1000,
  ...over,
});

const thread = (id: string, frags: Frag[] = [], over: Partial<Thread> = {}): Thread => ({
  id,
  name: "A thread",
  summary: "",
  frags,
  updatedAt: 1000,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  actions: [],
  threads: [],
  intentions: [],
  principles: [],
  ledger: [],
  corrections: [],
  ...over,
});

describe("mergeBoards", () => {
  it("keeps adds from both sides", () => {
    const a = board({ actions: [action("a1")] });
    const b = board({ actions: [action("b1")] });
    const out = mergeBoards(a, b);
    expect(out.actions.map((x) => x.id).sort()).toEqual(["a1", "b1"]);
  });

  it("edits resolve to the newer updatedAt (whole item)", () => {
    const a = board({ actions: [action("a1", { text: "old", updatedAt: 100 })] });
    const b = board({ actions: [action("a1", { text: "new", updatedAt: 200 })] });
    const out = mergeBoards(a, b);
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0].text).toBe("new");
  });

  it("ties keep the existing copy (a side)", () => {
    const a = board({ actions: [action("a1", { text: "a", updatedAt: 100 })] });
    const b = board({ actions: [action("a1", { text: "b", updatedAt: 100 })] });
    const out = mergeBoards(a, b);
    expect(out.actions[0].text).toBe("a");
  });

  it("adopts a newer profile from the other device", () => {
    const desktop = board({
      profile: {
        name: "Desktop name",
        imageId: "desktop-photo",
        showSignature: false,
        updatedAt: 100,
      },
    });
    const phone = board({
      profile: {
        name: "Gleb",
        imageId: "phone-photo",
        showSignature: true,
        updatedAt: 200,
      },
    });

    const merged = mergeBoards(desktop, phone);

    expect(merged.profile).toEqual(phone.profile);
    expect(boardSignature(merged, [])).not.toBe(boardSignature(desktop, []));
  });

  it("merges fragments structurally — both devices' notes on the same thread survive", () => {
    const a = board({
      threads: [thread("t1", [frag("f1", { text: "phone note" })])],
    });
    const b = board({
      threads: [thread("t1", [frag("f2", { text: "mac note" })])],
    });
    const out = mergeBoards(a, b);
    expect(out.threads).toHaveLength(1);
    expect(out.threads[0].frags.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("places a moved fragment in its newest home thread", () => {
    const a = board({
      threads: [thread("t1", [frag("f1", { updatedAt: 100 })]), thread("t2", [])],
    });
    // Device b moved f1 into t2, bumping its updatedAt.
    const b = board({
      threads: [thread("t1", []), thread("t2", [frag("f1", { updatedAt: 300 })])],
    });
    const out = mergeBoards(a, b);
    const t1 = out.threads.find((t) => t.id === "t1");
    const t2 = out.threads.find((t) => t.id === "t2");
    expect(t1?.frags).toHaveLength(0);
    expect(t2?.frags.map((f) => f.id)).toEqual(["f1"]);
  });

  describe.each([
    ["fragment move", "destination", [
      thread("source", [frag("other")], { updatedAt: 5000 }),
      thread("destination", [frag("owner", { imgs: ["photo"], updatedAt: 5000 })], { updatedAt: 5000 }),
    ], []],
    ["fragment split", "split-thread", [
      thread("source", [frag("other")], { updatedAt: 5000 }),
      thread("split-thread", [frag("owner", { imgs: ["photo"], updatedAt: 5000 })], { updatedAt: 5000 }),
    ], []],
    ["whole-Thread merge", "destination", [
      thread("destination", [frag("owner", { imgs: ["photo"], updatedAt: 5000 })], { updatedAt: 5000 }),
    ], [{ kind: "thread", id: "source", deletedAt: 5000 } as Tombstone]],
  ] as const)("Action shot reconciliation after %s", (_case, actualHome, movedThreads, movedTombstones) => {
    const staleAction = action("image-action", {
      text: "newer stale-device edit",
      shot: { threadId: "source", fragId: "owner" },
      updatedAt: 7000,
    });
    const stale = {
      board: board({
        actions: [staleAction],
        threads: [
          thread("source", [frag("owner", { imgs: ["photo"], updatedAt: 1000 })]),
          thread("destination", []),
        ],
        ledger: [{
          id: "immutable-record", at: 1000, raw: "raw", clean: "clean",
          kind: "action", source: "image", targetId: "image-action",
          targetFragId: "owner", imgs: ["photo"],
        }],
      }),
      tombstones: [] as Tombstone[],
    };
    const moved = {
      board: board({
        actions: [action("image-action", {
          text: "before stale edit",
          shot: { threadId: actualHome, fragId: "owner" },
          updatedAt: 5000,
        })],
        threads: [...movedThreads],
        ledger: stale.board.ledger,
      }),
      tombstones: [...movedTombstones],
    };

    it("converges in either merge order without rewriting Action/history/image metadata", () => {
      for (const [left, right] of [[stale, moved], [moved, stale]] as const) {
        const out = mergeSync(left, right, 8000).board;
        const mergedAction = out.actions.find((item) => item.id === "image-action")!;
        expect(mergedAction).toEqual({
          ...staleAction,
          shot: { threadId: actualHome, fragId: "owner" },
        });
        expect(out.threads.find((item) => item.id === actualHome)
          ?.frags.find((item) => item.id === "owner")?.imgs).toEqual(["photo"]);
        expect(out.ledger).toEqual(stale.board.ledger);
      }
    });
  });

  it.each([
    ["missing", []],
    ["ambiguous", [
      thread("one", [frag("owner")]),
      thread("two", [frag("owner")]),
    ]],
  ] as const)("fails closed by preserving a %s shot when no unique fragment home exists", (_case, threads) => {
    const original = action("image-action", {
      shot: { threadId: "stale-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const input = board({ actions: [original], threads: [...threads] });
    const out = reconcileActionShotHomes(input);
    expect(out.actions[0]).toBe(original);
    expect(out.actions[0].shot).toEqual({ threadId: "stale-home", fragId: "owner" });
    expect(out.actions[0].updatedAt).toBe(7000);
  });

  it("does not rewrite a legacy completed Action while reconciling live owners", () => {
    const original = action("completed", {
      done: true,
      shot: { threadId: "obsolete-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const input = board({
      actions: [original],
      threads: [thread("actual-home", [frag("owner")])],
    });
    expect(reconcileActionShotHomes(input).actions[0]).toBe(original);
  });
});

describe("tombstones", () => {
  it("a delete tombstone removes the item everywhere", () => {
    const state = mergeSync(
      { board: board({ actions: [action("a1", { updatedAt: 100 })] }), tombstones: [] },
      { board: board({}), tombstones: [{ kind: "action", id: "a1", deletedAt: 500 }] },
      1000
    );
    expect(state.board.actions).toHaveLength(0);
  });

  it("an edit made after the delete resurrects the item", () => {
    const state = mergeSync(
      { board: board({}), tombstones: [{ kind: "action", id: "a1", deletedAt: 500 }] },
      { board: board({ actions: [action("a1", { updatedAt: 900 })] }), tombstones: [] }
    );
    expect(state.board.actions.map((x) => x.id)).toEqual(["a1"]);
  });

  it("tombstones merge keeping the newest deletedAt", () => {
    const merged = mergeTombstones(
      [{ kind: "action", id: "a1", deletedAt: 100 }],
      [{ kind: "action", id: "a1", deletedAt: 300 }],
      1000
    );
    expect(merged).toEqual([{ kind: "action", id: "a1", deletedAt: 300 }]);
  });

  it("tombstones age out after the TTL instead of syncing forever", () => {
    const old = { kind: "action", id: "old", deletedAt: 1000 } as Tombstone;
    const fresh = { kind: "action", id: "fresh", deletedAt: 2000 } as Tombstone;
    const now = 1000 + TOMBSTONE_TTL + 1;
    expect(mergeTombstones([old], [fresh], now)).toEqual([fresh]);
    /* Inside the horizon both survive. */
    expect(mergeTombstones([old], [fresh], 3000)).toHaveLength(2);
  });

  it("applyTombstones drops tombstoned fragments inside a surviving thread", () => {
    const t: Tombstone = { kind: "frag", id: "f1", deletedAt: 500 };
    const b = board({
      threads: [thread("t1", [frag("f1", { updatedAt: 100 })])],
    });
    const out = applyTombstones(b, [t]);
    expect(out.threads[0].frags).toHaveLength(0);
  });
});

describe("mergeSync end to end", () => {
  it("keeps the original Action shot when one input has duplicate fragment homes", () => {
    const original = action("image-action", {
      text: "keep every Action field",
      imgs: ["action-image"],
      shot: { threadId: "original-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const ledger = [{
      id: "immutable-record", at: 900, raw: "raw", clean: "clean",
      kind: "action" as const, source: "image" as const,
      targetId: "image-action", targetFragId: "owner", imgs: ["ledger-image"],
    }];
    const duplicate = {
      board: board({
        actions: [original],
        threads: [
          thread("one", [frag("owner", { imgs: ["first-image"] })]),
          thread("two", [frag("owner", { imgs: ["second-image"] })]),
        ],
        ledger,
      }),
      tombstones: [] as Tombstone[],
    };
    const empty = { board: board(), tombstones: [] as Tombstone[] };

    for (const [left, right] of [[duplicate, empty], [empty, duplicate]] as const) {
      const merged = mergeSync(left, right, 8000);
      expect(merged.board.actions[0]).toEqual(original);
      expect(merged.board.actions[0].updatedAt).toBe(7000);
      expect(merged.board.ledger).toEqual(ledger);
      expect(merged.board.threads.flatMap((item) => item.frags)
        .flatMap((item) => item.imgs ?? []).sort()).toEqual([
        "first-image", "second-image",
      ]);
    }
  });

  it("is order-independent for equal-timestamp fragment conflicts across inputs", () => {
    const original = action("image-action", {
      shot: { threadId: "original-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const left = {
      board: board({
        actions: [original],
        threads: [thread("one", [frag("owner", {
          text: "left content", imgs: ["left-image"], updatedAt: 5000,
        })])],
      }),
      tombstones: [] as Tombstone[],
    };
    const right = {
      board: board({
        actions: [original],
        threads: [thread("two", [frag("owner", {
          text: "right content", imgs: ["right-image"], updatedAt: 5000,
        })])],
      }),
      tombstones: [] as Tombstone[],
    };

    const forward = mergeSync(left, right, 8000).board;
    const reverse = mergeSync(right, left, 8000).board;
    const owners = (input: Board) => input.threads.flatMap((item) =>
      item.frags.map((item) => ({ home: input.threads.find((thread) =>
        thread.frags.includes(item))!.id, frag: item })))
      .filter((item) => item.frag.id === "owner")
      .sort((a, b) => a.home.localeCompare(b.home));

    expect(forward.actions[0]).toEqual(original);
    expect(reverse.actions[0]).toEqual(original);
    expect(owners(forward)).toEqual(owners(reverse));
    expect(owners(forward)).toHaveLength(2);
  });

  it("propagates equal-timestamp home ambiguity into later syncs", () => {
    const original = action("image-action", {
      shot: { threadId: "original-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const left = {
      board: board({
        actions: [original],
        threads: [thread("one", [frag("owner", {
          text: "left content", imgs: ["left-image"], updatedAt: 5000,
        })])],
      }),
      tombstones: [] as Tombstone[],
    };
    const right = {
      board: board({
        actions: [original],
        threads: [thread("two", [frag("owner", {
          text: "right content", imgs: ["right-image"], updatedAt: 5000,
        })])],
      }),
      tombstones: [] as Tombstone[],
    };

    const once = mergeSync(left, right, 8000);
    const again = mergeSync(once, once, 8000);
    expect(again.board.actions[0]).toEqual(original);
    expect(again.board.threads.flatMap((item) => item.frags)
      .filter((item) => item.id === "owner")).toHaveLength(2);
  });

  it("keeps the original shot when a fragment tombstone leaves no final home", () => {
    const original = action("image-action", {
      text: "preserve me exactly",
      imgs: ["action-image"],
      shot: { threadId: "original-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const ledger = [{
      id: "immutable-record", at: 900, raw: "raw", clean: "clean",
      kind: "action" as const, source: "image" as const,
      targetId: "image-action", targetFragId: "owner", imgs: ["ledger-image"],
    }];
    const present = {
      board: board({
        actions: [original],
        threads: [thread("apparent", [frag("owner", {
          imgs: ["fragment-image"], updatedAt: 5000,
        })])],
        ledger,
      }),
      tombstones: [] as Tombstone[],
    };
    const deleted = {
      board: board(),
      tombstones: [{ kind: "frag", id: "owner", deletedAt: 5000 }] as Tombstone[],
    };

    for (const [left, right] of [[present, deleted], [deleted, present]] as const) {
      const merged = mergeSync(left, right, 8000);
      expect(merged.board.actions[0]).toEqual(original);
      expect(merged.board.ledger).toEqual(ledger);
      expect(merged.board.threads.flatMap((item) => item.frags)).toEqual([]);
    }
  });

  it("keeps the original shot when a Thread tombstone leaves no final home", () => {
    const original = action("image-action", {
      imgs: ["action-image"],
      shot: { threadId: "original-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const present = {
      board: board({
        actions: [original],
        threads: [thread("apparent", [frag("owner", {
          imgs: ["fragment-image"], updatedAt: 5000,
        })], { updatedAt: 5000 })],
      }),
      tombstones: [] as Tombstone[],
    };
    const deleted = {
      board: board(),
      tombstones: [{ kind: "thread", id: "apparent", deletedAt: 5000 }] as Tombstone[],
    };

    for (const [left, right] of [[present, deleted], [deleted, present]] as const) {
      const merged = mergeSync(left, right, 8000).board;
      expect(merged.actions[0]).toEqual(original);
      expect(merged.threads).toEqual([]);
    }
  });

  it("repairs from the unique final home after a Thread tombstone removes the apparent winner", () => {
    const original = action("image-action", {
      shot: { threadId: "original-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const apparent = {
      board: board({
        actions: [original],
        threads: [thread("doomed", [frag("owner", {
          text: "newer but deleted", updatedAt: 5000,
        })], { updatedAt: 5000 })],
      }),
      tombstones: [] as Tombstone[],
    };
    const survivor = {
      board: board({
        actions: [original],
        threads: [thread("survivor", [frag("owner", {
          text: "final live content", imgs: ["surviving-image"], updatedAt: 4000,
        })], { updatedAt: 4000 })],
      }),
      tombstones: [{ kind: "thread", id: "doomed", deletedAt: 5000 }] as Tombstone[],
    };

    for (const [left, right] of [[apparent, survivor], [survivor, apparent]] as const) {
      const merged = mergeSync(left, right, 8000).board;
      expect(merged.actions[0]).toEqual({
        ...original,
        shot: { threadId: "survivor", fragId: "owner" },
      });
      expect(merged.threads.map((item) => item.id)).toEqual(["survivor"]);
      expect(merged.threads[0].frags[0]).toEqual(frag("owner", {
        text: "final live content", imgs: ["surviving-image"], updatedAt: 4000,
      }));
    }
  });

  it("does not let an unproven manual authority delete a valid automatic artifact", () => {
    const automatic = board({
      actions: [action("automatic-artifact")],
      routingSettlements: [{
        id: "automatic-authority",
        captureId: "capture",
        pendingId: "pending",
        revision: 1,
        settledBy: "automatic",
        artifacts: [{ kind: "action", id: "automatic-artifact" }],
      }],
    });
    const forged = board({
      routingSettlements: [{
        id: "unproven-manual-authority",
        captureId: "capture",
        pendingId: "pending",
        revision: 1,
        settledBy: "manual",
        artifacts: [{ kind: "action", id: "missing-manual-artifact" }],
      }],
    });

    for (const [left, right] of [[automatic, forged], [forged, automatic]] as const) {
      const merged = mergeSync(
        { board: left, tombstones: [] },
        { board: right, tombstones: [] },
        2000,
      );
      expect(merged.board.actions.map((item) => item.id)).toContain("automatic-artifact");
      expect(merged.board.routingSettlements).toEqual([
        expect.objectContaining({ id: "automatic-authority", settledBy: "automatic" }),
      ]);
    }
  });

  it("converges when run twice (idempotent)", () => {
    const a = {
      board: board({ actions: [action("a1", { updatedAt: 100 })] }),
      tombstones: [{ kind: "action", id: "gone", deletedAt: 200 }] as Tombstone[],
    };
    const b = {
      board: board({ actions: [action("b1", { updatedAt: 50 })] }),
      tombstones: [{ kind: "thread", id: "gone-t", deletedAt: 100 }] as Tombstone[],
    };
    const once = mergeSync(a, b);
    const twice = mergeSync(mergeSync(a, b), b);
    expect(twice).toEqual(once);
  });

  it("a merge then a tombstone resolves like the newest action", () => {
    // Phone deletes an action after the Mac edited it: the edit (newer) wins.
    const edited = {
      board: board({ actions: [action("a1", { text: "edited", updatedAt: 900 })] }),
      tombstones: [] as Tombstone[],
    };
    const deleted = {
      board: board({}),
      tombstones: [{ kind: "action", id: "a1", deletedAt: 500 }] as Tombstone[],
    };
    const state = mergeSync(edited, deleted);
    expect(state.board.actions.map((x) => x.text)).toEqual(["edited"]);
    // And the tombstone that lost is not reapplied later.
    const again = mergeSync(state, deleted);
    expect(again.board.actions.map((x) => x.text)).toEqual(["edited"]);
  });
});

describe("stampChanges — merge does not tombstone fragments that survived", () => {
  // A merge folds t2 into t1: t2 is removed, its fragment f2 now lives in t1.
  const prev = board({
    threads: [
      thread("t1", [frag("f1", { text: "kept note" })]),
      thread("t2", [frag("f2", { text: "folded-in note" })]),
    ],
  });
  const next = board({
    threads: [
      thread("t1", [frag("f1", { text: "kept note" }), frag("f2", { text: "folded-in note" })]),
    ],
  });

  it("tombstones the removed thread but NOT its moved-in fragment", () => {
    const { tombstones } = stampChanges(prev, next, 5000);
    expect(tombstones).toContainEqual({ kind: "thread", id: "t2", deletedAt: 5000 });
    // f2 moved into t1, so it must not be tombstoned.
    expect(tombstones.some((t) => t.kind === "frag" && t.id === "f2")).toBe(false);
  });

  it("the merged board survives applyTombstones (the actual data-loss bug)", () => {
    const { board: stamped, tombstones } = stampChanges(prev, next, 5000);
    const after = applyTombstones(stamped, tombstones);
    const t1 = after.threads.find((t) => t.id === "t1");
    expect(t1?.frags.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("survives a full sync against a hub still holding the pre-merge board", () => {
    const { board: stamped, tombstones } = stampChanges(prev, next, 5000);
    const hub = { board: prev, tombstones: [] as Tombstone[] };
    const merged = mergeSync({ board: stamped, tombstones }, hub, 6000);
    const surviving = merged.board.threads.flatMap((t) => t.frags.map((f) => f.id));
    expect(surviving.sort()).toEqual(["f1", "f2"]);
    // The folded thread stays gone; it does not resurrect from the hub.
    expect(merged.board.threads.map((t) => t.id)).toEqual(["t1"]);
  });

  it("still tombstones a fragment when its thread is genuinely deleted", () => {
    const before = board({ threads: [thread("t1", [frag("f1")])] });
    const emptied = board({ threads: [] });
    const { tombstones } = stampChanges(before, emptied, 5000);
    expect(tombstones).toContainEqual({ kind: "thread", id: "t1", deletedAt: 5000 });
    expect(tombstones).toContainEqual({ kind: "frag", id: "f1", deletedAt: 5000 });
  });
});

describe("stampChanges — a thread's own fields are content", () => {
  /* The bug: only fragment changes bumped a thread's updatedAt. A summary
     rewritten after a note was deleted, a rename, or a cover chosen on the
     phone all left the stamp alone — so mergeThreads, which picks a thread
     record by updatedAt, kept the other device's older copy and pushed the
     stale one straight back. The summary went on describing a deleted note
     and the cover never left the phone. */

  it("stamps a summary rewritten after a note was deleted", () => {
    const prev = board({
      threads: [
        thread("t1", [frag("f1"), frag("f2")], {
          summary: "Talks about the Nintendo Switch 2.",
        }),
      ],
    });
    // f2 deleted, then the summary regenerated from what is left.
    const next = board({
      threads: [
        thread("t1", [frag("f1")], { summary: "Talks about the espresso setup." }),
      ],
    });
    const { board: stamped } = stampChanges(prev, next, 5000);
    expect(stamped.threads[0].updatedAt).toBe(5000);
  });

  it("stamps a summary-only rewrite", () => {
    const prev = board({ threads: [thread("t1", [frag("f1")], { summary: "old" })] });
    const next = board({ threads: [thread("t1", [frag("f1")], { summary: "new" })] });
    expect(stampChanges(prev, next, 5000).board.threads[0].updatedAt).toBe(5000);
  });

  it("stamps a rename and a new cover", () => {
    const prev = board({ threads: [thread("t1", [frag("f1")])] });
    const renamed = board({
      threads: [thread("t1", [frag("f1")], { name: "Renamed" })],
    });
    const covered = board({
      threads: [thread("t1", [frag("f1")], { cover: "img:abc" })],
    });
    expect(stampChanges(prev, renamed, 5000).board.threads[0].updatedAt).toBe(5000);
    expect(stampChanges(prev, covered, 5000).board.threads[0].updatedAt).toBe(5000);
  });

  it("leaves an untouched thread's stamp alone", () => {
    const same = board({ threads: [thread("t1", [frag("f1")], { summary: "s" })] });
    const copy = board({ threads: [thread("t1", [frag("f1")], { summary: "s" })] });
    expect(stampChanges(same, copy, 5000).board.threads[0].updatedAt).toBe(1000);
  });

  /* The receiving device merges its OWN board first (useBoard pulls with
     local as `a`, hub as `b`), and mergeThreads only replaces on a strictly
     newer stamp — so an unstamped change loses the tie and the stale local
     copy is what gets pushed back. These merge stale-first, which is the
     direction the bug actually took. */

  it("a regenerated summary reaches the other device", () => {
    // The phone deletes a note and re-summarises. The laptop, still holding
    // the old summary, pulls: the fresh summary must win, not its own.
    const before = board({
      threads: [
        thread("t1", [frag("f1"), frag("f2")], { summary: "mentions the deleted note" }),
      ],
    });
    const after = board({
      threads: [thread("t1", [frag("f1")], { summary: "no longer mentions it" })],
    });
    const { board: stamped, tombstones } = stampChanges(before, after, 5000);
    const laptop = { board: before, tombstones: [] as Tombstone[] };
    const merged = mergeSync(laptop, { board: stamped, tombstones }, 6000);
    expect(merged.board.threads[0].summary).toBe("no longer mentions it");
    expect(merged.board.threads[0].frags.map((f) => f.id)).toEqual(["f1"]);
  });

  it("a cover set on the phone reaches the laptop", () => {
    const before = board({ threads: [thread("t1", [frag("f1")])] });
    const after = board({
      threads: [thread("t1", [frag("f1")], { cover: "img:photo-1" })],
    });
    const { board: stamped, tombstones } = stampChanges(before, after, 5000);
    const laptop = { board: before, tombstones: [] as Tombstone[] };
    const merged = mergeSync(laptop, { board: stamped, tombstones }, 6000);
    expect(merged.board.threads[0].cover).toBe("img:photo-1");
  });
});

describe("boardSignature — what a pull compares before adopting a merge", () => {
  /* The bug this replaced: comparing only the newest timestamp. A device
     holding anything fresher than the incoming edit saw an unchanged
     maximum and discarded the merge, so the edit never arrived. */
  const maxTs = (b: Board) =>
    Math.max(
      0,
      ...b.actions.map((a) => a.updatedAt ?? a.at ?? 0),
      ...b.threads.flatMap((t) => [
        t.updatedAt ?? 0,
        ...t.frags.map((f) => f.updatedAt ?? f.at ?? 0),
      ])
    );

  it("sees an incoming edit that is older than the device's own newest item", () => {
    // The phone captured at 10:05; the Mac edited a fragment at 10:00.
    const mine = board({
      actions: [action("a1", { updatedAt: 1005 })],
      threads: [thread("t1", [frag("f1", { text: "one line", updatedAt: 900 })])],
    });
    const theirs = board({
      actions: [action("a1", { updatedAt: 1005 })],
      threads: [
        thread("t1", [frag("f1", { text: "one line\ntwo lines", updatedAt: 1000 })]),
      ],
    });
    const merged = mergeSync(
      { board: mine, tombstones: [] },
      { board: theirs, tombstones: [] },
      2000
    );
    // The merge itself is correct: the newer fragment text wins.
    expect(merged.board.threads[0].frags[0].text).toBe("one line\ntwo lines");
    // The old heuristic could not see it — both boards peak at 1005.
    expect(maxTs(merged.board)).toBe(maxTs(mine));
    // The signature does.
    expect(boardSignature(merged.board, [])).not.toBe(boardSignature(mine, []));
  });

  it("is stable when nothing changed, whatever the ordering", () => {
    const a = board({
      actions: [action("a1", { updatedAt: 100 }), action("a2", { updatedAt: 200 })],
      threads: [thread("t1", [frag("f1", { updatedAt: 50 })])],
    });
    const reordered = board({
      actions: [action("a2", { updatedAt: 200 }), action("a1", { updatedAt: 100 })],
      threads: [thread("t1", [frag("f1", { updatedAt: 50 })])],
    });
    expect(boardSignature(a, [])).toBe(boardSignature(reordered, []));
  });

  it("notices a fragment that moved thread without its timestamp changing", () => {
    const before = board({
      threads: [thread("t1", [frag("f1", { updatedAt: 100 })]), thread("t2", [])],
    });
    const after = board({
      threads: [thread("t1", []), thread("t2", [frag("f1", { updatedAt: 100 })])],
    });
    expect(boardSignature(before, [])).not.toBe(boardSignature(after, []));
  });

  it("notices a reconciled Action shot even though reconciliation preserves its timestamp", () => {
    const threads = [thread("actual-home", [frag("owner")])];
    const stale = board({
      actions: [action("image-action", {
        shot: { threadId: "obsolete-home", fragId: "owner" },
        updatedAt: 7000,
      })],
      threads,
    });
    const reconciled = reconcileActionShotHomes(stale);
    expect(reconciled.actions[0].updatedAt).toBe(7000);
    expect(boardSignature(reconciled, [])).not.toBe(boardSignature(stale, []));
  });

  it("changes only for a valid mergeSync shot repair", () => {
    const original = action("image-action", {
      shot: { threadId: "obsolete-home", fragId: "owner" },
      updatedAt: 7000,
    });
    const stale = {
      board: board({
        actions: [original],
        threads: [thread("actual-home", [frag("owner", { updatedAt: 5000 })])],
      }),
      tombstones: [] as Tombstone[],
    };
    const valid = mergeSync(stale, stale, 8000);
    expect(valid.board.actions[0].shot?.threadId).toBe("actual-home");
    expect(boardSignature(valid.board, valid.tombstones)).not.toBe(
      boardSignature(stale.board, stale.tombstones)
    );

    const ambiguous = {
      board: board({
        actions: [original],
        threads: [
          thread("one", [frag("owner", { updatedAt: 5000 })]),
          thread("two", [frag("owner", { updatedAt: 5000 })]),
        ],
      }),
      tombstones: [] as Tombstone[],
    };
    const invalid = mergeSync(ambiguous, ambiguous, 8000);
    expect(invalid.board.actions[0]).toEqual(original);
    expect(boardSignature(invalid.board, invalid.tombstones)).toBe(
      boardSignature(ambiguous.board, ambiguous.tombstones)
    );
  });

  it("notices a new tombstone", () => {
    const b = board({ actions: [action("a1", { updatedAt: 100 })] });
    expect(boardSignature(b, [])).not.toBe(
      boardSignature(b, [{ kind: "action", id: "gone", deletedAt: 500 }])
    );
  });
});

describe("starting the history over", () => {
  it("the newer epoch drops the other side's history instead of merging it", async () => {
    const { mergeBoards } = await import("./sync");
    const { EMPTY } = await import("./model");
    const entry = { id: "e1", at: 1, raw: "r", clean: "c", kind: "action", source: "typed", targetId: "" } as import("./ledger").CaptureEntry;
    const corr = { id: "c1", at: 1, proposalKind: "undone", accepted: true, context: "x", rule: "r" } as import("./ledger").CorrectionEntry;
    const local = { ...EMPTY, ledger: [entry], corrections: [corr] };
    const wiped = { ...EMPTY, historyEpoch: 5 };
    const out = mergeBoards(local, wiped);
    expect(out.ledger).toEqual([]);
    expect(out.corrections).toEqual([]);
    expect(out.historyEpoch).toBe(5);
    /* Same epoch: the union as before. */
    const again = mergeBoards({ ...local, historyEpoch: 5 }, wiped);
    expect(again.ledger).toHaveLength(1);
  });
});
