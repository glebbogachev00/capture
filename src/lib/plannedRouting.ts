import { z } from "zod";
import type { SortResult } from "./boardOps";
import { parseDue } from "./due";
import { SEMANTIC_KIND_BOUNDARY } from "./semanticKindBoundary";

const Destination = z.discriminatedUnion("type", [
  z.object({ type: z.literal("existing"), threadId: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal("new"), newThreadKey: z.string().min(1).max(80) }).strict(),
]);

const AtomicItem = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1).max(8_000).describe(
    "one exact, ordered source slice; deadline slices retain the complete due-bearing phrase, its punctuation, and their single owned share of adjacent whitespace"
  ),
  kind: z.enum([
    "action",
    "developing_thought",
    "intention",
    "supporting_context",
    "deadline",
  ]).describe(
    "semantic role of this exact source slice. " + SEMANTIC_KIND_BOUNDARY +
    "Use supporting_context and deadline only for source owned by another item."
  ),
  action: z.string().min(1).max(500).nullable().describe(
    "standalone Action wording only for kind action; null for every other kind"
  ),
  due: z.string().min(1).max(40).nullable().describe(
    "null on Actions and every non-deadline item; resolved ISO only on a separate deadline item"
  ),
  ownerId: z.string().min(1).max(80).nullable().describe(
    "the owning Action id for a deadline; null unless kind is deadline or supporting_context"
  ),
  additionalOwnerIds: z.array(z.string().min(1).max(80)).max(28).optional().describe(
    "deadline only: exact additional Action ids sharing this one source phrase and due; omit or [] otherwise; exclude Actions with their own local deadline"
  ),
  destinations: z.array(Destination).max(4),
  duplicateActionId: z.string().min(1).max(100).nullable().describe(
    "exact supplied open Action id when this Action has the same intended outcome and finish line despite different wording; null when it produces a genuinely distinct result or follow-up"
  ),
  unresolved: z.boolean(),
  ambiguity: z.string().min(1).max(240).nullable(),
}).strict();

const ProposedAtomicItem = AtomicItem.extend({
  duplicateActionId: z.null().describe(
    "reserved for the dedicated Action identity adjudicator; the routing planner must always return null"
  ),
}).strict();

const NewThread = z.object({
  key: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  closestExistingThreadId: z.string().min(1).max(100).nullable(),
  whyNew: z.string().min(1).max(300),
}).strict();

/** The model's proposed operation. No board mutation can consume it directly. */
export const PlannedRoutingPlanSchema = z.object({
  items: z.array(AtomicItem).min(1).max(30),
  newThreads: z.array(NewThread).max(8),
}).strict();

/** Planner output cannot make Action identity decisions at this mixed-purpose stage. */
export const PlannedRoutingProposalSchema = z.object({
  items: z.array(ProposedAtomicItem).min(1).max(30),
  newThreads: z.array(NewThread).max(8),
}).strict();

export type PlannedRoutingPlan = z.infer<typeof PlannedRoutingPlanSchema>;
export type PlannedAtomicItem = z.infer<typeof AtomicItem>;
export type PlannedDestination = z.infer<typeof Destination>;

export type RoutingPlanContext = {
  /** Assigned by intake before planning; later settlement must re-check it. */
  captureId: string;
  raw: string;
  threads: { id: string; name: string; about: string }[];
  actions: { id: string; text: string }[];
  recovery: SortResult;
  /** Explicit user destination, never an advisory model classification. */
  force?: "action" | "thread" | "intention";
  now: number;
};

export const ROUTING_FAILURE_CODES = [
  "COMMAND_KIND_CONFLICT",
  "SOURCE_NOT_ACCOUNTED",
  "DUPLICATE_ITEM_ID",
  "UNKNOWN_THREAD",
  "UNKNOWN_NEW_THREAD",
  "DUPLICATE_DESTINATION",
  "MULTIPLE_NEW_DESTINATIONS",
  "NEW_AND_EXISTING_DESTINATIONS",
  "NON_THOUGHT_DESTINATION",
  "DEADLINE_NOT_ATOMIC",
  "INVALID_ITEM_FIELDS",
  "TOPIC_WITHOUT_DESTINATION",
  "AMBIGUITY_FORCED",
  "UNRESOLVED_ITEM_WAS_ROUTED",
  "UNKNOWN_OWNER",
  "INVALID_OWNER_KIND",
  "DUPLICATE_DEADLINE_OWNER",
  "DEADLINE_NOT_STRUCTURED",
  "INVALID_DEADLINE",
  "UNKNOWN_DUPLICATE_ACTION",
  "DUPLICATE_ACTION_SETTLEMENT",
  "NEW_THREAD_DUPLICATES_EXISTING_NAME",
  "DUPLICATE_NEW_THREAD_KEY",
  "DUPLICATE_NEW_THREAD_NAME",
  "NEW_THREAD_WITHOUT_CLOSEST_EXISTING",
  "UNUSED_NEW_THREAD",
  "UNRESOLVED_WITHOUT_AMBIGUITY",
  "MALFORMED_PLAN",
] as const;

export type RoutingFailureCode = typeof ROUTING_FAILURE_CODES[number];

export type RoutingPlanFailure = {
  code: RoutingFailureCode;
  itemId?: string;
  destination?: string;
  sourceMismatch?: {
    /** Unicode code-point offset, so one displayed character is one position. */
    characterOffset: number;
    expected: string | null;
    received: string | null;
  };
};

function firstSourceMismatch(expected: string, received: string) {
  const expectedCharacters = [...expected];
  const receivedCharacters = [...received];
  const limit = Math.max(expectedCharacters.length, receivedCharacters.length);
  for (let characterOffset = 0; characterOffset < limit; characterOffset += 1) {
    if (expectedCharacters[characterOffset] !== receivedCharacters[characterOffset]) {
      return {
        characterOffset,
        expected: expectedCharacters[characterOffset] ?? null,
        received: receivedCharacters[characterOffset] ?? null,
      };
    }
  }
  return undefined;
}

export type RoutingValidationObservation = Readonly<{
  attempt: 1 | 2;
  failureCodes: RoutingFailureCode[];
  itemCount: number | null;
  destinationCount: number | null;
  newThreadCount: number | null;
  sourceCharacterCount: number;
  accountedSourceCharacterCount: number | null;
  matchingPrefixCharacterCount: number | null;
  matchingSuffixCharacterCount: number | null;
}>;

function matchingCharacterCount(left: string, right: string, fromEnd = false): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (
    count < limit &&
    left[fromEnd ? left.length - 1 - count : count] ===
      right[fromEnd ? right.length - 1 - count : count]
  ) count++;
  return count;
}

/**
 * Repair only mechanically omitted separators. Every supplied item source must
 * otherwise match the original at its current position. The exact intervening
 * whitespace is assigned to the preceding item, matching the source contract.
 * Leading/trailing gaps, partial whitespace rewrites, punctuation changes,
 * non-whitespace omissions, overlap, and reordering remain validation failures.
 */
function restoreOmittedInterItemWhitespace(
  plan: PlannedRoutingPlan,
  raw: string
): PlannedRoutingPlan {
  if (plan.items.map((item) => item.source).join("") === raw) return plan;
  const items = plan.items.map((item) => ({ ...item }));
  let cursor = 0;

  for (let index = 0; index < items.length; index += 1) {
    const source = items[index].source;
    if (raw.startsWith(source, cursor)) {
      cursor += source.length;
      continue;
    }
    if (index === 0) return plan;

    const separatorStart = cursor;
    while (cursor < raw.length && /\s/u.test(raw[cursor])) cursor += 1;
    if (cursor === separatorStart || !raw.startsWith(source, cursor)) return plan;

    const separator = raw.slice(separatorStart, cursor);
    if (items[index - 1].source.length + separator.length > 8_000) return plan;
    items[index - 1] = {
      ...items[index - 1],
      source: items[index - 1].source + separator,
    };
    cursor += source.length;
  }

  if (cursor !== raw.length) return plan;
  return { ...plan, items };
}

export type PlannedActionDetail = {
  text: string;
  due: string | null;
  source: string;
};

export type PlannedSortResult = SortResult & {
  captureId: string;
  planned: true;
  actionDetails: PlannedActionDetail[];
  unresolved: string[];
};

const destinationKey = (destination: PlannedDestination) =>
  destination.type === "existing"
    ? `existing:${destination.threadId}`
    : `new:${destination.newThreadKey}`;

/** Exact name identity is a mechanical collision, not semantic routing. */
const exactNameKey = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

function validStructuredDue(value: string, now: number): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!iso) return false;
  const [, year, month, day] = iso;
  const calendar = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (
    calendar.getFullYear() !== Number(year) ||
    calendar.getMonth() !== Number(month) - 1 ||
    calendar.getDate() !== Number(day)
  ) return false;
  return parseDue(value, now) !== null;
}

/** An explicit user destination outranks the model; no source meaning is inferred here. */
function commandKindFailures(
  plan: PlannedRoutingPlan,
  force: RoutingPlanContext["force"],
): RoutingPlanFailure[] {
  if (!force) return [];
  const kind = force === "thread" ? "developing_thought" : force;
  return plan.items.filter((item) =>
    item.kind !== kind && item.kind !== "supporting_context" &&
    !(force === "action" && item.kind === "deadline")
  ).map((item) => ({ code: "COMMAND_KIND_CONFLICT", itemId: item.id }));
}

/** Integrity only: source, references, and explicit user authority. */
export function validateRoutingPlan(
  plan: PlannedRoutingPlan,
  context: RoutingPlanContext
): RoutingPlanFailure[] {
  const failures: RoutingPlanFailure[] = commandKindFailures(plan, context.force);
  const itemIds = new Set<string>();
  for (const item of plan.items) {
    if (itemIds.has(item.id)) failures.push({ code: "DUPLICATE_ITEM_ID", itemId: item.id });
    itemIds.add(item.id);
  }

  const accountedSource = plan.items.map((item) => item.source).join("");
  if (accountedSource !== context.raw) {
    failures.push({
      code: "SOURCE_NOT_ACCOUNTED",
      sourceMismatch: firstSourceMismatch(context.raw, accountedSource),
    });
  }

  const threadsById = new Map(context.threads.map((thread) => [thread.id, thread]));
  const actionsById = new Map(context.actions.map((action) => [action.id, action]));
  const itemsById = new Map(plan.items.map((item) => [item.id, item]));
  const newThreadsByKey = new Map(plan.newThreads.map((thread) => [thread.key, thread]));
  const usedNewThreads = new Set<string>();

  const existingNames = new Set(context.threads.map((thread) => exactNameKey(thread.name)));
  const newKeys = new Set<string>();
  const newNames = new Set<string>();
  for (const thread of plan.newThreads) {
    if (newKeys.has(thread.key)) {
      failures.push({ code: "DUPLICATE_NEW_THREAD_KEY", destination: thread.key });
    }
    newKeys.add(thread.key);
    const name = exactNameKey(thread.name);
    if (existingNames.has(name)) {
      failures.push({
        code: "NEW_THREAD_DUPLICATES_EXISTING_NAME",
        destination: thread.key,
      });
    }
    if (newNames.has(name)) {
      failures.push({ code: "DUPLICATE_NEW_THREAD_NAME", destination: thread.key });
    }
    newNames.add(name);
    if (context.threads.length > 0 && !thread.closestExistingThreadId) {
      failures.push({
        code: "NEW_THREAD_WITHOUT_CLOSEST_EXISTING",
        destination: thread.key,
      });
    } else if (
      thread.closestExistingThreadId &&
      !threadsById.has(thread.closestExistingThreadId)
    ) {
      failures.push({
        code: "UNKNOWN_THREAD",
        destination: thread.closestExistingThreadId,
      });
    }
  }

  const deadlineOwners = new Set<string>();
  const duplicateActionTargets = new Set<string>();
  for (const item of plan.items) {
    const seenDestinations = new Set<string>();
    for (const destination of item.destinations) {
      const key = destinationKey(destination);
      if (seenDestinations.has(key)) {
        failures.push({ code: "DUPLICATE_DESTINATION", itemId: item.id, destination: key });
      }
      seenDestinations.add(key);
      if (destination.type === "existing") {
        if (!threadsById.has(destination.threadId)) {
          failures.push({
            code: "UNKNOWN_THREAD",
            itemId: item.id,
            destination: destination.threadId,
          });
        }
      } else if (!newThreadsByKey.has(destination.newThreadKey)) {
        failures.push({
          code: "UNKNOWN_NEW_THREAD",
          itemId: item.id,
          destination: destination.newThreadKey,
        });
      } else {
        usedNewThreads.add(destination.newThreadKey);
      }
    }

    const newDestinationCount = item.destinations.filter(
      (destination) => destination.type === "new"
    ).length;
    const existingDestinationCount = item.destinations.length - newDestinationCount;
    if (item.kind === "developing_thought") {
      if (newDestinationCount > 1) {
        failures.push({ code: "MULTIPLE_NEW_DESTINATIONS", itemId: item.id });
      }
      if (newDestinationCount > 0 && existingDestinationCount > 0) {
        failures.push({ code: "NEW_AND_EXISTING_DESTINATIONS", itemId: item.id });
      }
    } else if (item.destinations.length > 0) {
      failures.push({ code: "NON_THOUGHT_DESTINATION", itemId: item.id });
    }
    if (item.kind !== "deadline" && item.due) {
      failures.push({ code: "DEADLINE_NOT_ATOMIC", itemId: item.id });
    }
    const ownedKind = item.kind === "supporting_context" || item.kind === "deadline";
    if (
      (item.kind === "action" ? !item.action : !!item.action) ||
      (!ownedKind && !!item.ownerId) ||
      (item.kind !== "deadline" && !!item.additionalOwnerIds?.length) ||
      (item.kind !== "action" && !!item.duplicateActionId)
    ) {
      failures.push({ code: "INVALID_ITEM_FIELDS", itemId: item.id });
    }

    if (item.unresolved && item.destinations.length > 0) {
      failures.push({ code: "UNRESOLVED_ITEM_WAS_ROUTED", itemId: item.id });
    }
    if (item.unresolved && !item.ambiguity) {
      failures.push({ code: "UNRESOLVED_WITHOUT_AMBIGUITY", itemId: item.id });
    }
    if (!item.unresolved && item.ambiguity) {
      failures.push({ code: "AMBIGUITY_FORCED", itemId: item.id });
    }
    if (
      item.kind === "developing_thought" &&
      !item.unresolved &&
      item.destinations.length === 0
    ) {
      failures.push({ code: "TOPIC_WITHOUT_DESTINATION", itemId: item.id });
    }

    if (item.kind === "action") {
      if (item.duplicateActionId && !actionsById.has(item.duplicateActionId)) {
        failures.push({ code: "UNKNOWN_DUPLICATE_ACTION", itemId: item.id });
      }
      if (item.duplicateActionId) {
        if (duplicateActionTargets.has(item.duplicateActionId)) {
          failures.push({
            code: "DUPLICATE_ACTION_SETTLEMENT",
            itemId: item.id,
            destination: item.duplicateActionId,
          });
        }
        duplicateActionTargets.add(item.duplicateActionId);
      }
    } else if (item.duplicateActionId) {
      failures.push({ code: "UNKNOWN_DUPLICATE_ACTION", itemId: item.id });
    }


    if (item.kind === "supporting_context" || item.kind === "deadline") {
      const owner = item.ownerId ? itemsById.get(item.ownerId) : undefined;
      if (!owner) {
        failures.push({ code: "UNKNOWN_OWNER", itemId: item.id });
      } else if (
        item.kind === "deadline"
          ? owner.kind !== "action"
          : !["action", "developing_thought", "intention"].includes(owner.kind)
      ) {
        failures.push({ code: "INVALID_OWNER_KIND", itemId: item.id });
      }
    }

    if (item.kind === "deadline") {
      for (const ownerId of routingOwnerIds(item)) {
        const owner = itemsById.get(ownerId);
        if (!owner) failures.push({ code: "UNKNOWN_OWNER", itemId: item.id });
        else if (owner.kind !== "action") failures.push({ code: "INVALID_OWNER_KIND", itemId: item.id });
        if (deadlineOwners.has(ownerId)) {
          failures.push({ code: "DUPLICATE_DEADLINE_OWNER", itemId: item.id });
        }
        deadlineOwners.add(ownerId);
      }
      if (!item.due) {
        failures.push({ code: "DEADLINE_NOT_STRUCTURED", itemId: item.id });
      } else if (!validStructuredDue(item.due, context.now)) {
        failures.push({ code: "INVALID_DEADLINE", itemId: item.id });
      }
    }
  }

  for (const thread of plan.newThreads) {
    if (!usedNewThreads.has(thread.key)) {
      failures.push({ code: "UNUSED_NEW_THREAD", destination: thread.key });
    }
  }

  return failures.filter(
    (failure, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === failure.code &&
          candidate.itemId === failure.itemId &&
          candidate.destination === failure.destination
      ) === index
  );
}

/** Explicit ownership only; supporting context remains single-owner. */
export const routingOwnerIds = (item: PlannedAtomicItem): string[] =>
  [...(item.ownerId ? [item.ownerId] : []), ...(item.kind === "deadline" ? item.additionalOwnerIds ?? [] : [])];

const sourceForOwner = (
  owner: PlannedAtomicItem,
  items: PlannedAtomicItem[],
  includedKinds: PlannedAtomicItem["kind"][]
) =>
  items
    .filter(
      (item) =>
        item.id === owner.id ||
        (routingOwnerIds(item).includes(owner.id) && includedKinds.includes(item.kind))
    )
    .map((item) => item.source)
    .join("");

/**
 * Read-only P1 adapter for route/evaluation compatibility. It does not settle
 * a board. P2 must consume the validated plan atomically under captureId and
 * pending-state authority rather than treating this preview as a commit.
 */
export function compileRoutingPlan(
  plan: PlannedRoutingPlan,
  context: RoutingPlanContext
): PlannedSortResult {
  const commandFailures = commandKindFailures(plan, context.force);
  if (commandFailures.length) throw new RoutingPlanCandidateValidationError(commandFailures);
  const newThreadsByKey = new Map(plan.newThreads.map((thread) => [thread.key, thread]));
  const unresolvedIds = new Set(
    plan.items.filter((item) => item.unresolved).map((item) => item.id)
  );
  for (const item of plan.items) {
    const owners = routingOwnerIds(item);
    if (owners.length && owners.every((id) => unresolvedIds.has(id))) unresolvedIds.add(item.id);
  }
  const unresolved = plan.items
    .filter((item) => unresolvedIds.has(item.id) && !item.ownerId)
    .map((owner) =>
      sourceForOwner(owner, plan.items, ["supporting_context", "deadline"])
    );

  const deadlines = new Map(
    plan.items
      .filter((item) => item.kind === "deadline" && !unresolvedIds.has(item.id))
      .flatMap((item) => routingOwnerIds(item).map((ownerId) => [ownerId, item.due!] as const))
  );
  const actionItems = plan.items.filter(
    (item) =>
      item.kind === "action" &&
      !unresolvedIds.has(item.id) &&
      !item.duplicateActionId &&
      !!item.action
  );
  const actionDetails: PlannedActionDetail[] = actionItems.map((item) => ({
    text: item.action!,
    due: deadlines.get(item.id) ?? null,
    source: sourceForOwner(item, plan.items, ["supporting_context", "deadline"]),
  }));

  type CompiledDestination = {
    key: string;
    threadId: string | null;
    threadName: string | null;
    sources: string[];
  };
  const destinationMap = new Map<string, CompiledDestination>();
  for (const item of plan.items) {
    if (item.kind !== "developing_thought" || unresolvedIds.has(item.id)) continue;
    const text = sourceForOwner(item, plan.items, ["supporting_context"]);
    for (const destination of item.destinations) {
      const key = destinationKey(destination);
      const existing = destinationMap.get(key);
      if (existing) {
        existing.sources.push(text);
        continue;
      }
      destinationMap.set(
        key,
        destination.type === "existing"
          ? {
              key,
              threadId: destination.threadId,
              threadName: null,
              sources: [text],
            }
          : {
              key,
              threadId: null,
              threadName: newThreadsByKey.get(destination.newThreadKey)!.name,
              sources: [text],
            }
      );
    }
  }
  const destinations = [...destinationMap.values()];
  const recoveryKey = context.recovery.threadId
    ? `existing:${context.recovery.threadId}`
    : context.recovery.threadName
      ? destinations.find(
          (destination) =>
            destination.threadName &&
            exactNameKey(destination.threadName) === exactNameKey(context.recovery.threadName!)
        )?.key
      : undefined;
  const primaryIndex = recoveryKey
    ? Math.max(0, destinations.findIndex((destination) => destination.key === recoveryKey))
    : 0;
  const primary = destinations[primaryIndex];
  const further = destinations.filter((_, index) => index !== primaryIndex);
  const resolvedIntention = plan.items.some(
    (item) => item.kind === "intention" && !unresolvedIds.has(item.id)
  );

  const kind: PlannedSortResult["kind"] = destinations.length && actionDetails.length
    ? "both"
    : destinations.length
      ? "thread"
      : actionDetails.length
        ? "action"
        : resolvedIntention
          ? "intention"
          : "action";

  const actions = actionDetails.map((detail) => detail.text);
  const primaryText = primary
    ? primary.sources.join("").trim()
    : null;
  const due = actionDetails.length === 1 ? actionDetails[0].due : null;
  const retainedPrimaryActions = new Set(actions);

  return {
    ...context.recovery,
    captureId: context.captureId,
    planned: true,
    kind,
    actions,
    actionDetails,
    due,
    primaryActions: (context.recovery.primaryActions ?? []).filter(
      (action) => typeof action === "string" && retainedPrimaryActions.has(action)
    ),
    threadId: primary?.threadId ?? null,
    threadName: primary?.threadName ?? null,
    primaryText,
    also: further.map((destination) => ({
      text: destination.sources.join("").trim(),
      threadId: destination.threadId,
      threadName: destination.threadName,
    })),
    unresolved,
  };
}

export class RoutingPlanValidationError extends Error {
  constructor() {
    super("The routing plan could not be validated");
    this.name = "RoutingPlanValidationError";
  }
}

export class RoutingPlanCandidateValidationError extends Error {
  constructor(public readonly failures: RoutingPlanFailure[]) {
    super("A provider tier returned an invalid routing plan");
    this.name = "RoutingPlanCandidateValidationError";
  }
}

/**
 * Remove coordinates that cannot be consumed by the compiler. Destination
 * ownership is meaningful only for developing thoughts; keeping a stray
 * destination on an Action, Intention, or Deadline would otherwise turn an
 * exact, semantically complete retry into a validation failure.
 */
function clearNonThoughtDestinations(plan: PlannedRoutingPlan): PlannedRoutingPlan {
  let changed = false;
  const items = plan.items.map((item) => {
    if (item.kind === "developing_thought" || item.destinations.length === 0) {
      return item;
    }
    changed = true;
    return { ...item, destinations: [] };
  });
  return changed ? { ...plan, items } : plan;
}

/** Exactly one feedback-bearing retry. The route may still use provider fallback. */
export async function planRoutingWithRetry(
  context: RoutingPlanContext,
  generate: (
    failures: RoutingPlanFailure[],
    validateCandidate?: (candidate: unknown) => PlannedRoutingPlan,
  ) => Promise<unknown>,
  observe?: (observation: RoutingValidationObservation) => void,
  options: { validateInsideGenerate?: boolean } = {},
): Promise<{ captureId: string; plan: PlannedRoutingPlan; attempts: 1 | 2 }> {
  let feedback: RoutingPlanFailure[] = [];
  for (const attempt of [1, 2] as const) {
    const observeMalformed = () => {
      try {
        observe?.({
          attempt,
          failureCodes: ["MALFORMED_PLAN"],
          itemCount: null,
          destinationCount: null,
          newThreadCount: null,
          sourceCharacterCount: context.raw.length,
          accountedSourceCharacterCount: null,
          matchingPrefixCharacterCount: null,
          matchingSuffixCharacterCount: null,
        });
      } catch {
        // Observability must never change routing or retry behavior.
      }
    };
    let acceptedInsideFallback: PlannedRoutingPlan | undefined;
    const validateCandidate = (untrusted: unknown): PlannedRoutingPlan => {
      let candidate: PlannedRoutingPlan;
      try {
        const parsed = restoreOmittedInterItemWhitespace(
          PlannedRoutingProposalSchema.parse(untrusted),
          context.raw
        );
        candidate = attempt === 2 ? clearNonThoughtDestinations(parsed) : parsed;
      } catch {
        observeMalformed();
        throw new RoutingPlanCandidateValidationError([{ code: "MALFORMED_PLAN" }]);
      }
      const failures = validateRoutingPlan(candidate, context);
      const accountedSource = candidate.items.map((item) => item.source).join("");
      try {
        observe?.({
          attempt,
          failureCodes: [...new Set(failures.map((failure) => failure.code))],
          itemCount: candidate.items.length,
          destinationCount: candidate.items.reduce(
            (count, item) => count + item.destinations.length,
            0
          ),
          newThreadCount: candidate.newThreads.length,
          sourceCharacterCount: context.raw.length,
          accountedSourceCharacterCount: accountedSource.length,
          matchingPrefixCharacterCount: matchingCharacterCount(context.raw, accountedSource),
          matchingSuffixCharacterCount: matchingCharacterCount(context.raw, accountedSource, true),
        });
      } catch {
        // Observability must never change routing or retry behavior.
      }
      if (failures.length) throw new RoutingPlanCandidateValidationError(failures);
      acceptedInsideFallback = candidate;
      return candidate;
    };
    try {
      const generated = options.validateInsideGenerate
        ? await generate(feedback, validateCandidate)
        : await generate(feedback);
      const candidate = acceptedInsideFallback !== undefined && generated === acceptedInsideFallback
        ? acceptedInsideFallback
        : validateCandidate(generated);
      return { captureId: context.captureId, plan: candidate, attempts: attempt };
    } catch (error) {
      feedback = error instanceof RoutingPlanCandidateValidationError
        ? error.failures
        : [{ code: "MALFORMED_PLAN" }];
      if (!(error instanceof RoutingPlanCandidateValidationError)) observeMalformed();
      if (attempt === 2) throw new RoutingPlanValidationError();
    }
  }
  throw new RoutingPlanValidationError();
}
