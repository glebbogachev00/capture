/**
 * organizeAi — the model's pass over the board.
 *
 * Where scanBoard (organize.ts) asks "what shares words?", the model asks
 * "what is the same thing, or clearly misplaced?" It reads a compact snapshot
 * of the whole board and returns the changes a person would immediately agree
 * improve it — the same idea living twice in different words (merge_fragments),
 * a note that is really a task (extract_action), a real duplicate, a misplaced
 * note, an action that belongs with a thread.
 *
 * The product rule is enforced here as well as in the prompt: no whole-thread
 * merges, and a proposal that is not a clear improvement must not survive.
 * Everything the model says is treated as a suggestion — ids are validated
 * against the snapshot (a hallucinated id is dropped, never trusted), pairs
 * are deduped, and the result is mapped into the exact OrganizeProposal shape
 * the deterministic scan produces, so one review screen serves both passes.
 */

import type { Board } from "./model";
import {
  HIGH_CAP,
  MEDIUM_CAP,
  NAME,
  actionsHoldNote,
  threadHoldsNote,
  type OrganizeConfidence,
  type OrganizeKind,
  type OrganizeProposal,
} from "./organize";

/** The compact board the model reads. Ids are the real board ids, so a
    proposal can be applied through the normal handlers. `at` travels with
    actions and fragments so a duplicate can always name the NEWER copy as
    the source — the original, with its notes and images, is never at risk
    and the two passes propose the same direction (so a pair is deduped). */
export type TidySnapshot = {
  actions: { id: string; text: string; at: number; src?: string }[];
  threads: {
    id: string;
    name: string;
    summary?: string;
    frags: { id: string; text: string; at: number }[];
  }[];
  intentions: { id: string; expanded: string }[];
};

/** Snapshot caps — a huge board must not bloat one prompt. */
export const SNAPSHOT_CAPS = {
  actions: 60,
  threads: 40,
  fragsPerThread: 12,
  intentions: 15,
} as const;


/** A plain-text cap so one fragment can't dominate the prompt. */
const CLIP = (s: string, n: number) =>
  s.length > n ? s.slice(0, n) + "…" : s;

/** The board reduced to what the model needs to judge clutter. */
export function compactBoard(board: Board): TidySnapshot {
  return {
    actions: board.actions
      .slice(0, SNAPSHOT_CAPS.actions)
      .map((a) => ({
        id: a.id,
        text: CLIP(a.text, 200),
        at: a.at || 0,
        /* src is the original note an extracted action came from — the
           fold-back guard needs it to see the thread already holds the
           note even when the model's rewrite differs. */
        src: a.src ? CLIP(a.src, 240) : undefined,
      })),
    threads: board.threads
      .slice(0, SNAPSHOT_CAPS.threads)
      .map((t) => ({
        id: t.id,
        name: CLIP(t.name, 80),
        summary: t.summary ? CLIP(t.summary, 160) : undefined,
        frags: t.frags
          .slice(0, SNAPSHOT_CAPS.fragsPerThread)
          .map((f) => ({ id: f.id, text: CLIP(f.text, 240), at: f.at || 0 })),
      })),
    intentions: board.intentions
      .slice(0, SNAPSHOT_CAPS.intentions)
      .map((i) => ({
        id: i.id,
        expanded: CLIP(i.expandedIntention || i.rawInput, 160),
      })),
  };
}

/** The snapshot rendered compactly, ids inline so the model can reference
    them exactly. */
export function renderBoardForPrompt(s: TidySnapshot): string {
  const lines: string[] = [];
  if (s.actions.length) {
    lines.push("Actions:");
    for (const a of s.actions) lines.push(`- [${a.id}] ${a.text}`);
  }
  if (s.threads.length) {
    lines.push("Threads:");
    for (const t of s.threads) {
      lines.push(`- [${t.id}] "${t.name}"${t.summary ? ` — ${t.summary}` : ""}`);
      for (const f of t.frags) lines.push(`    - [${f.id}] ${f.text}`);
    }
  }
  if (s.intentions.length) {
    lines.push("Intentions:");
    for (const i of s.intentions) lines.push(`- [${i.id}] ${i.expanded}`);
  }
  return lines.join("\n");
}

/** What the model returns, before validation. */
export type RawAiProposal = {
  kind: OrganizeKind;
  confidence: OrganizeConfidence;
  /** For fragment kinds: the id of the THREAD holding the fragment. */
  sourceId: string;
  /** Required for fragment kinds. */
  sourceFragId?: string;
  targetId: string;
  reason: string;
};

const VERBS: Record<OrganizeKind, string> = {
  dup_action: "Drop duplicate",
  dup_fragment: "Drop duplicate",
  fold_action: "Fold in",
  move_fragment: "Move",
  extract_action: "Extract",
  merge_fragments: "Merge",
  /* Deterministic only — the model is never asked about it, and the
     route's kind whitelist drops it if a model ever invents one. Get Light
     is free by design; routing it through the AI pass would put a quota
     cost on the one claim that needs none. */
  let_go: "Let go",
  revisit_intention: "Still true",
};

/** Fragment kinds — proposals that name a specific note inside a thread. */
const FRAGMENT_KINDS = new Set<OrganizeKind>([
  "dup_fragment",
  "move_fragment",
  "extract_action",
  "merge_fragments",
]);

/**
 * Turn the model's raw proposals into board proposals.
 *
 * Two layers of safety between the model and the board:
 *   - every id is validated against the snapshot — an id the model invented
 *     (it does invent them) is dropped, never mapped;
 *   - each accepted proposal becomes a deterministic `ai:` id, so a dismissal
 *     sticks across re-runs exactly like the local scan's ids.
 * Proposals are capped like the local scan: strong claims first, medium ones
 * behind "Show more".
 */
export function mapAiProposals(
  snapshot: TidySnapshot,
  raw: RawAiProposal[]
): OrganizeProposal[] {
  const actionById = new Map(snapshot.actions.map((a) => [a.id, a.text]));
  const threadById = new Map(snapshot.threads.map((t) => [t.id, t]));
  const fragById = new Map<
    string,
    { threadId: string; text: string; at: number }
  >();
  for (const t of snapshot.threads)
    for (const f of t.frags)
      fragById.set(f.id, { threadId: t.id, text: f.text, at: f.at });

  const out: OrganizeProposal[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    /* The product rule, guarded at runtime too: if a merge_threads ever
       arrives (the prompt forbids it and the route enum excludes it, but a
       model is a model), it is refused here, not mapped. */
    if ((p.kind as string) === "merge_threads") continue;
    /* A duplicate always names the NEWER copy as the source — the same rule
       as the local scan — so the original is never at risk, and a pair the
       model names in the opposite direction is normalised onto the pair the
       local scan would propose (which lets the merge dedupe collapse the
       two passes' rows into one). Only dup_action can be normalised here:
       both sides are actions with timestamps. dup_fragment's target is a
       thread, not a fragment, so its direction stands as the model wrote it
       and its deterministic id is stable regardless. */
    let dupSource = p.sourceId;
    let dupTarget = p.targetId;
    if (p.kind === "dup_action") {
      const s = snapshot.actions.find((a) => a.id === p.sourceId);
      const t = snapshot.actions.find((a) => a.id === p.targetId);
      if (s && t && t.at > s.at) [dupSource, dupTarget] = [dupTarget, dupSource];
    }

    /* After normalisation, the source is always the newer copy for
       dup_action. For fragment kinds the source is the thread the fragment
       lives in; for fold_action it is the action. Everything below reads
       from dupSource/dupTarget so validation and the mapped record agree. */
    const frag = dupSource && p.sourceFragId ? fragById.get(p.sourceFragId) : undefined;
    const sourceThread = threadById.get(dupSource);
    const targetThread = threadById.get(dupTarget);

    /* The refs must line up with the kind, or the proposal is dropped.
       A fragment kind names a thread + a fragment inside it; the others
       name items directly. */
    let ok = false;
    switch (p.kind) {
      case "dup_action":
        ok = !!actionById.get(dupSource) && !!actionById.get(dupTarget);
        break;
      case "dup_fragment":
        ok = !!sourceThread && !!frag && frag.threadId === dupSource;
        break;
      case "move_fragment":
        /* Same target bar as merge_fragments: the note must have a real,
           different thread to land in — a hallucinated target is dropped. */
        ok =
          !!sourceThread &&
          !!frag &&
          frag.threadId === dupSource &&
          !!targetThread &&
          targetThread.id !== sourceThread.id;
        break;
      case "extract_action":
        ok = !!sourceThread && !!frag && frag.threadId === dupSource;
        /* An extract-back is never an extract: if this note is already an
           action, lifting it out again just makes a second copy — and the
           fold claim would then offer to put it back, forever. */
        if (ok && actionsHoldNote(snapshot.actions, frag!.text)) ok = false;
        break;
      case "merge_fragments":
        /* The two fragments must genuinely live in different threads, or
           moving one is meaningless. */
        ok =
          !!sourceThread &&
          !!frag &&
          frag.threadId === dupSource &&
          !!targetThread &&
          targetThread.id !== sourceThread.id;
        break;
      case "fold_action": {
        ok = !!actionById.get(dupSource) && !!targetThread;
        /* A fold-back is never a fold: the thread already holds the note
           (an action extracted from it folds right back into the fragment
           it came from — src is the original note), and folding would copy
           it a second time. The proposal is dropped, not mapped. */
        const a = snapshot.actions.find((x) => x.id === dupSource);
        ok = ok && !threadHoldsNote(targetThread?.frags, a?.text, a?.src);
        break;
      }
    }
    if (!ok) continue;

    /* extract_action's home is its own thread, whatever the model wrote in
       targetId — normalising keeps the deterministic id stable across runs,
       so a dismissal of an extraction sticks. */
    const homeId =
      p.kind === "extract_action" ? dupSource : dupTarget;

    /* Deterministic id — stable item ids only, so a dismissal sticks. */
    const id = `ai:${p.kind}:${dupSource}:${p.sourceFragId ?? ""}:${homeId}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const sourceName =
      p.kind === "dup_action" || p.kind === "fold_action"
        ? actionById.get(dupSource) ?? ""
        : frag?.text ?? "";
    const targetName =
      p.kind === "extract_action"
        ? "an action"
        : p.kind === "dup_action"
          ? actionById.get(homeId) ?? ""
          : threadById.get(homeId)?.name ?? "";

    out.push({
      id,
      kind: p.kind,
      confidence: p.confidence,
      verb: VERBS[p.kind],
      sourceId: dupSource,
      sourceName: NAME(sourceName),
      sourceThreadId: FRAGMENT_KINDS.has(p.kind) ? dupSource : undefined,
      sourceFragId: FRAGMENT_KINDS.has(p.kind) ? p.sourceFragId : undefined,
      targetId: homeId,
      targetName: NAME(targetName),
      reason: CLIP(p.reason, 200),
      score: p.confidence === "high" ? 200 : 100,
      origin: "ai",
    });
  }

  const high = out
    .filter((p) => p.confidence === "high")
    .slice(0, HIGH_CAP);
  const medium = out
    .filter((p) => p.confidence === "medium")
    .slice(0, MEDIUM_CAP);
  return [...high, ...medium];
}

/** Merge the two passes for the review screen: the model's semantic claims
    first (they are the layer that sees ideas), the local word-matches after.
    Deduped by PAIR (kind + source + fragment + target), not by raw id — the
    two passes give the same pair different ids (ai:dup_action:a1::a2 vs
    dup_action:a1:a2), so the same claim from both must appear once. The AI
    version wins because it comes first. Capped together like the local scan
    alone would be. */
export function mergeOrganize(
  ai: OrganizeProposal[],
  local: OrganizeProposal[]
): OrganizeProposal[] {
  const seen = new Set<string>();
  const key = (p: OrganizeProposal) =>
    `${p.kind}:${p.sourceId}:${p.sourceFragId ?? ""}:${p.targetId}`;
  const all = [...ai, ...local].filter((p) => {
    const k = key(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const high = all
    .filter((p) => p.confidence === "high")
    .slice(0, HIGH_CAP);
  const medium = all
    .filter((p) => p.confidence === "medium")
    .slice(0, MEDIUM_CAP);
  return [...high, ...medium];
}
