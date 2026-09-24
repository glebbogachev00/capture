import { describe, expect, it } from "vitest";
import { reconcileSorted } from "./sort";
import {
  MAX_FALLBACK_TITLE_CHARS,
  UnsafeSortInterpretationError,
  interpretationToSortResult,
  semanticSegmentsToInterpretation,
  type SortInterpretation,
} from "./sortInterpretation";

const base = (over: Partial<SortInterpretation> = {}): SortInterpretation => ({
  clean: "A thought worth keeping.",
  title: "A useful thought",
  thinking: [],
  actions: [],
  intention: null,
  shelfLife: "keep",
  due: null,
  ...over,
});

function expectLosslessThinkingSplit(primaryText: string, secondaryText: string) {
  const clean = `${primaryText} ${secondaryText}`;
  const out = reconcileSorted(interpretationToSortResult(base({
    clean,
    title: "Two preserved subjects",
    thinking: [
      { text: primaryText, threadId: null, threadName: "Navigation" },
      { text: secondaryText, threadId: null, threadName: "Writing" },
    ],
  }), { validThreadIds: [], requireCompleteSource: true }));

  expect(out.clean).toBe(clean);
  expect(out.primaryText).toBe(primaryText);
  expect(out.also).toEqual([
    expect.objectContaining({ text: secondaryText }),
  ]);
  expect([out.primaryText, ...out.also!.map((share) => share.text)].join(" ")).toBe(clean);
}

describe("semantic sort interpretation", () => {
  it("derives four actions and shared timing from one ordered representation", () => {
    const source = "Before Friday, audit onboarding, rewrite the copy, ask Nina to review, and schedule the email.";
    const value = semanticSegmentsToInterpretation({
      title: "Friday launch work",
      segments: [
        { role: "context", source: "Before Friday, ", actionOrdinals: [1, 2, 3, 4], shelfLife: "days", due: "2026-09-25" },
        { role: "action", source: "audit onboarding", action: "Audit onboarding", thinkingOrdinal: null, shelfLife: "days", due: null },
        { role: "context", source: ", ", actionOrdinals: null, shelfLife: null, due: null },
        { role: "action", source: "rewrite the copy", action: "Rewrite the copy", thinkingOrdinal: null, shelfLife: "days", due: null },
        { role: "context", source: ", ", actionOrdinals: null, shelfLife: null, due: null },
        { role: "action", source: "ask Nina to review", action: "Ask Nina to review", thinkingOrdinal: null, shelfLife: "days", due: null },
        { role: "context", source: ", and ", actionOrdinals: null, shelfLife: null, due: null },
        { role: "action", source: "schedule the email", action: "Schedule the email", thinkingOrdinal: null, shelfLife: "days", due: null },
        { role: "context", source: ".", actionOrdinals: null, shelfLife: null, due: null },
      ],
    });

    expect(value.clean.replace(/\s+/gu, " ")).toBe(source);
    expect(value.clean.match(/\n\n/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(value.actions.map((action) => action.text)).toEqual([
      "Audit onboarding",
      "Rewrite the copy",
      "Ask Nina to review",
      "Schedule the email",
    ]);
    expect(value.actions.every((action) => action.due === "2026-09-25")).toBe(true);
  });

  it("derives thinking relationships and one image owner without duplicated source fields", () => {
    const value = semanticSegmentsToInterpretation({
      title: "Launch and garden",
      segments: [
        { role: "thinking", source: "The launch needs a clearer story.", threadId: "launch", threadName: null, ownsImage: true },
        { role: "context", source: " ", actionOrdinals: null, shelfLife: null, due: null },
        { role: "action", source: "Rewrite the opening.", action: "Rewrite the launch opening", thinkingOrdinal: 1, shelfLife: "days", due: null },
        { role: "context", source: " ", actionOrdinals: null, shelfLife: null, due: null },
        { role: "thinking", source: "The garden bed needs shade plants.", threadId: null, threadName: "Back garden", ownsImage: false },
      ],
    });

    expect(value.actions[0].thinkingIndex).toBe(0);
    expect(value.imageThinkingIndex).toBe(0);
    expect(value.sourceSegments?.map((segment) => segment.text).join("")).toBe(value.clean);
  });

  it("preserves an action while dropping an invalid optional thinking relationship", () => {
    const value = semanticSegmentsToInterpretation({
      title: "Call the dentist",
      segments: [{
        role: "action",
        source: "Call the dentist.",
        action: "Call the dentist",
        thinkingOrdinal: 1,
        shelfLife: "days",
        due: null,
      }],
    });

    expect(value.actions).toEqual([
      expect.objectContaining({ text: "Call the dentist", thinkingIndex: null }),
    ]);
    expect(value.clean).toBe("Call the dentist.");
  });

  it("uses the declared role and safely ignores flat-schema fields from other roles", () => {
    const value = semanticSegmentsToInterpretation({
      title: "Launch direction",
      segments: [{
        role: "thinking",
        source: "The launch needs a clearer story.",
        threadId: null,
        threadName: "Launch direction",
        ownsImage: false,
        action: "Rewrite the launch",
        thinkingOrdinal: 1,
        intention: "I launch calmly",
        actionOrdinals: [1],
        shelfLife: "days",
        due: "2026-09-25",
      }],
    });

    expect(value.thinking).toEqual([{
      text: "The launch needs a clearer story.",
      threadId: null,
      threadName: "Launch direction",
    }]);
    expect(value.actions).toEqual([]);
    expect(value.intention).toBeNull();
  });

  it("rejects context-only and conflicting intention representations", () => {
    expect(() => semanticSegmentsToInterpretation({
      title: "Nothing owned",
      segments: [{ role: "context", source: "An omitted idea.", actionOrdinals: null, shelfLife: null, due: null }],
    })).toThrow(UnsafeSortInterpretationError);
    expect(() => semanticSegmentsToInterpretation({
      title: "Conflict",
      segments: [
        { role: "intention", source: "I live calmly.", intention: "I live calmly" },
        { role: "thinking", source: " A plan.", threadId: null, threadName: "Plan", ownsImage: false },
      ],
    })).toThrow(UnsafeSortInterpretationError);
  });

  it("accepts an exclusive intention with punctuation owned as context", () => {
    const value = semanticSegmentsToInterpretation({
      title: "Calm mornings",
      segments: [
        {
          role: "intention",
          source: "I begin each day calmly",
          intention: "I begin each day calmly",
        },
        { role: "context", source: "." },
      ],
    });

    expect(value.clean).toBe("I begin each day calmly.");
    expect(value.thinking).toEqual([]);
    expect(value.actions).toEqual([]);
    expect(value.intention).toBe("I begin each day calmly");
  });

  it("preserves every source character in the original split-share case", () => {
    const paragraph = "I want to refine my Askde posting strategy so the posts sound like something I would actually say. The current drafts are too polished and keep turning ordinary observations into dramatic lessons. I want to keep the actual experience and uncertainty without inventing dialogue, outcomes, or a motivational ending.";
    expectLosslessThinkingSplit(
      "The navbar needs work.",
      `Separately, ${paragraph}`,
    );
  });

  it.each(["Separately, ", "Also, ", "On a separate note, ", "On another note, "])(
    "preserves detached transition %s as owned source text",
    (prefix) => {
      expectLosslessThinkingSplit(
        `${prefix}I want clearer navigation.`,
        `${prefix}I want human posts.`,
      );
    },
  );

  it.each([
    "Store the files separately, not in a shared folder.",
    "Separately packaged items cost more.",
    "Also available in Vietnamese.",
    "Separately,",
    "I want a calmer voice.\n\nAlso, keep my uncertainty.",
  ])("preserves meaningful wording and internal transitions: %s", (text) => {
    expectLosslessThinkingSplit("The navbar needs work.", text);
  });

  it("files a long-lived creative project as thinking instead of minting one giant action", () => {
    const out = interpretationToSortResult(base({
      clean: "I want to write a book that combines my articles about reality creation, productivity, and health into one coherent book with a unique angle and an interesting title.",
      title: "Reality and productive health",
      thinking: [{
        text: "I want to write a book that combines my articles about reality creation, productivity, and health into one coherent book with a unique angle and an interesting title.",
        threadId: null,
        threadName: "Reality and productive health book",
      }],
    }), { validThreadIds: [] });

    expect(out).toMatchObject({
      kind: "thread",
      actions: [],
      threadId: null,
      threadName: "Reality and productive health book",
    });
  });

  it("derives both from semantic evidence and links only actions assigned to the primary thinking subject", () => {
    const out = interpretationToSortResult(base({
      clean: "I am weighing annual pricing. Fix the pricing calculator. Call Mom.",
      title: "Annual pricing and tasks",
      thinking: [{ text: "I am weighing annual pricing.", threadId: "pricing", threadName: null }],
      actions: [
        { text: "Fix the pricing calculator", thinkingIndex: 0 },
        { text: "Call Mom", thinkingIndex: null },
      ],
    }), { validThreadIds: ["pricing"] });

    expect(out.kind).toBe("both");
    expect(out.actions).toEqual(["Fix the pricing calculator", "Call Mom"]);
    expect(out.primaryActions).toEqual(["Fix the pricing calculator"]);
    expect(out.primaryText).toBe("I am weighing annual pricing.");
  });

  it("keeps several thinking subjects losslessly in primary and also shares", () => {
    const out = interpretationToSortResult(base({
      clean: "Capture should keep rough thoughts. The launch article needs a clearer angle.",
      title: "Capture and launch article",
      thinking: [
        { text: "Capture should keep rough thoughts.", threadId: "capture", threadName: null },
        { text: "The launch article needs a clearer angle.", threadId: null, threadName: "Capture launch article" },
      ],
    }), { validThreadIds: ["capture"] });

    expect(out).toMatchObject({
      kind: "thread",
      threadId: "capture",
      primaryText: "Capture should keep rough thoughts.",
      also: [{ text: "The launch article needs a clearer angle.", threadId: null, threadName: "Capture launch article" }],
    });
  });

  it("derives a pure action from standalone commitments", () => {
    const out = interpretationToSortResult(base({
      clean: "Call the dentist and buy milk.",
      title: "Dentist and milk",
      actions: [
        { text: "Call the dentist", thinkingIndex: null },
        { text: "Buy milk", thinkingIndex: null },
      ],
      shelfLife: "days",
      due: "2026-09-25",
    }), { validThreadIds: [] });

    expect(out.kind).toBe("action");
    expect(out.actions).toEqual(["Call the dentist", "Buy milk"]);
    expect(out.due).toBeNull();
  });

  it("derives an intention when it is the exclusive semantic signal", () => {
    const out = interpretationToSortResult(base({
      clean: "I live somewhere with light.",
      title: "Living with light",
      intention: "I live somewhere with light.",
      sourceSegments: [{ text: "I live somewhere with light.", role: "intention", ownerIndex: 0 }],
    }), { validThreadIds: [] });

    expect(out).toMatchObject({
      kind: "intention",
      actions: [],
      threadId: null,
      threadName: null,
    });
  });

  it("rejects an unforced intention that coexists with thinking", () => {
    const clean = "I live somewhere with light. I am comparing two neighborhoods.";
    expect(() => interpretationToSortResult(base({
      clean,
      intention: "I live somewhere with light.",
      thinking: [{
        text: "I am comparing two neighborhoods.",
        threadId: null,
        threadName: "Neighborhood search",
      }],
      sourceSegments: [
        { text: "I live somewhere with light.", role: "intention", ownerIndex: 0 },
        { text: " ", role: "context", ownerIndex: null },
        { text: "I am comparing two neighborhoods.", role: "thinking", ownerIndex: 0 },
      ],
    }), { validThreadIds: [], requireCompleteSource: true }))
      .toThrow(UnsafeSortInterpretationError);
  });

  it("rejects an unforced intention that coexists with an action", () => {
    const clean = "I live somewhere with light. Call the estate agent.";
    expect(() => interpretationToSortResult(base({
      clean,
      intention: "I live somewhere with light.",
      actions: [{ text: "Call the estate agent", thinkingIndex: null }],
      sourceSegments: [
        { text: "I live somewhere with light.", role: "intention", ownerIndex: 0 },
        { text: " ", role: "context", ownerIndex: null },
        { text: "Call the estate agent.", role: "action", ownerIndex: 0 },
      ],
    }), { validThreadIds: [], requireCompleteSource: true }))
      .toThrow(UnsafeSortInterpretationError);
  });

  it("rejects an unforced intention that coexists with thinking and actions", () => {
    const clean = "I live somewhere with light. I am comparing neighborhoods. Call the estate agent.";
    expect(() => interpretationToSortResult(base({
      clean,
      intention: "I live somewhere with light.",
      thinking: [{
        text: "I am comparing neighborhoods.",
        threadId: null,
        threadName: "Neighborhood search",
      }],
      actions: [{ text: "Call the estate agent", thinkingIndex: 0 }],
      sourceSegments: [
        { text: "I live somewhere with light.", role: "intention", ownerIndex: 0 },
        { text: " ", role: "context", ownerIndex: null },
        { text: "I am comparing neighborhoods.", role: "thinking", ownerIndex: 0 },
        { text: " ", role: "context", ownerIndex: null },
        { text: "Call the estate agent.", role: "action", ownerIndex: 0 },
      ],
    }), { validThreadIds: [], requireCompleteSource: true }))
      .toThrow(UnsafeSortInterpretationError);
  });

  it("keeps an explicit forced intention authoritative over conflicting model evidence", () => {
    const out = interpretationToSortResult(base({
      clean: "I live somewhere with light. Call the estate agent.",
      intention: "I live somewhere with light.",
      actions: [{ text: "Call the estate agent", thinkingIndex: null }],
    }), { force: "intention", validThreadIds: [], requireCompleteSource: true });

    expect(out.kind).toBe("intention");
    expect(out.actions).toEqual([]);
  });

  it("makes a forced thread authoritative even when the model returned an action", () => {
    const out = interpretationToSortResult(base({
      clean: "Draft a book from the articles.",
      title: "Book from articles",
      actions: [{ text: "Draft a book from the articles", thinkingIndex: null }],
    }), { force: "thread", validThreadIds: [] });

    expect(out).toMatchObject({
      kind: "thread",
      actions: [],
      primaryText: null,
      threadName: "Book from articles",
    });
  });

  it("keeps the complete capture when a forced action lacks a model-extracted action", () => {
    const clean = "Draft the launch post, include the screenshots, and send it to Maya.";
    const out = interpretationToSortResult(base({
      clean,
      title: "Launch post",
    }), { force: "action", validThreadIds: [] });

    expect(out).toMatchObject({
      kind: "action",
      actions: [clean],
      threadId: null,
    });
  });

  it("does not trust a model-provided thread id outside the supplied candidates", () => {
    const out = interpretationToSortResult(base({
      thinking: [{ text: "A pricing thought.", threadId: "invented", threadName: "Pricing" }],
    }), { validThreadIds: ["real"] });

    expect(out.threadId).toBeNull();
    expect(out.threadName).toBe("Pricing");
  });

  it("retains action relationships to secondary thinking subjects", () => {
    const out = interpretationToSortResult(base({
      thinking: [
        { text: "Capture should stay simple.", threadId: "capture", threadName: null },
        { text: "Retake playback needs work.", threadId: "retake", threadName: null },
      ],
      actions: [
        { text: "Test Retake playback on mobile", thinkingIndex: 1 },
        { text: "Call mom", thinkingIndex: null },
      ],
    }), { validThreadIds: ["capture", "retake"] });

    expect(out.also).toEqual([expect.objectContaining({
      threadId: "retake",
      actions: ["Test Retake playback on mobile"],
    })]);
    expect(out.primaryActions).toBeNull();
  });

  it("preserves the source when a provider returns a schema-valid empty edit", () => {
    const source = "Keep every word of this capture even if the provider returns empty fields.";
    const out = interpretationToSortResult(base({ clean: "", title: "" }), {
      validThreadIds: [],
      fallbackText: source,
    });

    expect(out).toMatchObject({
      clean: source,
      kind: "thread",
      title: source.slice(0, MAX_FALLBACK_TITLE_CHARS),
      threadName: source.slice(0, MAX_FALLBACK_TITLE_CHARS),
    });
    expect(out.clean).toBe(source);
  });

  it("treats an out-of-range action relationship as independent", () => {
    const out = interpretationToSortResult(base({
      thinking: [{ text: "Capture should stay simple.", threadId: "capture", threadName: null }],
      actions: [{ text: "Call mom", thinkingIndex: 8 }],
    }), { validThreadIds: ["capture"] });

    expect(out.kind).toBe("both");
    expect(out.primaryActions).toBeNull();
    expect(out.actions).toEqual(["Call mom"]);
  });

  it("keeps action relationships stable when an earlier blank thinking share is discarded", () => {
    const out = interpretationToSortResult(base({
      thinking: [
        { text: " ", threadId: null, threadName: null },
        { text: "Retake playback needs work.", threadId: "retake", threadName: null },
      ],
      actions: [{ text: "Test Retake playback on mobile", thinkingIndex: 1 }],
    }), { validThreadIds: ["retake"] });

    expect(out.threadId).toBe("retake");
    expect(out.primaryActions).toEqual(["Test Retake playback on mobile"]);
  });

  it("rejects semantic anchors that are missing from or overlap in the source", () => {
    const clean = "Alpha thought. Buy milk. Beta thought.";
    const options = { validThreadIds: [] as string[], fallbackText: clean, requireCompleteSource: true };
    expect(() => interpretationToSortResult(base({
      clean,
      thinking: [{ text: "Gamma thought.", threadId: null, threadName: "Gamma" }],
      actions: [{ text: "Buy milk", sourceText: "Buy milk.", thinkingIndex: null }],
    }), options)).toThrow(UnsafeSortInterpretationError);

    expect(() => interpretationToSortResult(base({
      clean,
      thinking: [
        { text: "Alpha thought. Buy milk.", threadId: null, threadName: "Alpha" },
        { text: "Buy milk. Beta thought.", threadId: null, threadName: "Beta" },
      ],
    }), options)).toThrow(UnsafeSortInterpretationError);
  });

  it("preserves contextual deadline and connective text while extracting four short actions", () => {
    const clean = "Before Friday, audit the onboarding flow, rewrite the empty-state copy, ask Nina to review the privacy wording, and schedule the release email.";
    const out = interpretationToSortResult(base({
      clean,
      title: "Friday launch tasks",
      actions: [
        { text: "Audit the onboarding flow", sourceText: "Before Friday, audit the onboarding flow,", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
        { text: "Rewrite the empty-state copy", sourceText: "rewrite the empty-state copy,", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
        { text: "Ask Nina to review the privacy wording", sourceText: "ask Nina to review the privacy wording,", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
        { text: "Schedule the release email", sourceText: "and schedule the release email.", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
      ],
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out.kind).toBe("action");
    expect(out.actions).toEqual([
      "Audit the onboarding flow",
      "Rewrite the empty-state copy",
      "Ask Nina to review the privacy wording",
      "Schedule the release email",
    ]);
    const actionMeta = out.actionMeta ?? [];
    expect(actionMeta.map((action) => action.source).join(" ").replace(/\s+/gu, " "))
      .toBe(clean);
    expect(actionMeta.every((action) => action.due === "2026-09-25")).toBe(true);
  });

  it("accepts an explicit ordered context/action partition without assigning shared syntax to an action", () => {
    const clean = "Before Friday, audit onboarding, rewrite the copy, and schedule the email.";
    const out = interpretationToSortResult(base({
      clean,
      title: "Friday launch tasks",
      actions: [
        { text: "Audit onboarding", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
        { text: "Rewrite the copy", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
        { text: "Schedule the email", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
      ],
      sourceSegments: [
        { text: "Before Friday, ", role: "context", ownerIndex: null },
        { text: "audit onboarding", role: "action", ownerIndex: 0 },
        { text: ", ", role: "context", ownerIndex: null },
        { text: "rewrite the copy", role: "action", ownerIndex: 1 },
        { text: ", and ", role: "context", ownerIndex: null },
        { text: "schedule the email", role: "action", ownerIndex: 2 },
        { text: ".", role: "context", ownerIndex: null },
      ],
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out.clean).toBe(clean);
    expect(out.actionMeta?.map((action) => action.source)).toEqual([
      "audit onboarding",
      "rewrite the copy",
      "schedule the email",
    ]);
    expect(out.actions).toEqual(["Audit onboarding", "Rewrite the copy", "Schedule the email"]);
  });

  it("permits only omitted formatting whitespace between ordered semantic spans", () => {
    const clean = "I am weighing two approaches.\n\nSend the comparison tomorrow.";
    const out = interpretationToSortResult(base({
      clean,
      thinking: [{ text: "I am weighing two approaches.", threadId: null, threadName: "Approach comparison" }],
      actions: [{ text: "Send the comparison", thinkingIndex: 0, shelfLife: "days", due: "2026-09-25" }],
      sourceSegments: [
        { text: "I am weighing two approaches.", role: "thinking", ownerIndex: 0 },
        { text: "Send the comparison tomorrow.", role: "action", ownerIndex: 0 },
      ],
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out.clean).toBe(clean);
    expect(out.kind).toBe("both");
    expect(out.actions).toEqual(["Send the comparison"]);
  });

  it("normalizes a consistently one-based semantic owner index without changing meaning", () => {
    const clean = "The back garden may need raised beds.";
    const out = interpretationToSortResult(base({
      clean,
      thinking: [{ text: clean, threadId: null, threadName: "Back garden" }],
      sourceSegments: [{ text: clean, role: "thinking", ownerIndex: 1 }],
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out).toMatchObject({ kind: "thread", threadName: "Back garden" });
  });

  it("uses ordered role occurrences when a provider emits global semantic indexes", () => {
    const clean = "First thought. Second thought. Send it. Archive it.";
    const out = interpretationToSortResult(base({
      clean,
      thinking: [
        { text: "First thought.", threadId: null, threadName: "First" },
        { text: "Second thought.", threadId: null, threadName: "Second" },
      ],
      actions: [
        { text: "Send it", thinkingIndex: null },
        { text: "Archive it", thinkingIndex: null },
      ],
      sourceSegments: [
        { text: "First thought.", role: "thinking", ownerIndex: 0 },
        { text: "Second thought.", role: "thinking", ownerIndex: 1 },
        { text: "Send it.", role: "action", ownerIndex: 2 },
        { text: "Archive it.", role: "action", ownerIndex: 3 },
      ],
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out.actions).toEqual(["Send it", "Archive it"]);
    expect(out.actionMeta?.map((action) => action.source)).toEqual(["Send it.", "Archive it."]);
  });

  it("does not pretend structural validation can identify semantic context misuse", () => {
    const clean = "Buy milk, and call the doctor.";
    const out = interpretationToSortResult(base({
      clean,
      actions: [{ text: "Buy milk", thinkingIndex: null }],
      sourceSegments: [
        { text: "Buy milk", role: "action", ownerIndex: 0 },
        { text: ", and call the doctor.", role: "context", ownerIndex: null },
      ],
    }), { validThreadIds: [], requireCompleteSource: true });

    // Exact source coverage is mechanically valid. Whether the provider hid
    // meaningful content in context is a semantic judgment exercised by the
    // real-provider adversarial suite, not by words or punctuation here.
    expect(out.actions).toEqual(["Buy milk"]);
  });

  it("rejects invalid explicit context action owners", () => {
    const clean = "By Friday, ship it.";
    expect(() => interpretationToSortResult(base({
      clean,
      actions: [{ text: "Ship it", thinkingIndex: null }],
      sourceSegments: [
        { text: "By Friday, ", role: "context", ownerIndex: null, actionOwnerIndexes: [1] },
        { text: "ship it.", role: "action", ownerIndex: 0 },
      ],
    }), { validThreadIds: [], requireCompleteSource: true }))
      .toThrow(UnsafeSortInterpretationError);
  });

  it("accepts repeated text when ordered segments assign each occurrence to one owner", () => {
    const out = interpretationToSortResult(base({
      clean: "repeat repeat",
      actions: [
        { text: "First repeat", thinkingIndex: null },
        { text: "Second repeat", thinkingIndex: null },
      ],
      sourceSegments: [
        { text: "repeat", role: "action", ownerIndex: 0 },
        { text: " ", role: "context", ownerIndex: null },
        { text: "repeat", role: "action", ownerIndex: 1 },
      ],
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out.actionMeta?.map((action) => action.source)).toEqual(["repeat", "repeat"]);
  });

  it("requires ordered source segments to preserve every character exactly", () => {
    const clean = "Plan A:\n\tcall Maya — then ship.  ";
    const out = interpretationToSortResult(base({
      clean,
      actions: [
        { text: "Call Maya", thinkingIndex: null },
        { text: "Ship", thinkingIndex: null },
      ],
      sourceSegments: [
        { text: "Plan A:\n\t", role: "context", ownerIndex: null },
        { text: "call Maya", role: "action", ownerIndex: 0 },
        { text: " — then ", role: "context", ownerIndex: null },
        { text: "ship", role: "action", ownerIndex: 1 },
        { text: ".  ", role: "context", ownerIndex: null },
      ],
    }), { validThreadIds: [], requireCompleteSource: true });
    expect(out.clean).toBe(clean);
  });

  it("matches ordinary split pieces by source interval even when the provider returns them out of order", () => {
    const clean = "Alpha thought. Buy milk. Beta thought.";
    const out = interpretationToSortResult(base({
      clean,
      thinking: [
        { text: "Beta thought.", threadId: null, threadName: "Beta" },
        { text: "Alpha thought.", threadId: null, threadName: "Alpha" },
      ],
      actions: [{
        text: "Buy milk",
        sourceText: "Buy milk.",
        thinkingIndex: null,
      }],
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out.kind).toBe("both");
    expect(out.actions).toEqual(["Buy milk"]);
    expect(out.primaryText).toBe("Beta thought.");
    expect(out.also).toEqual([expect.objectContaining({ text: "Alpha thought." })]);
  });

  it("fails closed within a pinned fast bound for repeated-token malformed output", () => {
    const token = "repeat";
    const clean = Array.from({ length: 64 }, () => token).join(" ");
    const malformed = Array.from({ length: 65 }, () => ({
      text: token,
      threadId: null,
      threadName: "Repeated",
    }));
    const started = performance.now();

    expect(() => interpretationToSortResult(base({ clean, thinking: malformed }), {
      validThreadIds: [],
      requireCompleteSource: true,
    })).toThrow(UnsafeSortInterpretationError);

    expect(performance.now() - started).toBeLessThan(25);
  });

  it("fails closed on repeated exact spans whose owners would be ambiguous", () => {
    const token = "repeat";
    const clean = Array.from({ length: 64 }, () => token).join(" ");
    expect(() => interpretationToSortResult(base({
      clean,
      thinking: Array.from({ length: 64 }, () => ({
        text: token,
        threadId: null,
        threadName: "Repeated",
      })),
    }), { validThreadIds: [], requireCompleteSource: true }))
      .toThrow(UnsafeSortInterpretationError);
  });

  it("rejects unowned non-whitespace instead of hiding it in an adjacent action", () => {
    const clean = "Buy milk. Call the doctor.";
    expect(() => interpretationToSortResult(base({
      clean,
      actions: [{
        text: "Buy milk",
        sourceText: "Buy milk.",
        thinkingIndex: null,
      }],
    }), { validThreadIds: [], requireCompleteSource: true }))
      .toThrow(UnsafeSortInterpretationError);
  });

  it("coalesces duplicate destinations without duplicating source coverage", () => {
    const out = interpretationToSortResult(base({
      clean: "First observation. Second observation.",
      thinking: [
        { text: "First observation.", threadId: "capture", threadName: null },
        { text: "Second observation.", threadId: "capture", threadName: null },
      ],
    }), { validThreadIds: ["capture"] });

    expect(out.threadId).toBe("capture");
    expect(out.clean).toBe("First observation. Second observation.");
    expect(out.primaryText).toBeNull();
    expect(out.also).toBeNull();
  });

  it("keeps per-action source, timing and shelf ownership", () => {
    const out = interpretationToSortResult(base({
      clean: "Call Maya Friday. Buy milk today.",
      actions: [
        { text: "Call Maya Friday", sourceText: "Call Maya Friday.", thinkingIndex: null, due: "2026-09-25", shelfLife: "keep" },
        { text: "Buy milk today", sourceText: "Buy milk today.", thinkingIndex: null, due: "2026-09-23", shelfLife: "hours" },
      ],
    }), { validThreadIds: [] });

    expect(out.actionMeta).toEqual([
      expect.objectContaining({ text: "Call Maya Friday", source: "Call Maya Friday.", due: "2026-09-25", shelfLife: "keep" }),
      expect.objectContaining({ text: "Buy milk today", source: "Buy milk today.", due: "2026-09-23", shelfLife: "hours" }),
    ]);
    expect(out.due).toBeNull();
  });

  it("marks the exact thinking share that owns an attached image", () => {
    const out = interpretationToSortResult(base({
      clean: "Capture thought. Retake screenshot.",
      thinking: [
        { text: "Capture thought.", threadId: "capture", threadName: null },
        { text: "Retake screenshot.", threadId: "retake", threadName: null },
      ],
      imageThinkingIndex: 1,
    }), { validThreadIds: ["capture", "retake"], hasImage: true });

    expect(out.primaryOwnsImages).toBe(false);
    expect(out.also).toEqual([expect.objectContaining({ threadId: "retake", ownsImages: true })]);
  });

  it("parks an image-backed thinking result when no valid share owns the image", () => {
    expect(() => interpretationToSortResult(base({
      clean: "A screenshot worth keeping.",
      thinking: [{ text: "A screenshot worth keeping.", threadId: null, threadName: "Screenshot" }],
      imageThinkingIndex: null,
    }), { validThreadIds: [], hasImage: true })).toThrow(UnsafeSortInterpretationError);
  });
});
