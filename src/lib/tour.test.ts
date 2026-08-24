import { describe, expect, it } from "vitest";
import { TOUR_STEPS, tourStepDone } from "./tour";

describe("the playground tour", () => {
  const ctx = { captures: 0, answered: 0, threadOpen: false, recordOpen: false };

  it("is four steps, each with a title a card can carry", () => {
    expect(TOUR_STEPS).toHaveLength(4);
    for (const s of TOUR_STEPS) expect(s.title.length).toBeLessThan(60);
  });

  it("advances on real state, one condition per step", () => {
    expect(tourStepDone(0, ctx)).toBe(false);
    expect(tourStepDone(0, { ...ctx, captures: 1 })).toBe(true);
    expect(tourStepDone(1, { ...ctx, captures: 3 })).toBe(false);
    expect(tourStepDone(1, { ...ctx, answered: 1 })).toBe(true);
    expect(tourStepDone(2, { ...ctx, threadOpen: true })).toBe(true);
    expect(tourStepDone(3, { ...ctx, recordOpen: true })).toBe(true);
    expect(tourStepDone(4, { ...ctx, recordOpen: true })).toBe(false);
  });
});
