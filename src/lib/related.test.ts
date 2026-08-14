import { describe, expect, it } from "vitest";
import type { Action, Board, Intention, Thread } from "./model";
import {
  bestActionDuplicate,
  bestFragmentDuplicate,
  bestFragmentOverlap,
  bestThreadHome,
  phraseAsWritten,
  sharedPhrase,
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
    corrections: [],
  };
}

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

  it("a lone shared word is no home, however distinctive", () => {
    const b = board({
      threads: [
        thread("t1", "Perfectionism", ["Delaying releases because of perfectionism"]),
        thread("t2", "Buy groceries", ["Milk and eggs"]),
      ],
    });
    // "perfectionism" is rare and distinctive, but the two texts share no
    // contiguous PHRASE — and only a phrase is concrete enough to move
    // something.
    expect(
      sharedPhrase(
        "Delaying releases because of perfectionism",
        "my perfectionism is ruining the release"
      )
    ).toBe("");
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

  it("two notes that only name the same subject are no duplicate", () => {
    // The regression. Both notes name "Reality Creation Game" — three
    // content words on its own — so the run-only test called them the same
    // note and Organize offered to delete one. They share a subject and
    // nothing else; deleting either destroys writing that exists once.
    const b = board({
      threads: [
        thread("t1", "Reality Creation", [
          "The Reality Creation Game rewards purified intent — doing what " +
            "is asked of you without wanting the outcome for yourself.",
        ]),
      ],
    });
    expect(
      bestFragmentDuplicate(
        b,
        "Turn the Reality Creation Game into something my brother can play " +
          "on a train journey without any preparation beforehand."
      )
    ).toBeNull();
    // The overlap is still visible — it is a merge's business, not a delete's.
    const overlap = bestFragmentOverlap(
      b,
      "Turn the Reality Creation Game into something my brother can play " +
        "on a train journey without any preparation beforehand."
    );
    expect(overlap?.fragId).toBe("t1-f0");
    expect(overlap?.duplicate).toBe(false);
  });

  it("a short note quoted inside a long one is a quotation, not a copy", () => {
    // Full coverage of the short note, but the notes are nowhere near the
    // same size: the long note says a great deal the short one never does.
    const b = board({
      threads: [
        thread("t1", "Espresso", [
          "The espresso machine gasket replacement went fine, though the " +
            "portafilter still drips whenever the pressure climbs above " +
            "nine bars and the grinder needs recalibrating afterwards.",
        ]),
      ],
    });
    expect(
      bestFragmentDuplicate(b, "espresso machine gasket replacement")
    ).toBeNull();
  });

  it("still catches a re-paste the sorter reworded", () => {
    // The case the strictness must not break: same note, different wording.
    const b = board({
      threads: [
        thread("t1", "Rocket Maintenance", [
          "Rocket maintenance checklist — checking the rocket thoroughly " +
            "before every launch day, twice over.",
        ]),
      ],
    });
    const hit = bestFragmentDuplicate(
      b,
      "Rocket maintenance checklist: check the rocket thoroughly before " +
        "each launch day, twice."
    );
    expect(hit?.fragId).toBe("t1-f0");
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

describe("phraseAsWritten", () => {
  it("expands a content-word run back to the raw wording", () => {
    expect(
      phraseAsWritten("step step", "Here's the clean step-by-step requirement")
    ).toBe("step-by-step");
    expect(
      phraseAsWritten("source self", "coming back to the source of self")
    ).toBe("source of self");
  });

  it("keeps the user's casing", () => {
    expect(
      phraseAsWritten("north star", "The North Star for this quarter")
    ).toBe("North Star");
  });

  it("returns a literal phrase unchanged", () => {
    expect(
      phraseAsWritten("boiler service", "book the boiler service")
    ).toBe("boiler service");
  });

  it("picks the tightest window when the words recur", () => {
    expect(
      phraseAsWritten(
        "espresso machine",
        "espresso beans for the machine — the espresso machine needs them"
      )
    ).toBe("espresso machine");
  });

  it("falls back to the bare phrase when the text no longer carries it", () => {
    expect(phraseAsWritten("cold brew", "something else entirely")).toBe(
      "cold brew"
    );
    expect(phraseAsWritten("", "anything")).toBe("");
  });
});
