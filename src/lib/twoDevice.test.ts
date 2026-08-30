import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubStore, StoredValue, WriteExpectation } from "./hubStore";

/**
 * Two devices, one hub — the whole sync story as one test file.
 *
 * Every layer here is the REAL code: the client's stampChanges before a
 * push, the hub's merge (syncStore), and the client's adoption of the
 * reply (adopt). Only the disk is fake. This is the test the commit
 * history kept promising: unit suites covered each layer alone, the
 * deployed gate covers the hub-down path, and nothing anywhere proved that
 * a phone and a laptop actually CONVERGE — the one property sync exists
 * to provide.
 */

const docs = new Map<string, { body: string; version: number }>();

function memoryStore(): HubStore {
  return {
    async exists(key: string) {
      return docs.has(key);
    },
    async read(key): Promise<StoredValue | null> {
      const doc = docs.get(key);
      return doc ? { body: doc.body, version: String(doc.version) } : null;
    },
    async write(key, body, expect?: WriteExpectation) {
      const cur = docs.get(key);
      if (expect) {
        const want = expect.version === null ? undefined : Number(expect.version);
        if ((cur?.version ?? undefined) !== want) return false;
      }
      const version = (cur?.version ?? 0) + 1;
      docs.set(key, { body, version });
      return { version: String(version) };
    },
  };
}

vi.mock("./hubStore", async (importOriginal) => {
  const mod = (await importOriginal()) as object;
  const store = memoryStore();
  return { ...mod, hubStore: () => store };
});

const { getSync, pushSync, _forgetHub } = await import("./syncStore");
const { adoptHubState } = await import("./adopt");
const { stampChanges } = await import("./sync");
const { EMPTY } = await import("./model");
import type { Board } from "./model";
import type { SyncState, Tombstone } from "./sync";

/** A device: its board, its tombstones, and the client-side motions of a
    push (stamp, send, adopt the reply) and a pull (fetch, adopt). */
function device() {
  const d = {
    board: { ...EMPTY } as Board,
    tombstones: [] as Tombstone[],
    async push() {
      const reply = await pushSync({ board: d.board, tombstones: d.tombstones });
      const a = adoptHubState(
        { board: d.board, tombstones: d.tombstones },
        { board: reply.board, tombstones: reply.tombstones }
      );
      d.board = a.board;
      d.tombstones = a.tombstones;
    },
    async pull() {
      const remote = (await getSync()) as SyncState;
      const a = adoptHubState(
        { board: d.board, tombstones: d.tombstones },
        { board: remote.board, tombstones: remote.tombstones ?? [] }
      );
      d.board = a.board;
      d.tombstones = a.tombstones;
      return a;
    },
    /** A local edit, stamped the way commit() stamps before pushing. */
    edit(mutate: (b: Board) => Board) {
      const next = mutate(d.board);
      const stamped = stampChanges(d.board, next, Date.now());
      d.board = stamped.board;
      d.tombstones = [...d.tombstones, ...stamped.tombstones];
    },
  };
  return d;
}

const act = (id: string, text: string) =>
  ({ id, text, done: false, at: Date.now(), updatedAt: Date.now() }) as never;

beforeEach(() => {
  /* Both memories: the hub module's cache AND the fake disk — a document
     surviving between tests is not a finding, it is leakage. */
  _forgetHub();
  docs.clear();
});

describe("a phone and a laptop, converging", () => {
  it("a capture on one device arrives on the other", async () => {
    const phone = device();
    const laptop = device();
    phone.edit((b) => ({ ...b, actions: [act("a1", "Order the flowers")] }));
    await phone.push();
    const out = await laptop.pull();
    expect(laptop.board.actions.map((a) => a.id)).toContain("a1");
    expect(out.note).toBeTruthy();
  });

  it("both devices edit different things: nothing is lost, both converge", async () => {
    const phone = device();
    const laptop = device();
    phone.edit((b) => ({ ...b, actions: [act("p1", "Prepare the class")] }));
    laptop.edit((b) => ({ ...b, actions: [act("l1", "Send the invoice")] }));
    await phone.push();
    await laptop.push();
    await phone.pull();
    const ids = (b: Board) => b.actions.map((a) => a.id).sort();
    expect(ids(phone.board)).toEqual(["l1", "p1"]);
    expect(ids(laptop.board)).toEqual(["l1", "p1"]);
  });

  it("a tick on the phone deletes on the laptop too — and stays deleted", async () => {
    const phone = device();
    const laptop = device();
    phone.edit((b) => ({ ...b, actions: [act("a1", "Book the dentist")] }));
    await phone.push();
    await laptop.pull();
    /* Tick on the phone: the action goes, a tombstone marks the grave. */
    phone.edit((b) => ({ ...b, actions: [] }));
    await phone.push();
    await laptop.pull();
    expect(laptop.board.actions).toHaveLength(0);
    /* The laptop pushing its (older) state must not resurrect the dead. */
    await laptop.push();
    const check = device();
    await check.pull();
    expect(check.board.actions).toHaveLength(0);
  });

  it("an edit made while the other device's push lands is kept", async () => {
    const phone = device();
    const laptop = device();
    phone.edit((b) => ({ ...b, actions: [act("a1", "old wording")] }));
    await phone.push();
    await laptop.pull();
    /* Phone edits and pushes; laptop edits the SAME action later (newer). */
    phone.edit((b) => ({
      ...b,
      actions: [{ ...b.actions[0], text: "phone wording", updatedAt: Date.now() } as never],
    }));
    await phone.push();
    await new Promise((r) => setTimeout(r, 5));
    laptop.edit((b) => ({
      ...b,
      actions: [{ ...b.actions[0], text: "laptop wording, newer", updatedAt: Date.now() } as never],
    }));
    await laptop.push();
    await phone.pull();
    expect(phone.board.actions[0].text).toBe("laptop wording, newer");
    expect(laptop.board.actions[0].text).toBe("laptop wording, newer");
  });

  it("wraps and completions survive the round trip", async () => {
    const phone = device();
    const laptop = device();
    phone.edit((b) => ({
      ...b,
      wraps: [{ day: "2026-08-30", at: 1, stats: {}, line: "a day of fixes" }] as never,
      completions: [{ id: "c1", text: "done thing", at: 2 }] as never,
    }));
    await phone.push();
    await laptop.pull();
    expect(laptop.board.wraps).toHaveLength(1);
    expect(laptop.board.completions).toHaveLength(1);
  });
});
