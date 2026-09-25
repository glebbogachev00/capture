import { describe, expect, it } from "vitest";
import {
  REFILE_WINDOW_MS,
  answeredKindCorrection,
  isRefile,
} from "./refiled";

const MIN = 60 * 1000;

describe("isRefile — fixing the sorter vs ordinary housekeeping", () => {
  it("treats a move within ten minutes as a correction", () => {
    const at = 1_000_000;
    expect(isRefile(at, at + 30 * 1000)).toBe(true);
    expect(isRefile(at, at + REFILE_WINDOW_MS)).toBe(true);
  });

  it("treats a later move or backwards clock as housekeeping", () => {
    const at = 1_000_000;
    expect(isRefile(at, at + REFILE_WINDOW_MS + 1)).toBe(false);
    expect(isRefile(at, at - MIN)).toBe(false);
  });
});

describe("answeredKindCorrection", () => {
  it("stores the whole bounded example and explicit outcome, not a phrase rule", () => {
    expect(answeredKindCorrection(
      "We are out of cold brew again, which is annoying",
      "action",
      "thread",
    )).toEqual({
      proposalKind: "undone",
      accepted: true,
      context: "We are out of cold brew again, which is annoying",
      routing: { kind: "thread" },
    });
  });

  it("writes nothing when the answer is unchanged or empty", () => {
    expect(answeredKindCorrection("Buy running clothes", "action", "action")).toBeNull();
    expect(answeredKindCorrection("   ", "action", "thread")).toBeNull();
  });
});
