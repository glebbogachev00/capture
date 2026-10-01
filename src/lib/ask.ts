import { z } from "zod";
import type { Board, Frag, Thread } from "./model";

/**
 * Ask — answer a question from what is on the board.
 *
 * The model reads the board itself, not a word-matched shortlist of it. A
 * question is usually worded differently from the note that answers it
 * ("what did I land on for pricing?" against "going annual, $8"), so any
 * step that picks notes by shared words throws the answer away before the
 * model ever sees it. So the whole board goes in, rendered once as plain
 * labelled text, and the model decides what is relevant.
 *
 * A board bigger than the budget keeps everything that is small and dense —
 * every thread's name and "Where this stands", every open action, every
 * intention, the recent receipts — and spends what is left on notes, newest
 * first. The summaries already carry the older history, so a large board
 * loses detail, never whole subjects. The prompt says when notes were left
 * out, so a missing detail is reported as missing rather than denied.
 *
 * Labels ([T3], [A1], [I2]) are short and opaque so the answer can point at
 * items without the board's ids ever leaving the device; they are mapped
 * back here, and a label the board did not hand out is simply dropped.
 */

/** About 12k tokens of board: comfortably inside every model in the chain. */
export const ASK_BUDGET = 48_000;
/** The most the Ask route accepts. The built context never exceeds it. */
export const ASK_MAX_CONTEXT = ASK_BUDGET + 12_000;
export const ASK_MAX_QUESTION = 600;
const NOTE_CHARS = 1_200;
const SUMMARY_CHARS = 700;
const MAX_ACTIONS = 150;
const MAX_RECEIPTS = 40;

export type AskRef = {
  kind: "thread" | "action" | "intention";
  id: string;
  name: string;
};

export type AskContext = {
  /** The board as the model reads it. */
  text: string;
  /** Label → the item it names. Stays on the device. */
  refs: Record<string, AskRef>;
  /** Notes left out to fit the budget. Zero means the model saw everything. */
  omitted: number;
};

const clip = (text: string, max: number) => {
  const t = text.trim().replace(/\n{3,}/g, "\n\n");
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
};
const oneLine = (text: string, max: number) => clip(text.replace(/\s+/g, " "), max);
const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar date — the day the person lived it, not UTC's. */
export const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Unsorted material has not been classified and never leaves the device as
    model context; a thread holding nothing else is not yet a subject. */
const sortedFrags = (t: Thread): Frag[] => t.frags.filter((f) => !f.unsorted && f.text.trim());
const lastAt = (t: Thread) => Math.max(0, ...sortedFrags(t).map((f) => f.at));

export function askContext(board: Board, now: number): AskContext {
  const refs: Record<string, AskRef> = {};
  const threads = board.threads
    .filter((t) => sortedFrags(t).length)
    .sort((a, b) => lastAt(b) - lastAt(a));
  const label = new Map<string, string>();
  threads.forEach((t, i) => {
    label.set(t.id, `T${i + 1}`);
    refs[`T${i + 1}`] = { kind: "thread", id: t.id, name: t.name };
  });

  const actions = board.actions.filter((a) => !a.unsorted && !a.done && a.text.trim());
  const open = actions.filter((a) => !a.faded).sort((a, b) => b.at - a.at).slice(0, MAX_ACTIONS);
  const faded = actions.filter((a) => a.faded).sort((a, b) => b.at - a.at).slice(0, 30);
  const actionLine = (a: (typeof actions)[number], i: number, prefix: string) => {
    const ref = `${prefix}${i + 1}`;
    refs[ref] = { kind: "action", id: a.id, name: a.text };
    const due = typeof a.due === "number" ? ` · due ${day(a.due)}` : "";
    const home = a.threadId && label.has(a.threadId) ? ` · from [${label.get(a.threadId)}]` : "";
    return `- [${ref}] ${oneLine(a.text, 300)}${due} · added ${day(a.at)}${home}`;
  };

  /* Summaries and intentions get a share of the budget, split across however
     many there are, so notes always keep room: 40 full summaries and 52
     intentions once filled it alone. */
  const share = (part: number, count: number, floor: number, ceil: number) =>
    Math.max(floor, Math.min(ceil, Math.floor((ASK_BUDGET * part) / Math.max(1, count))));
  const summaryChars = share(0.35, threads.length, 200, SUMMARY_CHARS);
  const intentions = [...board.intentions].sort((a, b) => a.number - b.number);
  const intentionChars = share(0.15, intentions.length, 120, 300);
  const intentionBlock = intentions.map((it, i) => {
    const ref = `I${i + 1}`;
    refs[ref] = { kind: "intention", id: it.id, name: oneLine(it.expandedIntention || it.rawInput, 80) };
    /* One line each: with dozens of intentions, their action lists alone
       filled the budget and pushed every note out. */
    return `- [${ref}] ${oneLine(it.expandedIntention || it.rawInput, intentionChars)} (declared ${day(it.at)})`;
  });

  const receipts = [...(board.completions ?? [])].sort((a, b) => b.at - a.at).slice(0, MAX_RECEIPTS);

  /* Notes compete for what is left, newest first across the whole board. */
  const fixedParts = [
    ...threads.map((t) => `${t.name} ${t.summary ?? ""} ${t.next ?? ""}`.slice(0, summaryChars + 200)),
    ...open.map((a) => a.text.slice(0, 340)),
    ...faded.map((a) => a.text.slice(0, 340)),
    ...intentionBlock,
    ...receipts.map((r) => r.text.slice(0, 200)),
  ];
  let room = ASK_BUDGET - fixedParts.reduce((n, s) => n + s.length + 40, 0);
  const all = threads.flatMap((t) => sortedFrags(t).map((f) => ({ t, f })))
    .sort((a, b) => b.f.at - a.f.at);
  const kept = new Set<Frag>();
  for (const { f } of all) {
    const cost = Math.min(f.text.length, NOTE_CHARS) + 24;
    if (cost > room) break;
    room -= cost;
    kept.add(f);
  }
  /* The estimate above leaves out headers and labels, so check the real text
     and drop the oldest notes until it fits what the route accepts. */
  let text = render(kept);
  const byAge = all.map(({ f }) => f).filter((f) => kept.has(f)).reverse();
  while (text.length > ASK_MAX_CONTEXT && byAge.length) {
    for (const f of byAge.splice(0, Math.max(1, Math.ceil(byAge.length / 10)))) kept.delete(f);
    text = render(kept);
  }
  if (text.length > ASK_MAX_CONTEXT) text = text.slice(0, ASK_MAX_CONTEXT - 1) + "…";
  return { text, refs, omitted: all.length - kept.size };

  function render(kept: Set<Frag>): string {
  const omitted = all.length - kept.size;
  const out: string[] = [];
  const today = new Date(now);
  out.push(`Today is ${WEEKDAY[today.getDay()]} ${day(now)}.`);
  if (omitted) {
    out.push(`This board is large: the ${omitted} oldest notes are not shown below. Each thread's "Where this stands" still covers its whole history.`);
  }

  out.push(`\n## Threads (${threads.length}) — running notes, oldest note first`);
  for (const t of threads) {
    const frags = sortedFrags(t);
    const shown = frags.filter((f) => kept.has(f)).sort((a, b) => a.at - b.at);
    out.push(`\n### [${label.get(t.id)}] ${oneLine(t.name, 120)} · ${frags.length} ${frags.length === 1 ? "note" : "notes"} · last ${day(lastAt(t))}`);
    if (t.summary?.trim()) out.push(`Where this stands: ${clip(t.summary, summaryChars)}`);
    if (t.next?.trim()) out.push(`Next step: ${oneLine(t.next, 200)}`);
    if (frags.length > shown.length) out.push(`(${frags.length - shown.length} older notes not shown)`);
    for (const f of shown) {
      const resolved = typeof f.resolvedAt === "number" ? ` [resolved ${day(f.resolvedAt)}]` : "";
      const photo = f.imgs?.length ? ` [${f.imgs.length === 1 ? "photo" : `${f.imgs.length} photos`}]` : "";
      out.push(`- ${day(f.at)}${resolved}${photo}: ${clip(f.text, NOTE_CHARS).replace(/\n/g, "\n  ")}`);
    }
  }

  out.push(`\n## Open actions (${open.length}) — things still to do`);
  out.push(open.length ? open.map((a, i) => actionLine(a, i, "A")).join("\n") : "(none)");
  if (faded.length) {
    out.push(`\n## Let go (${faded.length}) — actions that faded without being done`);
    out.push(faded.map((a, i) => actionLine(a, i, "F")).join("\n"));
  }
  out.push(`\n## Done — actions ticked off, newest first`);
  out.push(receipts.length ? receipts.map((r) => `- ${day(r.at)}: ${oneLine(r.text, 200)}`).join("\n") : "(none recorded)");
  out.push(`\n## Intentions (${intentions.length}) — states declared as already true`);
  out.push(intentionBlock.length ? intentionBlock.join("\n") : "(none)");
  return out.join("\n");
  }
}

/* ------------------------------ the answer ------------------------------ */

export const AskAnswerSchema = z.object({
  found: z.boolean().describe("false when the board does not hold what the question asks about"),
  answer: z.string().describe("the formatted answer text"),
  refs: z.array(z.string()).describe("labels like T3, A1 or I2 of the items the answer is drawn from, most important first; at most 6"),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

export type AskResult = { found: boolean; answer: string; refs: AskRef[] };

const LABEL = /\s*\[(?:[TAFI]\d+)(?:\s*[,;]\s*[TAFI]\d+)*\]/g;

/** Map the model's reply back onto the board. Unknown labels are dropped,
    never guessed at; labels written into the prose are lifted out of it. */
export function readAnswer(value: unknown, refs: Record<string, AskRef>): AskResult | null {
  const parsed = AskAnswerSchema.safeParse(value);
  if (!parsed.success) return null;
  const answer = parsed.data.answer.replace(LABEL, "").replace(/[ \t]+([.,;:!?])/g, "$1").trim();
  if (!answer) return null;
  const seen = new Set<string>();
  const out: AskRef[] = [];
  for (const raw of parsed.data.refs) {
    const ref = refs[raw.replace(/[[\]\s]/g, "").toUpperCase()];
    if (!ref || seen.has(`${ref.kind}:${ref.id}`)) continue;
    seen.add(`${ref.kind}:${ref.id}`);
    out.push(ref);
    if (out.length === 6) break;
  }
  return { found: parsed.data.found, answer, refs: out };
}

/* ------------------------- rendering the answer ------------------------- */

export type Span = { text: string; bold: boolean };
export type Block =
  | { type: "p"; spans: Span[] }
  | { type: "ul" | "ol"; items: Span[][] };

/** **bold** is the only inline mark the answer may use. */
export function spans(line: string): Span[] {
  const out: Span[] = [];
  line.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (!part) return;
    const bold = /^\*\*[^*]+\*\*$/.test(part);
    out.push({ text: bold ? part.slice(2, -2) : part, bold });
  });
  return out;
}

/** The small, fixed shape the prompt asks for — paragraphs and lists — read
    back without an HTML step, so nothing in an answer can become markup. */
export function answerBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", spans: spans(para.join(" ")) });
    para = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^#{1,6}\s+/, "");
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const item = bullet?.[1] ?? numbered?.[1];
    if (item !== undefined) {
      flush();
      const type = bullet ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      if (last && last.type === type) last.items.push(spans(item));
      else blocks.push({ type, items: [spans(item)] });
    } else if (!line) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}
