import { describe, expect, it } from "vitest";
import type { Action, Board, Intention, Thread } from "./model";
import {
  bestActionDuplicate,
  bestFragmentDuplicate,
  bestThreadHome,
  relatedTo,
  relatedToText,
} from "./related";

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
    ledger: [],
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

  it("excludes the source id when handed one", () => {
    const b = board({
      threads: [
        thread("t1", "Coffee Setup", ["espresso machine notes"]),
        thread("t2", "Renew insurance", ["Nothing in common here"]),
      ],
    });
    // The capture always phrase-matches the item it landed in; handing its
    // id keeps the engine from reporting that item as its own home.
    expect(bestThreadHome(b, "espresso machine notes", "t1")).toBeNull();
    expect(bestThreadHome(b, "espresso machine notes", "t9")?.id).toBe("t1");
  });
});

describe("bestActionDuplicate", () => {
  it("names the action a phrase clearly repeats", () => {
    const b = board({
      actions: [
        action("a1", "Buy espresso beans for the machine"),
        action("a2", "Call the dentist about the appointment"),
      ],
    });
    const hit = bestActionDuplicate(b, "buy espresso beans");
    expect(hit?.id).toBe("a1");
    expect(hit?.reason).toMatch(/espresso beans/);
  });

  it("is stricter than the Related line: a lone shared word is no duplicate", () => {
    const b = board({
      actions: [
        action("a1", "Buy espresso beans for the machine"),
        action("a2", "Review the espresso options"),
      ],
    });
    // "espresso" is shared but no phrase is — a connection, not a duplicate.
    expect(bestActionDuplicate(b, "pick up the espresso grind")).toBeNull();
  });

  it("returns nothing when nothing repeats a phrase", () => {
    const b = board({
      actions: [action("a1", "Buy milk and eggs")],
    });
    expect(bestActionDuplicate(b, "renew the car insurance")).toBeNull();
  });

  it("takes the strongest action even when a thread phrase-matches too", () => {
    const b = board({
      actions: [action("a1", "Buy espresso beans for the machine")],
      threads: [thread("t1", "Coffee Setup", ["espresso beans on the counter"])],
    });
    const hit = bestActionDuplicate(b, "buy espresso beans");
    // Only an action can be a duplicate; the thread's match is ignored.
    expect(hit?.id).toBe("a1");
  });

  it("skips the excluded action even when it sits at the front and matches first", () => {
    // The capture lands at the front of the list and always matches its own
    // text — without the exclusion it would be reported as its own
    // duplicate. The older, real counterpart must be the one found.
    const b = board({
      actions: [
        action("a-new", "Buy espresso beans"),
        action("a-old", "Buy espresso beans for the machine"),
      ],
    });
    expect(bestActionDuplicate(b, "buy espresso beans", "a-new")?.id).toBe("a-old");
    // Without an exclusion the self-match at the front wins.
    expect(bestActionDuplicate(b, "buy espresso beans")?.id).toBe("a-new");
  });
});

describe("bestFragmentDuplicate", () => {
  it("names the fragment the same note pasted twice clearly repeats", () => {
    const b = board({
      threads: [
        thread("t1", "Cross-device copy and sharing app", [
          "An app idea focused on easily capturing/copying any content and " +
            "sharing it seamlessly — both syncing across personal devices " +
            "and sending text/media to other people.",
        ]),
      ],
    });
    // The sorter reworded the second paste, but the content words survive.
    const hit = bestFragmentDuplicate(
      b,
      "An app idea focused on easily capturing and copying any content, " +
        "then sharing it seamlessly. It would sync across personal devices " +
        "and allow sending text or media to other people."
    );
    expect(hit?.fragId).toBe("t1-f0");
    expect(hit?.threadId).toBe("t1");
    // The longest shared content-word phrase (weighted by word length).
    expect(hit?.reason).toMatch(/copying seamlessly personal/);
  });

  it("catches the same short note filed twice into one thread", () => {
    const b = board({
      threads: [
        thread("t1", "Rocket Maintenance", [
          "Rocket maintenance checklist — checking the rocket before launch day.",
        ]),
      ],
    });
    const hit = bestFragmentDuplicate(
      b,
      "Rocket maintenance checklist — checking the rocket before launch day."
    );
    expect(hit?.fragId).toBe("t1-f0");
  });

  it("is stricter than the Related line: a two-word overlap is no duplicate", () => {
    // Two genuinely different notes on the same subject share "espresso
    // machine" — a connection, not a duplicate. Only a 3-word phrase earns
    // the claim, so long-running threads stay quiet.
    const b = board({
      threads: [
        thread("t1", "Espresso", [
          "The espresso machine pulls great crema.",
        ]),
      ],
    });
    expect(
      bestFragmentDuplicate(b, "the espresso machine needs new gaskets")
    ).toBeNull();
  });

  it("returns nothing when notes share only generic words", () => {
    const b = board({
      threads: [
        thread("t1", "Ideas", [
          "An app for capturing content across devices.",
        ]),
      ],
    });
    expect(bestFragmentDuplicate(b, "another idea about sharing an app")).toBeNull();
  });

  it("finds a duplicate in another thread", () => {
    const b = board({
      threads: [
        thread("t1", "Cross-device copy and sharing app", [
          "An app idea focused on easily capturing/copying any content and " +
            "sharing it seamlessly — both syncing across personal devices " +
            "and sending text/media to other people.",
        ]),
        thread("t2", "Rocket Maintenance", [
          "Rocket maintenance checklist before launch day.",
        ]),
      ],
    });
    const hit = bestFragmentDuplicate(
      b,
      "An app idea focused on easily capturing and copying any content, " +
        "then sharing it seamlessly. It would sync across personal devices."
    );
    expect(hit?.fragId).toBe("t1-f0");
    expect(hit?.threadName).toBe("Cross-device copy and sharing app");
  });

  it("skips the just-landed fragment, which always phrase-matches its own text", () => {
    // The capture is already committed to the board when the check runs;
    // without the exclusion it would be reported as its own duplicate.
    // The older, real counterpart must be the one found.
    const b = board({
      threads: [
        thread("t1", "Rocket Maintenance", [
          "Rocket maintenance checklist — checking the rocket before launch day.",
          "Rocket maintenance checklist — checking the rocket before launch day.",
        ]),
      ],
    });
    expect(
      bestFragmentDuplicate(
        b,
        "Rocket maintenance checklist — checking the rocket before launch day.",
        "t1-f1"
      )?.fragId
    ).toBe("t1-f0");
    // Without an exclusion the self-match would win.
    expect(
      bestFragmentDuplicate(
        b,
        "Rocket maintenance checklist — checking the rocket before launch day."
      )?.fragId
    ).toBe("t1-f0");
  });
});
