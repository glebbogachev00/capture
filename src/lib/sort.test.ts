import { describe, expect, it } from "vitest";
import { reconcileSorted } from "./sort";

describe("reconcileSorted", () => {
  it("preserves every validated source character in split shares", () => {
    const primaryText = "The navbar needs work.";
    const secondaryText = "Separately, I want posts to sound human — exactly as said.";
    const clean = `${primaryText} ${secondaryText}`;
    const input = {
      kind: "thread" as const,
      actions: [],
      clean,
      threadName: "Navbar",
      primaryText,
      also: [{ text: secondaryText, threadName: "Writing", threadId: null }],
    };

    const out = reconcileSorted(input);

    expect(out.primaryText).toBe(primaryText);
    expect(out.also[0].text).toBe(secondaryText);
    expect(out.clean).toBe(clean);
    expect(reconcileSorted(out)).toEqual(out);
  });

  it("does not rewrite an unsplit capture", () => {
    const input = {
      kind: "thread" as const,
      threadName: "Writing",
      clean: "Separately, I want human posts.",
      primaryText: "Separately, I want human posts.",
      also: [],
    };
    expect(reconcileSorted(input)).toEqual({ ...input, actions: [] });
  });

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
