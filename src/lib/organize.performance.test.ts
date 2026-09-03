import { describe, expect, it } from "vitest";
import { applyActionDone } from "./actionOps";
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

  it("keeps twenty ordinary ticks inside the interaction budget on a large board", () => {
    let board = largeBoard();
    const started = performance.now();
    let slowestTick = 0;

    for (let index = 0; index < 20; index++) {
      const tickStarted = performance.now();
      const updated = applyActionDone(board, `a-${index}`, NOW + index);
      expect(updated).not.toBeNull();
      board = updated!.board;
      /* The hook derives this on each board change for the header Tidy badge.
         This is the interaction path that used to accidentally call scanBoard. */
      scanStale(board, [], NOW + index);
      slowestTick = Math.max(slowestTick, performance.now() - tickStarted);
    }

    const elapsed = performance.now() - started;
    expect(board.actions).toHaveLength(80);
    /* Full-suite worker contention makes an aggregate wall-clock threshold
       noisy; a single tick must still stay below 20ms, and the full burst has
       a deliberately looser 300ms ceiling. The former scanBoard path takes
       hundreds of milliseconds for one scan on this fixture. */
    expect(elapsed).toBeLessThan(300);
    expect(slowestTick).toBeLessThan(20);
  });
});
