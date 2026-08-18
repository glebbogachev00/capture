import { describe, expect, it } from "vitest";
import { EMPTY, type Action, type Board } from "./model";
import { scanBoard } from "./organize";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 7, 18, 12, 0, 0).getTime();

const action = (over: Partial<Action> = {}): Action => ({
  id: "a1",
  text: "send Alex the proposal",
  done: false,
  at: NOW,
  shelf: "keep",
  expires: null,
  ...over,
});

const board = (actions: Action[]): Board => ({ ...EMPTY, actions });

const letGo = (b: Board, now = NOW) =>
  scanBoard(b, [], now).filter((p) => p.kind === "let_go");

/**
 * Get Light asks a different question from the rest of Organize: not "what
 * is messy?" but "what is still pulling at you?". It only looks at the
 * actions the board will never clear by itself, because everything with a
 * shelf life already fades on its own.
 */
describe("get light — what is still being carried", () => {
  it("asks about an action whose own stated deadline has passed", () => {
    const ps = letGo(board([action({ due: NOW - 5 * DAY })]));
    expect(ps).toHaveLength(1);
    expect(ps[0].verb).toBe("Let go");
    expect(ps[0].reason).toContain("deadline passed");
  });

  it("asks about a kept action carried a long time with nothing to clear it", () => {
    const ps = letGo(board([action({ at: NOW - 60 * DAY })]));
    expect(ps).toHaveLength(1);
    expect(ps[0].reason).toContain("nothing will fade it");
  });

  it("stays quiet about a deadline that has only just passed", () => {
    /* A thing due today is still live tonight — the same grace the shelf
       life already grants it. */
    expect(letGo(board([action({ due: NOW - 60 * 1000 })]))).toEqual([]);
  });

  it("stays quiet about a recent kept action", () => {
    expect(letGo(board([action({ at: NOW - 3 * DAY })]))).toEqual([]);
  });

  it("never asks about an action that fades on its own", () => {
    /* The whole point: things with a shelf life are already handled. Only
       "keep" can pile up forever. */
    for (const shelf of ["hours", "days", "weeks"] as const) {
      expect(
        letGo(board([action({ shelf, at: NOW - 200 * DAY, expires: NOW + DAY })]))
      ).toEqual([]);
    }
  });

  it("never asks twice — a faded or done action is already gone", () => {
    expect(letGo(board([action({ at: NOW - 90 * DAY, faded: true })]))).toEqual([]);
    expect(letGo(board([action({ at: NOW - 90 * DAY, done: true })]))).toEqual([]);
  });

  it("is never a high-confidence claim — it is a question, not a mistake", () => {
    const ps = letGo(board([action({ due: NOW - 30 * DAY })]));
    expect(ps[0].confidence).toBe("medium");
  });

  it("is deterministic and locally derived — never a model claim", () => {
    const ps = letGo(board([action({ due: NOW - 30 * DAY })]));
    expect(ps[0].origin).toBe("local");
  });

  it("can be dismissed for good, by id", () => {
    const b = board([action({ due: NOW - 30 * DAY })]);
    const [p] = letGo(b);
    expect(scanBoard(b, [p.id], NOW).filter((x) => x.kind === "let_go")).toEqual([]);
  });
});
