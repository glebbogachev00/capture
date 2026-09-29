import { generateObject } from "ai";
import { z } from "zod";
import {
  PlannedRoutingPlanSchema,
  validateRoutingPlan,
  type PlannedRoutingPlan,
  type RoutingPlanContext,
} from "./plannedRouting";
import type { Tier } from "./providers";

const NewActionDecision = z.object({
  proposedActionId: z.string().min(1).max(80),
  outcome: z.literal("new"),
  closestExistingActionId: z.string().min(1).max(100),
  relation: z.literal("distinct_outcome"),
  rationale: z.string().min(1).max(240),
}).strict();

const ExistingActionDecision = z.object({
  proposedActionId: z.string().min(1).max(80),
  outcome: z.literal("existing"),
  existingActionId: z.string().min(1).max(100),
  relation: z.literal("same_outcome"),
  rationale: z.string().min(1).max(240),
}).strict();

export const ActionIdentityAdjudicationSchema = z.object({
  decisions: z.array(
    z.discriminatedUnion("outcome", [NewActionDecision, ExistingActionDecision]),
  ).max(30),
}).strict();

export type ActionIdentityAdjudication = z.infer<typeof ActionIdentityAdjudicationSchema>;

export type ActionIdentityFailureCode =
  | "OUTPUT_SCHEMA_INVALID"
  | "COVERAGE_INVALID"
  | "ACTION_ID_INVALID"
  | "FIELD_IMMUTABILITY_INVALID"
  | "FINAL_PLAN_INVALID";

export class ActionIdentityAdjudicationError extends Error {
  constructor(public readonly code: ActionIdentityFailureCode = "OUTPUT_SCHEMA_INVALID") {
    super("Action identity could not be adjudicated");
    this.name = "ActionIdentityAdjudicationError";
  }
}

function nonIdentityPlanBytes(plan: PlannedRoutingPlan): Uint8Array {
  const immutableFields = {
    items: plan.items.map((item) => ({
      id: item.id,
      source: item.source,
      kind: item.kind,
      action: item.action,
      due: item.due,
      ownerId: item.ownerId,
      destinations: item.destinations,
      unresolved: item.unresolved,
      ambiguity: item.ambiguity,
    })),
    newThreads: plan.newThreads.map((thread) => ({
      key: thread.key,
      name: thread.name,
      closestExistingThreadId: thread.closestExistingThreadId,
      whyNew: thread.whyNew,
    })),
  };
  return new TextEncoder().encode(JSON.stringify(immutableFields));
}

/** Mechanical proof that adjudication changed only duplicateActionId values. */
export function assertOnlyActionIdentityChanged(
  before: PlannedRoutingPlan,
  after: PlannedRoutingPlan,
): void {
  const beforeBytes = nonIdentityPlanBytes(before);
  const afterBytes = nonIdentityPlanBytes(after);
  const identityMutationOutsideProposedAction = before.items.some((item, index) => {
    const actual = after.items[index];
    const isProposedAction = item.kind === "action" && item.action !== null && !item.unresolved;
    return !isProposedAction && actual?.duplicateActionId !== item.duplicateActionId;
  });
  if (
    beforeBytes.length !== afterBytes.length ||
    beforeBytes.some((byte, index) => byte !== afterBytes[index]) ||
    identityMutationOutsideProposedAction
  ) {
    throw new ActionIdentityAdjudicationError("FIELD_IMMUTABILITY_INVALID");
  }
}

type ActionCandidate = {
  id: string;
  action: string;
  source: string;
};

function candidatesFor(plan: PlannedRoutingPlan): ActionCandidate[] {
  return plan.items.flatMap((item) =>
    item.kind === "action" && item.action && !item.unresolved
      ? [{
          id: item.id,
          action: item.action,
          source: plan.items
            .filter((part) => part.id === item.id || part.ownerId === item.id)
            .map((part) => part.source)
            .join(""),
        }]
      : [],
  );
}

export function requiresPlannedActionIdentity(
  plan: PlannedRoutingPlan,
  context: RoutingPlanContext,
): boolean {
  return candidatesFor(plan).length > 0 && context.actions.length > 0;
}

function finalValidatedPlan(
  plan: PlannedRoutingPlan,
  context: RoutingPlanContext,
): PlannedRoutingPlan {
  const parsed = PlannedRoutingPlanSchema.parse(plan);
  if (validateRoutingPlan(parsed, context).length) {
    throw new ActionIdentityAdjudicationError("FINAL_PLAN_INVALID");
  }
  return parsed;
}

/**
 * One bounded semantic question, deliberately separate from source partitioning
 * and routing: does each proposed Action close the same obligation as an open
 * Action, or does it leave a genuinely different result to complete?
 */
export function actionIdentityPrompt(
  proposed: ActionCandidate[],
  existing: RoutingPlanContext["actions"],
): string {
  return (
    "ACTION IDENTITY ADJUDICATION\n" +
    "Judge semantic identity only; do not rewrite, merge, remove, or invent Actions.\n\n" +
    `Proposed Actions (id, wording, exact provenance source):\n${JSON.stringify(proposed)}\n\n` +
    `Existing open Actions (id and wording):\n${JSON.stringify(existing)}\n\n` +
    "For each proposed Action, compare its intended outcome and finish line with all existing Actions, then make one constrained decision. Completing an existing Action is the same outcome only when it fully covers the proposed obligation despite different wording, verbs, order, or detail. Shared subject matter, project, artifact, person, or prerequisite alone is distinct; a remaining delivery, communication, review, approval, deadline, recipient, or other result is distinct.\n\n" +
    "Return exactly one JSON object with only { decisions }, using every proposed id exactly once and only supplied ids. Each decision is exactly either " +
    '{ "proposedActionId": <id>, "outcome": "existing", "existingActionId": <id>, "relation": "same_outcome", "rationale": <concise outcome comparison> } or ' +
    '{ "proposedActionId": <id>, "outcome": "new", "closestExistingActionId": <id>, "relation": "distinct_outcome", "rationale": <concise remaining outcome or finish-line difference> }. ' +
    "Each rationale must be one short sentence, no more than 240 characters. No prose or extra keys."
  );
}

const MAX_ACTION_IDENTITY_OUTPUT_TOKENS = 6_000;
const MAX_ACTION_IDENTITY_JSON_CHARS = 100_000;

/** One provider attempt. Provider fallback stays owned by the route. */
export async function generatePlannedActionIdentityCandidate({
  tier,
  prompt,
  abortSignal,
}: {
  tier: Tier;
  prompt: string;
  abortSignal: AbortSignal;
}): Promise<unknown> {
  const common = {
    model: tier.model,
    maxRetries: 0 as const,
    maxOutputTokens: MAX_ACTION_IDENTITY_OUTPUT_TOKENS,
    abortSignal,
    temperature: 0,
    prompt,
    providerOptions: tier.providerOptions,
  };

  if (tier.name !== "cerebras") {
    const { object } = await generateObject({
      ...common,
      schema: ActionIdentityAdjudicationSchema,
    });
    return object;
  }

  const { object } = await generateObject({
    ...common,
    output: "no-schema",
  });
  if (
    object === null ||
    typeof object !== "object" ||
    Array.isArray(object) ||
    JSON.stringify(object).length > MAX_ACTION_IDENTITY_JSON_CHARS
  ) {
    throw new ActionIdentityAdjudicationError();
  }
  return object;
}

/**
 * Apply only the adjudicator's id-level semantic judgment. Every other field is
 * copied untouched, then the complete plan is validated again before compile.
 */
export async function adjudicatePlannedActionIdentity({
  plan,
  context,
  generate,
}: {
  plan: PlannedRoutingPlan;
  context: RoutingPlanContext;
  generate: (prompt: string) => Promise<unknown>;
}): Promise<PlannedRoutingPlan> {
  const proposed = candidatesFor(plan);

  if (!proposed.length || !context.actions.length) {
    try {
      return finalValidatedPlan(plan, context);
    } catch (error) {
      if (error instanceof ActionIdentityAdjudicationError) throw error;
      throw new ActionIdentityAdjudicationError();
    }
  }

  const cleared: PlannedRoutingPlan = {
    ...plan,
    items: plan.items.map((item) =>
      item.kind === "action" && item.action && !item.unresolved && item.duplicateActionId !== null
        ? { ...item, duplicateActionId: null }
        : item,
    ),
  };

  try {
    const adjudication = ActionIdentityAdjudicationSchema.parse(
      await generate(actionIdentityPrompt(proposed, context.actions)),
    );
    const proposedIds = new Set(proposed.map((candidate) => candidate.id));
    const existingIds = new Set(context.actions.map((action) => action.id));
    const byProposedId = new Map<string, ActionIdentityAdjudication["decisions"][number]>();

    for (const decision of adjudication.decisions) {
      if (
        !proposedIds.has(decision.proposedActionId) ||
        byProposedId.has(decision.proposedActionId)
      ) {
        throw new ActionIdentityAdjudicationError("COVERAGE_INVALID");
      }
      if (decision.outcome === "existing" && !existingIds.has(decision.existingActionId)) {
        throw new ActionIdentityAdjudicationError("ACTION_ID_INVALID");
      }
      if (decision.outcome === "new" && !existingIds.has(decision.closestExistingActionId)) {
        throw new ActionIdentityAdjudicationError("ACTION_ID_INVALID");
      }
      byProposedId.set(decision.proposedActionId, decision);
    }
    if (byProposedId.size !== proposedIds.size) {
      throw new ActionIdentityAdjudicationError("COVERAGE_INVALID");
    }

    const adjudicated = PlannedRoutingPlanSchema.parse({
      ...cleared,
      items: cleared.items.map((item) => {
        const decision = byProposedId.get(item.id);
        return decision?.outcome === "existing"
          ? { ...item, duplicateActionId: decision.existingActionId }
          : item;
      }),
    });
    assertOnlyActionIdentityChanged(plan, adjudicated);
    return finalValidatedPlan(adjudicated, context);
  } catch (error) {
    if (error instanceof ActionIdentityAdjudicationError) throw error;
    throw new ActionIdentityAdjudicationError();
  }
}
