import { describe, expect, it } from "vitest";
import { EMPTY, hydrate, type Board, type CaptureEntry } from "./model";
import {
  appendCorrections,
  appendLedger,
  LEDGER_CAP,
  mergeCorrections,
  mergeLedgers,
  sourceOf,
  withCorrection,
  withLedger,
} from "./ledger";
import { applyTombstones, mergeBoards, stampChanges } from "./sync";
import { restoreBackup } from "./backup";

const entry = (id: string, at = id.length): CaptureEntry => ({
  id,
  at,
  raw: "said " + id,
  clean: "filed " + id,
  kind: "action",
  source: "typed",
  targetId: "t-" + id,
});

describe("hydrate", () => {
  it("defaults a board saved before the ledger existed to an empty ledger", () => {
    const old = { actions: [], threads: [], intentions: [], principles: [] };
    expect(hydrate(old).ledger).toEqual([]);
  });

  it("keeps a board's existing ledger", () => {
    const e = entry("a", 1);
    const b = hydrate({ ...EMPTY, ledger: [e] });
    expect(b.ledger).toEqual([e]);
  });

  it("drops malformed ledger entries", () => {
    const b = hydrate({
      ...EMPTY,
      ledger: [
        entry("ok", 2),
        {
          id: "no-at",
          raw: "x",
          clean: "y",
          kind: "action",
          source: "typed",
          targetId: "",
        } as unknown as CaptureEntry,
        null as unknown as CaptureEntry,
      ],
    });
    expect(b.ledger.map((x) => x.id)).toEqual(["ok"]);
  });
});

describe("appendLedger", () => {
  it("adds newest first", () => {
    const out = appendLedger([entry("a", 1)], entry("b", 2));
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("is idempotent by id", () => {
    const out = appendLedger([entry("a", 1)], entry("a", 1));
    expect(out).toHaveLength(1);
  });

  it("caps at the ledger cap, dropping the oldest", () => {
    let ledger: CaptureEntry[] = [];
    for (let i = 0; i < LEDGER_CAP + 10; i++) ledger = appendLedger(ledger, entry("e" + i, i));
    expect(ledger).toHaveLength(LEDGER_CAP);
    /* The ten oldest are gone; the newest survived. */
    expect(ledger.some((e) => e.id === "e0")).toBe(false);
    expect(ledger[0]?.id).toBe("e" + (LEDGER_CAP + 9));
  });
});

describe("sourceOf", () => {
  it("calls an image-only capture an image", () => {
    expect(sourceOf("", false, true)).toBe("image");
  });
  it("distinguishes dictated from typed", () => {
    expect(sourceOf("words", true, false)).toBe("dictated");
    expect(sourceOf("words", false, false)).toBe("typed");
  });
  it("prefers words over images for the source", () => {
    expect(sourceOf("words", false, true)).toBe("typed");
  });
});

describe("withLedger", () => {
  it("folds an entry into the board's ledger", () => {
    const b = withLedger(EMPTY, entry("a", 1));
    expect(b.ledger).toHaveLength(1);
    expect(b.actions).toEqual([]); // untouched
  });
});

describe("mergeLedgers", () => {
  it("unions by id — both devices' entries survive, no duplicates", () => {
    const a = [entry("a", 3), entry("b", 1)];
    const b = [entry("b", 1), entry("c", 2)];
    const out = mergeLedgers(a, b);
    expect(out.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
    expect(out.map((e) => e.id)).toEqual(["a", "c", "b"]); // newest first
  });

  it("never lets a replayed entry duplicate", () => {
    const out = mergeLedgers([entry("x", 5)], [entry("x", 5)]);
    expect(out).toHaveLength(1);
  });
});

describe("sync pass-through", () => {
  it("mergeBoards unions the ledgers", () => {
    const a: Board = { ...EMPTY, ledger: [entry("a", 2)] };
    const b: Board = { ...EMPTY, ledger: [entry("b", 1)] };
    expect(mergeBoards(a, b).ledger.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("applyTombstones leaves the ledger alone", () => {
    const b: Board = { ...EMPTY, ledger: [entry("a", 1)] };
    const tombstoned = applyTombstones(b, [
      { kind: "action", id: "a", deletedAt: Date.now() },
    ]);
    expect(tombstoned.actions).toEqual([]);
    expect(tombstoned.ledger).toHaveLength(1);
  });

  it("stampChanges passes the ledger through without stamping it", () => {
    const a: Board = { ...EMPTY, ledger: [entry("a", 1)] };
    const b: Board = {
      ...a,
      actions: [...a.actions, { id: "n", text: "new", done: false, at: 2, shelf: "keep", expires: null }],
    };
    const { board } = stampChanges(a, b);
    expect(board.ledger).toEqual([entry("a", 1)]);
    expect(board.actions[0]?.updatedAt).toBeDefined();
  });
});

describe("appendCorrections / mergeCorrections", () => {
  const correction = (id: string, at: number) => ({
    id,
    at,
    proposalKind: "related_suggestion" as const,
    accepted: true,
    context: "kept a thread out of X",
  });

  it("appends newest first, idempotent by id", () => {
    const out = appendCorrections([correction("a", 1)], correction("b", 2));
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
    const again = appendCorrections(out, correction("b", 2));
    expect(again).toHaveLength(2);
  });

  it("unions two correction ledgers by id, newest first", () => {
    const a = [correction("a", 2)];
    const b = [correction("b", 1), correction("a", 2)];
    expect(mergeCorrections(a, b).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("withCorrection folds an entry into a board's corrections", () => {
    const board: Board = { ...EMPTY, corrections: [correction("a", 1)] };
    const next = withCorrection(board, correction("b", 2));
    expect(next.corrections.map((e) => e.id)).toEqual(["b", "a"]);
    expect(board.corrections).toHaveLength(1); // original untouched
  });

  it("hydrate defaults missing corrections to [] and drops malformed ones", () => {
    const old = { actions: [], threads: [], intentions: [], principles: [] };
    expect(hydrate(old).corrections).toEqual([]);
    const out = hydrate({
      ...EMPTY,
      corrections: [
        correction("ok", 1),
        { id: "no-at", proposalKind: "rename_thread", accepted: true },
        null,
      ],
    } as unknown as Board);
    expect(out.corrections.map((c) => c.id)).toEqual(["ok"]);
  });
});

describe("restoreBackup", () => {
  it("merges the incoming ledger add-only", () => {
    const board: Board = { ...EMPTY, ledger: [entry("a", 1)] };
    const backup = {
      app: "capture",
      version: 1,
      exportedAt: new Date().toISOString(),
      board: { ...EMPTY, ledger: [entry("b", 2)] },
    };
    const { board: merged } = restoreBackup(backup, board);
    expect(merged.ledger.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });

  it("restoring the same backup twice adds nothing", () => {
    const backup = {
      app: "capture",
      version: 1,
      exportedAt: new Date().toISOString(),
      board: { ...EMPTY, ledger: [entry("x", 1)] },
    };
    const once = restoreBackup(backup, EMPTY).board;
    const twice = restoreBackup(backup, once).board;
    expect(twice.ledger).toHaveLength(1);
  });

  it("merges the incoming corrections add-only like the ledger", () => {
    const corr = {
      id: "c1",
      at: 5,
      proposalKind: "rename_thread" as const,
      accepted: true,
      context: "old name",
      correctionText: "new name",
    };
    const board: Board = { ...EMPTY, corrections: [corr] };
    const backup = {
      app: "capture",
      version: 1,
      exportedAt: new Date().toISOString(),
      board: {
        ...EMPTY,
        corrections: [{ ...corr, id: "c2", at: 6, context: "another" }],
      },
    };
    const { board: merged } = restoreBackup(backup, board);
    expect(merged.corrections.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });
});
