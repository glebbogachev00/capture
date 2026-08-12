import { describe, expect, it } from "vitest";
import {
  applyTombstones,
  mergeBoards,
  mergeSync,
  mergeTombstones,
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
