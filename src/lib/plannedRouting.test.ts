import { describe, expect, it, vi } from "vitest";
import type { SortResult } from "./boardOps";
import {
  compileRoutingPlan,
  planRoutingWithRetry,
  validateRoutingPlan,
  type PlannedRoutingPlan,
  type RoutingPlanContext,
} from "./plannedRouting";

const raw =
  "Capture needs a quieter filing explanation. Retake playback still stalls. Draft two labels tomorrow. Review them next Friday.";

const threads = [
  { id: "capture", name: "Capture filing", about: "Capture filing and retrieval behavior." },
  { id: "retake", name: "Retake workflow", about: "Retake playback and editing behavior." },
];

const actions = [
  { id: "existing-labels", text: "Draft two alternative labels" },
  { id: "existing-email", text: "Send the synthetic review email" },
];

const recovery: SortResult = {
  clean: raw,
  kind: "both",
  title: "Filing and playback",
  actions: ["Draft two labels tomorrow", "Review the labels next Friday"],
  primaryActions: [],
  shelfLife: "keep",
  due: null,
  threadId: "capture",
  threadName: null,
  primaryText: "Capture needs a quieter filing explanation.",
  also: [{ text: "Retake playback still stalls.", threadId: "retake", threadName: null }],
};

const plan = (over: Partial<PlannedRoutingPlan> = {}): PlannedRoutingPlan => ({
  items: [
    {
      id: "capture-thought",
      source: "Capture needs a quieter filing explanation. ",
      kind: "developing_thought",
      action: null,
      due: null,
      ownerId: null,
      destinations: [{ type: "existing", threadId: "capture" }],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "retake-thought",
      source: "Retake playback still stalls. ",
      kind: "developing_thought",
      action: null,
      due: null,
      ownerId: null,
      destinations: [
        { type: "existing", threadId: "retake" },
        { type: "existing", threadId: "capture" },
      ],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "draft-action",
      source: "Draft two labels",
      kind: "action",
      action: "Draft two labels tomorrow",
      due: null,
      ownerId: null,
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "draft-deadline",
      source: " tomorrow. ",
      kind: "deadline",
      action: null,
      due: "2026-09-27",
      ownerId: "draft-action",
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "review-action",
      source: "Review them",
      kind: "action",
      action: "Review the labels next Friday",
      due: null,
      ownerId: null,
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "review-deadline",
      source: " next Friday.",
      kind: "deadline",
      action: null,
      due: "2026-10-02",
      ownerId: "review-action",
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
  ],
  newThreads: [],
  ...over,
});

const context = (over: Partial<RoutingPlanContext> = {}): RoutingPlanContext => ({
  captureId: "capture-one",
  raw,
  threads,
  actions,
  recovery,
  now: new Date("2026-09-26T12:00:00+07:00").getTime(),
  ...over,
});

describe("planned routing validation", () => {
  it.each(["action", "thread", "intention"] as const)(
    "rejects a final plan contradicting explicit %s authority without rewriting it",
    (force) => {
      const candidate = plan({ items: [{
        ...plan().items[0], source: "Exact source", kind: force === "action" ? "intention" : "action",
        action: force === "action" ? null : "Exact source", destinations: [],
      }], newThreads: [] });
      const before = JSON.stringify(candidate);
      const forced = context({ raw: "Exact source", force });
      expect(validateRoutingPlan(candidate, forced)).toContainEqual({
        code: "COMMAND_KIND_CONFLICT", itemId: "capture-thought",
      });
      expect(() => compileRoutingPlan(candidate, forced)).toThrow();
      expect(JSON.stringify(candidate)).toBe(before);
      expect(validateRoutingPlan(candidate, context({ raw: "Exact source" }))).toEqual([]);
    },
  );


  it("accepts exact source coverage and makes multi-destination thinking ordinary", () => {
    expect(validateRoutingPlan(plan(), context())).toEqual([]);
    const out = compileRoutingPlan(plan(), context());
    expect(out.kind).toBe("both");
    expect(out.threadId).toBe("capture");
    expect(out.primaryText).toContain("Capture needs a quieter filing explanation.");
    expect(out.primaryText).toContain("Retake playback still stalls.");
    expect(out.also).toEqual([
      expect.objectContaining({ threadId: "retake", text: "Retake playback still stalls." }),
    ]);
    expect(out.actions).toEqual(["Draft two labels tomorrow", "Review the labels next Friday"]);
    expect(out.actionDetails).toEqual([
      expect.objectContaining({ text: "Draft two labels tomorrow", due: "2026-09-27" }),
      expect.objectContaining({ text: "Review the labels next Friday", due: "2026-10-02" }),
    ]);
  });

  it("lets planned semantics correct recovery evidence while retaining mechanical validation", () => {
    const thirdThread = {
      id: "archive",
      name: "Synthetic archive",
      about: "A third independent synthetic destination.",
    };
    const threeDestinationPlan = plan({
      items: plan().items.map((item) =>
        item.id === "retake-thought"
          ? {
              ...item,
              destinations: [
                ...item.destinations,
                { type: "existing" as const, threadId: thirdThread.id },
              ],
            }
          : item
      ),
    });
    const recoveryMisread: SortResult = {
      ...recovery,
      kind: "action",
      actions: ["Invented recovery-only action"],
      threadId: null,
      primaryText: null,
      also: [],
    };
    const correctedContext = context({
      threads: [...threads, thirdThread],
      recovery: recoveryMisread,
    });

    expect(validateRoutingPlan(threeDestinationPlan, correctedContext)).toEqual([]);

    const unsafeNeighbor = plan({
      ...threeDestinationPlan,
      items: threeDestinationPlan.items.map((item) =>
        item.id === "retake-thought"
          ? {
              ...item,
              destinations: [
                ...item.destinations,
                { type: "existing" as const, threadId: "missing" },
              ],
            }
          : item
      ),
    });
    expect(validateRoutingPlan(unsafeNeighbor, correctedContext).map(({ code }) => code)).toContain(
      "UNKNOWN_THREAD"
    );
  });

  it("rejects omitted, duplicated, reordered, and invented source fragments", () => {
    const omitted = plan({ items: plan().items.slice(0, -1) });
    const duplicated = plan({ items: [...plan().items, plan().items[0]] });
    const reordered = plan({ items: [plan().items[1], plan().items[0], ...plan().items.slice(2)] });
    const invented = plan({
      items: plan().items.map((item, index) =>
        index === 0 ? { ...item, source: item.source + "Invented. " } : item
      ),
    });

    for (const candidate of [omitted, duplicated, reordered, invented]) {
      expect(validateRoutingPlan(candidate, context()).map((failure) => failure.code)).toContain(
        "SOURCE_NOT_ACCOUNTED"
      );
    }
  });

  it("rejects unknown, duplicate, and mechanically duplicate Thread destinations", () => {
    const unknown = plan({
      items: plan().items.map((item, index) =>
        index === 0
          ? { ...item, destinations: [{ type: "existing" as const, threadId: "missing" }] }
          : item
      ),
    });
    const duplicateDestination = plan({
      items: plan().items.map((item, index) =>
        index === 0
          ? {
              ...item,
              destinations: [
                { type: "existing" as const, threadId: "capture" },
                { type: "existing" as const, threadId: "capture" },
              ],
            }
          : item
      ),
    });
    const duplicateNew = plan({
      newThreads: [
        {
          key: "new-capture",
          name: "  capture   filing ",
          closestExistingThreadId: "capture",
          whyNew: "The planner claimed a difference.",
        },
      ],
    });

    expect(validateRoutingPlan(unknown, context()).map((failure) => failure.code)).toContain(
      "UNKNOWN_THREAD"
    );
    expect(
      validateRoutingPlan(duplicateDestination, context()).map((failure) => failure.code)
    ).toContain("DUPLICATE_DESTINATION");
    expect(validateRoutingPlan(duplicateNew, context()).map((failure) => failure.code)).toContain(
      "NEW_THREAD_DUPLICATES_EXISTING_NAME"
    );
  });

  it("rejects a thinking item that mixes existing homes with a new Thread or proposes several new Threads", () => {
    const newThreads = [
      {
        key: "new-one",
        name: "A genuinely separate synthetic subject",
        closestExistingThreadId: "capture",
        whyNew: "It is about a separate synthetic subject.",
      },
      {
        key: "new-two",
        name: "Another separate synthetic subject",
        closestExistingThreadId: "retake",
        whyNew: "It is about another separate synthetic subject.",
      },
    ];
    const mixed = plan({
      newThreads,
      items: plan().items.map((item, index) =>
        index === 0
          ? {
              ...item,
              destinations: [
                { type: "existing" as const, threadId: "capture" },
                { type: "new" as const, newThreadKey: "new-one" },
              ],
            }
          : item
      ),
    });
    const severalNew = plan({
      newThreads,
      items: plan().items.map((item, index) =>
        index === 0
          ? {
              ...item,
              destinations: [
                { type: "new" as const, newThreadKey: "new-one" },
                { type: "new" as const, newThreadKey: "new-two" },
              ],
            }
          : item
      ),
    });

    expect(validateRoutingPlan(mixed, context()).map((failure) => failure.code)).toContain(
      "NEW_AND_EXISTING_DESTINATIONS"
    );
    expect(validateRoutingPlan(severalNew, context()).map((failure) => failure.code)).toContain(
      "MULTIPLE_NEW_DESTINATIONS"
    );
  });

  it("keeps destinations on thinking and deadlines in owned deadline items", () => {
    const invalid = plan({
      items: plan().items.map((item) => {
        if (item.id === "draft-action") {
          return {
            ...item,
            due: "2026-09-27",
            destinations: [{ type: "existing" as const, threadId: "capture" }],
          };
        }
        return item;
      }),
    });

    expect(validateRoutingPlan(invalid, context()).map((failure) => failure.code)).toEqual(
      expect.arrayContaining(["NON_THOUGHT_DESTINATION", "DEADLINE_NOT_ATOMIC"])
    );
  });

  it("rejects kind-specific fields that would invent a second semantic item", () => {
    const invalid = plan({
      items: plan().items.map((item) =>
        item.id === "capture-thought"
          ? { ...item, action: "Invent a task", ownerId: "retake-thought" }
          : item
      ),
    });

    expect(validateRoutingPlan(invalid, context()).map((failure) => failure.code)).toContain(
      "INVALID_ITEM_FIELDS"
    );
  });

  it("does not pull an undeclared Intention out of a capture that says several things", () => {
    const changed = plan({
      items: plan().items.map((item) =>
        item.kind === "developing_thought"
          ? { ...item, kind: "intention" as const, destinations: [] }
          : item
      ),
    });

    expect(new Set(validateRoutingPlan(changed, context()).map((failure) => failure.code)))
      .toEqual(new Set(["INTENTION_NOT_DECLARED_ALONE"]));
    expect(validateRoutingPlan(changed, context({ force: "intention" })).map((failure) => failure.code))
      .not.toContain("INTENTION_NOT_DECLARED_ALONE");
  });

  it("rejects duplicate new-Thread keys before a Map can collapse them", () => {
    const duplicateKey = plan({
      newThreads: [
        {
          key: "same-key",
          name: "Synthetic subject one",
          closestExistingThreadId: "capture",
          whyNew: "It is a separate synthetic subject.",
        },
        {
          key: "same-key",
          name: "Synthetic subject two",
          closestExistingThreadId: "retake",
          whyNew: "It is another separate synthetic subject.",
        },
      ],
    });

    expect(validateRoutingPlan(duplicateKey, context()).map((failure) => failure.code)).toContain(
      "DUPLICATE_NEW_THREAD_KEY"
    );
  });

  it("requires unresolved items to state ambiguity and accepts an entirely unresolved capture", () => {
    const unresolvedRaw = "This synthetic thought could belong in either place.";
    const unresolvedRecovery: SortResult = {
      ...recovery,
      clean: unresolvedRaw,
      kind: "thread",
      actions: [],
      threadId: "capture",
      primaryText: null,
      also: [],
    };
    const unresolvedPlan: PlannedRoutingPlan = {
      items: [{
        id: "uncertain",
        source: unresolvedRaw,
        kind: "developing_thought",
        action: null,
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: null,
        unresolved: true,
        ambiguity: "Capture and Retake are equally plausible from the source.",
      }],
      newThreads: [],
    };
    const unresolvedContext = context({ raw: unresolvedRaw, recovery: unresolvedRecovery });

    expect(validateRoutingPlan(unresolvedPlan, unresolvedContext)).toEqual([]);
    expect(compileRoutingPlan(unresolvedPlan, unresolvedContext).unresolved).toEqual([unresolvedRaw]);
    expect(
      validateRoutingPlan({
        ...unresolvedPlan,
        items: [{ ...unresolvedPlan.items[0], ambiguity: null }],
      }, unresolvedContext).map((failure) => failure.code)
    ).toContain("UNRESOLVED_WITHOUT_AMBIGUITY");
  });

  it("accepts a duplicate-only Action as a represented no-op preview", () => {
    const duplicateRaw = "Draft the two alternative labels.";
    const duplicateRecovery: SortResult = {
      ...recovery,
      clean: duplicateRaw,
      kind: "action",
      actions: ["Draft two alternative labels"],
      threadId: null,
      primaryText: null,
      also: [],
    };
    const duplicatePlan: PlannedRoutingPlan = {
      items: [{
        id: "duplicate",
        source: duplicateRaw,
        kind: "action",
        action: "Draft two alternative labels",
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: "existing-labels",
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };
    const duplicateContext = context({ raw: duplicateRaw, recovery: duplicateRecovery });

    expect(validateRoutingPlan(duplicatePlan, duplicateContext)).toEqual([]);
    expect(compileRoutingPlan(duplicatePlan, duplicateContext).actions).toEqual([]);
  });

  it("rejects impossible calendar dates, not only malformed ISO strings", () => {
    const invalid = plan({
      items: plan().items.map((item) =>
        item.id === "draft-deadline" ? { ...item, due: "2026-09-31" } : item
      ),
    });

    expect(validateRoutingPlan(invalid, context()).map((failure) => failure.code)).toContain(
      "INVALID_DEADLINE"
    );
  });

  it("requires every resolved thought to have a destination and every ambiguous item to stay unresolved", () => {
    const missingDestination = plan({
      items: plan().items.map((item, index) =>
        index === 0 ? { ...item, destinations: [] } : item
      ),
    });
    const unsafeAmbiguity = plan({
      items: plan().items.map((item, index) =>
        index === 0 ? { ...item, ambiguity: "Two homes seem equally plausible." } : item
      ),
    });
    const safelyUnresolved = plan({
      items: plan().items.map((item, index) =>
        index === 0
          ? {
              ...item,
              destinations: [],
              unresolved: true,
              ambiguity: "Two homes seem equally plausible.",
            }
          : item
      ),
    });

    expect(validateRoutingPlan(missingDestination, context()).map((failure) => failure.code)).toContain(
      "TOPIC_WITHOUT_DESTINATION"
    );
    expect(validateRoutingPlan(unsafeAmbiguity, context()).map((failure) => failure.code)).toContain(
      "AMBIGUITY_FORCED"
    );
    expect(validateRoutingPlan(safelyUnresolved, context())).toEqual([]);
    expect(compileRoutingPlan(safelyUnresolved, context()).unresolved).toEqual([
      "Capture needs a quieter filing explanation. ",
    ]);
  });

  it("requires model-declared semantic Action duplicates to reference a real Action and never recommits them", () => {
    const duplicate = plan({
      items: plan().items.map((item) =>
        item.id === "draft-action"
          ? { ...item, duplicateActionId: "existing-labels", action: "Draft two labels tomorrow" }
          : item
      ),
    });
    const unknown = plan({
      items: duplicate.items.map((item) =>
        item.id === "draft-action" ? { ...item, duplicateActionId: "missing-action" } : item
      ),
    });

    expect(validateRoutingPlan(duplicate, context())).toEqual([]);
    expect(compileRoutingPlan(duplicate, context()).actions).toEqual([
      "Review the labels next Friday",
    ]);
    expect(validateRoutingPlan(unknown, context()).map((failure) => failure.code)).toContain(
      "UNKNOWN_DUPLICATE_ACTION"
    );
  });

  it("rejects two plan items that both settle as the same existing Action", () => {
    const repeatedRaw = "Draft the labels. Draft the labels.";
    const repeatedRecovery: SortResult = {
      ...recovery,
      clean: repeatedRaw,
      kind: "action",
      actions: ["Draft two alternative labels", "Draft two alternative labels"],
      threadId: null,
      primaryText: null,
      also: [],
    };
    const duplicateTargetPlan: PlannedRoutingPlan = {
      items: [
        {
          id: "first",
          source: "Draft the labels. ",
          kind: "action",
          action: "Draft two alternative labels",
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: "existing-labels",
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "second",
          source: "Draft the labels.",
          kind: "action",
          action: "Draft two alternative labels",
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: "existing-labels",
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [],
    };

    expect(validateRoutingPlan(
      duplicateTargetPlan,
      context({ raw: repeatedRaw, recovery: repeatedRecovery })
    ).map((failure) => failure.code)).toContain("DUPLICATE_ACTION_SETTLEMENT");
  });

  it("requires each explicit Action deadline to be valid structured data", () => {
    const missing = plan({
      items: plan().items.map((item) =>
        item.id === "draft-deadline" ? { ...item, due: null } : item
      ),
    });
    const malformed = plan({
      items: plan().items.map((item) =>
        item.id === "draft-deadline" ? { ...item, due: "tomorrow" } : item
      ),
    });

    expect(validateRoutingPlan(missing, context()).map((failure) => failure.code)).toContain(
      "DEADLINE_NOT_STRUCTURED"
    );
    expect(validateRoutingPlan(malformed, context()).map((failure) => failure.code)).toContain(
      "INVALID_DEADLINE"
    );
  });

  it("rejects multiple structured deadlines for one Action owner", () => {
    const duplicateDeadlineRaw = "Draft labels tomorrow by five.";
    const duplicateDeadlineRecovery: SortResult = {
      ...recovery,
      clean: duplicateDeadlineRaw,
      kind: "action",
      actions: ["Draft labels tomorrow by five"],
      threadId: null,
      primaryText: null,
      also: [],
    };
    const duplicateDeadlinePlan: PlannedRoutingPlan = {
      items: [
        {
          id: "draft",
          source: "Draft labels",
          kind: "action",
          action: "Draft labels tomorrow by five",
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "day",
          source: " tomorrow",
          kind: "deadline",
          action: null,
          due: "2026-09-27",
          ownerId: "draft",
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "time",
          source: " by five.",
          kind: "deadline",
          action: null,
          due: "2026-09-27T17:00:00+07:00",
          ownerId: "draft",
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [],
    };

    expect(validateRoutingPlan(
      duplicateDeadlinePlan,
      context({ raw: duplicateDeadlineRaw, recovery: duplicateDeadlineRecovery })
    ).map((failure) => failure.code)).toContain("DUPLICATE_DEADLINE_OWNER");
  });

  it("does not turn an Intention into supporting Actions", () => {
    const intentionRaw = "I protect room for deliberate rest.";
    const intentionRecovery: SortResult = {
      ...recovery,
      clean: intentionRaw,
      kind: "intention",
      actions: [],
      threadId: null,
      primaryText: null,
      also: [],
    };
    const intentionPlan: PlannedRoutingPlan = {
      items: [
        {
          id: "rest-intention",
          source: intentionRaw,
          kind: "intention",
          action: null,
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [],
    };
    const intentionContext = context({ raw: intentionRaw, recovery: intentionRecovery });

    expect(validateRoutingPlan(intentionPlan, intentionContext)).toEqual([]);
    expect(compileRoutingPlan(intentionPlan, intentionContext)).toMatchObject({
      kind: "intention",
      actions: [],
      actionDetails: [],
    });
  });
});

describe("bounded plan retry", () => {
  it("rejects planner-owned Action identity so only the dedicated adjudicator can set it", async () => {
    const plannerClaim = plan({
      items: plan().items.map((item) =>
        item.id === "draft-action"
          ? { ...item, duplicateActionId: "existing-labels" }
          : item
      ),
    });
    const generate = vi.fn()
      .mockResolvedValueOnce(plannerClaim)
      .mockResolvedValueOnce(plan());

    const result = await planRoutingWithRetry(context(), generate);

    expect(result.attempts).toBe(2);
    expect(result.plan.items.find((item) => item.id === "draft-action")?.duplicateActionId)
      .toBeNull();
    expect(generate).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ code: "MALFORMED_PLAN" })],
    );
  });

  it("clears only unusable destinations from non-thought items on the bounded retry", async () => {
    const withStrayCoordinates = plan({
      items: plan().items.map((item) =>
        item.kind === "developing_thought"
          ? item
          : { ...item, destinations: [{ type: "existing" as const, threadId: "capture" }] }
      ),
    });
    const sourceIncomplete = plan({ items: plan().items.slice(0, -1) });
    const generate = vi.fn()
      .mockResolvedValueOnce(sourceIncomplete)
      .mockResolvedValueOnce(withStrayCoordinates);

    const result = await planRoutingWithRetry(context(), generate);

    expect(result.attempts).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ code: "SOURCE_NOT_ACCOUNTED" })])
    );
    expect(result.plan.items.map((item) => item.destinations)).toEqual(
      plan().items.map((item) => item.destinations)
    );
    expect(result.plan.items.filter((item) => item.kind === "developing_thought"))
      .toEqual(plan().items.filter((item) => item.kind === "developing_thought"));
  });

  it("restores only exact omitted inter-item whitespace before validation", async () => {
    const omittedSeparators = plan({
      items: plan().items.map((item) => ({ ...item, source: item.source.trim() })),
    });
    const generate = vi.fn().mockResolvedValue(omittedSeparators);

    const result = await planRoutingWithRetry(context(), generate);

    expect(result.attempts).toBe(1);
    expect(result.plan.items.map((item) => item.source).join("")).toBe(raw);
    expect(result.plan.items.map((item) => item.source)).toEqual([
      "Capture needs a quieter filing explanation. ",
      "Retake playback still stalls. ",
      "Draft two labels ",
      "tomorrow. ",
      "Review them ",
      "next Friday.",
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["changed punctuation", (value: PlannedRoutingPlan) => ({
      ...value,
      items: value.items.map((item, index) => index === 0
        ? { ...item, source: item.source.replace(".", "!") }
        : item),
    })],
    ["omitted non-whitespace", (value: PlannedRoutingPlan) => ({
      ...value,
      items: value.items.map((item, index) => index === 1
        ? { ...item, source: item.source.replace("playback", "playbac") }
        : item),
    })],
    ["reordered items", (value: PlannedRoutingPlan) => ({
      ...value,
      items: [value.items[1], value.items[0], ...value.items.slice(2)],
    })],
  ])("never canonicalizes a %s source mismatch", async (_label, alter) => {
    const invalid = alter(plan());
    const generate = vi.fn().mockResolvedValue(invalid);

    await expect(planRoutingWithRetry(context(), generate)).rejects.toThrow(
      "The routing plan could not be validated"
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ code: "SOURCE_NOT_ACCOUNTED" })])
    );
  });

  it("does not restore whitespace when doing so would exceed the source schema bound", async () => {
    const boundedRaw = `${"x".repeat(8_000)} y`;
    const boundedPlan: PlannedRoutingPlan = {
      items: [
        { id: "first", source: "x".repeat(8_000), kind: "action", action: "Record the synthetic x sample", due: null, ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "second", source: "y", kind: "action", action: "Record the synthetic y sample", due: null, ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
      ],
      newThreads: [],
    };
    const generate = vi.fn().mockResolvedValue(boundedPlan);

    await expect(planRoutingWithRetry(context({ raw: boundedRaw }), generate)).rejects.toThrow(
      "The routing plan could not be validated"
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("keeps two cross-domain Actions deadline-free while separate owned deadlines carry ISO dates", async () => {
    const mixedRaw = "The sourdough log should compare crumb after cooler proofs. Telescope notes need a clearer way to track lens fog. Photograph the next loaf tomorrow. Calibrate the dew heater next Friday.";
    const mixedPlan: PlannedRoutingPlan = {
      items: [
        { id: "bread-thought", source: "The sourdough log should compare crumb after cooler proofs. ", kind: "developing_thought", action: null, due: null, ownerId: null, destinations: [{ type: "existing", threadId: "bread" }], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "scope-thought", source: "Telescope notes need a clearer way to track lens fog. ", kind: "developing_thought", action: null, due: null, ownerId: null, destinations: [{ type: "existing", threadId: "astronomy" }], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "photo-action", source: "Photograph the next loaf", kind: "action", action: "Photograph the next loaf tomorrow", due: null, ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "photo-deadline", source: " tomorrow. ", kind: "deadline", action: null, due: "2026-09-27", ownerId: "photo-action", destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "heater-action", source: "Calibrate the dew heater", kind: "action", action: "Calibrate the dew heater next Friday", due: null, ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "heater-deadline", source: " next Friday.", kind: "deadline", action: null, due: "2026-10-02", ownerId: "heater-action", destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
      ],
      newThreads: [],
    };
    const mixedContext = context({
      raw: mixedRaw,
      recovery: { ...recovery, clean: mixedRaw },
      threads: [
        { id: "bread", name: "Bread trials", about: "Sourdough proofing and crumb." },
        { id: "astronomy", name: "Astronomy notes", about: "Telescope setup and observing." },
      ],
    });

    const result = await planRoutingWithRetry(mixedContext, vi.fn().mockResolvedValue(mixedPlan));
    const compiled = compileRoutingPlan(result.plan, mixedContext);

    expect(result.plan.items.filter((item) => item.kind === "action").map((item) => item.due))
      .toEqual([null, null]);
    expect(result.plan.items.filter((item) => item.kind === "deadline")).toMatchObject([
      { source: " tomorrow. ", ownerId: "photo-action", due: "2026-09-27" },
      { source: " next Friday.", ownerId: "heater-action", due: "2026-10-02" },
    ]);
    expect(compiled.actionDetails.map(({ due, source }) => ({ due, source }))).toEqual([
      { due: "2026-09-27", source: "Photograph the next loaf tomorrow. " },
      { due: "2026-10-02", source: "Calibrate the dew heater next Friday." },
    ]);
  });

  it("retries once with specific validator failures and accepts the corrected plan", async () => {
    const invalid = plan({
      items: plan().items.map((item, index) =>
        index === 0 ? { ...item, destinations: [] } : item
      ),
    });
    const generate = vi.fn()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(plan());

    const result = await planRoutingWithRetry(context(), generate);

    expect(result.plan).toEqual(plan());
    expect(result.captureId).toBe("capture-one");
    expect(result.attempts).toBe(2);
    expect(generate).toHaveBeenNthCalledWith(1, []);
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ code: "TOPIC_WITHOUT_DESTINATION" })])
    );
  });

  it("fails closed after one retry without exposing the plan in the error", async () => {
    const invalid = plan({ items: plan().items.slice(0, -1) });
    const generate = vi.fn().mockResolvedValue(invalid);

    await expect(planRoutingWithRetry(context(), generate)).rejects.toThrow(
      "The routing plan could not be validated"
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
