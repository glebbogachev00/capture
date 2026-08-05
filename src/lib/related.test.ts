import { describe, expect, it } from "vitest";
import type { Action, Board, Intention, Thread } from "./model";
import { relatedTo } from "./related";

function action(id: string, text: string, src?: string): Action {
  return { id, text, done: false, at: 0, shelf: "keep", expires: null, src };
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
  it("connects on a real contiguous phrase with the phrase as the reason", () => {
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
    expect(hit?.reason).toMatch(/both mention "cold brew"/);
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

  it("surfaces intentions and actions alongside threads", () => {
    const b = board({
      threads: [thread("t1", "Morning routines", ["Want a calmer start to the day"])],
      intentions: [intention("i1", "I wake up rested and unhurried in the morning")],
      actions: [action("a1", "Photograph the routines on film")],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    const ids = items.map((i) => i.id);
    // The intention shares "morning" with the thread; the action shares
    // "routines". Both are genuine, non-generic connections.
    expect(ids).toContain("i1");
    expect(ids).toContain("a1");
    expect(items.every((i) => i.id !== "t1")).toBe(true);
  });

  it("connects on a single distinctive word, quoting its context", () => {
    const b = board({
      threads: [thread("t1", "Video release", ["Record a simple video explaining the build"])],
      actions: [
        action(
          "a1",
          "Post the video on X",
          "I've been delaying because of perfectionism. To overcome this, aim for good enough."
        ),
        action("a2", "Buy groceries", "Need milk and eggs"),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    const hit = items.find((i) => i.id === "a1");
    expect(hit).toBeDefined();
    // The reason quotes the action's own words around the shared term
    // ("video") as a readable sentence, not a bare word.
    expect(hit?.reason).toContain("video");
    expect(hit?.reason.length).toBeGreaterThan("video".length);
    expect(items.find((i) => i.id === "a2")).toBeUndefined();
  });

  it("does NOT connect on a generic shared word — no meaningful link", () => {
    const b = board({
      threads: [
        thread("t1", "Preview test note", [
          "A placeholder record. Any additional content or context can be added later.",
        ]),
        thread("t2", "Cross-device copy and sharing app", [
          "An app idea focused on copying any content across devices.",
        ]),
        thread("t3", "Cold brew", ["Fixing the cold brew ratio"]),
      ],
    });
    // Both t1 and t2 mention "content" — a generic noun — so no connection.
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    expect(items.find((i) => i.id === "t2")).toBeUndefined();
  });

  it("still connects when a distinctive word and a generic word co-occur", () => {
    const b = board({
      threads: [
        thread("t1", "Cold brew", ["Fixing the cold brew ratio"]),
        thread("t2", "Cold brew and content", [
          "More cold brew experiments, plus content planning.",
        ]),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    // "cold brew" is a real phrase — the generic "content" doesn't matter.
    expect(items.find((i) => i.id === "t2")).toBeDefined();
    expect(items.find((i) => i.id === "t2")?.reason).toContain("cold brew");
  });

  it("drops to a single term when a two-term phrase never co-occurs", () => {
    const b = board({
      threads: [thread("t1", "Alpha bravo", ["Alpha bravo system"])],
      actions: [
        action("a1", "Alpha system notes"),
        action("a2", "Bravo system notes"),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    // No item holds both "alpha" and "bravo", but each holds one of them.
    expect(items.length).toBeGreaterThan(0);
  });

  it("returns nothing when there is no real overlap", () => {
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
