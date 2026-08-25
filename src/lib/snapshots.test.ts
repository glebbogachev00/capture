import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import {
  expiredDays,
  snapshotDay,
  snapshotDays,
  snapshotKey,
  worthSnapshotting,
} from "./snapshots";

describe("a week of rollbacks", () => {
  it("keys by the person's own calendar day", () => {
    const at = new Date(2026, 7, 25, 23, 30).getTime();
    expect(snapshotDay(at)).toBe("2026-08-25");
    expect(snapshotKey("2026-08-25")).toBe("capture:snapshot:2026-08-25");
  });

  it("lists days newest first and ignores other keys", () => {
    const keys = [
      "capture:board",
      snapshotKey("2026-08-20"),
      snapshotKey("2026-08-25"),
      snapshotKey("2026-08-22"),
    ];
    expect(snapshotDays(keys)).toEqual(["2026-08-25", "2026-08-22", "2026-08-20"]);
  });

  it("keeps the newest seven and names the rest for deletion", () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);
    const gone = expiredDays(days);
    expect(gone).toEqual(["2026-08-03", "2026-08-02", "2026-08-01"]);
  });

  it("never snapshots an empty board over a real one", () => {
    expect(worthSnapshotting(EMPTY)).toBe(false);
    expect(
      worthSnapshotting({ ...EMPTY, actions: [{ id: "a" }] } as unknown as Board)
    ).toBe(true);
  });
});
