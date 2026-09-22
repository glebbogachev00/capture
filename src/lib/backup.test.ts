import { describe, expect, it } from "vitest";
import {
  BACKUP_APP,
  buildBackup,
  parseBackupV3,
  restoreBackup,
} from "@/lib/backup";
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

function backupV2(
  boardData: Partial<Board>,
  images: Record<string, string> = {}
) {
  return {
    app: BACKUP_APP,
    version: 2,
    exportedAt: "2026-01-01T00:00:00.000Z",
    board: board(boardData),
    images,
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
    expect(() => restoreBackup({ ...backup({}), version: 4 }, board({}))).toThrow(
      "version is not supported"
    );
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

  it("marks newly restored history so it cannot spend the local daily allowance", () => {
    const incoming = backup({
      ledger: [
        {
          id: "remote-ledger",
          at: Date.now(),
          raw: "captured elsewhere",
          clean: "Captured elsewhere",
          kind: "action",
          source: "typed",
          targetId: "a1",
        } as never,
      ],
    });
    const r = restoreBackup(incoming, board({}));
    expect(r.board.ledger![0].restored).toBe(true);
  });

  it("v2 carries the images through a restore", () => {
    const incoming = backupV2(
      { actions: [{ id: "a1", imgs: ["img-1"] } as never] },
      { "img-1": "data:image/webp;base64,AAAA" }
    );
    const r = restoreBackup(incoming, board({}));
    expect(r.actions).toBe(1);
    expect(r.images).toEqual({ "img-1": "data:image/webp;base64,AAAA" });
  });

  it("v1 backups restore without images (undefined, not an error)", () => {
    const r = restoreBackup(
      backup({ actions: [{ id: "a1" } as never] }),
      board({})
    );
    expect(r.actions).toBe(1);
    expect(r.images).toBeUndefined();
  });

  it("buildBackup emits v3 with complete media and tombstone metadata", () => {
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
    const deleted = [{ kind: "action" as const, id: "gone", deletedAt: 10 }];
    const b = buildBackup(
      board({ actions: [{ id: "a", imgs: ["img-9"] } as never] }),
      { "img-9": image },
      deleted,
      { kind: "cloud", ownerId: "owner" }
    );
    expect(b.version).toBe(3);
    expect(b.complete).toBe(true);
    expect(b.scope).toEqual({ kind: "cloud", ownerId: "owner" });
    expect(b.tombstones).toEqual(deleted);
    expect(b.images).toEqual({ "img-9": image });
  });

  it.each([
    ["action", { actions: [{ id: "a", imgs: ["../bad"] } as never] }],
    ["intention", { intentions: [{ id: "i", imgs: ["bad.id"] } as never] }],
    ["pending ledger", { ledger: [{ id: "l", kind: "pending", imgs: ["bad id"] } as never] }],
    ["fragment", { threads: [{ id: "t", frags: [{ id: "f", imgs: ["a/b"] }] } as never] }],
    ["cover", { threads: [{ id: "t", frags: [], cover: "img:.." } as never] }],
    ["profile", { profile: { name: "Owner", imageId: "x".repeat(65) } }],
  ])("strict v3 rejects a noncanonical %s image reference", (_kind, partial) => {
    const payload = {
      app: BACKUP_APP,
      version: 3,
      exportedAt: "2026-01-01T00:00:00.000Z",
      board: board(partial as Partial<Board>),
      images: {},
      scope: { kind: "local" as const },
      tombstones: [],
      complete: true as const,
    };
    expect(() => parseBackupV3(payload)).toThrow(/noncanonical|image id/i);
  });
});

describe("a backup carries thread covers", () => {
  /* It did not. exportBoard walked actions and fragments and forgot
     `thread.cover`, so 8 of the 26 image references in a real 2026-08-27
     export had no bytes behind them — and all 8 were covers. Restore that
     file and every cover is gone. The sync path had already been fixed for
     this exact case; the export had its own copy of the walk. */
  it("counts a cover as a referenced image", async () => {
    const { referencedImageIds } = await import("./imgSync");
    const board = {
      actions: [],
      threads: [
        {
          id: "t1",
          name: "Design language creation",
          summary: "",
          cover: "img:cover-1",
          frags: [{ id: "f1", at: 1, text: "a note", imgs: ["frag-1"] }],
        },
      ],
      intentions: [],
      principles: [],
      ledger: [],
      corrections: [],
    };
    const ids = referencedImageIds(board as never);
    expect(ids).toContain("frag-1");
    expect(ids).toContain("cover-1");
  });
});
