import { describe, expect, it } from "vitest";
import { BACKUP_APP, restoreBackup } from "@/lib/backup";
import type { Board } from "@/lib/model";

function board(over: Partial<Board> = {}): Board {
  return {
    actions: [],
    threads: [],
    intentions: [],
    principles: [],
    ledger: [],
    corrections: [],
    ...over,
  };
}

function backup(boardData: Partial<Board>) {
  return {
    app: BACKUP_APP,
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    board: board(boardData),
  };
}

describe("restoreBackup", () => {
  it("rejects files that are not a capture backup (app/board mismatch)", () => {
    expect(() => restoreBackup({ app: "other-app", board: board({}) }, board({}))).toThrow(
      "isn't a capture backup"
    );
    expect(() => restoreBackup({ board: board({}) }, board({}))).toThrow(
      "isn't a capture backup"
    );
    expect(() => restoreBackup({ app: BACKUP_APP }, board({}))).toThrow(
      "isn't a capture backup"
    );
    expect(() => restoreBackup(null, board({}))).toThrow("isn't a capture backup");
  });

  it("adds new actions, threads, intentions, and principles", () => {
    const existing = board({
      actions: [{ id: "a1" } as never],
      threads: [{ id: "t1" } as never],
      intentions: [{ id: "i1", at: 0 } as never],
      principles: [{ id: "p1", name: "Existing" } as never],
    });

    const incoming = backup({
      actions: [{ id: "a2" } as never],
      threads: [{ id: "t2" } as never],
      intentions: [{ id: "i2", at: 10 } as never],
      principles: [{ id: "p2", name: "New" } as never],
    });

    const r = restoreBackup(incoming, existing);
    expect(r.actions).toBe(1);
    expect(r.threads).toBe(1);
    expect(r.intentions).toBe(1);
    expect(r.principles).toBe(1);
    expect(r.board.actions.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(r.board.threads.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(r.board.intentions.map((i) => i.id)).toEqual(["i2", "i1"]);
    expect(r.board.principles.map((p) => p.name)).toEqual(["Existing", "New"]);
  });

  it("skips incoming duplicates by id (existing always wins)", () => {
    const existing = board({
      actions: [{ id: "a1", text: "original" } as never],
      threads: [{ id: "t1", name: "original" } as never],
      intentions: [{ id: "i1", at: 5, expandedIntention: "original" } as never],
      principles: [{ id: "p1", name: "Shared" } as never],
    });

    const incoming = backup({
      actions: [{ id: "a1", text: "new" } as never],
      threads: [{ id: "t1", name: "new" } as never],
      intentions: [{ id: "i1", at: 99, expandedIntention: "new" } as never],
      principles: [{ id: "p2", name: "Shared" } as never],
    });

    const r = restoreBackup(incoming, existing);
    expect(r.board.actions).toHaveLength(1);
    expect(r.board.actions[0].text).toBe("original");
    expect(r.board.threads).toHaveLength(1);
    expect(r.board.threads[0].name).toBe("original");
    expect(r.board.intentions).toHaveLength(1);
    expect(r.board.intentions[0].expandedIntention).toBe("original");
    // Principles match by name, so "Shared" is not duplicated.
    expect(r.board.principles).toHaveLength(1);
    expect(r.principles).toBe(0);
  });

  it("principles match by name, not id", () => {
    const existing = board({
      principles: [{ id: "x", name: "Simplify" } as never],
    });
    const incoming = backup({
      principles: [{ id: "different-id", name: "Simplify" } as never],
    });
    const r = restoreBackup(incoming, existing);
    expect(r.board.principles).toHaveLength(1);
    expect(r.principles).toBe(0);
  });

  it("skips malformed records missing an id", () => {
    const existing = board({
      actions: [{ id: "a1" } as never],
      threads: [{ id: "t1" } as never],
      intentions: [{ id: "i1" } as never],
    });
    const incoming = backup({
      actions: [{} as never, { text: "no id" } as never],
      threads: [{} as never],
      intentions: [{ text: "no id" } as never],
      principles: [{ id: "p", name: "x" } as never],
    });
    const r = restoreBackup(incoming, existing);
    expect(r.actions).toBe(0);
    expect(r.threads).toBe(0);
    expect(r.intentions).toBe(0);
  });

  it("returns zero counts when there is nothing new", () => {
    const existing = board({ principles: [{ id: "x", name: "Real" } as never] });
    const r = restoreBackup(backup({}), existing);
    expect(r).toMatchObject({ actions: 0, threads: 0, intentions: 0 });
    expect(r.board.actions).toEqual([]);
  });
});
