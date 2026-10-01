/**
 * The live sorter answers { sort: { items } } (one call, sortVersion 2). The
 * probe and baseline scripts were written against the older single answer
 * ({ kind, clean, actions, threadId, ... }), so they ask the live sorter and
 * read its answer through this. New actions land with a "weeks" shelf; the
 * one-call sorter has no other.
 */

/** Fields every probe request adds to ask the one-call sorter. */
export const oneCall = () => ({
  sortVersion: 2,
  tzOffset: new Date().getTimezoneOffset(),
  captureId: `probe-${Math.random().toString(36).slice(2)}`,
});

/**
 * The one-call sorter answers with a list of items; the judge reads the
 * single-call shape (kind, actions, a primary destination plus `also`).
 * Translate, so every case and every judgement stays exactly as it was.
 */
export function fromSimpleSort(response) {
  const items = Array.isArray(response?.sort?.items) ? response.sort.items : [];
  const thoughts = items.filter((item) => item?.kind === "thought");
  const fresh = items.filter((item) => item?.kind === "action" && !item.existingActionId);
  const destinations = thoughts.flatMap((item) => (item.threads ?? []).map((target) => ({
    threadId: typeof target?.id === "string" ? target.id : null,
    threadName: typeof target?.name === "string" ? target.name : null,
    text: String(item.text ?? ""),
  })));
  const kind = thoughts.length && fresh.length ? "both"
    : thoughts.length ? "thread"
      : items.some((item) => item?.kind === "intention") && !fresh.length ? "intention" : "action";
  const [first, ...rest] = destinations;
  return {
    via: response?.via,
    kind,
    actions: fresh.map((action) => String(action.text)),
    actionDetails: fresh.map((action) => ({ text: String(action.text), due: action.due ?? null, source: "" })),
    due: fresh.length === 1 ? fresh[0].due ?? null : null,
    shelfLife: fresh.length ? "weeks" : undefined,
    threadId: first?.threadId ?? null,
    threadName: first?.threadName ?? null,
    primaryText: first?.text,
    clean: thoughts.map((thought) => String(thought.text)).join("\n\n"),
    also: rest,
  };
}
