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

/** About 35k tokens of board: room for every note of a large board, and well
    inside the models in the chain. */
export const ASK_BUDGET = 130_000;
/** The most the Ask route accepts. The built context never exceeds it. */
export const ASK_MAX_CONTEXT = ASK_BUDGET + 20_000;
export const ASK_MAX_QUESTION = 600;
/** A note is shown whole up to this, and clipped no shorter than NOTE_MIN. */
const NOTE_CHARS = 1_200;
const NOTE_MIN = 200;
const SUMMARY_CHARS = 700;
const MAX_ACTIONS = 150;
const MAX_RECEIPTS = 40;

export type AskRef = {
  kind: "thread" | "action" | "intention";
  id: string;
  name: string;
};

/** A note the board holds, labelled [N#] for the model. Its text and time
    stay here: the model only names which notes support an answer. */
type AskNote = { fragId: string; threadId: string; threadName: string; at: number; text: string };

export type AskContext = {
  /** The board as the model reads it. */
  text: string;
  /** Label → the item it names. Stays on the device. */
  refs: Record<string, AskRef>;
  /** Note label → the saved note. Stays on the device. */
  notes: Record<string, AskNote>;
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

  /* Every note is shown when it fits, clipped only as much as it takes:
     answering from the newest notes alone said "not on your board" about
     pricing notes three weeks old. Past the shortest clip, the oldest go. */
  const fixedParts = [
    ...threads.map((t) => `${t.name} ${t.summary ?? ""} ${t.next ?? ""}`.slice(0, summaryChars + 200)),
    ...open.map((a) => a.text.slice(0, 340)),
    ...faded.map((a) => a.text.slice(0, 340)),
    ...intentionBlock,
    ...receipts.map((r) => r.text.slice(0, 200)),
  ];
  let room = ASK_MAX_CONTEXT - 2_000 - fixedParts.reduce((n, s) => n + s.length + 40, 0);
  const all = threads.flatMap((t) => sortedFrags(t).map((f) => ({ t, f })))
    .sort((a, b) => b.f.at - a.f.at);
  const notes: Record<string, AskNote> = {};
  const noteLabel = new Map<Frag, string>();
  all.forEach(({ t, f }, i) => {
    noteLabel.set(f, `N${i + 1}`);
    notes[`N${i + 1}`] = { fragId: f.id, threadId: t.id, threadName: t.name, at: f.at, text: f.text };
  });
  const costAt = (cap: number) => all.reduce((n, { f }) => n + Math.min(f.text.length, cap) + 24, 0);
  let noteChars = NOTE_CHARS;
  while (noteChars > NOTE_MIN && costAt(noteChars) > room) noteChars = Math.max(NOTE_MIN, Math.floor(noteChars * 0.85));
  const kept = new Set<Frag>();
  for (const { f } of all) {
    const cost = Math.min(f.text.length, noteChars) + 24;
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
  return { text, refs, notes, omitted: all.length - kept.size };

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
      out.push(`- [${noteLabel.get(f)}] ${day(f.at)}${resolved}${photo}: ${clip(f.text, noteChars).replace(/\n/g, "\n  ")}`);
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
  answer: z.string().describe("the formatted answer text, with no dates, note labels or quotations in it"),
  sources: z.array(z.object({
    note: z.string().describe("the label of a note that supports the answer, like N12"),
    quote: z.string().nullable().describe("a short phrase copied exactly from that note, or null"),
  })).describe("the notes the answer rests on, most important first; at most 4"),
  refs: z.array(z.string()).describe("labels like T3, A1 or I2 of other items the answer draws on; at most 4"),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

/** A cited note, as the app knows it: real text, real time, real thread. */
export type AskSource = {
  fragId: string;
  threadId: string;
  threadName: string;
  at: number;
  /** The model's quote when it appears in the saved note, word for word. */
  quote?: string;
  /** The model's wording when it does not: shown as a paraphrase. */
  paraphrase?: string;
  /** The note's own opening, shown when there is no quote. */
  excerpt: string;
};

export type AskResult = { found: boolean; answer: string; sources: AskSource[]; refs: AskRef[] };

const LABEL = /\s*[[(](?:(?:sources?|see|from|notes?)\s*:?\s*)?[TAFIN]\d+(?:\s*(?:[,;]|and)\s*[TAFIN]\d+)*[\])]/gi;

/** Same words, ignoring spacing, case and typographic quotes and dashes. */
const comparable = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2010-\u2015\u2212]/g, "-")
  .replace(/\s+/g, " ").trim();

/** Map the model's reply back onto the board. Unknown labels are dropped,
    never guessed at; labels written into the prose are lifted out of it.
    Dates and wording of a cited note come from the board, never the model. */
export function readAnswer(
  value: unknown,
  refs: Record<string, AskRef>,
  notes: Record<string, AskNote> = {},
): AskResult | null {
  /* A reply without sources is still an answer, just an uncited one. */
  const parsed = AskAnswerSchema.safeParse(
    value && typeof value === "object" && !("sources" in value) ? { ...value, sources: [] } : value,
  );
  if (!parsed.success) return null;
  const answer = parsed.data.answer.replace(LABEL, "").replace(/[ \t]+([.,;:!?])/g, "$1").trim();
  if (!answer) return null;
  const label = (raw: string) => raw.replace(/[[\]\s]/g, "").toUpperCase();
  const sources: AskSource[] = [];
  const allNotes = Object.values(notes);
  for (const cited of parsed.data.sources) {
    const quote = cited.quote?.trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "").trim();
    let note = notes[label(cited.note)];
    /* Right words, wrong label: the saved words decide which note it is. */
    if (quote && (!note || !comparable(note.text).includes(comparable(quote)))) {
      note = allNotes.find((n) => comparable(n.text).includes(comparable(quote))) ?? note;
    }
    if (!note || sources.some((s) => s.fragId === note.fragId)) continue;
    const exact = !!quote && comparable(note.text).includes(comparable(quote));
    sources.push({
      fragId: note.fragId, threadId: note.threadId, threadName: note.threadName, at: note.at,
      ...(quote ? (exact ? { quote } : { paraphrase: quote }) : {}),
      excerpt: note.text.replace(/\s+/g, " ").trim().slice(0, 160),
    });
    if (sources.length === 4) break;
  }
  const seen = new Set<string>();
  const out: AskRef[] = [];
  for (const raw of parsed.data.refs) {
    const ref = refs[label(raw)];
    if (!ref || seen.has(`${ref.kind}:${ref.id}`)) continue;
    if (ref.kind === "thread" && sources.some((s) => s.threadId === ref.id)) continue;
    seen.add(`${ref.kind}:${ref.id}`);
    out.push(ref);
    if (out.length === 4) break;
  }
  return { found: parsed.data.found, answer, sources, refs: out };
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
