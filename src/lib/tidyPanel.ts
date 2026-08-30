import { scanStale, type OrganizeProposal } from "./organize";
import { mergeOrganize } from "./organizeAi";
import type { Board } from "./model";

/**
 * What the Tidy panel shows — assembled in exactly one place.
 *
 * Three sources feed the panel: the model's whole-board reading, the
 * judged word-matches, and the local staleness scan. The hook assembled
 * them inline at three call sites, each slightly differently — one forgot
 * to filter dismissals from the judged rows, another from the model's —
 * so whether a waved-away suggestion stayed away depended on WHICH path
 * repainted the panel. A dismissal is a promise: this row, never again,
 * whatever repaints.
 */
export function assemblePanel(opts: {
  board: Board;
  ai: OrganizeProposal[];
  judged: OrganizeProposal[];
  dismissed: string[];
  now?: number;
}): OrganizeProposal[] {
  const drop = new Set(opts.dismissed);
  const keep = (ps: OrganizeProposal[]) => ps.filter((p) => !drop.has(p.id));
  return mergeOrganize(
    [...keep(opts.ai), ...keep(opts.judged)],
    scanStale(opts.board, opts.dismissed, opts.now)
  );
}
