import type { Suggestion } from "./boardOps";

/**
 * What the record says when a "this also belongs with X" suggestion is
 * accepted or waved off.
 *
 * These sentences are not display copy — they are the RULES the personal
 * model reads back when weighing its next proposal ("Drop duplicates of
 * X", "Keep actions out of X"). Two properties matter and are pinned by
 * test rather than by care:
 *
 *   - Accept and dismiss must be mirror images of the same proposal. If
 *     accepting teaches "Merge threads into X" but dismissing teaches
 *     something about a different subject, the model learns from a
 *     conversation that never happened.
 *   - The rule names the TARGET by name, because that is what the next
 *     proposal will be about; the source is described only by kind. A
 *     rule naming a source id would never match anything again.
 */

export type SuggestionRecord = {
  /** What happened, for the history row. */
  context: string;
  /** The reusable lesson, phrased for the personal model. */
  rule: string;
};

export function suggestionOutcome(
  s: Suggestion,
  accepted: boolean
): SuggestionRecord {
  const article = s.sourceKind === "action" ? "an action" : "a thread";
  if (s.kind === "duplicate") {
    return accepted
      ? {
          context: `dropped a duplicate of ${s.targetName}`,
          rule: `Drop duplicates of "${s.targetName}"`,
        }
      : {
          context: `kept the duplicate of ${s.targetName}`,
          rule: `Don't treat "${s.targetName}" as a duplicate`,
        };
  }
  if (!accepted) {
    return {
      context: `kept ${article} out of ${s.targetName}`,
      rule: `Keep ${s.sourceKind}s out of "${s.targetName}"`,
    };
  }
  return s.verb === "Merge"
    ? {
        context: `merged ${article} into ${s.targetName}`,
        rule: `Merge ${s.sourceKind}s into "${s.targetName}"`,
      }
    : {
        context: `moved ${article} into ${s.targetName}`,
        rule: `Move ${s.sourceKind}s into "${s.targetName}"`,
      };
}
