import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AFTER_DONE,
  DAY,
  EMPTY,
  GRACE,
  HOUR,
  SEED_PRINCIPLES,
  hydrate,
  left,
  nextNumber,
  sweep,
  type Action,
  type Board,
  type Intention,
} from "@/lib/model";

vi.mock("@/lib/storage", () => ({
  del: vi.fn(async () => {}),
  get: vi.fn(),
  set: vi.fn(),
}));

function action(over: Partial<Action> = {}): Action {
  return {
    id: "a",
    text: "",
    done: false,
    at: 0,
    shelf: "days",
    expires: null,
    ...over,
  };
}

function intention(over: Partial<Intention> = {}): Intention {
  return {
    id: "i",
    number: 1,
    rawInput: "",
    expandedIntention: "",
    recommendedActions: [],
    counterIntentions: [],
    at: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("hydrate", () => {
  it("fills defaults for boards missing intentions/principles", () => {
    const empty = hydrate({ actions: [], threads: [] });
    expect(empty.intentions).toEqual([]);
    expect(empty.principles).toEqual(SEED_PRINCIPLES);
    expect(empty.actions).toEqual([]);
    expect(empty.threads).toEqual([]);
  });

  it("returns defaults for null/undefined", () => {
    const h = hydrate(null);
    expect(h.actions).toEqual([]);
    expect(h.intentions).toEqual([]);
    expect(h.principles).toEqual(SEED_PRINCIPLES);
  });

  it("keeps supplied principles when present", () => {
    const h = hydrate({ principles: [{ id: "x" } as never] });
    expect(h.principles).toHaveLength(1);
  });

  it("migrates legacy unsorted actions and fragments into lossless retryable envelopes", () => {
    const raw: Partial<Board> = {
      ...({} as Board),
      actions: [action({
        id: "legacy-action",
        text: "Action copy",
        src: "Exact action source",
        at: 11,
        imgs: ["action-photo"],
        unsorted: true,
      })],
      threads: [{
        id: "legacy-thread",
        name: "Chosen home",
        summary: "",
        frags: [{
          id: "legacy-frag",
          text: "Exact fragment source",
          at: 12,
          imgs: ["frag-photo"],
          unsorted: true,
        }],
      }],
      ledger: [
        {
          id: "old-action-row",
          captureId: "action-capture",
          at: 11,
          raw: "Exact action source",
          clean: "Action copy",
          kind: "action",
          source: "typed",
          targetId: "legacy-action",
          imgs: ["action-photo"],
        },
        {
          id: "old-frag-row",
          captureId: "frag-capture",
          at: 12,
          raw: "Exact fragment source",
          clean: "Exact fragment source",
          kind: "thread",
          source: "typed",
          targetId: "legacy-thread",
          targetFragId: "legacy-frag",
          imgs: ["frag-photo"],
        },
      ],
    };

    const migrated = hydrate(raw);
    expect(migrated.threads[0].frags).toEqual([]);
    expect(migrated.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "legacy-action",
        text: "Action copy",
        src: "Exact action source",
        imgs: ["action-photo"],
        unsorted: true,
      }),
      expect.objectContaining({
        text: "Exact fragment source",
        src: "Exact fragment source",
        imgs: ["frag-photo"],
        unsorted: true,
        threadId: "legacy-thread",
      }),
    ]));
    const actionEnvelope = migrated.actions.find((item) => item.id === "legacy-action")!;
    const fragEnvelope = migrated.actions.find((item) => item.threadId === "legacy-thread")!;
    expect(migrated.ledger.find((entry) => entry.id === "old-action-row")).toMatchObject({
      kind: "pending",
      targetId: actionEnvelope.id,
      captureId: "action-capture",
      raw: "Exact action source",
      imgs: ["action-photo"],
    });
    expect(migrated.ledger.find((entry) => entry.id === "old-frag-row")).toMatchObject({
      kind: "pending",
      targetId: fragEnvelope.id,
      captureId: "frag-capture",
      raw: "Exact fragment source",
      imgs: ["frag-photo"],
    });
    expect(migrated.ledger.find((entry) => entry.id === "old-frag-row")?.targetFragId)
      .toBeUndefined();
    expect(hydrate(migrated)).toEqual(migrated);
  });

  it("synthesizes retry history when a legacy unsorted item has no ledger row", () => {
    const migrated = hydrate({
      ...EMPTY,
      actions: [action({ id: "orphan", text: "Preserve me", unsorted: true, imgs: ["photo"] })],
      ledger: [],
    });

    expect(migrated.ledger).toContainEqual(expect.objectContaining({
      kind: "pending",
      targetId: "orphan",
      raw: "Preserve me",
      clean: "Preserve me",
      imgs: ["photo"],
    }));
  });
});

describe("sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fades expired actions, setting faded and fadedAt, and counts them", async () => {
    const now = Date.parse("2026-01-10T00:00:00.000Z");
    vi.setSystemTime(now);

    const expired = action({ id: "x", expires: now - 1 });
    const fresh = action({ id: "y", expires: now + DAY });
    const data = board([expired, fresh]);

    const { next, faded, cleared } = await sweep(data);
    expect(faded).toBe(1);
    expect(cleared).toBe(0);
    expect(next.actions).toHaveLength(2);
    const fadedAction = next.actions.find((a) => a.id === "x");
    expect(fadedAction?.faded).toBe(true);
    expect(fadedAction?.fadedAt).toBe(now);
    const kept = next.actions.find((a) => a.id === "y");
    expect(kept?.faded).toBeUndefined();
  });

  it("clears legacy done actions a week after they were completed", async () => {
    const now = Date.parse("2026-01-10T00:00:00.000Z");
    vi.setSystemTime(now);

    const staleDone = action({
      id: "d",
      done: true,
      doneAt: now - AFTER_DONE - 1,
      imgs: ["img1"],
    });
    const recentDone = action({ id: "r", done: true, doneAt: now - 1 });

    const { next, faded, cleared } = await sweep(board([staleDone, recentDone]));
    expect(cleared).toBe(1);
    expect(faded).toBe(0);
    expect(next.actions.map((a) => a.id)).toEqual(["r"]);
  });

  it("clears faded actions past grace and counts them", async () => {
    const now = Date.parse("2026-01-10T00:00:00.000Z");
    vi.setSystemTime(now);

    const staleFaded = action({
      id: "f",
      faded: true,
      fadedAt: now - GRACE - 1,
    });
    const recentFaded = action({ id: "n", faded: true, fadedAt: now - 1 });

    const { next, cleared } = await sweep(board([staleFaded, recentFaded]));
    expect(cleared).toBe(1);
    expect(next.actions.map((a) => a.id)).toEqual(["n"]);
  });

  it("keeps keep-forever and unexpired actions untouched", async () => {
    const now = Date.parse("2026-01-10T00:00:00.000Z");
    vi.setSystemTime(now);
    const keep = action({ id: "k", shelf: "keep", expires: null });
    const { next, faded, cleared } = await sweep(board([keep]));
    expect(next.actions).toHaveLength(1);
    expect(faded).toBe(0);
    expect(cleared).toBe(0);
  });
});

describe("nextNumber", () => {
  it("returns max number + 1", () => {
    expect(
      nextNumber([
        intention({ number: 3 }),
        intention({ number: 0 }),
        intention({ number: 7 }),
      ])
    ).toBe(8);
  });

  it("returns 1 for an empty list", () => {
    expect(nextNumber([])).toBe(1);
  });
});

describe("left", () => {
  it("formats now when non-positive", () => {
    expect(left(0)).toBe("now");
    expect(left(-5)).toBe("now");
  });

  it("formats days with ceil", () => {
    expect(left(DAY)).toBe("1d");
    expect(left(DAY * 2 + 1)).toBe("3d");
  });

  it("formats hours with a 1h minimum", () => {
    expect(left(HOUR)).toBe("1h");
    expect(left(HOUR * 3)).toBe("3h");
    expect(left(1)).toBe("1h");
    expect(left(HOUR * 23)).toBe("23h");
  });
});

function board(actions: Action[]): Board {
  return {
    actions,
    threads: [],
    intentions: [],
    principles: [],
    ledger: [],
    corrections: [],
  };
}
