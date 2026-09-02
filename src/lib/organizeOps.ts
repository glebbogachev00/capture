import type { CorrectionEntry, ProposalKind } from "./ledger";
import type { OrganizeProposal } from "./organize";

/**
 * What an approved tidy change teaches the sorter.
 *
 * Every accepted proposal that says something about FILING writes one of
 * these, so the personal model learns where this person actually wants
 * things to go. The wording matters — `rule` is injected back into later
 * prompts as a tendency, so it has to read as an instruction about a
 * destination, not as a description of one event.
 *
 * Three kinds deliberately teach nothing and return null:
 *
 *   looks_done          resolving a note says nothing about how captures
 *                       are filed.
 *   let_go              letting a stale task fade is about time, not
 *                       destination — feeding it back would teach the
 *                       sorter a lesson that was never about sorting.
 *   revisit_intention   standing by a declared state is not a filing
 *                       decision at all.
 *
 * Kept out of the hook because it is policy: what the app concludes about
 * you from a tap. That belongs somewhere it can be read in one screen and
 * tested without React.
 */

type Note = Omit<CorrectionEntry, "id" | "at">;

const suggestion = (context: string, rule?: string): Note => ({
  proposalKind: "related_suggestion" as ProposalKind,
  accepted: true,
  context,
  ...(rule ? { rule } : {}),
});

export function organizeCorrection(p: OrganizeProposal): Note | null {
  const to = p.targetName;
  switch (p.kind) {
    case "dup_action":
    case "dup_fragment":
      return suggestion(`dropped a duplicate of ${to}`, `Drop duplicates of "${to}"`);
    case "fold_action":
      return suggestion(`moved an action into ${to}`, `Move actions into "${to}"`);
    case "move_fragment":
      return suggestion(`moved a note into ${to}`, `Move notes into "${to}"`);
    case "merge_fragments":
      return suggestion(`merged a note into ${to}`, `Move notes into "${to}"`);
    /* No rule: a split says the note did not belong where it was, and
       names no destination to generalise to. */
    case "split_fragment":
      return suggestion(`split a note out of ${to}`);
    default:
      return null;
  }
}
