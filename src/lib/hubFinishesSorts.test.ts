import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY, type Board } from "./model";
import { mergeSync, type SyncState } from "./sync";
import { settleSimpleSort } from "./simpleSortSettlement";

/* The hub, in memory: reads hand back a copy, pushes merge like the real one. */
const hub = vi.hoisted(() => ({ state: null as unknown as SyncState & { rev: number } }));
vi.mock("./syncStore", () => ({
  getSync: async () => structuredClone(hub.state),
  pushSync: async (client: SyncState) => {
    const merged = mergeSync(hub.state, client);
    hub.state = { ...merged, rev: hub.state.rev + 1 };
    return structuredClone(hub.state);
  },
}));

const MINUTE = 60_000;
const NOW = Date.parse("2026-10-19T10:03:00Z");
const raw = "Another article idea: how founders can use Retake to make money. Potentially a viral video there.";
const pendingCapture = (id: string, at: number, extra: { imgs?: string[]; force?: "intention"; source?: "typed" | "dictated" | "image" } = {}) => ({
  action: { id: `envelope-${id}`, text: raw, src: raw, done: false, at, updatedAt: at, unsorted: true, shelf: "keep", expires: null,
    imgs: extra.imgs ?? [], pendingRevision: 1, ...(extra.force ? { pendingForce: extra.force } : {}) },
  entry: { id: `pending-${id}`, captureId: id, at, raw, clean: raw, kind: "pending", source: extra.source ?? "dictated",
    targetId: `envelope-${id}`, pendingRevision: 1, pendingSource: raw, ...(extra.imgs ? { imgs: extra.imgs } : {}) },
});
const boardWith = (...captures: ReturnType<typeof pendingCapture>[]): Board => ({
  ...EMPTY,
  threads: [{ id: "writing", name: "Writing", summary: "", frags: [] }],
  actions: captures.map((capture) => capture.action),
  ledger: captures.map((capture) => capture.entry),
} as Board);
const sortAnswer = { sort: { items: [{ kind: "thought", text: raw, threads: [{ id: "writing" }] }] }, via: "cerebras" };

async function load() {
  vi.resetModules();
  return import("./hubFinishesSorts.server");
}

beforeEach(() => { hub.state = { board: boardWith(), tombstones: [], rev: 1 }; });

describe("the hub finishing an abandoned sort", () => {
  it("looks only at text captures left unsorted for a while, and less than a day", async () => {
    const { abandonedSorts } = await load();
    const board = boardWith(
      pendingCapture("abandoned", NOW - 3 * MINUTE),
      pendingCapture("still-sorting", NOW - 30_000),
      pendingCapture("photo", NOW - 3 * MINUTE, { imgs: ["img1"] }),
      pendingCapture("intention", NOW - 3 * MINUTE, { force: "intention" }),
      pendingCapture("yesterday", NOW - 25 * 60 * MINUTE),
    );
    expect(abandonedSorts(board, NOW).map((snapshot) => snapshot.captureId)).toEqual(["abandoned"]);
  });

  it("sorts it with the device's own request and settles it on the hub", async () => {
    const { finishAbandonedSorts } = await load();
    hub.state.board = boardWith(pendingCapture("cap", NOW - 3 * MINUTE));
    const sort = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(sortAnswer));
    await finishAbandonedSorts(sort, () => NOW);
    expect(String(sort.mock.calls[0][0])).toBe("/api/sort");
    expect(JSON.parse(String(sort.mock.calls[0][1]?.body))).toMatchObject({ raw, captureId: "cap", sortVersion: 2 });
    const { board, tombstones } = hub.state;
    expect(board.threads[0].frags.map((frag) => frag.text)).toEqual([raw]);
    expect(board.ledger.some((entry) => entry.captureId === "cap" && entry.kind === "thread")).toBe(true);
    expect(tombstones.map((tombstone) => tombstone.id)).toContain("envelope-cap");
  });

  it("stands down when the device finished it meanwhile, so it never lands twice", async () => {
    const { finishAbandonedSorts } = await load();
    hub.state.board = boardWith(pendingCapture("cap", NOW - 3 * MINUTE));
    const sort = vi.fn(async () => {
      /* The phone wakes and settles while the hub's sort is running. */
      const settled = settleSimpleSort(hub.state.board, { captureId: "cap", revision: 1, now: NOW, items: sortAnswer.sort.items as never });
      if (settled.status !== "applied") throw new Error("phone could not settle");
      hub.state = { board: settled.board, tombstones: [...hub.state.tombstones, ...settled.tombstones], rev: hub.state.rev + 1 };
      return Response.json(sortAnswer);
    });
    await finishAbandonedSorts(sort, () => NOW);
    expect(hub.state.board.threads[0].frags).toHaveLength(1);
    expect(hub.state.rev).toBe(2);
  });

  it("gives up on a capture after two failed tries, leaving it to the person", async () => {
    const { finishAbandonedSorts } = await load();
    hub.state.board = boardWith(pendingCapture("cap", NOW - 3 * MINUTE));
    const sort = vi.fn(async () => Response.json({ error: "provider down" }, { status: 502 }));
    for (let pass = 0; pass < 4; pass++) await finishAbandonedSorts(sort, () => NOW);
    expect(sort).toHaveBeenCalledTimes(2);
    expect(hub.state.board.ledger.map((entry) => entry.kind)).toEqual(["pending"]);
  });
});
