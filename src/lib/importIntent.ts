import { type Board, type Intention, type Principle, uid } from "./model";

/**
 * Read a backup exported by the standalone intent app.
 *
 * intent stored dates as ISO strings and numbered its records; capture works
 * in epoch milliseconds. The conversion happens here so nothing downstream
 * has to know two date formats.
 *
 * The merge is non-destructive and matched on id: importing the same file
 * twice adds nothing the second time, and an intention already on the board
 * is never overwritten by an older copy of itself.
 */

type IntentRecord = {
  id?: string;
  number?: number;
  rawInput?: string;
  expandedIntention?: string;
  recommendedActions?: unknown;
  counterIntentions?: unknown;
  dateCreated?: string;
  dateUpdated?: string;
};

type IntentBackup = {
  app?: string;
  version?: number;
  principles?: Principle[];
  intentions?: IntentRecord[];
};

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** ISO string to epoch ms, falling back to now for anything unparseable. */
function toEpoch(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : fallback;
}

export type ImportResult = {
  board: Board;
  added: number;
  /** Already on the board, matched by id. Re-importing is safe. */
  duplicates: number;
  /** Missing an id or any wording, so there was nothing to bring across. */
  malformed: number;
  principlesAdded: number;
};

export function importIntentBackup(parsed: unknown, board: Board): ImportResult {
  const backup = parsed as IntentBackup;
  if (!backup || !Array.isArray(backup.intentions)) {
    throw new Error(
      "That doesn't look like an intent backup — expected a file with an \"intentions\" list."
    );
  }

  const now = Date.now();
  const existing = new Set(board.intentions.map((i) => i.id));
  let highest = board.intentions.reduce((m, i) => Math.max(m, i.number || 0), 0);

  const incoming: Intention[] = [];
  let duplicates = 0;
  let malformed = 0;

  for (const rec of backup.intentions) {
    if (!rec?.id || !rec.expandedIntention) {
      malformed++;
      continue;
    }
    if (existing.has(rec.id)) {
      duplicates++;
      continue;
    }
    const at = toEpoch(rec.dateCreated, now);
    // Renumber only when the record carries no number of its own, so the
    // numbering you already know stays the numbering you see.
    const number = rec.number && rec.number > 0 ? rec.number : ++highest;
    highest = Math.max(highest, number);

    incoming.push({
      id: rec.id,
      number,
      rawInput: rec.rawInput || rec.expandedIntention,
      expandedIntention: rec.expandedIntention,
      recommendedActions: asStrings(rec.recommendedActions),
      counterIntentions: asStrings(rec.counterIntentions),
      at,
      updatedAt: toEpoch(rec.dateUpdated, at),
    });
  }

  // Custom principles come across; the builtin ones are already here.
  const havePrinciples = new Set(board.principles.map((p) => p.name));
  const newPrinciples = (backup.principles || [])
    .filter((p) => p?.name && !havePrinciples.has(p.name))
    .map((p) => ({
      id: p.id || uid(),
      name: p.name,
      description: p.description || "",
      enabled: p.enabled !== false,
      builtin: false,
    }));

  return {
    board: {
      ...board,
      intentions: [...incoming, ...board.intentions].sort((a, b) => b.at - a.at),
      principles: [...board.principles, ...newPrinciples],
    },
    added: incoming.length,
    duplicates,
    malformed,
    principlesAdded: newPrinciples.length,
  };
}
