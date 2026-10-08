import { vi } from "vitest";
import type { PlannedRoutingPlan } from "@/lib/plannedRouting";
import type { SimpleSortItem } from "@/lib/simpleSort";

/**
 * The hook tests describe sorter answers as planned routing plans. The app
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

/** An older sorter's answer ({kind, clean, actions, threadId, …}) as the
 * one-call sorter's items, now that Sort now and retries ask that sorter. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function simpleFromLegacy(body: any): SimpleSortItem[] {
  const due = typeof body.due === "string" ? body.due.slice(0, 10) : undefined;
  const actions: SimpleSortItem[] = (body.actions?.length ? body.actions : [body.clean])
    .map((text: string) => ({ kind: "action" as const, text, ...(due ? { due } : {}) }));
  const thought: SimpleSortItem = {
    kind: "thought", text: body.clean,
    threads: [body.threadId ? { id: body.threadId } : { name: body.threadName ?? body.title ?? "New thread" }],
  };
  if (body.kind === "intention") return [{ kind: "intention", text: body.clean }];
  if (body.kind === "thread") return [thought];
  if (body.kind === "both") return [thought, ...actions];
  return actions;
}

/** vi.stubGlobal("fetch", mock), with planned and older answers translated
 * for the one-call sorter. The mock still receives every call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stubSortFetch(mock: (input: any, init?: RequestInit) => unknown) {
  const wrapped = vi.fn(async (input: unknown, init?: RequestInit) => {
    const response = await mock(input, init);
    if (!(response instanceof Response) || !String(input).includes("/api/sort") || !response.ok) return response;
    const asked = (() => { try { return JSON.parse(String(init?.body ?? "{}")); } catch { return {}; } })();
    if (asked.sortVersion !== 2) return response;
    const body = await response.clone().json().catch(() => null);
    if (body?.routingPlan) return Response.json({ sort: { version: 2, items: simpleAnswer(body.routingPlan) }, via: body.via }, { status: response.status });
    if (typeof body?.kind === "string" && typeof body?.clean === "string") {
      return Response.json({ sort: { version: 2, items: simpleFromLegacy(body) }, via: body.via }, { status: response.status });
    }
    return response;
  });
  vi.stubGlobal("fetch", wrapped);
  return wrapped;
}
