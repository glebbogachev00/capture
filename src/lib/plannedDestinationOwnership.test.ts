import { describe, expect, it, vi } from "vitest";
import type { SortResult } from "./boardOps";
import {
  DestinationOwnershipAdjudicationError,
  adjudicatePlannedDestinationOwnership,
  type DestinationOwnershipAdjudication,
} from "./plannedDestinationOwnership";
import { validateRoutingPlan, type PlannedRoutingPlan, type RoutingPlanContext } from "./plannedRouting";

const recovery: SortResult = {
  clean: "synthetic",
  kind: "thread",
  title: "Synthetic",
  actions: [],
  primaryActions: [],
  shelfLife: "keep",
  due: null,
  threadId: "bread",
  threadName: null,
  primaryText: null,
  also: [],
};

const threads = [
  { id: "bread", name: "Bread trials", about: "Sourdough proofing and crumb experiments." },
  { id: "astronomy", name: "Astronomy notes", about: "Telescope setup and observing conditions." },
];

const thought = (
  id: string,
  source: string,
  destinations: PlannedRoutingPlan["items"][number]["destinations"],
) => ({
  id,
  source,
  kind: "developing_thought" as const,
  action: null,
  due: null,
  ownerId: null,
  destinations,
  duplicateActionId: null,
  unresolved: false,
  ambiguity: null,
});

const action = (id: string, source: string, text: string) => ({
  id,
  source,
  kind: "action" as const,
  action: text,
  due: null,
  ownerId: null,
  destinations: [],
  duplicateActionId: null,
  unresolved: false,
  ambiguity: null,
});

const deadline = (id: string, source: string, ownerId: string, due: string) => ({
  id,
  source,
  kind: "deadline" as const,
  action: null,
  due,
  ownerId,
  destinations: [],
  duplicateActionId: null,
  unresolved: false,
  ambiguity: null,
});

const context = (raw: string): RoutingPlanContext => ({
  captureId: "destination-ownership",
  raw,
  threads,
  actions: [],
  recovery: { ...recovery, clean: raw },
  now: new Date("2026-09-29T12:00:00+07:00").getTime(),
});

const adjudication = (
  ...decisions: DestinationOwnershipAdjudication["decisions"]
): DestinationOwnershipAdjudication => ({ decisions });

const existing = (threadId: string) => ({ type: "existing" as const, threadId });
const indivisible = (
  itemId: string,
  destinations: PlannedRoutingPlan["items"][number]["destinations"],
) => ({ itemId, mode: "indivisible" as const, destinations });
const split = (
  itemId: string,
  ...spans: Array<{
    start: number;
    end: number;
    destinations: PlannedRoutingPlan["items"][number]["destinations"];
  }>
) => ({ itemId, mode: "split" as const, spans });

function withoutBoundaryFields(item: PlannedRoutingPlan["items"][number]) {
  const { id, source, destinations, ...rest } = item;
  void id;
  void source;
  void destinations;
  return rest;
}

describe("model-owned planned destination and subject boundaries", () => {
  it("applies model abstention to the exact thought and preserves source and all other fields", async () => {
    const raw = "🍞  That one’s approach needs changing.\n";
    const proposed: PlannedRoutingPlan = {
      items: [thought("uncertain", raw, [existing("bread")])], newThreads: [],
    };
    const snapshot = structuredClone(proposed);
    const ambiguity = "The referent is not identified.";
    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed, context: context(raw),
      generate: vi.fn().mockResolvedValue({ decisions: [
        { itemId: "uncertain", mode: "unresolved", ambiguity },
      ] }),
    });
    expect(result).toEqual({ ...proposed, items: [{
      ...proposed.items[0], unresolved: true, ambiguity, destinations: [],
    }] });
    expect(proposed).toEqual(snapshot);
    const generate = vi.fn();
    expect(validateRoutingPlan(result, context(raw))).toEqual([]);
    expect(validateRoutingPlan({ ...result, items: [{
      ...result.items[0], unresolved: false, ambiguity: null,
    }] }, context(raw))).toContainEqual({ code: "TOPIC_WITHOUT_DESTINATION", itemId: "uncertain" });
    expect(await adjudicatePlannedDestinationOwnership({
      plan: result, context: context(raw), generate,
    })).toEqual(result);
    expect(generate).not.toHaveBeenCalled();
  });

  it("prunes only new declarations orphaned by abstention while preserving mixed items and shared references", async () => {
    const fresh = (key: string) => ({ type: "new" as const, newThreadKey: key });
    const proposed: PlannedRoutingPlan = {
      items: [
        thought("uncertain", "That approach. ", [fresh("orphan")]),
        thought("shared-uncertain", "That archive. ", [fresh("retained")]),
        thought("certain", "Keep the lunar drawings. ", [fresh("retained")]),
        action("photo", "Photograph the loaf", "Photograph the loaf tomorrow"),
        deadline("due", " tomorrow. ", "photo", "2026-09-30"),
        { ...thought("intention", "I value patience. ", []), kind: "intention" },
        { ...thought("already-unresolved", "Something else?", []), unresolved: true, ambiguity: "Unknown subject." },
      ],
      newThreads: ["orphan", "retained"].map((key) => ({
        key, name: key, closestExistingThreadId: "astronomy", whyNew: "Distinct archive subject.",
      })),
    };
    const raw = proposed.items.map((item) => item.source).join("");
    const snapshot = structuredClone(proposed);
    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed, context: context(raw),
      generate: vi.fn().mockResolvedValue({ decisions: [
        { itemId: "uncertain", mode: "unresolved", ambiguity: "No justified destination." },
        { itemId: "shared-uncertain", mode: "unresolved", ambiguity: "Referent is ambiguous." },
        indivisible("certain", [fresh("retained")]),
      ] }),
    });
    expect(result.items.slice(2)).toEqual(snapshot.items.slice(2));
    expect(result.items.slice(0, 2)).toEqual(snapshot.items.slice(0, 2).map((item, index) => ({
      ...item, unresolved: true, destinations: [],
      ambiguity: index === 0 ? "No justified destination." : "Referent is ambiguous.",
    })));
    expect(result.newThreads).toEqual([snapshot.newThreads[1]]);
    expect(result.items.map((item) => item.source).join("")).toBe(raw);
    expect(proposed).toEqual(snapshot);
    expect(await adjudicatePlannedDestinationOwnership({
      plan: result, context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(indivisible("certain", [fresh("retained")]))),
    })).toEqual(result);
  });

  it("supplies advisory corrections without forcing a shared-word match instead of abstention", async () => {
    const raw = "That release needs a better owner.";
    const correctionExamples = [{ capture: "Release the bread trial.", threadId: "bread" }];
    const generate = vi.fn().mockResolvedValue({ decisions: [
      { itemId: "uncertain", mode: "unresolved", ambiguity: "The referent is ambiguous." },
    ] });
    const result = await adjudicatePlannedDestinationOwnership({
      plan: { items: [thought("uncertain", raw, [existing("bread")])], newThreads: [] },
      context: context(raw), correctionExamples, generate,
    });
    expect(result.items[0].destinations).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = generate.mock.calls[0][0];
    expect(prompt).toContain(JSON.stringify(correctionExamples));
    expect(prompt).toContain('"mode": "unresolved"');
    expect(prompt).toContain("no supplied existing destination or declared new key can be justified");
    expect(prompt).toContain("referent is ambiguous");
    expect(prompt).toContain("Corrections are advisory");
    expect(prompt).not.toContain("Intentions, unresolved state, ambiguity, or provenance");
  });

  it.each([
    ["missing reason", { itemId: "uncertain", mode: "unresolved" }, "OUTPUT_SCHEMA_INVALID"],
    ["empty reason", { itemId: "uncertain", mode: "unresolved", ambiguity: "" }, "OUTPUT_SCHEMA_INVALID"],
    ["blank reason", { itemId: "uncertain", mode: "unresolved", ambiguity: " \n " }, "OUTPUT_SCHEMA_INVALID"],
    ["long reason", { itemId: "uncertain", mode: "unresolved", ambiguity: "x".repeat(241) }, "OUTPUT_SCHEMA_INVALID"],
    ["wrong reason type", { itemId: "uncertain", mode: "unresolved", ambiguity: 1 }, "OUTPUT_SCHEMA_INVALID"],
    ["destinations forbidden", { itemId: "uncertain", mode: "unresolved", ambiguity: "Unclear.", destinations: [] }, "OUTPUT_SCHEMA_INVALID"],
    ["source forbidden", { itemId: "uncertain", mode: "unresolved", ambiguity: "Unclear.", source: "replacement" }, "OUTPUT_SCHEMA_INVALID"],
    ["unknown id", { itemId: "unknown", mode: "unresolved", ambiguity: "Unclear." }, "COVERAGE_INVALID"],
  ])("rejects unresolved %s without mutating the input", async (_label, decision, code) => {
    const raw = "That one.";
    const proposed: PlannedRoutingPlan = { items: [thought("uncertain", raw, [existing("bread")])], newThreads: [] };
    const snapshot = structuredClone(proposed);
    await expect(adjudicatePlannedDestinationOwnership({
      plan: proposed, context: context(raw), generate: vi.fn().mockResolvedValue({ decisions: [decision] }),
    })).rejects.toMatchObject({ code });
    expect(proposed).toEqual(snapshot);
  });

  it.each(["missing", "duplicate"])("rejects %s decisions when abstention is present", async (mode) => {
    const raw = "That one. Bread opens.";
    const decision = { itemId: "uncertain", mode: "unresolved", ambiguity: "Unclear." };
    await expect(adjudicatePlannedDestinationOwnership({
      plan: { items: [thought("uncertain", "That one. ", [existing("bread")]), thought("certain", "Bread opens.", [existing("bread")])], newThreads: [] },
      context: context(raw), generate: vi.fn().mockResolvedValue({ decisions: mode === "missing" ? [decision] : [decision, decision] }),
    })).rejects.toMatchObject({ code: "COVERAGE_INVALID" });
  });

  it("does not hide a pre-existing unreferenced new declaration during abstention", async () => {
    const raw = "That one.";
    await expect(adjudicatePlannedDestinationOwnership({
      plan: { items: [thought("uncertain", raw, [existing("bread")])], newThreads: [{
        key: "unused", name: "Unused archive", closestExistingThreadId: "bread", whyNew: "Different subject.",
      }] },
      context: context(raw), generate: vi.fn().mockResolvedValue({ decisions: [
        { itemId: "uncertain", mode: "unresolved", ambiguity: "Unclear." },
      ] }),
    })).rejects.toMatchObject({ code: "FINAL_PLAN_INVALID" });
  });

  it("splits two independent subjects inside one sentence and gives each only its owner", async () => {
    const raw = "Bread crumb opens after a cooler proof, while telescope lenses fog near dawn.";
    const proposed: PlannedRoutingPlan = {
      items: [thought("mixed", raw, [existing("bread"), existing("astronomy")])],
      newThreads: [],
    };

    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(split("mixed",
        { start: 0, end: 40, destinations: [existing("bread")] },
        { start: 40, end: [...raw].length, destinations: [existing("astronomy")] },
      ))),
    });

    expect(result.items.map(({ source, destinations }) => ({ source, destinations }))).toEqual([
      { source: "Bread crumb opens after a cooler proof, ", destinations: [existing("bread")] },
      { source: "while telescope lenses fog near dawn.", destinations: [existing("astronomy")] },
    ]);
    expect(result.items.map((item) => item.source).join("")).toBe(raw);
    expect(result.items[0].id).toBe("mixed");
    expect(result.items[1].id).not.toBe("mixed");
  });

  it("preserves one genuinely indivisible thought with several destinations", async () => {
    const raw = "The shared humidity observation changes both dough proofing and telescope storage.";
    const proposed: PlannedRoutingPlan = {
      items: [thought("shared", raw, [existing("bread"), existing("astronomy")])],
      newThreads: [],
    };

    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(
        indivisible("shared", [existing("bread"), existing("astronomy")]),
      )),
    });

    expect(result).toEqual(proposed);
  });

  it("supplies bounded Thread correction evidence to the destination decision", async () => {
    const raw = "The final release passage should make the ownership transfer obvious without another control.";
    const proposed: PlannedRoutingPlan = {
      items: [thought("release", raw, [existing("astronomy")])],
      newThreads: [],
    };
    const correctionExamples = [{
      capture: "The ship handoff needs a clearer owner before Capture goes out.",
      threadId: "bread",
      threadName: "Bread trials",
    }];
    let receivedPrompt = "";

    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      correctionExamples,
      generate: vi.fn().mockImplementation(async (prompt) => {
        receivedPrompt = prompt;
        return adjudication(indivisible("release", [existing("bread")]));
      }),
    });

    expect(receivedPrompt).toContain(JSON.stringify(correctionExamples));
    expect(result.items[0].destinations).toEqual([existing("bread")]);
  });

  it("changes only destination and subject-boundary fields around two Actions and their deadlines", async () => {
    const raw = "Bread crumb opens after a cooler proof, while telescope lenses fog near dawn. Photograph the loaf tomorrow. Calibrate the heater next Friday.";
    const proposed: PlannedRoutingPlan = {
      items: [
        thought("mixed", "Bread crumb opens after a cooler proof, while telescope lenses fog near dawn. ", [existing("bread"), existing("astronomy")]),
        action("photo", "Photograph the loaf", "Photograph the loaf tomorrow"),
        deadline("photo-due", " tomorrow. ", "photo", "2026-09-30"),
        action("heater", "Calibrate the heater", "Calibrate the heater next Friday"),
        deadline("heater-due", " next Friday.", "heater", "2026-10-02"),
      ],
      newThreads: [],
    };
    const immutableItems = structuredClone(proposed.items.slice(1));

    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(split("mixed",
        { start: 0, end: 40, destinations: [existing("bread")] },
        { start: 40, end: 78, destinations: [existing("astronomy")] },
      ))),
    });

    expect(result.items.slice(2)).toEqual(immutableItems);
    expect(result.items.slice(0, 2).map(withoutBoundaryFields)).toEqual([
      withoutBoundaryFields(proposed.items[0]),
      withoutBoundaryFields(proposed.items[0]),
    ]);
    expect(result.items.map((item) => item.source).join("")).toBe(raw);
  });

  it.each([
    ["missing decision", adjudication()],
    ["unknown item", adjudication(indivisible("unknown", [existing("bread")]))],
    ["duplicate decision", adjudication(
      indivisible("mixed", [existing("bread")]),
      indivisible("mixed", [existing("astronomy")]),
    )],
    ["overlapping source", adjudication(split("mixed",
      { start: 0, end: 11, destinations: [existing("bread")] },
      { start: 10, end: 16, destinations: [existing("astronomy")] },
    ))],
    ["unknown destination", adjudication(indivisible("mixed", [existing("missing")]))],
  ])("fails closed on %s without partially applying ownership", async (_label, output) => {
    const raw = "Bread and stars.";
    const proposed: PlannedRoutingPlan = {
      items: [thought("mixed", raw, [existing("bread"), existing("astronomy")])],
      newThreads: [],
    };

    await expect(adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(output),
    })).rejects.toBeInstanceOf(DestinationOwnershipAdjudicationError);
    expect(proposed.items[0].source).toBe(raw);
  });

  it.each([
    ["missing decision", adjudication(), "COVERAGE_INVALID"],
    ["source partition gap", adjudication(split("mixed",
      { start: 0, end: 5, destinations: [existing("bread")] },
      { start: 6, end: 16, destinations: [existing("astronomy")] },
    )), "SOURCE_PARTITION_INVALID"],
    ["unknown destination", adjudication(indivisible("mixed", [existing("missing")])), "DESTINATION_ID_INVALID"],
  ])("exposes fixed privacy-safe rejection code for %s", async (_label, output, code) => {
    const raw = "Bread and stars.";
    try {
      await adjudicatePlannedDestinationOwnership({
        plan: { items: [thought("mixed", raw, [existing("bread"), existing("astronomy")])], newThreads: [] },
        context: context(raw),
        generate: vi.fn().mockResolvedValue(output),
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DestinationOwnershipAdjudicationError);
      expect((error as DestinationOwnershipAdjudicationError).code).toBe(code);
    }
  });

  it("preserves new Threads, Intention boundaries, and unresolved content byte-for-byte", async () => {
    const raw = "A lunar sketch archive needs its own home. I protect slow observation. This last fragment is unclear.";
    const newThread = {
      key: "lunar-sketches",
      name: "Lunar sketch archive",
      closestExistingThreadId: "astronomy",
      whyNew: "The archive concerns drawings rather than telescope setup notes.",
    };
    const proposed: PlannedRoutingPlan = {
      items: [
        thought("archive", "A lunar sketch archive needs its own home. ", [{ type: "new", newThreadKey: "lunar-sketches" }]),
        {
          id: "intention",
          source: "I protect slow observation. ",
          kind: "intention",
          action: null,
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "unclear",
          source: "This last fragment is unclear.",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: true,
          ambiguity: "The intended subject is not stated.",
        },
      ],
      newThreads: [newThread],
    };
    const snapshot = structuredClone(proposed);

    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(indivisible(
        "archive",
        [{ type: "new", newThreadKey: "lunar-sketches" }],
      ))),
    });

    expect(result).toEqual(snapshot);
  });

  it("fails closed rather than guessing how to re-parent owned supporting context after a split", async () => {
    const raw = "Bread changes, while stars blur. That comparison came from yesterday's notes.";
    const proposed: PlannedRoutingPlan = {
      items: [
        thought("mixed", "Bread changes, while stars blur. ", [existing("bread"), existing("astronomy")]),
        {
          id: "context",
          source: "That comparison came from yesterday's notes.",
          kind: "supporting_context",
          action: null,
          due: null,
          ownerId: "mixed",
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [],
    };

    await expect(adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(split("mixed",
        { start: 0, end: 15, destinations: [existing("bread")] },
        { start: 15, end: 33, destinations: [existing("astronomy")] },
      ))),
    })).rejects.toBeInstanceOf(DestinationOwnershipAdjudicationError);
  });

  it("preserves provider failure identity for route-owned fallback", async () => {
    const raw = "Bread and stars.";
    const failure = new Error("provider unavailable");
    await expect(adjudicatePlannedDestinationOwnership({
      plan: { items: [thought("mixed", raw, [existing("bread"), existing("astronomy")])], newThreads: [] },
      context: context(raw),
      generate: () => Promise.reject(failure),
    })).rejects.toBe(failure);
  });

  it("preserves deadline abort identity for route-owned fallback", async () => {
    const raw = "Bread and stars.";
    const failure = new DOMException("timed out", "AbortError");
    await expect(adjudicatePlannedDestinationOwnership({
      plan: { items: [thought("mixed", raw, [existing("bread"), existing("astronomy")])], newThreads: [] },
      context: context(raw),
      generate: () => Promise.reject(failure),
    })).rejects.toBe(failure);
  });

  it("is stable under repeated invocation", async () => {
    const raw = "Bread crumb changes, while telescope lenses fog.";
    const initial: PlannedRoutingPlan = {
      items: [thought("mixed", raw, [existing("bread"), existing("astronomy")])],
      newThreads: [],
    };
    const first = await adjudicatePlannedDestinationOwnership({
      plan: initial,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(split("mixed",
        { start: 0, end: 21, destinations: [existing("bread")] },
        { start: 21, end: [...raw].length, destinations: [existing("astronomy")] },
      ))),
    });
    const second = await adjudicatePlannedDestinationOwnership({
      plan: first,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(
        indivisible(first.items[0].id, [existing("bread")]),
        indivisible(first.items[1].id, [existing("astronomy")]),
      )),
    });

    expect(second).toEqual(first);
  });

  it("does not call the model when the plan has no resolved developing thought", async () => {
    const raw = "Photograph the loaf.";
    const proposed: PlannedRoutingPlan = { items: [action("photo", raw, "Photograph the loaf")], newThreads: [] };
    const generate = vi.fn();

    await expect(adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate,
    })).resolves.toEqual(proposed);
    expect(generate).not.toHaveBeenCalled();
  });

  it("slices split spans by Unicode code-point offsets without retyping punctuation or whitespace", async () => {
    const raw = "🍞 café—proof  \nwhile 星 fogs…";
    const boundary = [..."🍞 café—proof  \n"].length;
    const proposed: PlannedRoutingPlan = {
      items: [thought("unicode", raw, [existing("bread"), existing("astronomy")])],
      newThreads: [],
    };

    const result = await adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(split("unicode",
        { start: 0, end: boundary, destinations: [existing("bread")] },
        { start: boundary, end: [...raw].length, destinations: [existing("astronomy")] },
      ))),
    });

    expect(result.items.map((item) => item.source)).toEqual([
      "🍞 café—proof  \n",
      "while 星 fogs…",
    ]);
    expect(result.items.map((item) => item.source).join("")).toBe(raw);
  });

  it.each([
    ["gap", split("mixed",
      { start: 0, end: 5, destinations: [existing("bread")] },
      { start: 6, end: 16, destinations: [existing("astronomy")] },
    )],
    ["overlap", split("mixed",
      { start: 0, end: 9, destinations: [existing("bread")] },
      { start: 8, end: 16, destinations: [existing("astronomy")] },
    )],
    ["out of range", split("mixed",
      { start: 0, end: 9, destinations: [existing("bread")] },
      { start: 9, end: 17, destinations: [existing("astronomy")] },
    )],
    ["empty span", split("mixed",
      { start: 0, end: 16, destinations: [existing("bread")] },
      { start: 16, end: 16, destinations: [existing("astronomy")] },
    )],
  ])("rejects malformed %s offsets", async (_label, decision) => {
    const raw = "Bread and stars.";
    await expect(adjudicatePlannedDestinationOwnership({
      plan: { items: [thought("mixed", raw, [existing("bread"), existing("astronomy")])], newThreads: [] },
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(decision)),
    })).rejects.toMatchObject({ code: "SOURCE_PARTITION_INVALID" });
  });

  it("requires one decision for each thought item and applies each partition independently", async () => {
    const first = "Bread opens. ";
    const second = "Stars blur.";
    const raw = first + second;
    const proposed: PlannedRoutingPlan = {
      items: [
        thought("bread-thought", first, [existing("bread")]),
        thought("stars-thought", second, [existing("astronomy")]),
      ],
      newThreads: [],
    };

    await expect(adjudicatePlannedDestinationOwnership({
      plan: proposed,
      context: context(raw),
      generate: vi.fn().mockResolvedValue(adjudication(
        indivisible("bread-thought", [existing("bread")]),
        indivisible("stars-thought", [existing("astronomy")]),
      )),
    })).resolves.toEqual(proposed);
  });
});
