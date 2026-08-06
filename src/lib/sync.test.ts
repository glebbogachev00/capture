import { describe, expect, it } from "vitest";
import {
  applyTombstones,
  mergeBoards,
  mergeSync,
  mergeTombstones,
  stampChanges,
  type Tombstone,
} from "@/lib/sync";
import type { Action, Board, Frag, Thread } from "@/lib/model";
import {
  activeFoldedSources,
  foldThread,
  restoreFoldedThread,
} from "@/lib/threadFold";

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
      { board: board({}), tombstones: [{ kind: "action", id: "a1", deletedAt: 500 }] }
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
      [{ kind: "action", id: "a1", deletedAt: 300 }]
    );
    expect(merged).toEqual([{ kind: "action", id: "a1", deletedAt: 300 }]);
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
  it("keeps fragments moved out of a folded source thread", () => {
    const source = thread("source", [
      frag("early", { text: "the earlier thread's note", updatedAt: 100 }),
    ]);
    const destination = thread("destination", [
      frag("later", { text: "the destination note", updatedAt: 200 }),
    ]);
    const before = board({ threads: [source, destination] });
    const folded = board({
      threads: [
        thread("destination", [...source.frags, ...destination.frags], {
          updatedAt: 200,
        }),
      ],
    });

    const local = stampChanges(before, folded, 5_000);
    expect(local.tombstones).toContainEqual({
      kind: "thread",
      id: "source",
      deletedAt: 5_000,
    });
    expect(local.tombstones).not.toContainEqual({
      kind: "frag",
      id: "early",
      deletedAt: 5_000,
    });

    const synced = mergeSync(
      { board: local.board, tombstones: local.tombstones },
      { board: before, tombstones: [] }
    );
    expect(synced.board.threads.map((t) => t.id)).toEqual(["destination"]);
    expect(synced.board.threads[0]?.frags.map((f) => f.id)).toEqual([
      "early",
      "later",
    ]);
  });

  it("keeps fold recovery metadata through a newer stale thread edit", () => {
    const source = thread("source", [frag("from-source")], {
      name: "Earlier thread",
    });
    const destination = thread("destination", [frag("already-there")]);
    const before = board({ threads: [destination, source] });
    const folded = stampChanges(
      before,
      foldThread(before, "destination", "source", 2_000),
      2_000
    );
    const staleEdit = board({
      threads: [
        thread("destination", [frag("already-there")], {
          name: "Renamed elsewhere",
          updatedAt: 3_000,
        }),
        source,
      ],
    });

    const synced = mergeSync(
      { board: folded.board, tombstones: folded.tombstones },
      { board: staleEdit, tombstones: [] }
    );
    const result = synced.board.threads.find((t) => t.id === "destination")!;
    expect(result.name).toBe("Renamed elsewhere");
    expect(result.frags.map((f) => f.id).sort()).toEqual([
      "already-there",
      "from-source",
    ]);
    expect(activeFoldedSources(result).map((f) => f.id)).toEqual(["source"]);
    expect(synced.board.threads.some((t) => t.id === "source")).toBe(false);
  });

  it("unions concurrent folds into the same destination", () => {
    const destination = thread("destination", [frag("base")]);
    const first = thread("first", [frag("one")]);
    const second = thread("second", [frag("two")]);
    const before = board({ threads: [destination, first, second] });
    const left = stampChanges(
      before,
      foldThread(before, "destination", "first", 2_000),
      2_000
    );
    const right = stampChanges(
      before,
      foldThread(before, "destination", "second", 3_000),
      3_000
    );

    const synced = mergeSync(
      { board: left.board, tombstones: left.tombstones },
      { board: right.board, tombstones: right.tombstones }
    );
    const result = synced.board.threads.find((t) => t.id === "destination")!;
    expect(result.frags.map((f) => f.id).sort()).toEqual([
      "base",
      "one",
      "two",
    ]);
    expect(activeFoldedSources(result).map((f) => f.id).sort()).toEqual([
      "first",
      "second",
    ]);
  });

  it("syncs a restoration without resurrecting stale fold metadata", () => {
    const source = thread("source", [frag("from-source")]);
    const destination = thread("destination", [frag("base")]);
    const before = board({ threads: [destination, source] });
    const folded = stampChanges(
      before,
      foldThread(before, "destination", "source", 2_000),
      2_000
    );
    const restoredBoard = restoreFoldedThread(
      folded.board,
      "destination",
      "source",
      4_000
    );
    const restored = stampChanges(folded.board, restoredBoard, 4_000);

    const synced = mergeSync(
      {
        board: restored.board,
        tombstones: mergeTombstones(folded.tombstones, restored.tombstones),
      },
      { board: folded.board, tombstones: folded.tombstones }
    );
    const result = synced.board.threads.find((t) => t.id === "destination")!;
    const recovered = synced.board.threads.find((t) => t.id === "source")!;
    expect(activeFoldedSources(result)).toEqual([]);
    expect(result.frags.map((f) => f.id)).toEqual(["base"]);
    expect(recovered.frags.map((f) => f.id)).toEqual(["from-source"]);
  });

  it("treats a newer source edit as an implicit restoration", () => {
    const source = thread("source", [frag("from-source")]);
    const destination = thread("destination", [frag("base")]);
    const before = board({ threads: [destination, source] });
    const folded = stampChanges(
      before,
      foldThread(before, "destination", "source", 2_000),
      2_000
    );
    const editedSource = thread(
      "source",
      [frag("from-source", { text: "edited offline", updatedAt: 4_000 })],
      { updatedAt: 4_000 }
    );

    const synced = mergeSync(
      { board: folded.board, tombstones: folded.tombstones },
      { board: board({ threads: [destination, editedSource] }), tombstones: [] }
    );
    const result = synced.board.threads.find((t) => t.id === "destination")!;
    expect(synced.board.threads.some((t) => t.id === "source")).toBe(true);
    expect(activeFoldedSources(result)).toEqual([]);
    expect(result.foldedFrom?.[0]).toMatchObject({
      id: "source",
      foldedAt: 2_000,
      restoredAt: 4_000,
    });
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
