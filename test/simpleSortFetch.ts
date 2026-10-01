import { vi } from "vitest";
import type { PlannedRoutingPlan } from "@/lib/plannedRouting";
import type { SimpleSortItem } from "@/lib/simpleSort";

/**
 * The hook tests describe sorter answers as planned routing plans or as the
 * older single-call answer. The app
 * now asks the one-call sorter, so this turns such a fixture into the answer
 * that sorter gives: one item per kept part, supporting text folded into its
 * owner, a deadline's date onto its Actions. Unresolved parts are dropped;
 * the one-call sorter has no partial remainder.
 */
export function simpleAnswer(plan: PlannedRoutingPlan): SimpleSortItem[] {
  const items: SimpleSortItem[] = [];
  const byId = new Map<string, SimpleSortItem>();
  for (const item of plan.items) {
    if (item.unresolved) continue;
    if (item.kind === "supporting_context" || item.kind === "deadline") {
      for (const ownerId of [item.ownerId, ...(item.additionalOwnerIds ?? [])]) {
        const owner = ownerId ? byId.get(ownerId) : undefined;
        if (!owner) continue;
        if (item.kind === "deadline" && item.due) owner.due = item.due.slice(0, 10);
        if (item.kind === "supporting_context" && owner.kind !== "action") owner.text += item.source;
      }
      continue;
    }
    const next: SimpleSortItem = item.kind === "action"
      ? { kind: "action", text: item.action ?? item.source.trim() }
      : item.kind === "intention"
        ? { kind: "intention", text: item.source }
        : {
            kind: "thought", text: item.source,
            threads: item.destinations.length ? item.destinations.map((destination) => destination.type === "existing"
              ? { id: destination.threadId }
              : { name: plan.newThreads.find((thread) => thread.key === destination.newThreadKey)?.name ?? "New thread" })
              : [{ name: "New thread" }],
          };
    byId.set(item.id, next);
    items.push(next);
  }
  return items;
}

type LegacySorted = {
  kind?: string; clean?: string; title?: string; actions?: string[]; due?: string | null;
  threadId?: string | null; threadName?: string | null; primaryText?: string | null;
  also?: { text: string; threadId?: string | null; threadName?: string | null }[];
};

/** The older single-call answer ({ kind, clean, actions, threadId, ... }) as
 * the one-call sorter would say it. */
export function simpleFromLegacy(sorted: LegacySorted): SimpleSortItem[] {
  const clean = sorted.clean ?? "";
  const home = (threadId?: string | null, threadName?: string | null) =>
    [threadId ? { id: threadId } : { name: threadName || sorted.title || "New thread" }];
  if (sorted.kind === "intention") return [{ kind: "intention", text: clean }];
  const thoughts: SimpleSortItem[] = sorted.kind === "thread" || sorted.kind === "both"
    ? [{ kind: "thought", text: (sorted.primaryText?.trim() || (sorted.kind === "both" ? "" : clean)) || clean,
        threads: home(sorted.threadId, sorted.threadName) },
       ...(sorted.also ?? []).map((part): SimpleSortItem => ({ kind: "thought", text: part.text, threads: home(part.threadId, part.threadName) }))]
    : [];
  const tasks = sorted.kind === "action" || sorted.kind === "both"
    ? (sorted.actions?.length ? sorted.actions : sorted.kind === "action" ? [sorted.title || clean] : [])
    : [];
  const due = tasks.length === 1 && sorted.due ? sorted.due.slice(0, 10) : undefined;
  return [...thoughts, ...tasks.map((text): SimpleSortItem => ({ kind: "action", text, ...(due ? { due } : {}) }))];
}

/** vi.stubGlobal("fetch", mock), with planned answers translated for the
 * one-call sorter. The mock still receives every call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stubSortFetch(mock: (input: any, init?: RequestInit) => unknown) {
  const wrapped = vi.fn(async (input: unknown, init?: RequestInit) => {
    const response = await mock(input, init);
    if (!(response instanceof Response) || !String(input).includes("/api/sort") || !response.ok) return response;
    const asked = (() => { try { return JSON.parse(String(init?.body ?? "{}")); } catch { return {}; } })();
    if (asked.sortVersion !== 2) return response;
    const body = await response.clone().json().catch(() => null);
    if (!body || body.sort) return response;
    const items = body.routingPlan ? simpleAnswer(body.routingPlan) : typeof body.kind === "string" ? simpleFromLegacy(body) : null;
    if (!items) return response;
    return Response.json({ sort: { version: 2, items }, via: body.via }, { status: response.status });
  });
  vi.stubGlobal("fetch", wrapped);
  return wrapped;
}
