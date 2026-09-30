/* eslint-disable */
/**
 * The word-matched Recall retrieval that Ask replaced, copied verbatim from
 * src/lib/recall.ts at e76fc47 (only its imports and exports trimmed), so the
 * help eval can measure what the old path could have shown the model. Not
 * used by the app.
 */
import { z } from "zod";
import type { Board } from "@/lib/model";
import { semanticThreads } from "@/lib/threadBrief";

export const RECALL_MAX_SOURCES = 12;
export const RECALL_MAX_SOURCE_CHARS = 1500;

const QUESTION_END = /[?？؟;]$/u;
const OUTER_QUOTED = /^(?:"[\s\S]*"|'[\s\S]*'|“[\s\S]*”|‘[\s\S]*’|«[\s\S]*»|「[\s\S]*」|『[\s\S]*』)$/u;
const FILE_NAME = /(?:^|[/\\])?[^/\\\s]+\.[\p{L}\p{N}]{1,10}[?？؟;]?$/iu;
const ENGLISH_AUX = new Set("do does did is are was were can could will would should have has had".split(" "));
const ENGLISH_WH = new Set("what when where why who whom whose which".split(" "));
const ENGLISH_SUBJECT = new Set((
  "i me we us you he she it they there this that these those the a an my mine our ours your yours his her hers its their theirs"
).split(" "));
const CJK_QUESTION_LEAD = /^(?:什么|为什么|何时|什么时候|哪里|哪儿|谁|怎么|如何|是否|有没有|いつ|なぜ|どこ|誰|どう|何)/u;
const QUESTION_WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’_-]*/gu;

const normalizeQuestion = (question: string): string => question.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();

/** A question mark is an explicit Ask signal; grammar covers unpunctuated questions. */
export function isLikelyRecallQuestion(query: string): boolean {
  // Inspect punctuation before normalization so a Greek question mark remains
  // distinguishable from an ordinary semicolon, which must stay local-only.
  const trimmed = query.trim();
  if (trimmed.length < 3 || trimmed.length > 500 || OUTER_QUOTED.test(trimmed) || FILE_NAME.test(trimmed)) return false;
  const punctuated = QUESTION_END.test(trimmed);
  const body = trimmed.replace(/^¿\s*/u, "").replace(/[?？؟;]\s*$/u, "").trim().normalize("NFC");
  if (punctuated && CJK_QUESTION_LEAD.test(body) && body.length >= 4) return true;
  const words = (body.match(QUESTION_WORD) ?? []).map((word) => word.toLowerCase());
  if (words.length < 3) return false;
  if (punctuated) return true;

  const first = words[0];
  const second = words[1];
  if (ENGLISH_WH.has(first) && ENGLISH_AUX.has(second)) {
    return words.length >= (first === "who" || first === "whom" ? 3 : 4);
  }
  if (first === "how") {
    if (ENGLISH_AUX.has(second)) return words.length >= 4;
    if (["much", "many", "long", "often", "far", "old", "soon", "well"].includes(second)) return words.length >= 4;
  }
  if (ENGLISH_AUX.has(first)) return words.length >= 3 && ENGLISH_SUBJECT.has(second);
  return false;
}

const MAX_DATE_MS = 8_640_000_000_000_000;
const TimestampSchema = z.number().finite().min(-MAX_DATE_MS).max(MAX_DATE_MS);
export type RecallSource = { id: string; kind: "thread" | "action" | "intention"; title: string; text: string; at: number; targetId: string; fragId?: string; state: "active" | "done" | "faded" | "resolved"; truncated: boolean };

// Recall is lexical retrieval, not semantic search. Grammatical/query scaffolding
// cannot turn a broad question into permission to send the whole board.
const STOP = new Set((
  "a an the and or but if of to in on for by at with from as is are was were be been being " +
  "i me my mine we us our you your he she it its they them their this that these those " +
  "what which who whom whose when where why how do does did have has had can could " +
  "will would shall should may might must about into over under after before not no " +
  "s t ve re ll d m say said says tell told show find get give remember recall decide decided " +
  "think thinking thought thoughts write wrote written note notes noted saved saving " +
  "all any anything everything something some every much many more most just please " +
  "summarize summary summaries important recent recently latest lately doing work working focus"
).split(" "));
const GENERIC = new Set("capture captures captured capturing app apps thread threads fragment fragments action actions intention intentions board".split(" "));
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
const normalize = (text: string): string => text.normalize("NFC").toLowerCase();
const tokens = (text: string): string[] => (text.match(WORD) ?? []).map(normalize);
const validId = (id: string): boolean => !!id.trim() && id.length <= 400;

/** One contiguous verbatim excerpt; never concatenate separated evidence. */
function excerpt(raw: string, terms: string[]): { text: string; truncated: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length <= RECALL_MAX_SOURCE_CHARS) return { text: trimmed, truncated: false };
  const match = Array.from(trimmed.matchAll(WORD)).find((m) => terms.includes(normalize(m[0])));
  const start = Math.min(Math.max(0, (match?.index ?? 0) - 250), trimmed.length - RECALL_MAX_SOURCE_CHARS);
  return { text: trimmed.slice(start, start + RECALL_MAX_SOURCE_CHARS).trim(), truncated: true };
}

/**
 * Original fragment/action/raw-intention text is the only quotable evidence. A
 * specific thread title can locate a contextual original but ranks below direct
 * text matches; a generic Capture-only query yields nothing. Titles/summary are
 * never factual evidence. All states remain eligible; recency breaks ties, not
 * contradictions. This bounded lexical selection is not a complete history.
 */
export function recallSources(board: Board, question: string): RecallSource[] {
  const terms = [...new Set(tokens(question).filter((term) => !STOP.has(term) && !GENERIC.has(term)))].sort();
  if (!terms.length) return [];
  const sources: RecallSource[] = [];
  const identities = new Map<string, number>();
  const add = (source: Omit<RecallSource, "id" | "truncated">) => {
    // Tuple encoding is reversible/collision-free, including delimiters in IDs.
    // Never clip identifiers: omit a pathological identity that exceeds bounds.
    const id = JSON.stringify([source.kind, source.targetId, ...(source.fragId === undefined ? [] : [source.fragId])]);
    identities.set(id, (identities.get(id) ?? 0) + 1);
    if (!validId(id) || !validId(source.targetId) ||
      (source.fragId !== undefined && !validId(source.fragId)) || !TimestampSchema.safeParse(source.at).success) return;
    const clipped = excerpt(source.text, terms);
    if (!clipped.text) return;
    sources.push({ ...source, id, title: source.title.trim().slice(0, 160), ...clipped });
  };
  for (const thread of semanticThreads(board.threads)) {
    for (const frag of thread.frags) {
      if (frag.unsorted) continue;
      add({ kind: "thread", title: thread.name, text: frag.text, at: frag.at,
        targetId: thread.id, fragId: frag.id,
        state: typeof frag.resolvedAt === "number" && Number.isFinite(frag.resolvedAt) ? "resolved" : "active" });
    }
  }
  for (const action of board.actions) {
    if (action.unsorted) continue;
    add({ kind: "action", title: action.text, text: action.text, at: action.at, targetId: action.id,
      state: action.done ? "done" : action.faded ? "faded" : "active" });
  }
  for (const intention of board.intentions) {
    add({ kind: "intention", title: intention.rawInput, text: intention.rawInput,
      at: intention.at, targetId: intention.id, state: "active" });
  }
  // Even an unmatched duplicate makes navigation/citation identity ambiguous.
  const candidates = sources.filter((source) => identities.get(source.id) === 1).map((source) => {
    const words = new Set(tokens(source.text));
    const context = new Set(source.kind === "thread" ? tokens(source.title) : []);
    return { source, evidenceMatches: terms.filter((term) => words.has(term)).length,
      matched: terms.filter((term) => words.has(term) || context.has(term)) };
  }).filter(({ matched }) => matched.length > 0);
  const frequencies = new Map<string, number>();
  for (const { matched } of candidates) {
    for (const term of matched) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  const ranked = candidates.map((candidate) => ({
    ...candidate,
    specificity: candidate.matched.reduce((sum, term) => sum + 1 / frequencies.get(term)!, 0),
  }));
  return ranked.sort((a, b) =>
    b.evidenceMatches - a.evidenceMatches || b.matched.length - a.matched.length || b.specificity - a.specificity ||
    b.source.at - a.source.at || (a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0)
  ).slice(0, RECALL_MAX_SOURCES).map(({ source }) => source);
}
