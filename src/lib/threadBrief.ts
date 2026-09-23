import type { Thread } from "./model";

/**
 * The sorter receives every thread, not a recency prefix. Exact board ids stay
 * in the request envelope and never enter the model prompt; the route assigns
 * short request-local routing keys and resolves them back server-side.
 */
export const BRIEF_BUDGET = 5000;
export const MAX_THREAD_CANDIDATES = 256;
export const MAX_THREAD_ID_CHARS = 1024;
export const MAX_THREAD_NAME_CHARS = 500;
export const MAX_THREAD_ABOUT_CHARS = 1000;
const MAX = 700;

export type ThreadBrief = { id: string; name: string; about: string };
export type PromptThreadInventory = {
  routes: [route: string, semanticContext: string][];
  serialized: string;
};

/** Trim at a sentence end where there is one, so the model never reads a
    description that stops mid-clause and implies something untrue. */
export function brief(summary: string | undefined, limit: number): string {
  if (limit <= 0) return "";
  const text = (summary ?? "").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return stop > limit * 0.5
    ? cut.slice(0, stop + 1)
    : cut.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}

function semanticContext(thread: Thread, limit: number): string {
  const originals = thread.frags
    .filter((frag) => !frag.unsorted && frag.text.trim())
    .slice(-3)
    .map((frag) => frag.text.trim())
    .join("\n\n");
  const parts = [thread.belongs?.trim(), thread.summary?.trim(), originals].filter(
    (part): part is string => Boolean(part),
  );
  if (!parts.length || limit <= 0) return "";
  if (parts.length === 1) return brief(parts[0], limit);

  const separators = (parts.length - 1) * 2;
  const usable = Math.max(0, limit - separators);
  let remaining = usable;
  const clipped = parts.map((part, index) => {
    const share = Math.floor(remaining / (parts.length - index));
    const value = brief(part, share);
    remaining -= value.length;
    return value;
  }).filter(Boolean);
  return clipped.join("\n\n").slice(0, limit);
}

function routeKey(index: number): string {
  return `r${index.toString(36)}`;
}

function promptSemantic(thread: ThreadBrief): string {
  return thread.about ? `${thread.name}\n${thread.about}` : thread.name;
}

function clipPromptValue(value: string, limit: number): string {
  if (limit <= 0) return "";
  if (value.length <= limit) return value;
  return limit === 1 ? "…" : `${value.slice(0, limit - 1).trimEnd()}…`;
}

/** Build the exact model-visible inventory. Every submitted thread gets one
 * opaque key. A uniform semantic cap is found by binary search against the
 * serialized representation, so escaped input cannot exceed the hard budget. */
export function promptThreadInventory(threads: ThreadBrief[]): PromptThreadInventory {
  if (threads.length > MAX_THREAD_CANDIDATES) {
    throw new Error("Too many thread candidates for one sort request");
  }
  const semantics = threads.map(promptSemantic);
  const build = (limit: number): [string, string][] => semantics.map((value, index) => [
    routeKey(index),
    clipPromptValue(value, limit),
  ]);
  const empty = build(0);
  if (JSON.stringify(empty).length > BRIEF_BUDGET) {
    throw new Error("Thread candidate inventory exceeds the routing budget");
  }

  let low = 0;
  let high = MAX_THREAD_NAME_CHARS + MAX_THREAD_ABOUT_CHARS + 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(build(middle)).length <= BRIEF_BUDGET) low = middle;
    else high = middle - 1;
  }
  const routes = build(low);
  const serialized = JSON.stringify(routes);
  if (serialized.length > BRIEF_BUDGET) {
    throw new Error("Thread candidate inventory exceeds the routing budget");
  }
  return { routes, serialized };
}

/** Resolve only canonical request-local route keys. No name or lexical fallback
 * is allowed: malformed model output fails closed before board application. */
export function resolvePromptThreadId(
  route: string,
  threads: ThreadBrief[],
): string | null {
  const match = /^r([0-9a-z]+)$/u.exec(route);
  if (!match) return null;
  const index = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(index) || routeKey(index) !== route) return null;
  return threads[index]?.id ?? null;
}

export function threadBriefs(threads: Thread[]): ThreadBrief[] {
  if (threads.length > MAX_THREAD_CANDIDATES) {
    throw new Error("Too many thread candidates for one sort request");
  }
  return threads.map((thread) => {
    const id = thread.id.trim();
    if (!id || id.length > MAX_THREAD_ID_CHARS) {
      throw new Error("Thread candidate id is invalid");
    }
    const name = thread.name.trim();
    if (!name) throw new Error("Thread candidate name is invalid");
    return {
      id,
      name: clipPromptValue(name, MAX_THREAD_NAME_CHARS),
      about: semanticContext(thread, MAX).slice(0, MAX_THREAD_ABOUT_CHARS),
    };
  });
}
