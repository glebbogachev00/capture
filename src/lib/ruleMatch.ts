import type { SortKind } from "./refiled";
import { contentWords } from "./related";

/**
 * A learned rule, applied in code.
 *
 * The rules the board learns are sentences — "Captures about "hallway
 * paint" are an action, not a thread" — and they went to the model as
 * "tendencies, not orders". Groq followed them; the Mistral fallback
 * ignored them four times out of four, which made "it learns" true on one
 * tier and false on the other. A rule the board wrote itself has a known
 * shape, so the server can read it back and apply it the way it applies a
 * slash command: when the capture contains every subject word of a rule,
 * the rule decides the kind (and the home, if it names one), and the
 * model's answer is corrected to match. The model still chooses everything
 * else — the wording, the shelf life, which thread when no home is named.
 */

export type ParsedRule = {
  subject: string[];
  kind?: SortKind;
  home?: string;
};

const KINDS: Record<string, SortKind> = {
  "an action": "action",
  "a thread": "thread",
  "an intention": "intention",
};

export function parseRule(text: string): ParsedRule | null {
  const m = /^captures about "([^"]+)" (?:are (an action|a thread|an intention)|belong in "([^"]+)")/i.exec(
    text.trim()
  );
  if (!m) return null;
  const subject = contentWords(m[1]);
  if (!subject.length) return null;
  if (m[2]) return { subject, kind: KINDS[m[2].toLowerCase()] };
  return { subject, kind: "thread", home: m[3] };
}

export type RuleDecision = {
  kind: SortKind;
  /** The id of the thread a refile rule names, when that thread exists. */
  threadId?: string;
  rule: string;
};

/**
 * The first rule whose every subject word is in the capture. Rules are
 * newest-first from the client, so a newer lesson outranks an older one.
 */
export function applyRules(
  raw: string,
  rules: string[] | undefined,
  threads: { id: string; name: string }[]
): RuleDecision | null {
  if (!rules?.length) return null;
  const words = new Set(contentWords(raw));
  if (!words.size) return null;
  for (const text of rules) {
    const r = parseRule(text);
    if (!r || !r.kind) continue;
    if (!r.subject.every((w) => words.has(w))) continue;
    const home = r.home
      ? threads.find((t) => t.name.trim().toLowerCase() === r.home!.trim().toLowerCase())
      : undefined;
    /* A refile rule whose thread is gone says nothing useful any more. */
    if (r.home && !home) continue;
    return { kind: r.kind, threadId: home?.id, rule: text };
  }
  return null;
}
