import { z } from "zod";
import type { Board } from "./model";

export const RECALL_MAX_SOURCES = 12;
export const RECALL_MAX_SOURCE_CHARS = 1500;

const nonblank = (max: number, min = 1) => z.string().min(min).max(max).refine((s) => /\S/u.test(s));
const SourceIdSchema = nonblank(400);
const MAX_DATE_MS = 8_640_000_000_000_000;
const TimestampSchema = z.number().finite().min(-MAX_DATE_MS).max(MAX_DATE_MS);
export const RecallSourceSchema = z.object({
  id: SourceIdSchema,
  kind: z.enum(["thread", "action", "intention"]),
  title: z.string().max(160),
  text: nonblank(RECALL_MAX_SOURCE_CHARS),
  at: TimestampSchema,
  targetId: SourceIdSchema,
  fragId: SourceIdSchema.optional(),
  state: z.enum(["active", "done", "faded", "resolved"]),
  truncated: z.boolean(),
}).strict();
export type RecallSource = z.infer<typeof RecallSourceSchema>;

const CitationSchema = z.object({ sourceId: SourceIdSchema, quote: nonblank(600, 8) }).strict();
const ClaimSchema = z.object({
  text: nonblank(700),
  citations: z.array(CitationSchema).min(1).max(4),
}).strict();
export const RecallAnswerSchema = z.object({
  status: z.enum(["answered", "insufficient"]),
  claims: z.array(ClaimSchema).max(5),
}).strict().refine((answer) => answer.status === "answered" ? answer.claims.length > 0 : answer.claims.length === 0,
  { message: "Answered requires cited claims; insufficient requires no claims." });
export type RecallAnswer = z.infer<typeof RecallAnswerSchema>;

/**
 * Structural citation validation, NOT semantic entailment: a verbatim quote can
 * still be irrelevant to its claim. The caller/model must assess meaning. Never
 * salvage a partially supported response by silently dropping claims/citations.
 * Sources are the caller's trusted local snapshot, not proof of board ownership.
 */
export function validateRecallAnswer(value: unknown, sources: RecallSource[]): RecallAnswer | null {
  const parsedSources = z.array(RecallSourceSchema).max(RECALL_MAX_SOURCES).safeParse(sources);
  const parsedAnswer = RecallAnswerSchema.safeParse(value);
  if (!parsedSources.success || !parsedAnswer.success) return null;
  const byId = new Map(parsedSources.data.map((source) => [source.id, source]));
  if (byId.size !== parsedSources.data.length) return null;
  for (const claim of parsedAnswer.data.claims) {
    for (const citation of claim.citations) {
      if (!byId.get(citation.sourceId)?.text.includes(citation.quote)) return null;
    }
  }
  return parsedAnswer.data;
}

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
  for (const thread of board.threads) {
    for (const frag of thread.frags) {
      add({ kind: "thread", title: thread.name, text: frag.text, at: frag.at,
        targetId: thread.id, fragId: frag.id,
        state: typeof frag.resolvedAt === "number" && Number.isFinite(frag.resolvedAt) ? "resolved" : "active" });
    }
  }
  for (const action of board.actions) {
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
