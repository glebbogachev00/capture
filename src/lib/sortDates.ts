import type { SortResult } from "./boardOps";
import type { SourceSegment } from "./sortInterpretation";

type DatedSpan = { start: number; end: number; date: string };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function localDateAt(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function shifted(date: Date, days: number): string {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

function relativeDateSpans(text: string, localDate: string): DatedSpan[] {
  const base = localDateAt(localDate);
  if (!base) return [];
  const spans: DatedSpan[] = [];
  const add = (match: RegExpExecArray, date: string) => {
    spans.push({ start: match.index, end: match.index + match[0].length, date });
  };

  for (const match of text.matchAll(/\b(today|tomorrow)\b/giu)) {
    add(match as RegExpExecArray, shifted(base, match[1].toLowerCase() === "tomorrow" ? 1 : 0));
  }

  for (const match of text.matchAll(/\b(?:(before|by|on|this|next|coming|following)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/giu)) {
    const modifier = match[1]?.toLowerCase();
    /* These modifiers are dialect- and context-sensitive. Preserve the
       provider-owned date rather than replacing it with a deterministic
       guess. Bare/this/by weekdays retain nearest-day reconciliation. */
    if (modifier === "next" || modifier === "coming" || modifier === "following") continue;
    const target = WEEKDAYS.indexOf(match[2].toLowerCase() as (typeof WEEKDAYS)[number]);
    const days = (target - base.getUTCDay() + 7) % 7;
    add(match as RegExpExecArray, shifted(base, days));
  }

  for (const match of text.matchAll(/\b(?:before|by|on)\s+(?:the\s+)?([12]?\d|3[01])(?:st|nd|rd|th)?\b/giu)) {
    const day = Number(match[1]);
    const candidate = new Date(base.getTime());
    candidate.setUTCDate(day);
    if (candidate.getUTCDate() !== day) continue;
    if (candidate < base) candidate.setUTCMonth(candidate.getUTCMonth() + 1, day);
    if (candidate.getUTCDate() === day) add(match as RegExpExecArray, candidate.toISOString().slice(0, 10));
  }

  return spans.filter((span, index) => !spans.some((other, otherIndex) => (
    otherIndex !== index && other.start <= span.start && other.end >= span.end &&
    (other.end - other.start) > (span.end - span.start)
  )));
}

function hasProviderOwnedAmbiguousWeekday(text: string): boolean {
  return /\b(?:next|coming|following)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/iu.test(text);
}

function oneDeterministicDate(text: string, localDate: string): string | null {
  if (hasProviderOwnedAmbiguousWeekday(text)) return null;
  const dates = [...new Set(relativeDateSpans(text, localDate).map((span) => span.date))];
  return dates.length === 1 ? dates[0] : null;
}

function sharedDatesByAction(
  sourceSegments: SourceSegment[],
  actionCount: number,
  localDate: string,
): Map<number, Set<string>> {
  const datesByAction = new Map<number, Set<string>>();
  for (const segment of sourceSegments) {
    if (segment.role !== "context" || !segment.actionOwnerIndexes?.length) continue;
    const date = oneDeterministicDate(segment.text, localDate);
    if (!date) continue;
    for (const ownerIndex of segment.actionOwnerIndexes) {
      // The interpretation boundary rejects invalid references. Keep this pure
      // helper fail-closed when called directly rather than assigning context
      // to an unintended row.
      if (!Number.isInteger(ownerIndex) || ownerIndex < 0 || ownerIndex >= actionCount) continue;
      const dates = datesByAction.get(ownerIndex) ?? new Set<string>();
      dates.add(date);
      datesByAction.set(ownerIndex, dates);
    }
  }
  return datesByAction;
}

/**
 * Reconcile deterministic relative-calendar arithmetic only within declared
 * source ownership. An action's own source may correct its provider due date.
 * Shared context may do so only when an ordered context segment explicitly
 * names that action. Text elsewhere in the raw capture is never evidence for
 * another action, and absolute or ambiguous expressions remain provider-owned.
 */
export function reconcileSortDates(
  result: SortResult,
  localDate: string,
  sourceSegments: SourceSegment[] = [],
): SortResult {
  if (!result.actionMeta?.length) return result;
  const sharedDates = sharedDatesByAction(sourceSegments, result.actionMeta.length, localDate);

  const actionMeta = result.actionMeta.map((action, index) => {
    // Deterministic arithmetic may correct an already identified deadline but
    // must never invent one when the provider found none.
    if (!action.due) return action;
    const ownedDate = oneDeterministicDate(action.source, localDate);
    if (ownedDate) return { ...action, due: ownedDate };

    const contextDates = sharedDates.get(index);
    if (contextDates?.size === 1) {
      return { ...action, due: [...contextDates][0] };
    }
    return action;
  });

  return {
    ...result,
    actionMeta,
    due: actionMeta.length === 1 ? actionMeta[0].due : null,
  };
}
