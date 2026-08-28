import { describe, it, expect } from "vitest";
import { dayKey, dayStats, wrapDue, mergeWraps, pendingWrap, type DayWrap } from "./wrap";
import type { Board } from "./model";
import type { CaptureEntry } from "./ledger";

const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`).getTime();

function entry(p: Partial<CaptureEntry> & { at: number }): CaptureEntry {
  return { id: "e" + p.at, raw: "x", clean: "x", kind: "thread", source: "typed", targetId: "t1", ...p } as CaptureEntry;
}
function board(ledger: CaptureEntry[], threads = [{ id: "t1", name: "Bugs" }, { id: "t2", name: "Retake" }]): Board {
  return { actions: [], threads: threads as Board["threads"], intentions: [], principles: [], ledger, corrections: [] };
}

describe("dayKey", () => {
  it("uses the local day, so a late-night capture stays on its own day", () => {
    expect(dayKey(at("2026-08-26", 23, 29))).toBe("2026-08-26");
  });
});

describe("dayStats", () => {
  it("returns null for a day too thin to say anything about", () => {
    const b = board([entry({ at: at("2026-08-26", 10) }), entry({ at: at("2026-08-26", 11) })]);
    expect(dayStats(b, "2026-08-26")).toBeNull();
  });

  it("counts the day and ranks its threads", () => {
    const b = board([
      entry({ at: at("2026-08-26", 10), targetId: "t1" }),
      entry({ at: at("2026-08-26", 14), targetId: "t1" }),
      entry({ at: at("2026-08-26", 19), targetId: "t2" }),
      entry({ at: at("2026-08-26", 21), kind: "action", targetId: "a1" }),
      entry({ at: at("2026-08-26", 23), kind: "intention", targetId: "i1" }),
    ]);
    const s = dayStats(b, "2026-08-26")!;
    expect(s.said).toBe(5);
    expect(s.threads[0]).toEqual({ name: "Bugs", n: 2 });
    expect(s.threadsMoved).toBe(2);
    expect(s.actionsMade).toBe(1);
    expect(s.intentions).toBe(1);
    expect(s.firstAt).toBe(at("2026-08-26", 10));
    expect(s.lastAt).toBe(at("2026-08-26", 23));
  });

  it("leaves undone captures out — the record stands, the count does not", () => {
    const b = board([
      entry({ at: at("2026-08-26", 10) }),
      entry({ at: at("2026-08-26", 11) }),
      entry({ at: at("2026-08-26", 12) }),
      entry({ at: at("2026-08-26", 13), undone: true }),
    ]);
    expect(dayStats(b, "2026-08-26")!.said).toBe(3);
  });

  it("reports returns only when the day actually came back", () => {
    const once = board([
      entry({ at: at("2026-08-26", 10), targetId: "t1" }),
      entry({ at: at("2026-08-26", 11), kind: "action", targetId: "a1" }),
      entry({ at: at("2026-08-26", 12), kind: "action", targetId: "a2" }),
    ]);
    expect(dayStats(once, "2026-08-26")!.returns).toEqual([]);

    const twice = board([
      entry({ at: at("2026-08-26", 10), targetId: "t1" }),
      entry({ at: at("2026-08-26", 14), targetId: "t1" }),
      entry({ at: at("2026-08-26", 19), targetId: "t1" }),
    ]);
    expect(dayStats(twice, "2026-08-26")!.returns).toHaveLength(3);
  });
});

describe("wrapDue", () => {
  const full = (d: string) => [
    entry({ at: at(d, 10) }), entry({ at: at(d, 12) }), entry({ at: at(d, 15) }),
  ];

  it("offers yesterday once today has begun", () => {
    const b = board(full("2026-08-26"));
    expect(wrapDue(b, [], at("2026-08-27", 9))).toBe("2026-08-26");
  });

  it("never offers the day still being lived", () => {
    const b = board(full("2026-08-26"));
    expect(wrapDue(b, [], at("2026-08-26", 23))).toBeNull();
  });

  it("does not offer a day already wrapped", () => {
    const b = board(full("2026-08-26"));
    const w = [{ day: "2026-08-26" } as DayWrap];
    expect(wrapDue(b, w, at("2026-08-27", 9))).toBeNull();
  });

  it("only ever offers yesterday — never a backlog of missed days", () => {
    /* Without this, writing one wrap changes the board, which re-runs the
       check, which finds the day before: a first run would wrap the whole
       ledger, one model call per day. */
    const b = board([...full("2026-08-20"), ...full("2026-08-24")]);
    expect(wrapDue(b, [], at("2026-08-27", 9))).toBeNull();
  });

  it("does not reach back a day when yesterday was too thin", () => {
    const b = board([...full("2026-08-25"), entry({ at: at("2026-08-26", 10) })]);
    expect(wrapDue(b, [], at("2026-08-27", 9))).toBeNull();
  });
});

describe("mergeWraps", () => {
  const w = (day: string, seen?: boolean) => ({ day, seen, at: 1, line: "l" } as DayWrap);

  it("unions by day", () => {
    expect(mergeWraps([w("2026-08-25")], [w("2026-08-26")]).map((x) => x.day))
      .toEqual(["2026-08-25", "2026-08-26"]);
  });

  it("keeps a dismissal — seen on one device stays seen on the other", () => {
    expect(mergeWraps([w("2026-08-26", true)], [w("2026-08-26")])[0].seen).toBe(true);
    expect(mergeWraps([w("2026-08-26")], [w("2026-08-26", true)])[0].seen).toBe(true);
  });
});

describe("pendingWrap", () => {
  const today = at("2026-08-27", 9);

  it("stays on offer after it has been read — reading is not losing it", () => {
    const w = { day: "2026-08-26", at: at("2026-08-27", 8), seen: true } as DayWrap;
    expect(pendingWrap([w], today)!.day).toBe("2026-08-26");
  });

  it("is gone once its own day is over", () => {
    const w = { day: "2026-08-25", at: at("2026-08-26", 8) } as DayWrap;
    expect(pendingWrap([w], today)).toBeNull();
  });

  it("offers the newest when two were written the same day", () => {
    const a = { day: "2026-08-25", at: at("2026-08-27", 8) } as DayWrap;
    const b = { day: "2026-08-26", at: at("2026-08-27", 9) } as DayWrap;
    expect(pendingWrap([a, b], today)!.day).toBe("2026-08-26");
  });
});

describe("hydrate keeps the wrap fields", () => {
  it("carries wraps and completions through a hub round trip", async () => {
    /* hydrate() rebuilds the board field by field, so anything it does not
       name is dropped on every sync. That silently rewrote the day's wrap
       on each load, because the stored one never came back. */
    const { hydrate } = await import("./model");
    const raw = {
      actions: [], threads: [], intentions: [], principles: [],
      ledger: [], corrections: [],
      wraps: [{ day: "2026-08-26", at: 1, line: "l", insights: [], tomorrow: "", stats: {} }],
      completions: [{ id: "a1", text: "did it", at: 2 }],
    } as never;
    const out = hydrate(raw);
    expect(out.wraps).toHaveLength(1);
    expect(out.wraps![0].day).toBe("2026-08-26");
    expect(out.completions).toHaveLength(1);
    expect(out.completions![0].text).toBe("did it");
  });

  it("drops malformed entries rather than crashing", async () => {
    const { hydrate } = await import("./model");
    const out = hydrate({ wraps: [null, { day: 1 }], completions: [{ id: 5 }] } as never);
    expect(out.wraps).toEqual([]);
    expect(out.completions).toEqual([]);
  });
});

describe("dayStats leaves out threads it cannot name", () => {
  it("recovers a thread through its fragment, and drops what stays unnamed", () => {
    /* A capture's targetId can outlive the thread it named. The fragment it
       left behind still knows where it lives; what cannot be named after
       that is left out rather than drawn as "—". */
    const b: Board = {
      actions: [], intentions: [], principles: [], corrections: [],
      threads: [{ id: "t1", name: "Bugs", frags: [{ id: "f9", at: 1 }] }] as Board["threads"],
      ledger: [
        entry({ at: at("2026-08-26", 10), targetId: "t1" }),
        entry({ at: at("2026-08-26", 11), targetId: "gone", targetFragId: "f9" }),
        entry({ at: at("2026-08-26", 12), targetId: "vanished" }),
      ],
    };
    const s = dayStats(b, "2026-08-26")!;
    expect(s.threads).toEqual([{ name: "Bugs", n: 2 }]);
    expect(s.threads.some((t) => t.name === "—")).toBe(false);
  });
});
