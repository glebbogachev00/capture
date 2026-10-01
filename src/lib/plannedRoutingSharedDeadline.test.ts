import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import { parseDue } from "./due";
import { settlePlannedRouting } from "./plannedRoutingSettlement";
import { adjudicatePlannedDeadlines } from "./plannedDeadlineAdjudication";
import { compileRoutingPlan, PlannedRoutingPlanSchema, validateRoutingPlan, type PlannedRoutingPlan, type RoutingPlanContext } from "./plannedRouting";

const raw = "By Friday I need to reproduce the accepted-invite signup error, compare usage-based billing against seat pricing, and profile the render path with the analytics package enabled.";
const sources = ["I need to reproduce the accepted-invite signup error, ", "compare usage-based billing against seat pricing, ", "and profile the render path with the analytics package enabled."];
const base = { action: null, due: null, ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null };
function plan(): PlannedRoutingPlan {
  return { items: [
    { ...base, id: "date", kind: "deadline", source: "By Friday ", due: "2026-10-02", ownerId: "a0", additionalOwnerIds: ["a1", "a2"] },
    ...sources.map((source, index) => ({ ...base, id: `a${index}`, kind: "action" as const, source, action: source.trim() })),
  ], newThreads: [] };
}
const context: RoutingPlanContext = { captureId: "shared", raw, threads: [], actions: [], now: Date.parse("2026-09-30T12:00:00+07:00"), recovery: { clean: raw, kind: "action", title: "Tasks", actions: [], shelfLife: "keep", due: "2099-01-01", threadId: null, threadName: null } };

describe("explicit shared deadline ownership", () => {
  it("retains shared ownership through the unchanged one-decision-per-phrase adjudicator", async () => {
    const candidate = PlannedRoutingPlanSchema.parse(plan());
    const result = await adjudicatePlannedDeadlines({ plan: candidate, context, timeZone: "Asia/Bangkok", generate: async () => ({ decisions: [{ deadlineItemId: "date", ownerActionId: "a0", due: "2026-10-02", calendarOperation: { type: "next_weekday", weekday: "friday", occurrence: "strictly_after_today" } }] }) });
    expect(result).toEqual(candidate);
  });

  it.each([[], [0], [1], [0, 2], [0, 1, 2]].map(unresolved => ({ unresolved })))("settles shared owners independently ($unresolved)", ({ unresolved }) => {
    const candidate = plan();
    for (const index of unresolved) {
      candidate.items[index + 1].unresolved = true;
      candidate.items[index + 1].ambiguity = "Which task scope?";
    }
    const board: Board = { ...EMPTY, actions: [{ id: "pending", text: raw, src: raw, at: context.now, done: false, shelf: "keep", expires: null, unsorted: true }], ledger: [{ id: "pending-row", captureId: context.captureId, raw, clean: raw, at: context.now, kind: "pending", source: "typed", targetId: "pending" }] };
    const result = settlePlannedRouting(board, { captureId: context.captureId, plan: candidate, recovery: context.recovery, now: context.now });
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("Settlement rejected");
    const settled = result.board.actions.filter(action => !action.unsorted);
    const resolvedSources = sources.filter((_, index) => !unresolved.includes(index));
    expect(settled.map(action => action.due)).toEqual(resolvedSources.map(() => parseDue("2026-10-02", context.now)));
    expect(settled.map(action => action.src)).toEqual(resolvedSources.map(source => "By Friday " + source));
    const pending = result.board.actions.filter(action => action.unsorted);
    if (unresolved.length === 3) expect(pending.map(action => action.src)).toEqual([raw]);
    else expect(pending.map(action => action.src)).toEqual(unresolved.map(index => "By Friday " + sources[index]));
    expect(result.board.ledger.find(entry => entry.id === "pending-row")?.raw).toBe(raw);
  });
  it.each([
    ["unknown", ["missing"], "UNKNOWN_OWNER"],
    ["non-Action", ["date"], "INVALID_OWNER_KIND"],
    ["repeated primary", ["a0"], "DUPLICATE_DEADLINE_OWNER"],
    ["repeated additional", ["a1", "a1"], "DUPLICATE_DEADLINE_OWNER"],
  ])("rejects %s owners", (_name, owners, code) => {
    const candidate = plan();
    candidate.items[0].additionalOwnerIds = owners as string[];
    expect(validateRoutingPlan(PlannedRoutingPlanSchema.parse(candidate), context).map(f => f.code)).toContain(code);
  });

  it("rejects additional owners outside deadline items", () => {
    const candidate = plan();
    candidate.items[1].additionalOwnerIds = ["a2"];
    expect(validateRoutingPlan(PlannedRoutingPlanSchema.parse(candidate), context)).toContainEqual({ code: "INVALID_ITEM_FIELDS", itemId: "a0" });
  });

  it("preserves the shared deadline for resolved siblings of an unresolved primary owner", () => {
    const candidate = PlannedRoutingPlanSchema.parse(plan());
    candidate.items[1].unresolved = true;
    candidate.items[1].ambiguity = "Which signup flow?";
    const out = compileRoutingPlan(candidate, context);
    expect(out.actionDetails.map(item => item.due)).toEqual(["2026-10-02", "2026-10-02"]);
    expect(out.unresolved).toEqual(["By Friday " + sources[0]]);
  });

  it("keeps old single-owner plans local instead of broadcasting recovery.due", () => {
    const candidate = plan();
    delete candidate.items[0].additionalOwnerIds;
    const parsed = PlannedRoutingPlanSchema.parse(candidate);
    expect(validateRoutingPlan(parsed, context)).toEqual([]);
    expect(compileRoutingPlan(parsed, context).actionDetails.map(item => item.due)).toEqual(["2026-10-02", null, null]);
  });

  it("rejects conflicting local deadlines but accepts exact exclusion from shared scope", () => {
    const candidate = PlannedRoutingPlanSchema.parse(plan());
    candidate.items.push({ ...candidate.items[0], id: "local", source: " By Monday.", due: "2026-10-05", ownerId: "a2", additionalOwnerIds: [] });
    const localContext = { ...context, raw: raw + " By Monday." };
    expect(validateRoutingPlan(candidate, localContext)).toContainEqual({ code: "DUPLICATE_DEADLINE_OWNER", itemId: "local" });
    candidate.items[0].additionalOwnerIds = ["a1"];
    expect(validateRoutingPlan(candidate, localContext)).toEqual([]);
    expect(compileRoutingPlan(candidate, localContext).actionDetails.map(item => item.due)).toEqual(["2026-10-02", "2026-10-02", "2026-10-05"]);
    expect(compileRoutingPlan(candidate, localContext).actionDetails[2].source).toBe(sources[2] + " By Monday.");
  });
  it("represents the real three-task Friday phrase once and compiles all explicit owners", () => {
    const parsed = PlannedRoutingPlanSchema.parse(plan());
    expect(parsed.items.map(item => item.source).join("")).toBe(raw);
    expect(validateRoutingPlan(parsed, context)).toEqual([]);
    expect(compileRoutingPlan(parsed, context).actionDetails).toEqual(sources.map(source => ({ text: source.trim(), due: "2026-10-02", source: "By Friday " + source })));
  });
});
