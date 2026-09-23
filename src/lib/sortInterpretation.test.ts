import { describe, expect, it } from "vitest";
import { reconcileSorted } from "./sort";
import {
  MAX_FALLBACK_TITLE_CHARS,
  UnsafeSortInterpretationError,
  interpretationToSortResult,
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

  it("derives an intention only when the capture's sole semantic signal is a desired state", () => {
    const out = interpretationToSortResult(base({
      clean: "I live somewhere with light.",
      title: "Living with light",
      intention: "I live somewhere with light.",
    }), { validThreadIds: [] });

    expect(out).toMatchObject({
      kind: "intention",
      actions: [],
      threadId: null,
      threadName: null,
    });
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

  it("rejects a decomposition that omits or overlaps non-whitespace source text", () => {
    const clean = "Alpha thought. Buy milk. Beta thought.";
    const options = { validThreadIds: [] as string[], fallbackText: clean, requireCompleteSource: true };
    expect(() => interpretationToSortResult(base({
      clean,
      thinking: [{ text: "Alpha thought.", threadId: null, threadName: "Alpha" }],
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

  it("accepts complete repeated-token splits without recursive permutation search", () => {
    const token = "repeat";
    const clean = Array.from({ length: 64 }, () => token).join(" ");
    const out = interpretationToSortResult(base({
      clean,
      thinking: Array.from({ length: 64 }, () => ({
        text: token,
        threadId: null,
        threadName: "Repeated",
      })),
    }), { validThreadIds: [], requireCompleteSource: true });

    expect(out.kind).toBe("thread");
    expect(out.clean).toBe(clean);
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
