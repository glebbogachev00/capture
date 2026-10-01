import { z } from "zod";
import type { Board } from "./model";
import { applyActionFold } from "./actionOps";
import { applyFragDelete, applyFragMove } from "./fragOps";
import { day } from "./ask";

/**
 * Clean up — the two kinds of clutter Tidy's other passes never touch.
 *
 * Old photos: pictures that did their job weeks ago and now only weigh the
 * board down. Chosen by age alone, which is exactly what the person asked
 * for — they do not want to look at each one — and nothing is removed until
 * they have seen the batch and confirmed it. The words a photo came with
 * stay; only a note that WAS the photo ("(image only)") goes with it.
 *
 * One-liners: the short scraps a sort leaves behind — a clause split off a
 * longer thought, "ok that", a reminder whose moment has passed. Which of
 * them are noise is a judgement about meaning, so the model makes it, with
 * the rest of the board in view, and proposes; the person decides.
 *
 * Both return a whole change for ONE commit, so one Undo takes back the
 * batch, and the pictures a change drops are handed back so the caller can
 * hold their bytes until that Undo can no longer run.
 */

export type CleanupChange = {
  board: Board;
  /** Image ids no longer on the board — held, not destroyed, until Undo expires. */
  imgs: string[];
  /** Threads whose notes changed, so their summaries can catch up. */
  threads: string[];
  notice: string;
};

/* ------------------------------ old photos ------------------------------ */

export type OldPhoto = { id: string; at: number; where: string };

const PLACEHOLDER = /^\s*(?:\(image only\))?\s*$/i;

/** Every photo on the board whose newest use is older than `cutoff`, newest
    first. The profile picture is identity, not clutter, and an unsorted
    capture is still waiting to be filed — neither is ever offered. */
export function oldPhotos(board: Board, cutoff: number): OldPhoto[] {
  const newest = new Map<string, OldPhoto>();
  const protectedIds = new Set<string>(board.profile?.imageId ? [board.profile.imageId] : []);
  const see = (ids: string[] | undefined, at: number, where: string, unsorted?: boolean) => {
    for (const id of ids ?? []) {
      if (unsorted) protectedIds.add(id);
      const prev = newest.get(id);
      if (!prev || at > prev.at) newest.set(id, { id, at, where });
    }
  };
  for (const a of board.actions) see(a.imgs, a.at, "Actions", a.unsorted);
  for (const t of board.threads) for (const f of t.frags) see(f.imgs, f.at, t.name, f.unsorted);
  for (const i of board.intentions) see(i.imgs, i.at, "Intentions");
  return [...newest.values()]
    .filter((p) => p.at < cutoff && !protectedIds.has(p.id))
    .sort((a, b) => b.at - a.at);
}

export function removePhotos(board: Board, ids: string[], now: number): CleanupChange | null {
  const gone = new Set(ids);
  if (!gone.size) return null;
  const hit = (imgs: string[] | undefined) => !!imgs?.some((id) => gone.has(id));
  const keep = (imgs: string[] | undefined) => imgs?.filter((id) => !gone.has(id));
  let notes = 0;
  const threads: string[] = [];

  const nextThreads = board.threads.flatMap((t) => {
    if (!t.frags.some((f) => hit(f.imgs)) && !gone.has(t.cover?.slice(4) ?? "")) return [t];
    const frags = t.frags.flatMap((f) => {
      if (!hit(f.imgs)) return [f];
      const imgs = keep(f.imgs)!;
      if (!imgs.length && PLACEHOLDER.test(f.text)) { notes++; return []; }
      return [{ ...f, imgs, updatedAt: now }];
    });
    if (!frags.length) return [];
    if (frags.length !== t.frags.length) threads.push(t.id);
    const cover = t.cover && gone.has(t.cover.slice(4)) ? undefined : t.cover;
    return [{ ...t, frags, cover, updatedAt: now }];
  });
  const holdsPhoto = new Set(nextThreads.flatMap((t) => t.frags.filter((f) => f.imgs?.length).map((f) => f.id)));

  const actions = board.actions.flatMap((a) => {
    let next = a;
    if (hit(a.imgs)) {
      const imgs = keep(a.imgs)!;
      if (!imgs.length && PLACEHOLDER.test(a.text)) { notes++; return []; }
      next = { ...next, imgs, updatedAt: now };
    }
    if (next.shot && !holdsPhoto.has(next.shot.fragId)) next = { ...next, shot: undefined, updatedAt: now };
    return [next];
  });

  const intentions = board.intentions.map((i) =>
    hit(i.imgs) ? { ...i, imgs: keep(i.imgs), updatedAt: now } : i
  );
  /* The record of a filed capture still names its photos; strip them there
     too, or the bytes stay referenced — and backed up — forever. A pending
     capture's photos are its only copy and are never touched. */
  const ledger = board.ledger.map((e) =>
    e.kind !== "pending" && hit(e.imgs) ? { ...e, imgs: keep(e.imgs) } : e
  );

  const count = gone.size;
  return {
    board: { ...board, threads: nextThreads, actions, intentions, ledger },
    imgs: [...gone],
    threads,
    notice: `Removed ${count} ${count === 1 ? "photo" : "photos"}${notes ? ` and ${notes} photo-only ${notes === 1 ? "note" : "notes"}` : ""}. The words stay.`,
  };
}

/* ------------------------------- one-liners ------------------------------ */

/** Short enough to be a scrap: one line, a sentence at most. */
export const ONE_LINER_MAX = 100;
export const ONE_LINER_BATCH = 80;
/** The route refuses more than 60k characters; this keeps well inside it. */
export const ONE_LINER_CONTEXT_MAX = 56_000;
const NEIGHBOUR_BUDGET = 22_000;

export type OneLiner = {
  /** Stable across scans, so a "keep" can be remembered. */
  key: string;
  kind: "action" | "note";
  id: string;
  threadId?: string;
  text: string;
  at: number;
};

export function oneLiners(board: Board, kept: ReadonlySet<string> = new Set()): OneLiner[] {
  const short = (text: string) => {
    const t = text.trim();
    return !!t && t.length <= ONE_LINER_MAX && !t.includes("\n");
  };
  const out: OneLiner[] = [];
  const pinned = new Set(board.actions.filter((a) => !a.done && a.shot).map((a) => a.shot!.fragId));
  for (const a of board.actions) {
    if (a.unsorted || a.done || a.faded || a.imgs?.length || !short(a.text)) continue;
    out.push({ key: `a:${a.id}`, kind: "action", id: a.id, text: a.text.trim(), at: a.at });
  }
  for (const t of board.threads) {
    for (const f of t.frags) {
      if (f.unsorted || f.resolvedAt || f.imgs?.length || pinned.has(f.id) || !short(f.text)) continue;
      out.push({ key: `n:${f.id}`, kind: "note", id: f.id, threadId: t.id, text: f.text.trim(), at: f.at });
    }
  }
  return out.filter((o) => !kept.has(o.key)).sort((a, b) => b.at - a.at).slice(0, ONE_LINER_BATCH);
}

export type OneLinerContext = {
  text: string;
  items: Record<string, OneLiner>;
  threads: Record<string, { id: string; name: string }>;
};

/** What the model reads: every thread (so it knows where a scrap could go),
    the other notes of each thread a scrap sits in (so it can tell a scrap
    that repeats its neighbours from one that adds something), the open
    actions, and the scraps themselves, labelled. */
export function oneLinerContext(board: Board, items: OneLiner[], now: number): OneLinerContext {
  const threads: OneLinerContext["threads"] = {};
  const tLabel = new Map<string, string>();
  board.threads.forEach((t, i) => {
    tLabel.set(t.id, `T${i + 1}`);
    threads[`T${i + 1}`] = { id: t.id, name: t.name };
  });
  const scrapIds = new Set(items.map((i) => i.id));
  const homes = new Set(items.map((i) => i.threadId).filter(Boolean));
  const out: string[] = [`Today is ${day(now)}.`, "", "## Threads"];
  /* The neighbours are what let the model tell a repeat from a new thought;
     they get a fixed share, so a board of many threads still fits. */
  let neighbours = NEIGHBOUR_BUDGET;
  for (const t of board.threads) {
    const about = (t.belongs || t.summary || "").replace(/\s+/g, " ").trim().slice(0, 180);
    out.push(`- [${tLabel.get(t.id)}] ${t.name.slice(0, 100)}${about ? ` — ${about}` : ""} (${t.frags.length} notes)`);
    if (!homes.has(t.id)) continue;
    const others = t.frags.filter((f) => !scrapIds.has(f.id) && !f.unsorted).slice(-8);
    for (const f of others) {
      const line = `    · ${day(f.at)}: ${f.text.replace(/\s+/g, " ").trim().slice(0, 180)}`;
      if ((neighbours -= line.length) < 0) break;
      out.push(line);
    }
  }
  const open = board.actions.filter((a) => !a.done && !a.faded && !a.unsorted && !scrapIds.has(a.id)).slice(0, 60);
  out.push("", "## Other open actions", ...(open.length ? open.map((a) => `- ${a.text.replace(/\s+/g, " ").slice(0, 160)}`) : ["(none)"]));
  const labelled: Record<string, OneLiner> = {};
  out.push("", "## One-liners to review");
  items.forEach((item, i) => {
    const ref = `L${i + 1}`;
    labelled[ref] = item;
    const where = item.kind === "action" ? "open action" : `note in [${tLabel.get(item.threadId!)}]`;
    out.push(`- [${ref}] (${where}, ${day(item.at)}) ${item.text}`);
  });
  /* Scraps come last, so a pathologically wide board loses thread lines,
     never the scraps under review. */
  const body = out.join("\n");
  const tail = body.indexOf("\n## Other open actions");
  const text = body.length <= ONE_LINER_CONTEXT_MAX ? body
    : body.slice(0, Math.max(0, ONE_LINER_CONTEXT_MAX - (body.length - tail))) + body.slice(tail);
  return { text: text.slice(-ONE_LINER_CONTEXT_MAX), items: labelled, threads };
}

export const OneLinerVerdictsSchema = z.object({
  changes: z.array(z.object({
    ref: z.string().describe("the one-liner's label, like L4"),
    verdict: z.enum(["remove", "move"]),
    to: z.string().nullable().describe("for move: the thread label, like T2; otherwise null"),
    reason: z.string().describe("one short plain sentence the person can check"),
  })),
});

export type OneLinerProposal = {
  item: OneLiner;
  verdict: "remove" | "move";
  to?: { id: string; name: string };
  reason: string;
};

/** Only verdicts that name a real scrap, and for a move a real, different
    thread, survive. Anything else is dropped — never guessed at. */
export function readVerdicts(value: unknown, ctx: OneLinerContext): OneLinerProposal[] | null {
  const parsed = OneLinerVerdictsSchema.safeParse(value);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const out: OneLinerProposal[] = [];
  for (const c of parsed.data.changes) {
    const item = ctx.items[c.ref.replace(/[[\]\s]/g, "").toUpperCase()];
    if (!item || seen.has(item.key)) continue;
    const reason = c.reason.trim().slice(0, 240);
    if (c.verdict === "move") {
      const to = c.to ? ctx.threads[c.to.replace(/[[\]\s]/g, "").toUpperCase()] : undefined;
      if (!to || to.id === item.threadId) continue;
      out.push({ item, verdict: "move", to, reason });
    } else {
      out.push({ item, verdict: "remove", reason });
    }
    seen.add(item.key);
  }
  /* Repeats are removed down to one, never to none. Three copies of a note
     each "repeat" the others, and the model marked all three. */
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const groups = new Map<string, OneLiner[]>();
  for (const item of Object.values(ctx.items)) groups.set(words(item.text), [...(groups.get(words(item.text)) ?? []), item]);
  for (const copies of groups.values()) {
    const removed = copies.filter((copy) => out.some((p) => p.verdict === "remove" && p.item.key === copy.key));
    if (copies.length < 2 || removed.length < copies.length) continue;
    const oldest = copies.reduce((a, b) => (b.at < a.at ? b : a));
    out.splice(out.findIndex((p) => p.item.key === oldest.key), 1);
  }
  return out;
}

/** Apply the chosen proposals in one pass over the latest board. A scrap
    that has since changed or gone is skipped, not forced. */
export function applyOneLiners(
  board: Board,
  proposals: OneLinerProposal[],
  now: number,
  mkId: () => string,
): CleanupChange | null {
  let next = board;
  const imgs: string[] = [];
  const threads = new Set<string>();
  let removed = 0, moved = 0, letGo = 0;
  for (const p of proposals) {
    const { item } = p;
    if (item.kind === "action") {
      const a = next.actions.find((x) => x.id === item.id);
      if (!a || a.done || a.faded || a.text.trim() !== item.text) continue;
      if (p.verdict === "remove") {
        /* Let go, not destroyed: it sits in Faded for two weeks. */
        next = { ...next, actions: next.actions.map((x) => x.id === a.id ? { ...x, faded: true, fadedAt: now, updatedAt: now } : x) };
        removed++;
        letGo++;
      } else {
        const out = applyActionFold(next, a.id, p.to!.id, now, mkId);
        if (!out) continue;
        next = out.board;
        if (!out.already) threads.add(p.to!.id);
        moved++;
      }
      continue;
    }
    const home = next.threads.find((t) => t.frags.some((f) => f.id === item.id));
    const frag = home?.frags.find((f) => f.id === item.id);
    if (!home || !frag || frag.text.trim() !== item.text) continue;
    if (p.verdict === "remove") {
      const out = applyFragDelete(next, home.id, frag.id);
      if (!out) continue;
      next = out.board;
      imgs.push(...out.imgs);
      if (!out.removedThread) threads.add(home.id);
      removed++;
    } else {
      const out = applyFragMove(next, home.id, frag.id, p.to!.id, now);
      if (!out) continue;
      next = out.board;
      threads.add(p.to!.id);
      if (!out.emptied) threads.add(home.id);
      moved++;
    }
  }
  if (!removed && !moved) return null;
  const parts = [removed && `cleared ${removed}`, moved && `filed ${moved}`].filter(Boolean).join(", ");
  const live = new Set(next.threads.map((t) => t.id));
  return {
    board: next,
    imgs,
    threads: [...threads].filter((id) => live.has(id)),
    notice: `One-liners: ${parts}.${letGo ? " Let-go actions wait in Faded for two weeks." : ""}`,
  };
}
