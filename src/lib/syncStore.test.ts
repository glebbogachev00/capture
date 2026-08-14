import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubStore, StoredValue, WriteExpectation } from "./hubStore";

/**
 * The hub's concurrency, tested against a fake store.
 *
 * Two things have to hold on a serverless host, and neither was true before:
 * a push that cannot be stored must FAIL rather than quietly live in one
 * instance's memory, and two instances merging at once must not overwrite
 * each other. The fake store below is the only way to stage that second
 * case — a real disk is one machine and never races with itself.
 */

/** A store that can be made to lose a race a set number of times. */
function fakeStore() {
  const docs = new Map<string, { body: string; version: number }>();
  /* Writes that will be rejected as stale before one is allowed through —
     standing in for another instance getting there first. */
  let loseNext = 0;
  /* What the interloper wrote, applied on the losing write. */
  let interloper: string | null = null;

  const store: HubStore = {
    async read(key): Promise<StoredValue | null> {
      const doc = docs.get(key);
      return doc ? { body: doc.body, version: String(doc.version) } : null;
    },
    async write(key, body, expect?: WriteExpectation) {
      if (loseNext > 0) {
        loseNext--;
        /* The winner's write lands instead of ours, bumping the version. */
        const cur = docs.get(key);
        docs.set(key, {
          body: interloper ?? cur?.body ?? body,
          version: (cur?.version ?? 0) + 1,
        });
        return false;
      }
      const cur = docs.get(key);
      if (expect) {
        const seen = cur ? String(cur.version) : null;
        if (expect.version !== seen) return false;
      }
      docs.set(key, { body, version: (cur?.version ?? 0) + 1 });
      return true;
    },
    async exists(key) {
      return docs.has(key);
    },
  };

  return {
    store,
    docs,
    lose(times: number, wrote?: string) {
      loseNext = times;
      interloper = wrote ?? null;
    },
  };
}

const fake = fakeStore();

vi.mock("./hubStore", () => ({
  hubStore: () => fake.store,
  usingBlob: () => false,
}));

const { getSync, pushSync } = await import("./syncStore");

/* Ids derive from the name: two boards naming different threads must be two
   different threads, or the merge rightly collapses them into one. */
const board = (threadNames: string[]) => ({
  actions: [],
  threads: threadNames.map((name) => ({
    id: "t-" + name.toLowerCase(),
    name,
    summary: "",
    frags: [],
    updatedAt: 1000,
  })),
  intentions: [],
  principles: [],
  ledger: [],
  corrections: [],
});

describe("syncStore", () => {
  beforeEach(() => {
    fake.docs.clear();
    fake.lose(0);
  });

  it("an empty hub reads as an empty board, not an error", async () => {
    const out = await getSync();
    expect(out.rev).toBe(0);
    expect(out.board.threads).toEqual([]);
  });

  it("a push is stored and comes back on the next pull", async () => {
    await pushSync({ board: board(["Espresso"]), tombstones: [] });
    const out = await getSync();
    expect(out.board.threads.map((t) => t.name)).toEqual(["Espresso"]);
    expect(out.rev).toBe(1);
  });

  it("a push that loses the race re-merges on top of the winner", async () => {
    // Another instance stored a board holding "Marathon" first. Ours must
    // not overwrite it — both threads have to survive.
    const winner = JSON.stringify({
      rev: 7,
      board: board(["Marathon"]),
      tombstones: [],
    });
    fake.lose(1, winner);
    const out = await pushSync({ board: board(["Espresso"]), tombstones: [] });
    expect(out.board.threads.map((t) => t.name).sort()).toEqual([
      "Espresso",
      "Marathon",
    ]);
  });

  it("gives up loudly rather than pretending a push landed", async () => {
    // The old hub set its in-memory copy before the write it never made, so
    // a host with nowhere to write still looked healthy. It must throw.
    fake.lose(99);
    await expect(
      pushSync({ board: board(["Espresso"]), tombstones: [] })
    ).rejects.toThrow();
  });

  it("a write that throws is not reported as success", async () => {
    const boom = vi
      .spyOn(fake.store, "write")
      .mockRejectedValueOnce(new Error("read-only file system"));
    await expect(
      pushSync({ board: board(["Espresso"]), tombstones: [] })
    ).rejects.toThrow();
    boom.mockRestore();
  });
});
