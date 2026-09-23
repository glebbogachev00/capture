import { z } from "zod";
import type { Board } from "./model";

export const RECALL_MAX_SOURCES = 12;
export const RECALL_MAX_SOURCE_CHARS = 1500;
export const RECALL_MAX_TOPICS = 64;
export const RECALL_MAX_SELECTED_TOPICS = 4;
export const RECALL_TOPIC_CONTEXT_BUDGET = 12_000;

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

export function recallRequestFingerprint(question: string, sources: RecallSource[]): string {
  return JSON.stringify([normalizeQuestion(question), sources]);
}

export function recallRetrievalFingerprint(
  question: string,
  sources: RecallSource[],
  topics: RecallTopic[]
): string {
  return JSON.stringify([normalizeQuestion(question), sources, topics]);
}

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

export const RecallTopicSchema = z.object({
  id: SourceIdSchema,
  name: nonblank(160),
  about: z.string().max(700),
  at: TimestampSchema,
}).strict();
export type RecallTopic = z.infer<typeof RecallTopicSchema>;

export const RecallSelectionSchema = z.object({
  threadIds: z.array(SourceIdSchema).max(RECALL_MAX_SELECTED_TOPICS),
}).strict();
export type RecallSelection = z.infer<typeof RecallSelectionSchema>;

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
    const extractive = claim.citations.map((citation) => citation.quote).join(" ");
    if (claim.text !== extractive) return null;
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

function meaningfulTerms(question: string, includeGeneric = false): string[] {
  return [...new Set(tokens(question).filter((term) => !STOP.has(term) && (includeGeneric || !GENERIC.has(term))))];
}

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
function selectRecallSources(board: Board, question: string): RecallSource[] {
  const terms = meaningfulTerms(question).sort();
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

/** Exact lexical evidence used by local retrieval and deterministic tests. */
export function recallSources(board: Board, question: string): RecallSource[] {
  return selectRecallSources(board, question);
}

/**
 * Bounded semantic routing context. These topic briefs can help a selector find
 * the right thread, but they are never quotable evidence. Every thread keeps
 * its name; the shared context budget shrinks evenly as the board grows. This
 * avoids replacing semantic retrieval with an unrelated "latest notes" dump.
 */
export function recallTopics(board: Board): RecallTopic[] {
  const counts = new Map<string, number>();
  for (const thread of board.threads) counts.set(thread.id, (counts.get(thread.id) ?? 0) + 1);
  const threads = board.threads
    .filter((thread) => counts.get(thread.id) === 1 && validId(thread.id) && thread.name.trim())
    .sort((a, b) => {
      const aAt = Math.max(a.updatedAt ?? 0, ...a.frags.filter((frag) => !frag.unsorted).map((frag) => frag.at));
      const bAt = Math.max(b.updatedAt ?? 0, ...b.frags.filter((frag) => !frag.unsorted).map((frag) => frag.at));
      return bAt - aAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })
    .slice(0, RECALL_MAX_TOPICS);
  const perThread = Math.min(700, Math.max(0, Math.floor(RECALL_TOPIC_CONTEXT_BUDGET / Math.max(1, threads.length))));
  return threads.flatMap((thread) => {
    const settled = thread.frags.filter((frag) => !frag.unsorted && frag.text.trim());
    // Selector metadata only. Original fragment text is disclosed only after
    // this topic is selected and can then be cited by the answer route.
    const context = [thread.belongs?.trim(), thread.summary?.trim()].filter(Boolean).join("\n\n");
    const at = Math.max(thread.updatedAt ?? 0, ...settled.map((frag) => frag.at));
    const topic = { id: thread.id, name: thread.name.trim().slice(0, 160), about: context.slice(0, perThread), at };
    return RecallTopicSchema.safeParse(topic).success ? [topic] : [];
  });
}

/** Accept only unique IDs from the exact topic snapshot supplied by the client. */
export function validateRecallSelection(value: unknown, topics: RecallTopic[]): RecallSelection | null {
  const parsedTopics = z.array(RecallTopicSchema).max(RECALL_MAX_TOPICS).safeParse(topics);
  const parsed = RecallSelectionSchema.safeParse(value);
  if (!parsedTopics.success || !parsed.success) return null;
  const available = new Set(parsedTopics.data.map((topic) => topic.id));
  if (available.size !== parsedTopics.data.length || new Set(parsed.data.threadIds).size !== parsed.data.threadIds.length) return null;
  return parsed.data.threadIds.every((id) => available.has(id)) ? parsed.data : null;
}

/**
 * Original, settled evidence from semantically selected threads. Selection
 * context is not evidence: the answer route receives only these originals.
 * Round-robin allocation prevents one large thread from crowding every other
 * selected topic out of the twelve-source citation boundary.
 */
export function recallSourcesForThreads(board: Board, threadIds: string[], question: string): RecallSource[] {
  const selected = [...new Set(threadIds)].slice(0, RECALL_MAX_SELECTED_TOPICS);
  const wanted = new Set(selected);
  const terms = meaningfulTerms(question, true);
  const buckets = new Map<string, RecallSource[]>();
  for (const thread of board.threads) {
    if (!wanted.has(thread.id)) continue;
    const identities = new Map<string, number>();
    const sources = thread.frags.flatMap((frag) => {
      if (frag.unsorted || !validId(thread.id) || !validId(frag.id) || !TimestampSchema.safeParse(frag.at).success) return [];
      const id = JSON.stringify(["thread", thread.id, frag.id]);
      identities.set(id, (identities.get(id) ?? 0) + 1);
      const clipped = excerpt(frag.text, terms);
      if (!validId(id) || !clipped.text) return [];
      return [{
        id,
        kind: "thread" as const,
        title: thread.name.trim().slice(0, 160),
        text: clipped.text,
        at: frag.at,
        targetId: thread.id,
        fragId: frag.id,
        state: typeof frag.resolvedAt === "number" && Number.isFinite(frag.resolvedAt) ? "resolved" as const : "active" as const,
        truncated: clipped.truncated,
      }];
    }).filter((source) => identities.get(source.id) === 1);
    sources.sort((a, b) => {
      const aWords = new Set(tokens(a.text));
      const bWords = new Set(tokens(b.text));
      const aMatches = terms.filter((term) => aWords.has(term)).length;
      const bMatches = terms.filter((term) => bWords.has(term)).length;
      return bMatches - aMatches || b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    buckets.set(thread.id, sources);
  }
  const result: RecallSource[] = [];
  for (let index = 0; result.length < RECALL_MAX_SOURCES; index++) {
    let added = false;
    for (const id of selected) {
      const source = buckets.get(id)?.[index];
      if (!source) continue;
      result.push(source);
      added = true;
      if (result.length === RECALL_MAX_SOURCES) break;
    }
    if (!added) break;
  }
  return result;
}
