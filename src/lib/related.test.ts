import { describe, expect, it } from "vitest";
import type { Action, Board, Intention, Thread } from "./model";
import { relatedTo } from "./related";

function action(id: string, text: string): Action {
  return { id, text, done: false, at: 0, shelf: "keep", expires: null };
}

function thread(id: string, name: string, frags: string[]): Thread {
  return {
    id,
    name,
    summary: "",
    frags: frags.map((text, i) => ({ id: `${id}-f${i}`, at: 0, text })),
  };
}

function intention(id: string, text: string): Intention {
  return {
    id,
    number: 1,
    rawInput: text,
    expandedIntention: text,
    recommendedActions: [],
    counterIntentions: [],
    at: 0,
    updatedAt: 0,
  };
}

function board(a: {
  actions?: Action[];
  threads?: Thread[];
  intentions?: Intention[];
}): Board {
  return {
    actions: a.actions || [],
    threads: a.threads || [],
    intentions: a.intentions || [],
    principles: [],
  };
}

describe("relatedTo", () => {
  it("finds an item that shares the thread's distinctive words", () => {
    const b = board({
      threads: [
        thread("t1", "Cold Brew Experiments", [
          "Experimenting with cold brew ratios this week.",
        ]),
      ],
      actions: [
        action("a1", "Fix the cold brew ratio and try a finer grind"),
        action("a2", "Call the dentist about the appointment"),
      ],
    });

    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    const hit = items.find((i) => i.id === "a1");
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("action");
    expect(hit?.reason).toMatch(/cold brew/);
    // The unrelated action is not surfaced.
    expect(items.find((i) => i.id === "a2")).toBeUndefined();
  });

  it("never returns the item itself, even though its own words match", () => {
    const b = board({
      threads: [
        thread("t1", "Sleep cycles", ["Been reading about sleep cycles"]),
        thread("t2", "Sleep and productivity", ["How sleep affects focus"]),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    expect(items.find((i) => i.id === "t1")).toBeUndefined();
    expect(items.find((i) => i.id === "t2")).toBeDefined();
  });

  it("surfaces intentions and threads together", () => {
    const b = board({
      threads: [thread("t1", "Morning routines", ["Want a calmer morning"])],
      intentions: [intention("i1", "I wake up rested and unhurried in the morning")],
      actions: [action("a1", "Photograph the morning light on the porch")],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    const ids = items.map((i) => i.id);
    // Both the intention and the action genuinely share "morning".
    expect(ids).toContain("i1");
    expect(ids).toContain("a1");
    expect(items.every((i) => i.id !== "t1")).toBe(true);
  });

  it("uses a single shared term when nothing else overlaps", () => {
    const b = board({
      threads: [thread("t1", "Cross-device sharing", ["Copy between devices"])],
      actions: [action("a1", "Check the device sync settings")],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    expect(items.some((i) => i.id === "a1")).toBe(true);
  });

  it("drops to one term when two shared terms never co-occur", () => {
    const b = board({
      threads: [thread("t1", "Alpha bravo", ["Alpha bravo system"])],
      actions: [
        action("a1", "Alpha system notes"),
        action("a2", "Bravo system notes"),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    // No item holds both "alpha" and "bravo", so the two-term query must
    // fall back to a single term and still find one of them.
    expect(items.length).toBeGreaterThan(0);
  });

  it("returns nothing when there is no overlap", () => {
    const b = board({
      threads: [thread("t1", "Cold brew ratios", ["Brewing coffee darker"])],
      actions: [action("a1", "Renew the car insurance")],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    expect(items).toEqual([]);
  });

  it("handles a board with nothing meaningful in it", () => {
    const b = board({
      threads: [thread("t1", "Notes", ["some things to remember"])],
    });
    expect(relatedTo(b, { kind: "thread", id: "t1" }).items).toEqual([]);
  });
});
