import { describe, expect, it } from "vitest";
import type { Action, Board, Intention, Thread } from "./model";
import { bestThreadHome, relatedTo, relatedToText } from "./related";

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

  it("carries the matched fragment id on thread hits", () => {
    const b = board({
      threads: [
        thread("t1", "Cold Brew Experiments", [
          "Experimenting with cold brew ratios this week.",
        ]),
        thread("t2", "Cold brew equipment", [
          "Unrelated intro.",
          "The cold brew pitcher arrived today.",
        ]),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    const hit = items.find((i) => i.id === "t2");
    expect(hit).toBeDefined();
    // The match lives in the second fragment of t2.
    expect(hit?.fragId).toBe("t2-f1");
  });

  it("finds the fragment when the shared phrase is broken by stop words", () => {
    const b = board({
      threads: [
        thread("t1", "Cold Brew Experiments", [
          "Experimenting with cold brew ratios this week.",
        ]),
        thread("t2", "Equipment for brewing", [
          "The cold strong brew pitcher arrived today.",
        ]),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    const hit = items.find((i) => i.id === "t2");
    // "cold strong brew" still shares "cold brew" — the fragment that
    // carries the words in order is the one Move/Extract should target.
    expect(hit?.fragId).toBe("t2-f0");
  });

  it("omits fragId when the thread matched on its name only", () => {
    const b = board({
      threads: [
        thread("t1", "Cold brew", ["Something about the weather."]),
        thread("t2", "Cold brew ratio", ["Something about the weather too."]),
      ],
    });
    const { items } = relatedTo(b, { kind: "thread", id: "t1" });
    const hit = items.find((i) => i.id === "t2");
    // The shared word is only in the thread names, so no fragment carries it.
    expect(hit?.fragId).toBeUndefined();
  });
});

describe("bestThreadHome", () => {
  it("names the thread a phrase clearly belongs with", () => {
    const b = board({
      threads: [
        thread("t1", "Coffee Setup", ["Bought an espresso machine for the kitchen"]),
        thread("t2", "Renew car insurance", ["The renewal is due this month"]),
      ],
    });
    const hit = bestThreadHome(b, "buy an espresso machine and a grinder");
    expect(hit).not.toBeNull();
    expect(hit?.id).toBe("t1");
    expect(hit?.name).toBe("Coffee Setup");
    expect(hit?.reason).toMatch(/espresso machine/);
  });

  it("is stricter than the Related line: a lone shared word is no home", () => {
    const b = board({
      threads: [
        thread("t1", "Perfectionism", ["Delaying releases because of perfectionism"]),
        thread("t2", "Buy groceries", ["Milk and eggs"]),
      ],
    });
    // "perfectionism" is rare and distinctive, so the Related line would
    // connect — but a single word is not concrete enough to move something.
    expect(
      relatedToText(b, "my perfectionism is ruining the release").items.some(
        (i) => i.id === "t1"
      )
    ).toBe(true);
    expect(bestThreadHome(b, "my perfectionism is ruining the release")).toBeNull();
  });

  it("returns nothing when nothing on the board shares a phrase", () => {
    const b = board({
      threads: [thread("t1", "Cold brew ratios", ["Brewing coffee darker"])],
    });
    expect(bestThreadHome(b, "renew the car insurance today")).toBeNull();
  });

  it("takes the strongest thread even when an action phrase-matches too", () => {
    const b = board({
      threads: [thread("t1", "Coffee Setup", ["espresso machine on the counter"])],
      actions: [action("a1", "espresso machine maintenance")],
    });
    const hit = bestThreadHome(b, "buy an espresso machine");
    // Only a thread can be a home, so the action's match is ignored.
    expect(hit?.id).toBe("t1");
  });

  it("returns the best of several matching threads", () => {
    const b = board({
      threads: [
        thread("t1", "Coffee Setup", ["The espresso machine arrived"]),
        thread("t2", "Grinder research", ["The grinder is still on the list"]),
      ],
    });
    const hit = bestThreadHome(b, "espresso machine and a burr grinder");
    // Both share a phrase; "espresso machine" outranks "grinder" alone.
    expect(hit?.id).toBe("t1");
  });

  it("returns the thread whose own content the text matches — the caller excludes the source", () => {
    const b = board({
      threads: [thread("t1", "Coffee Setup", ["espresso machine notes"])],
    });
    // bestThreadHome cannot know the text already lives in t1; the caller
    // (computeSuggestion) drops a hit that equals the thread it landed in.
    expect(bestThreadHome(b, "espresso machine notes")?.id).toBe("t1");
  });
});
