import { describe, it, expect } from "vitest";
import { buildBackup, restoreBackup } from "./backup";
import type { Board } from "./model";
import type { DayWrap } from "./wrap";

/**
 * A backup round trip must carry every Board field.
 *
 * Restore is the third place that names the fields by hand — hydrate and the
 * sync merge are the others — and the easiest to forget, because a restore is
 * rare and its loss is silent. The wraps and the ticks are simply not there
 * afterwards, with nothing to say they ever were.
 */

const wrap = (day: string, at = 1, seen?: boolean): DayWrap => ({
  day, at, line: "the day", insights: [{ k: "weight", v: "v" }], tomorrow: "t", seen,
  stats: { day, said: 4, threadsMoved: 1, actionsMade: 1, intentions: 0,
           threads: [{ name: "Bugs", n: 2 }], firstAt: 1, lastAt: 9, returns: [], finished: [] },
});

const board = (over: Partial<Board> = {}): Board => ({
  actions: [], threads: [], intentions: [], principles: [],
  ledger: [], corrections: [], wraps: [], completions: [], ...over,
});

describe("a backup round trip", () => {
  it("brings the wraps and the ticks back", () => {
    const full = board({
      wraps: [wrap("2026-08-26")],
      completions: [{ id: "a1", text: "Ship the wrap", at: 20 }],
    });
    const { board: restored } = restoreBackup(buildBackup(full), board());
    expect(restored.wraps).toHaveLength(1);
    expect(restored.wraps![0].line).toBe("the day");
    expect(restored.completions).toHaveLength(1);
    expect(restored.completions![0].text).toBe("Ship the wrap");
  });

  it("does not drop history the device already had", () => {
    const local = board({ wraps: [wrap("2026-08-25")], completions: [{ id: "keep", text: "k", at: 1 }] });
    const backup = buildBackup(board({ wraps: [wrap("2026-08-26")], completions: [{ id: "old", text: "o", at: 2 }] }));
    const { board: restored } = restoreBackup(backup, local);
    expect(restored.wraps!.map((w) => w.day)).toEqual(["2026-08-25", "2026-08-26"]);
    expect(restored.completions!.map((c) => c.id).sort()).toEqual(["keep", "old"]);
  });

  it("keeps a wrap dismissed, whichever side dismissed it", () => {
    const local = board({ wraps: [wrap("2026-08-26", 1, true)] });
    const backup = buildBackup(board({ wraps: [wrap("2026-08-26", 1)] }));
    expect(restoreBackup(backup, local).board.wraps![0].seen).toBe(true);
  });

  it("reads an old backup that predates these fields", () => {
    const old = buildBackup({
      actions: [], threads: [], intentions: [], principles: [],
      ledger: [], corrections: [],
    } as Board);
    const { board: restored } = restoreBackup(old, board({ wraps: [wrap("2026-08-26")] }));
    expect(restored.wraps).toHaveLength(1);
    expect(restored.completions).toEqual([]);
  });

  it("keeps the later epoch, and still restores what the person asked for", () => {
    /* A sync drops history arriving on an older epoch — nobody asked for it.
       A restore is a deliberate act, so the file's contents come back; only
       the epoch takes the later value, so the device cannot be made to look
       older than it is and lose everything at the next sync. */
    const local = board({ historyEpoch: 500 });
    const backup = buildBackup(board({ historyEpoch: 100, wraps: [wrap("2026-08-26")] }));
    const { board: restored } = restoreBackup(backup, local);
    expect(restored.historyEpoch).toBe(500);
    expect(restored.wraps).toHaveLength(1);
  });
});
