import { z } from "zod";
import type { Board, Frag } from "./model";
import { day } from "./ask";
import type { CleanupChange } from "./cleanup";

/**
 * Combine — notes in one thread that say the same thing, folded into one.
 *
 * A thread that grows by dictation repeats itself: the same idea, said on
 * Monday and again on Thursday in slightly different words. Deleting one
 * copy (Tidy's duplicate claim) loses whatever the second telling added;
 * keeping both makes the thread read like an echo. Combining keeps every
 * distinct detail in one note.
 *
 * The model finds the groups and writes the combined note, but only as an
 * EDIT of the person's own sentences — the app files and tidies thoughts, it
 * does not write them. Two cheap checks hold it to that: every number in
 * the originals must survive, and the result may not be longer than the
 * originals together. A proposal that fails either is dropped, never shown.
 */

/** A note long enough to be an essay is not combined — too much to lose. */
const NOTE_MAX = 600;
export const COMBINE_CONTEXT_MAX = 50_000;

export type CombineContext = {
  text: string;
  notes: Record<string, { threadId: string; frag: Frag }>;
  threads: Record<string, { id: string; name: string }>;
};

const eligible = (f: Frag) =>
  !f.unsorted && !f.resolvedAt && f.text.trim().length > 0 && f.text.length <= NOTE_MAX;

/** Threads with at least two combinable notes, most recently active first,
    until the budget is spent. */
export function combineContext(board: Board, now: number): CombineContext {
  const notes: CombineContext["notes"] = {};
  const threads: CombineContext["threads"] = {};
  const out: string[] = [`Today is ${day(now)}.`];
  let room = COMBINE_CONTEXT_MAX;
  let n = 0;
  const ranked = board.threads
    .map((t) => ({ t, fs: t.frags.filter(eligible) }))
    .filter(({ fs }) => fs.length >= 2)
    .sort((a, b) => Math.max(...b.fs.map((f) => f.at)) - Math.max(...a.fs.map((f) => f.at)));
  ranked.forEach(({ t, fs }, i) => {
    const lines = [`\n## [T${i + 1}] ${t.name.slice(0, 100)}`];
    const labels: [string, Frag][] = [];
    for (const f of fs) {
      const label = `N${++n}`;
      labels.push([label, f]);
      lines.push(`- [${label}] ${day(f.at)}: ${f.text.trim().replace(/\n+/g, " / ")}`);
    }
    const block = lines.join("\n");
    if (block.length > room) return;
    room -= block.length;
    threads[`T${i + 1}`] = { id: t.id, name: t.name };
    for (const [label, frag] of labels) notes[label] = { threadId: t.id, frag };
    out.push(block);
  });
  return { text: out.join("\n"), notes, threads };
}

export const CombineSchema = z.object({
  groups: z.array(z.object({
    notes: z.array(z.string()).describe("labels like N3, N7 — two or more notes from ONE thread"),
    combined: z.string().describe("the single note that replaces them, built from their own sentences"),
    reason: z.string().describe("one short plain sentence: what they have in common"),
  })),
});

export type CombineProposal = {
  /** Stable for the same notes, so a "keep separate" can be remembered. */
  key: string;
  threadId: string;
  threadName: string;
  frags: Frag[];
  combined: string;
  reason: string;
};

const NUMBER = /\d+(?:[.,:]\d+)*/g;

/** The model may drop repetition, never facts: every number said survives,
    and the result is no longer than what it replaces. */
export function keepsEveryDetail(sources: string[], combined: string): boolean {
  const total = sources.reduce((sum, s) => sum + s.trim().length, 0);
  if (!combined.trim() || combined.trim().length > total + 20) return false;
  const have = new Set(combined.match(NUMBER) ?? []);
  return sources.every((s) => (s.match(NUMBER) ?? []).every((num) => have.has(num)));
}

export function readCombine(
  value: unknown,
  ctx: CombineContext,
  skip: ReadonlySet<string> = new Set(),
): CombineProposal[] | null {
  const parsed = CombineSchema.safeParse(value);
  if (!parsed.success) return null;
  const used = new Set<string>();
  const out: CombineProposal[] = [];
  for (const g of parsed.data.groups) {
    const picked = [...new Set(g.notes.map((l) => l.replace(/[[\]\s]/g, "").toUpperCase()))]
      .map((l) => ctx.notes[l]);
    if (picked.length < 2 || picked.some((p) => !p || used.has(p.frag.id))) continue;
    const threadId = picked[0].threadId;
    if (picked.some((p) => p.threadId !== threadId)) continue;
    const frags = picked.map((p) => p.frag).sort((a, b) => a.at - b.at);
    const combined = g.combined.trim();
    if (!keepsEveryDetail(frags.map((f) => f.text), combined)) continue;
    const key = frags.map((f) => f.id).sort().join("+");
    if (skip.has(key)) continue;
    frags.forEach((f) => used.add(f.id));
    const name = Object.values(ctx.threads).find((t) => t.id === threadId)?.name ?? "";
    out.push({ key, threadId, threadName: name, frags, combined, reason: g.reason.trim().slice(0, 240) });
  }
  return out;
}

/** Each group becomes its newest note, rewritten: it sits where the idea
    was last said, carries every photo the group had, and anything pointing
    at a folded note points at it instead. A group whose notes changed since
    the proposal is skipped. */
export function applyCombine(board: Board, proposals: CombineProposal[], now: number): CleanupChange | null {
  let next = board;
  const threads = new Set<string>();
  let combined = 0;
  let folded = 0;
  for (const p of proposals) {
    const t = next.threads.find((x) => x.id === p.threadId);
    const live = p.frags.map((f) => t?.frags.find((x) => x.id === f.id));
    if (!t || live.some((f, i) => !f || f.text !== p.frags[i].text || f.resolvedAt)) continue;
    const keep = p.frags[p.frags.length - 1];
    const gone = new Set(p.frags.slice(0, -1).map((f) => f.id));
    const imgs = [...new Set(p.frags.flatMap((f) => f.imgs ?? []))];
    next = {
      ...next,
      threads: next.threads.map((x) => x.id !== t.id ? x : {
        ...x,
        updatedAt: now,
        frags: x.frags.filter((f) => !gone.has(f.id)).map((f) => f.id !== keep.id ? f : {
          ...f, text: p.combined, ...(imgs.length ? { imgs } : {}), updatedAt: now,
        }),
      }),
      actions: next.actions.map((a) => a.shot && gone.has(a.shot.fragId)
        ? { ...a, shot: { threadId: t.id, fragId: keep.id }, updatedAt: now } : a),
    };
    threads.add(t.id);
    combined++;
    folded += p.frags.length;
  }
  if (!combined) return null;
  return {
    board: next,
    imgs: [],
    threads: [...threads],
    notice: `Combined ${folded} notes into ${combined}.`,
  };
}
