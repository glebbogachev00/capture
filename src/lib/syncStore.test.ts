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

const { getSync, pushSync, _forgetHub, FRESH_MS } = await import("./syncStore");

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


describe("syncStore — a pull does not cost a store read", () => {
  /* Why this matters: the blob store got suspended. Two devices polling
     every ten seconds, each poll a full document download, was ~17,000
     reads a day for a board that had not changed. */
  let reads = 0;
  const realRead = fake.store.read;

  beforeEach(() => {
    fake.docs.clear();
    fake.lose(0);
    _forgetHub();
    reads = 0;
    fake.store.read = async (key) => {
      reads++;
      return realRead(key);
    };
  });

  it("answers repeated pulls from memory while fresh", async () => {
    await pushSync({ board: board(["A"]), tombstones: [] });
    /* Real clock: the push stamped memory with Date.now(). */
    const t0 = Date.now();
    await getSync(t0);
    await getSync(t0 + 10_000);
    await getSync(t0 + 20_000);
    /* The push's own read is the only one. The pushed state is served
       from memory because the store confirmed the write. */
    expect(reads).toBe(1);
  });

  it("asks the store again once memory is stale", async () => {
    await pushSync({ board: board(["A"]), tombstones: [] });
    const t0 = Date.now();
    await getSync(t0);
    await getSync(t0 + FRESH_MS + 1);
    expect(reads).toBe(2);
  });

  it("a push always reads, because compare-and-swap needs the live version", async () => {
    await pushSync({ board: board(["A"]), tombstones: [] });
    await pushSync({ board: board(["B"]), tombstones: [] });
    /* Two pushes, two reads — memory holds no version after a write, and
       a guess must never back a conditional write. */
    expect(reads).toBe(2);
  });

  it("serves what another instance would see: the merged result, not the request", async () => {
    await pushSync({ board: board(["A"]), tombstones: [] });
    const out = await pushSync({ board: board(["B"]), tombstones: [] });
    const pulled = await getSync(Date.now());
    expect(pulled.rev).toBe(out.rev);
    expect(pulled.board.threads.map((t) => t.name).sort()).toEqual(["A", "B"]);
  });

  it("forgets everything when the store refuses a write", async () => {
    await pushSync({ board: board(["A"]), tombstones: [] });
    const realWrite = fake.store.write;
    fake.store.write = async () => {
      throw new Error("This store has been suspended.");
    };
    await expect(
      pushSync({ board: board(["B"]), tombstones: [] })
    ).rejects.toThrow("suspended");
    fake.store.write = realWrite;
    /* The next pull must ask the store, not repeat a memory that may no
       longer be true. */
    const before = reads;
    await getSync(Date.now());
    expect(reads).toBe(before + 1);
  });
});
