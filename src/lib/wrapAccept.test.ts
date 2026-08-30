import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import { acceptWrap, markWrapsSeen } from "./wrap";

/** A board with one captured thing on the day, so dayStats has substance. */
const board = (over: Partial<Board> = {}): Board => ({
  ...EMPTY,
  /* Three captures — a day needs MIN_CAPTURES utterances before it has
     anything to say about itself. */
  ledger: [
    "I need to fix the intentions",
    "the covers disappear during sorting",
    "release the charge behind the urge instead of acting on it",
  ].map(
    (raw, i) =>
      ({
        id: "L" + i,
        at: Date.parse("2026-08-30T14:00:00") + i * 60_000,
        raw,
        clean: raw,
        kind: "action",
        source: "typed",
        targetId: "a" + i,
      }) as never
  ),
  ...over,
});

const out = { line: "A day spent circling one thought.", via: "gemini" };

describe("accepting a day's wrap", () => {
  it("writes the wrap from the board as it is NOW", () => {
    const next = acceptWrap(board(), "2026-08-30", out, 999)!;
    expect(next.wraps).toHaveLength(1);
    expect(next.wraps![0].day).toBe("2026-08-30");
    expect(next.wraps![0].line).toBe(out.line);
  });

  it("the other device already wrote this day: write nothing", () => {
    /* The race the hook guarded inline: our request was in flight while
       the other device's wrap synced in. Two wraps for one day would both
       show and both count. */
    const b = board({
      wraps: [{ day: "2026-08-30", at: 1, stats: {}, line: "theirs" }] as never,
    });
    expect(acceptWrap(b, "2026-08-30", out, 999)).toBeNull();
  });

  it("a day with nothing captured gets no wrap", () => {
    expect(acceptWrap({ ...EMPTY }, "2026-08-30", out, 999)).toBeNull();
  });

  it("an empty line from the model is a failure, not a wrap", () => {
    expect(acceptWrap(board(), "2026-08-30", { line: "" }, 999)).toBeNull();
  });
});

describe("dismissing the wrap", () => {
  it("marks every unseen wrap seen, and only those", () => {
    const b = board({
      wraps: [
        { day: "2026-08-29", at: 1, stats: {}, line: "old", seen: true },
        { day: "2026-08-30", at: 2, stats: {}, line: "new" },
      ] as never,
    });
    const next = markWrapsSeen(b)!;
    expect(next.wraps!.every((w) => w.seen)).toBe(true);
  });

  it("nothing unseen means no commit at all", () => {
    const b = board({
      wraps: [{ day: "2026-08-30", at: 1, stats: {}, line: "x", seen: true }] as never,
    });
    expect(markWrapsSeen(b)).toBeNull();
  });
});
