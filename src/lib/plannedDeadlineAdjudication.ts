import { generateObject } from "ai";
import { z } from "zod";
import {
  PlannedRoutingPlanSchema,
  validateRoutingPlan,
  type PlannedRoutingPlan,
  type RoutingPlanContext,
} from "./plannedRouting";
import type { Tier } from "./providers";

const Weekday = z.enum([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

const CalendarOperation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("day_offset"),
    days: z.number().int().min(-366).max(366),
  }).strict(),
  z.object({
    type: z.literal("next_weekday"),
    weekday: Weekday,
    occurrence: z.literal("strictly_after_today"),
  }).strict(),
  z.object({
    type: z.literal("fixed"),
    iso: z.string().min(1).max(40),
  }).strict(),
]);

const DeadlineDecision = z.object({
  deadlineItemId: z.string().min(1).max(80),
  ownerActionId: z.string().min(1).max(80),
  due: z.string().min(1).max(40),
  calendarOperation: CalendarOperation,
}).strict();

export const PlannedDeadlineAdjudicationSchema = z.object({
  decisions: z.array(DeadlineDecision).max(30),
}).strict();

export type PlannedDeadlineAdjudication = z.infer<typeof PlannedDeadlineAdjudicationSchema>;
export type DeadlineAdjudicationFailureCode =
  | "OUTPUT_SCHEMA_INVALID"
  | "COVERAGE_INVALID"
  | "DEADLINE_ID_INVALID"
  | "DEADLINE_SEMANTICS_INVALID"
  | "FIELD_IMMUTABILITY_INVALID"
  | "FINAL_PLAN_INVALID";

export class DeadlineAdjudicationError extends Error {
  constructor(public readonly code: DeadlineAdjudicationFailureCode = "OUTPUT_SCHEMA_INVALID") {
    super("Planned deadlines could not be adjudicated");
    this.name = "DeadlineAdjudicationError";
  }
}

type DeadlineCandidate = {
  id: string;
  source: string;
  ownerActionId: string;
};

function deadlineCandidates(plan: PlannedRoutingPlan): DeadlineCandidate[] {
  return plan.items.flatMap((item) =>
    item.kind === "deadline" && item.ownerId && !item.unresolved
      ? [{ id: item.id, source: item.source, ownerActionId: item.ownerId }]
      : [],
  );
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

type CalendarDate = { year: number; month: number; day: number };

function calendarDateAt(now: number, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const date = { year: value("year"), month: value("month"), day: value("day") };
  if (!date.year || !date.month || !date.day) throw new DeadlineAdjudicationError();
  return date;
}

function isoDate(date: CalendarDate): string {
  return `${date.year}-${twoDigits(date.month)}-${twoDigits(date.day)}`;
}

function shiftedDate(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12)).getUTCDay();
}

function expectedDue(
  operation: z.infer<typeof CalendarOperation>,
  today: CalendarDate,
): string {
  if (operation.type === "fixed") return operation.iso;
  if (operation.type === "day_offset") return isoDate(shiftedDate(today, operation.days));
  const target = Weekday.options.indexOf(operation.weekday);
  const offset = (target - weekdayOf(today) + 7) % 7 || 7;
  return isoDate(shiftedDate(today, offset));
}

function finalValidatedPlan(
  plan: PlannedRoutingPlan,
  context: RoutingPlanContext,
): PlannedRoutingPlan {
  const parsed = PlannedRoutingPlanSchema.parse(plan);
  if (validateRoutingPlan(parsed, context).length) {
    throw new DeadlineAdjudicationError("FINAL_PLAN_INVALID");
  }
  return parsed;
}

export function requiresPlannedDeadlineAdjudication(plan: PlannedRoutingPlan): boolean {
  return deadlineCandidates(plan).length > 0;
}

/**
 * Minimal model-owned date question. It deliberately excludes Action wording,
 * destinations, existing board state, and the planner's untrusted due values.
 */
export function plannedDeadlineAdjudicationPrompt(
  plan: PlannedRoutingPlan,
  context: RoutingPlanContext,
  timeZone: string,
): string {
  const today = calendarDateAt(context.now, timeZone);
  const weekday = Weekday.options[weekdayOf(today)];
  return (
    "PLANNED DEADLINE ADJUDICATION\n" +
    "Interpret only the calendar meaning of each exact deadline phrase. Do not infer from Action wording or any evidence outside the supplied phrase. Do not rewrite sources, change owners, omit ids, or invent ids.\n\n" +
    `Current local calendar date: ${isoDate(today)}\n` +
    `Current local weekday: ${weekday}\n` +
    `IANA timezone: ${timeZone}\n\n` +
    `Deadline items (stable id, exact immutable source phrase, immutable owner Action id):\n${JSON.stringify(deadlineCandidates(plan))}\n\n` +
    "Return exactly one decision for every supplied deadline id and no other id. Copy ownerActionId exactly. Return the interpreted ISO due and the explicit calendar operation that produced it. " +
    "Use day_offset for a relative number of local calendar days. Use next_weekday for the named weekday's next occurrence strictly after today; when today is that weekday, that means seven days later. " +
    "Use fixed only when the phrase itself supplies a fixed date or date-time, and copy the same ISO value into calendarOperation.iso and due.\n\n" +
    "Return exactly one JSON object with only { decisions }. Each decision has exactly { deadlineItemId, ownerActionId, due, calendarOperation }. " +
    "calendarOperation is exactly one of " +
    '{ "type": "day_offset", "days": <integer> }, ' +
    '{ "type": "next_weekday", "weekday": <lowercase weekday>, "occurrence": "strictly_after_today" }, or ' +
    '{ "type": "fixed", "iso": <exact ISO due> }. No prose or extra keys.'
  );
}

const MAX_DEADLINE_ADJUDICATION_OUTPUT_TOKENS = 4_000;
const MAX_DEADLINE_ADJUDICATION_JSON_CHARS = 100_000;

/** One provider attempt. Provider fallback and the shared deadline stay route-owned. */
export async function generatePlannedDeadlineAdjudicationCandidate({
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
    maxOutputTokens: MAX_DEADLINE_ADJUDICATION_OUTPUT_TOKENS,
    abortSignal,
    temperature: 0,
    prompt,
    providerOptions: tier.providerOptions,
  };
  if (tier.name !== "cerebras") {
    const { object } = await generateObject({ ...common, schema: PlannedDeadlineAdjudicationSchema });
    return object;
  }
  const { object } = await generateObject({ ...common, output: "no-schema" });
  if (
    object === null ||
    typeof object !== "object" ||
    Array.isArray(object) ||
    JSON.stringify(object).length > MAX_DEADLINE_ADJUDICATION_JSON_CHARS
  ) throw new DeadlineAdjudicationError();
  return object;
}

/** Apply only complete, owner-stable, mechanically consistent model date decisions. */
export async function adjudicatePlannedDeadlines({
  plan,
  context,
  timeZone,
  generate,
}: {
  plan: PlannedRoutingPlan;
  context: RoutingPlanContext;
  timeZone: string;
  generate: (prompt: string) => Promise<unknown>;
}): Promise<PlannedRoutingPlan> {
  const candidates = deadlineCandidates(plan);
  if (!candidates.length) return finalValidatedPlan(plan, context);

  let generated: unknown;
  try {
    generated = await generate(plannedDeadlineAdjudicationPrompt(plan, context, timeZone));
  } catch (error) {
    /* Transport/provider/abort failures must remain distinguishable so the
       route can record the fixed tier reason before bounded fallback. */
    throw error;
  }

  try {
    const output = PlannedDeadlineAdjudicationSchema.parse(generated);
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const decisionsById = new Map<string, PlannedDeadlineAdjudication["decisions"][number]>();
    const today = calendarDateAt(context.now, timeZone);

    for (const decision of output.decisions) {
      const candidate = candidatesById.get(decision.deadlineItemId);
      if (!candidate || decisionsById.has(decision.deadlineItemId)) {
        throw new DeadlineAdjudicationError("DEADLINE_ID_INVALID");
      }
      if (decision.ownerActionId !== candidate.ownerActionId) {
        throw new DeadlineAdjudicationError("FIELD_IMMUTABILITY_INVALID");
      }
      if (decision.due !== expectedDue(decision.calendarOperation, today)) {
        throw new DeadlineAdjudicationError("DEADLINE_SEMANTICS_INVALID");
      }
      decisionsById.set(decision.deadlineItemId, decision);
    }
    if (decisionsById.size !== candidatesById.size) {
      throw new DeadlineAdjudicationError("COVERAGE_INVALID");
    }

    const adjudicated = PlannedRoutingPlanSchema.parse({
      ...plan,
      items: plan.items.map((item) => {
        const decision = decisionsById.get(item.id);
        return decision ? { ...item, due: decision.due } : item;
      }),
    });
    const withoutDue = (candidate: PlannedRoutingPlan) => ({
      newThreads: candidate.newThreads,
      items: candidate.items.map((item) =>
        item.kind === "deadline" ? { ...item, due: null } : item),
    });
    if (JSON.stringify(withoutDue(plan)) !== JSON.stringify(withoutDue(adjudicated))) {
      throw new DeadlineAdjudicationError("FIELD_IMMUTABILITY_INVALID");
    }
    return finalValidatedPlan(adjudicated, context);
  } catch (error) {
    throw error instanceof DeadlineAdjudicationError
      ? error
      : new DeadlineAdjudicationError();
  }
}
