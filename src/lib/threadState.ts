/**
 * Where a thread stands — said plainly.
 *
 * A thread's summary used to be one paragraph of prose. On a small thread
 * that is right. On a real one it is not: after 86 notes the Capture thread's
 * summary was four sentences of mission statement, and the two decisions that
 * mattered most that month were nowhere in it. Prose blends what is decided,
 * what is still open and what keeps coming back into one voice, so none of
 * them can be found — by the person, by Ask, or by an agent handed the thread.
 *
 * So the summary keeps its short snapshot and then names those three things on
 * their own lines. It stays one string — every reader of `summary` keeps
 * working, and the snapshot comes first, so anything that clips it (the
 * sorter's brief, a card preview) still reads the overview.
 *
 *   <one to three sentences>
 *
 *   Decided:
 *   - …
 *   Still open:
 *   - …
 *   Keeps coming up:
 *   - …
 *
 * Models do not all write lists the same way, so the reader accepts
 * "Decided: a; b", bullets in any style and bold labels, and `normalizeState`
 * writes one shape back. A section with nothing in it is simply absent.
 */

export type ThreadState = {
  snapshot: string;
  decided: string[];
  open: string[];
  recurring: string[];
};

type Key = "decided" | "open" | "recurring";

const LABELS: [Key, string, RegExp][] = [
  ["decided", "Decided", /^decided$/i],
  ["open", "Still open", /^(still )?open( questions?)?$/i],
  ["recurring", "Keeps coming up", /^keeps coming up$/i],
];

/** Per section — enough to scan, never a second summary. */
const MAX_ITEMS = { decided: 5, open: 5, recurring: 3 } as const;
const MAX_ITEM_CHARS = 200;

const LABEL_LINE = /^[\s*_#>-]*([A-Za-z][A-Za-z ]{2,24}?)[\s*_]*:[\s*_]*(.*)$/;
const BULLET = /^\s*(?:[-*•–]|\d+[.)])\s+/;
const NONE = /^(none|nothing( yet)?|n\/a|-|—)\.?$/i;

function sectionOf(label: string): Key | null {
  const hit = LABELS.find(([, , re]) => re.test(label.trim()));
  return hit ? hit[0] : null;
}

const clean = (item: string) => {
  const t = item.replace(BULLET, "").replace(/^\*\*|\*\*$/g, "").trim();
  return t.length > MAX_ITEM_CHARS ? t.slice(0, MAX_ITEM_CHARS - 1).trimEnd() + "…" : t;
};

/** Read a summary, old prose or new labelled. Old prose is all snapshot. */
export function parseState(summary: string | undefined): ThreadState {
  const state: ThreadState = { snapshot: "", decided: [], open: [], recurring: [] };
  const prose: string[] = [];
  let current: Key | null = null;
  for (const line of (summary ?? "").split("\n")) {
    const label = LABEL_LINE.exec(line);
    const key = label ? sectionOf(label[1]) : null;
    if (key) {
      current = key;
      /* "Decided: annual at $96; free tier has no sync" — inline items. */
      for (const part of label![2].split(/\s*;\s*/)) {
        if (part.trim() && !NONE.test(part.trim())) state[key].push(clean(part));
      }
      continue;
    }
    if (current && BULLET.test(line)) {
      const item = clean(line);
      if (item && !NONE.test(item)) state[current].push(item);
      continue;
    }
    if (current && !line.trim()) continue;
    /* Prose after a section has ended belongs to the snapshot again. */
    current = null;
    prose.push(line);
  }
  state.snapshot = prose.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  for (const [key] of LABELS) {
    state[key] = [...new Set(state[key])].slice(0, MAX_ITEMS[key]);
  }
  return state;
}

/** The one shape every summary is stored in, whatever the model wrote. */
export function normalizeState(summary: string): string {
  const s = parseState(summary);
  const parts = [s.snapshot];
  for (const [key, label] of LABELS) {
    if (s[key].length) parts.push(`${label}:\n${s[key].map((item) => `- ${item}`).join("\n")}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

/** Just the overview — for a card preview, where lists would not fit. */
export const snapshotOf = (summary: string | undefined) => parseState(summary).snapshot;
