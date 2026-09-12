import { describe, expect, it } from "vitest";
import {
  enforceStandingDecision,
  explicitStandingDecision,
  reconcileSorted,
} from "./sort";

describe("reconcileSorted", () => {
  it("keeps a valid 'both' and trims its actions", () => {
    const out = reconcileSorted({
      kind: "both",
      actions: ["  Tell the agency by Friday ", ""],
      threadName: "Whether to leave the agency",
    });
    expect(out.kind).toBe("both");
    expect(out.actions).toEqual(["Tell the agency by Friday"]);
  });

  it("collapses a 'both' with no task to a thread", () => {
    const out = reconcileSorted({
      kind: "both",
      actions: [],
      threadName: "Whether to leave the agency",
    });
    expect(out.kind).toBe("thread");
  });

  it("collapses a 'both' with no thread to an action", () => {
    const out = reconcileSorted({
      kind: "both",
      actions: ["Call the dentist"],
      threadId: null,
      threadName: null,
    });
    expect(out.kind).toBe("action");
    expect(out.threadName).toBe(null);
  });

  it("keeps a valid 'both' that routes into an existing thread", () => {
    const out = reconcileSorted({
      kind: "both",
      actions: ["Register the domain this week"],
      threadId: "t123",
      threadName: null,
    });
    expect(out.kind).toBe("both");
    expect(out.threadId).toBe("t123");
  });

  it("passes single kinds through, trimming their actions", () => {
    expect(reconcileSorted({ kind: "thread", actions: [] }).kind).toBe("thread");
    expect(
      reconcileSorted({ kind: "action", actions: [" Buy milk "] }).actions
    ).toEqual(["Buy milk"]);
    expect(reconcileSorted({ kind: "intention", actions: [] }).kind).toBe(
      "intention"
    );
  });
});

describe("explicitStandingDecision", () => {
  it("recognizes a durable operating decision", () => {
    expect(
      explicitStandingDecision(
        "I've decided to always ship a demo video with every feature from now on, not just sometimes."
      )
    ).toBe(true);
  });

  it("does not turn a one-off decision into an intention", () => {
    expect(explicitStandingDecision("I've decided to buy milk tomorrow.")).toBe(false);
  });

  it("does not turn open-ended consideration into an intention", () => {
    expect(explicitStandingDecision("I'm thinking about whether every feature needs a demo.")).toBe(false);
  });

  it("overrides a model's thread fallback without keeping a false thread home", () => {
    expect(
      enforceStandingDecision(
        "I've decided to always ship a demo video with every feature from now on.",
        {
          kind: "thread",
          actions: [],
          threadId: "first-thread",
          threadName: null,
        }
      )
    ).toEqual({
      kind: "intention",
      actions: [],
      threadId: null,
      threadName: null,
    });
  });

  it("overrides a model's action fallback for a standing rule", () => {
    expect(
      enforceStandingDecision(
        "I've decided to always ship a demo video with every feature from now on.",
        {
          kind: "action",
          actions: ["Always ship a demo video with every feature"],
          threadId: null,
          threadName: null,
        }
      )
    ).toEqual({
      kind: "intention",
      actions: [],
      threadId: null,
      threadName: null,
    });
  });

  it("does not override a mixed result that carries a separate concrete task", () => {
    expect(
      enforceStandingDecision("From now on every feature gets a demo; record this one today.", {
        kind: "both",
        actions: ["Record this feature demo today"],
        threadId: "launch",
        threadName: null,
      }).kind
    ).toBe("both");
  });
});
