import { describe, expect, it } from "vitest";
import { EMPTY, type Action, type Board, type Frag, type Thread } from "./model";
import { scanBoard, scanResolved, scanStale } from "./organize";

const DAY = 86_400_000;
const NOW = 200 * DAY;

function largeBoard(): Board {
  const actions: Action[] = Array.from({ length: 100 }, (_, index) => ({
    id: `a-${index}`,
    text: `Review Capture performance regression action ${index} before the mobile release`,
    done: false,
    at: NOW - (index + 50) * DAY,
    shelf: "keep",
    expires: null,
  }));
  const threads: Thread[] = Array.from({ length: 30 }, (_, threadIndex) => ({
    id: `t-${threadIndex}`,
    name: `Capture performance ${threadIndex}`,
    summary: "",
    frags: Array.from({ length: 10 }, (_, fragIndex): Frag => ({
      id: `f-${threadIndex}-${fragIndex}`,
      at: NOW - (fragIndex + 1) * DAY,
      text: `Capture mobile performance regression shared thread ${threadIndex} fragment ${fragIndex}`,
    })),
  }));
  const completions = Array.from({ length: 500 }, (_, index) => ({
    id: `done-${index}`,
    text: `Completed Capture performance task ${index} after the mobile review`,
    at: NOW - index * DAY,
  }));
  return { ...EMPTY, actions, threads, completions };
}

describe("scanStale performance boundary", () => {
  it("does not run the semantic overlap scan during an ordinary board render", () => {
    const started = performance.now();
    const proposals = scanStale(largeBoard(), [], NOW);
    const elapsed = performance.now() - started;

    expect(proposals.some((proposal) => proposal.kind === "let_go")).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });

  it("keeps the same stale and completion-receipt results as the full scan", () => {
    const board = largeBoard();
    const expected = [
      ...scanBoard(board, [], NOW).filter(
        (proposal) =>
          proposal.kind === "let_go" ||
          proposal.kind === "revisit_intention"
      ),
      ...scanResolved(board),
    ];

    expect(scanStale(board, [], NOW)).toEqual(expected);
  });
});
