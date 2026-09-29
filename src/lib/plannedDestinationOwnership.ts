import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import {
  PlannedRoutingPlanSchema,
  validateRoutingPlan,
  type PlannedDestination,
  type PlannedRoutingPlan,
  type RoutingPlanContext,
} from "./plannedRouting";
import type { Tier } from "./providers";

const Destination = z.discriminatedUnion("type", [
  z.object({ type: z.literal("existing"), threadId: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal("new"), newThreadKey: z.string().min(1).max(80) }).strict(),
]);

const DestinationSpan = z.object({
  start: z.number().int().min(0).max(8_000),
  end: z.number().int().min(0).max(8_000),
  destinations: z.array(Destination).min(1).max(4),
}).strict();

const IndivisibleDecision = z.object({
  itemId: z.string().min(1).max(80),
  mode: z.literal("indivisible"),
  destinations: z.array(Destination).min(1).max(4),
}).strict();

const SplitDecision = z.object({
  itemId: z.string().min(1).max(80),
  mode: z.literal("split"),
  spans: z.array(DestinationSpan).min(2).max(30),
}).strict();

const DestinationDecision = z.discriminatedUnion("mode", [
  IndivisibleDecision,
  SplitDecision,
  z.object({
    itemId: z.string().min(1).max(80),
    mode: z.literal("unresolved"),
    ambiguity: z.string().min(1).max(240).refine((value) => value.trim().length > 0),
  }).strict(),
]);

export const DestinationOwnershipAdjudicationSchema = z.object({
  decisions: z.array(DestinationDecision).max(30),
}).strict();

export type DestinationOwnershipAdjudication = z.infer<
  typeof DestinationOwnershipAdjudicationSchema
>;

export type DestinationOwnershipFailureCode =
  | "OUTPUT_SCHEMA_INVALID"
  | "COVERAGE_INVALID"
  | "SOURCE_PARTITION_INVALID"
  | "DESTINATION_ID_INVALID"
  | "FIELD_IMMUTABILITY_INVALID"
  | "FINAL_PLAN_INVALID";

export class DestinationOwnershipAdjudicationError extends Error {
  constructor(public readonly code: DestinationOwnershipFailureCode = "OUTPUT_SCHEMA_INVALID") {
    super("Destination ownership could not be adjudicated");
    this.name = "DestinationOwnershipAdjudicationError";
  }
}

type ThoughtCandidate = {
  itemId: string;
  source: string;
  sourceLength: number;
  currentDestinations: PlannedDestination[];
};

export type DestinationCorrectionExample = {
  capture: string;
  threadId: string;
  threadName?: string;
};

const candidatesFor = (plan: PlannedRoutingPlan): ThoughtCandidate[] =>
  plan.items.flatMap((item) =>
    item.kind === "developing_thought" && !item.unresolved
      ? [{
          itemId: item.id,
          source: item.source,
          sourceLength: [...item.source].length,
          currentDestinations: item.destinations,
        }]
      : [],
  );

export function requiresPlannedDestinationOwnership(plan: PlannedRoutingPlan): boolean {
  return candidatesFor(plan).length > 0;
}

const destinationKey = (destination: PlannedDestination) =>
  destination.type === "existing"
    ? `existing:${destination.threadId}`
    : `new:${destination.newThreadKey}`;

function stablePartId(itemId: string, partIndex: number): string {
  const digest = createHash("sha256").update(itemId).digest("hex").slice(0, 16);
  return `subject:${digest}:${partIndex + 1}`;
}

type AppliedPart = {
  source: string;
  destinations: PlannedDestination[];
};

type AppliedDecision = {
  itemId: string;
  parts: AppliedPart[];
  ambiguity?: string;
};

function indexedSourceLedger(source: string): string[] {
  const characters = [...source];
  const chunks: string[] = [];
  const chunkSize = 32;
  for (let start = 0; start < characters.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, characters.length);
    chunks.push(`[${start},${end}) ${JSON.stringify(characters.slice(start, end).join(""))}`);
  }
  return chunks;
}

function exactBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sameBytes(left: unknown, right: unknown): boolean {
  const leftBytes = exactBytes(left);
  const rightBytes = exactBytes(right);
  return leftBytes.length === rightBytes.length &&
    leftBytes.every((byte, index) => byte === rightBytes[index]);
}

/** Remove only declarations whose last reference was withdrawn by abstention. */
function retainedNewThreads(
  before: PlannedRoutingPlan,
  items: PlannedRoutingPlan["items"],
  decisions: Map<string, AppliedDecision>,
): PlannedRoutingPlan["newThreads"] {
  const withdrawn = new Set(before.items.flatMap((item) =>
    decisions.get(item.id)?.ambiguity !== undefined
      ? item.destinations.flatMap((destination) => destination.type === "new" ? [destination.newThreadKey] : [])
      : [],
  ));
  const referenced = new Set(items.flatMap((item) => item.destinations.flatMap(
    (destination) => destination.type === "new" ? [destination.newThreadKey] : [],
  )));
  return before.newThreads.filter((thread) => !withdrawn.has(thread.key) || referenced.has(thread.key));
}

/**
 * Untouched items and retained declarations remain byte-identical. Subject
 * parts may change only id, source boundary and destinations. Abstention may
 * change only unresolved, ambiguity and destinations on the original item.
 */
function assertOnlyDestinationOwnershipChanged({
  before,
  after,
  decisions,
}: {
  before: PlannedRoutingPlan;
  after: PlannedRoutingPlan;
  decisions: Map<string, AppliedDecision>;
}): void {
  if (!sameBytes(retainedNewThreads(before, after.items, decisions), after.newThreads)) {
    throw new DestinationOwnershipAdjudicationError("FIELD_IMMUTABILITY_INVALID");
  }

  let afterIndex = 0;
  for (const original of before.items) {
    const decision = decisions.get(original.id);
    if (!decision) {
      if (!sameBytes(original, after.items[afterIndex])) {
        throw new DestinationOwnershipAdjudicationError("FIELD_IMMUTABILITY_INVALID");
      }
      afterIndex += 1;
      continue;
    }

    if (decision.ambiguity !== undefined) {
      if (!sameBytes(after.items[afterIndex], {
        ...original, unresolved: true, ambiguity: decision.ambiguity, destinations: [],
      })) {
        throw new DestinationOwnershipAdjudicationError("FIELD_IMMUTABILITY_INVALID");
      }
      afterIndex += 1;
      continue;
    }

    for (let partIndex = 0; partIndex < decision.parts.length; partIndex += 1) {
      const actual = after.items[afterIndex];
      const expectedId = partIndex === 0
        ? original.id
        : stablePartId(original.id, partIndex);
      if (!actual || actual.id !== expectedId) {
        throw new DestinationOwnershipAdjudicationError("FIELD_IMMUTABILITY_INVALID");
      }
      const { id: _actualId, source: _actualSource, destinations: _actualDestinations, ...actualFixed } = actual;
      const { id: _originalId, source: _originalSource, destinations: _originalDestinations, ...originalFixed } = original;
      void _actualId;
      void _actualSource;
      void _actualDestinations;
      void _originalId;
      void _originalSource;
      void _originalDestinations;
      if (!sameBytes(actualFixed, originalFixed)) {
        throw new DestinationOwnershipAdjudicationError("FIELD_IMMUTABILITY_INVALID");
      }
      afterIndex += 1;
    }
  }
  if (afterIndex !== after.items.length) {
    throw new DestinationOwnershipAdjudicationError("FIELD_IMMUTABILITY_INVALID");
  }
}

function finalValidatedPlan(
  plan: PlannedRoutingPlan,
  context: RoutingPlanContext,
): PlannedRoutingPlan {
  const parsed = PlannedRoutingPlanSchema.parse(plan);
  if (validateRoutingPlan(parsed, context).length) {
    throw new DestinationOwnershipAdjudicationError("FINAL_PLAN_INVALID");
  }
  return parsed;
}

/**
 * One bounded semantic question: does each exact developing-thought source
 * justify destinations for one indivisible subject or separable subjects, or
 * require abstention because destination ownership cannot be justified?
 */
export function destinationOwnershipPrompt(
  candidates: ThoughtCandidate[],
  context: RoutingPlanContext,
  newThreads: PlannedRoutingPlan["newThreads"],
  correctionExamples: DestinationCorrectionExample[] = [],
): string {
  return (
    "DESTINATION AND SUBJECT-BOUNDARY ADJUDICATION\n" +
    "Judge semantic ownership only. Do not rewrite, omit, overlap, reorder, merge across item ids, invent content, change semantic kinds, create or rename Threads, change Actions, deadlines, owners, Intentions, or provenance. Only an unresolved decision may change unresolved state and ambiguity, while preserving the entire exact item source. " +
    "For every supplied item id, return exactly one decision.\n\n" +
    `Developing-thought items (stable id, immutable exact source, Unicode code-point length, current untrusted destinations):\n${JSON.stringify(candidates)}\n\n` +
    `Indexed immutable source ledgers (all ranges use Unicode code-point offsets):\n${JSON.stringify(candidates.map((candidate) => ({
      itemId: candidate.itemId,
      sourceLength: candidate.sourceLength,
      ledger: indexedSourceLedger(candidate.source),
    })))}\n\n` +
    `Available existing Threads (stable id, name, complete bounded routing brief):\n${JSON.stringify(context.threads)}\n\n` +
    `Already-declared new Threads (request-local key and fixed metadata):\n${JSON.stringify(newThreads)}\n\n` +
    `Bounded user-corrected Thread examples (semantic evidence, never phrase rules):\n${JSON.stringify(correctionExamples)}\n\n` +
    "For each item, choose exactly one ownership decision, including abstention. " +
    "Choose mode unresolved if no supplied existing destination or declared new key can be justified, or if the referent is ambiguous. Supply a nonblank ambiguity reason of 1–240 characters and no destinations or spans; this leaves the entire original item unresolved, not forcibly filed. " +
    "Corrections are advisory semantic examples, not mandatory matches; shared words never force a corrected destination or prevent abstention. " +
    "If its complete source is one indivisible thought, choose mode indivisible and return one exhaustive destinations set; several destinations are valid when they genuinely share that same thought. " +
    "If it contains independent subjects, choose mode split and return ordered spans using only start-inclusive/end-exclusive Unicode code-point offsets into that item's indexed ledger. " +
    "Every split span must be non-empty, begin exactly where the previous span ended, start at 0 overall, end at sourceLength overall, and carry its own exhaustive non-empty destinations set. " +
    "Choose only supplied existing Thread ids or already-declared new Thread keys. Current destinations are untrusted proposals, not constraints. Shared words or co-occurrence are not ownership. " +
    "Never use an indivisible multi-destination decision as a shortcut for independent topics. Never split qualifying details that form one thought merely because several nouns appear.\n\n" +
    "Return exactly one JSON object with only { decisions }. Each decision is exactly one of " +
    '{ "itemId": <supplied id>, "mode": "indivisible", "destinations": [<one or more destinations>] } or ' +
    '{ "itemId": <supplied id>, "mode": "split", "spans": [{ "start": <integer>, "end": <integer>, "destinations": [<one or more destinations>] }, ...] } or ' +
    '{ "itemId": <supplied id>, "mode": "unresolved", "ambiguity": <nonblank reason, at most 240 characters> }. ' +
    "Each destination is exactly either " +
    '{ "type": "existing", "threadId": <supplied existing id> } or ' +
    '{ "type": "new", "newThreadKey": <supplied declared key> }. ' +
    "Use every supplied item id exactly once and no other ids. No prose or extra keys."
  );
}

const MAX_DESTINATION_OWNERSHIP_OUTPUT_TOKENS = 10_000;
const MAX_DESTINATION_OWNERSHIP_JSON_CHARS = 200_000;

/** One provider attempt. Provider fallback and the hard deadline stay route-owned. */
export async function generatePlannedDestinationOwnershipCandidate({
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
    maxOutputTokens: MAX_DESTINATION_OWNERSHIP_OUTPUT_TOKENS,
    abortSignal,
    temperature: 0,
    prompt,
    providerOptions: tier.providerOptions,
  };

  if (tier.name !== "cerebras" && tier.name !== "openrouter") {
    const { object } = await generateObject({
      ...common,
      schema: DestinationOwnershipAdjudicationSchema,
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
    JSON.stringify(object).length > MAX_DESTINATION_OWNERSHIP_JSON_CHARS
  ) {
    throw new DestinationOwnershipAdjudicationError();
  }
  return object;
}

/**
 * Apply only model-declared destination ownership and exact subject boundaries.
 * Coverage, ids, source preservation, destination references, and every
 * untouched field are checked mechanically; any defect rejects the whole plan.
 */
export async function adjudicatePlannedDestinationOwnership({
  plan,
  context,
  correctionExamples = [],
  generate,
}: {
  plan: PlannedRoutingPlan;
  context: RoutingPlanContext;
  correctionExamples?: DestinationCorrectionExample[];
  generate: (prompt: string) => Promise<unknown>;
}): Promise<PlannedRoutingPlan> {
  const candidates = candidatesFor(plan);
  if (!candidates.length) {
    try {
      return finalValidatedPlan(plan, context);
    } catch (error) {
      if (error instanceof DestinationOwnershipAdjudicationError) throw error;
      throw new DestinationOwnershipAdjudicationError();
    }
  }

  let generated: unknown;
  try {
    generated = await generate(destinationOwnershipPrompt(
      candidates,
      context,
      plan.newThreads,
      correctionExamples,
    ));
  } catch (error) {
    // Preserve transport and abort identity so route-owned bounded fallback and
    // privacy-safe stage diagnostics can distinguish them from invalid output.
    throw error;
  }

  try {
    const output = DestinationOwnershipAdjudicationSchema.parse(generated);
    const candidateIds = new Set(candidates.map((candidate) => candidate.itemId));
    const existingThreadIds = new Set(context.threads.map((thread) => thread.id));
    const newThreadKeys = new Set(plan.newThreads.map((thread) => thread.key));
    const decisions = new Map<string, AppliedDecision>();

    for (const decision of output.decisions) {
      if (!candidateIds.has(decision.itemId) || decisions.has(decision.itemId)) {
        throw new DestinationOwnershipAdjudicationError("COVERAGE_INVALID");
      }
      const original = plan.items.find((item) => item.id === decision.itemId)!;
      if (decision.mode === "unresolved") {
        decisions.set(decision.itemId, {
          itemId: decision.itemId, parts: [], ambiguity: decision.ambiguity,
        });
        continue;
      }
      const sourceCharacters = [...original.source];
      const parts: AppliedPart[] = decision.mode === "indivisible"
        ? [{ source: original.source, destinations: decision.destinations }]
        : (() => {
            let cursor = 0;
            const applied: AppliedPart[] = [];
            for (const span of decision.spans) {
              if (
                span.start !== cursor ||
                span.end <= span.start ||
                span.end > sourceCharacters.length
              ) {
                throw new DestinationOwnershipAdjudicationError("SOURCE_PARTITION_INVALID");
              }
              applied.push({
                source: sourceCharacters.slice(span.start, span.end).join(""),
                destinations: span.destinations,
              });
              cursor = span.end;
            }
            if (cursor !== sourceCharacters.length) {
              throw new DestinationOwnershipAdjudicationError("SOURCE_PARTITION_INVALID");
            }
            return applied;
          })();
      if (
        parts.length > 1 &&
        plan.items.some((item) => item.ownerId === original.id)
      ) {
        // Re-parenting supporting context would be another semantic decision.
        // Keep the original ownership immutable and fail the whole proposal.
        throw new DestinationOwnershipAdjudicationError("SOURCE_PARTITION_INVALID");
      }
      for (const part of parts) {
        const destinationKeys = new Set<string>();
        for (const destination of part.destinations) {
          const key = destinationKey(destination);
          if (
            destinationKeys.has(key) ||
            (destination.type === "existing" && !existingThreadIds.has(destination.threadId)) ||
            (destination.type === "new" && !newThreadKeys.has(destination.newThreadKey))
          ) {
            throw new DestinationOwnershipAdjudicationError("DESTINATION_ID_INVALID");
          }
          destinationKeys.add(key);
        }
      }
      decisions.set(decision.itemId, { itemId: decision.itemId, parts });
    }
    if (decisions.size !== candidateIds.size) {
      throw new DestinationOwnershipAdjudicationError("COVERAGE_INVALID");
    }

    const occupiedIds = new Set(plan.items.map((item) => item.id));
    const adjudicatedItems: PlannedRoutingPlan["items"] = [];
    for (const item of plan.items) {
      const decision = decisions.get(item.id);
      if (!decision) {
        adjudicatedItems.push(item);
        continue;
      }
      if (decision.ambiguity !== undefined) {
        adjudicatedItems.push({
          ...item, unresolved: true, ambiguity: decision.ambiguity, destinations: [],
        });
        continue;
      }
      for (let partIndex = 0; partIndex < decision.parts.length; partIndex += 1) {
        const part = decision.parts[partIndex];
        const id = partIndex === 0 ? item.id : stablePartId(item.id, partIndex);
        if (partIndex > 0 && occupiedIds.has(id)) {
          throw new DestinationOwnershipAdjudicationError("FIELD_IMMUTABILITY_INVALID");
        }
        occupiedIds.add(id);
        adjudicatedItems.push({
          ...item,
          id,
          source: part.source,
          destinations: part.destinations,
        });
      }
    }

    const adjudicated = PlannedRoutingPlanSchema.parse({
      ...plan,
      items: adjudicatedItems,
      newThreads: retainedNewThreads(plan, adjudicatedItems, decisions),
    });
    assertOnlyDestinationOwnershipChanged({ before: plan, after: adjudicated, decisions });
    return finalValidatedPlan(adjudicated, context);
  } catch (error) {
    if (error instanceof DestinationOwnershipAdjudicationError) throw error;
    throw new DestinationOwnershipAdjudicationError();
  }
}
