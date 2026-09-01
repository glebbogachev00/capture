import {
  type Action,
  type Board,
  type Intention,
  type Thread,
  left,
  pad,
} from "./model";
import { actionsForThread, type DoneItem } from "./threadActions";

/**
 * Turning what is on screen into text someone else can read.
 *
 * One format, markdown, for both people and models. A separate "copy for AI"
 * would be a decision at the moment of sharing, and the point of this app is
 * to remove those; markdown with dates reads fine in a message and parses fine
 * in a chat window. The leading line names what the thing is, which is the
 * context a model needs and a person skims past.
 *
 * Distinct from the JSON in Settings: that is a complete backup meant for
 * restoring, this is a readable excerpt meant for continuing a thought
 * somewhere else.
 */

const shortDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const span = (times: number[]) => {
  if (!times.length) return "";
  const lo = shortDate(Math.min(...times));
  const hi = shortDate(Math.max(...times));
  return lo === hi ? lo : `${lo} – ${hi}`;
};

export type Shareable = {
  title: string;
  text: string;
  summary: string;
  /* The image ids a thread's fragments reference, so the share sheet can
     carry the actual photos alongside the text. Populated for threads;
     empty for every other shareable. */
  imgIds?: string[];
  /* Built from imgIds by the caller just before sharing — the OS sheet
     takes File objects, the clipboard fallback ignores them. */
  files?: File[];
};

export function shareThread(
  t: Thread,
  from?: { open: Action[]; done: DoneItem[] }
): Shareable {
  const dates = t.frags.map((f) => f.at);
  const lines = [`# ${t.name}`, ""];
  lines.push(
    `${t.frags.length} fragment${t.frags.length === 1 ? "" : "s"}${
      dates.length ? " · " + span(dates) : ""
    }`,
    ""
  );
  if (t.summary) lines.push("**Where this stands**", "", t.summary, "");
  lines.push("---", "");
  for (const f of t.frags) {
    lines.push(`**${shortDate(f.at)}**`, "", f.text, "");
  }
  /* The actions this thread gave rise to ride along, open first: a person
     pasting the thread into an agent is handing over where the thinking
     stands, and the agent's first question is always "so what is next?". */
  if (from && (from.open.length || from.done.length)) {
    lines.push("", "## Actions from this thread", "");
    for (const a of from.open) lines.push(`- [ ] ${a.text}`);
    for (const a of from.done) lines.push(`- [x] ${a.text}`);
  }
  return {
    title: t.name,
    text: lines.join("\n").trimEnd(),
    summary: `Thread · ${t.frags.length} fragment${t.frags.length === 1 ? "" : "s"}`,
    imgIds: t.frags.flatMap((f) => f.imgs || []),
  };
}

export function shareIntention(i: Intention): Shareable {
  const lines = [`# (${pad(i.number)}) ${i.expandedIntention}`, ""];
  if (i.recommendedActions.length) {
    lines.push("**Recommended actions**", "");
    for (const a of i.recommendedActions) lines.push(`- ${a}`);
    lines.push("");
  }
  if (i.counterIntentions.length) {
    lines.push("**Counter-intentions**", "");
    for (const c of i.counterIntentions) lines.push(`- ${c}`);
    lines.push("");
  }
  return {
    title: `Intention ${pad(i.number)}`,
    text: lines.join("\n").trimEnd(),
    summary: "Intention",
  };
}

/**
 * One action, on its way somewhere else — usually an assistant.
 *
 * The task alone is often useless to hand over: "Fix heat map bug" tells a
 * model nothing, while the sentence it was distilled from says what is
 * actually wrong. So the original rides along whenever it said more than
 * the card does, and the deadline comes too, since a date is the first
 * thing anybody asks about a task.
 *
 * Plain text, no heading. This gets pasted into a chat box, not a
 * document, and a markdown title in a prompt is noise.
 */
export function shareAction(a: Action): Shareable {
  const lines = [a.text];
  if (a.due) lines.push(`Due: ${shortDate(a.due)}`);
  /* `src` is the raw capture. It only earns its place when it carries
     something the action text lost — a re-worded one-liner would just be
     the same sentence twice.

     Compared on letters and digits alone, because the sorter routinely
     returns the capture with a full stop added: "Buy running clothes" and
     "Buy running clothes." are not two pieces of information, and the
     first version of this pasted both. */
  const bare = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const raw = (a.src || "").trim();
  if (raw && bare(raw) !== bare(a.text)) lines.push("", "Context:", raw);
  return {
    title: a.text,
    text: lines.join("\n"),
    summary: "Action",
  };
}

export function shareActions(actions: Action[], now: number): Shareable {
  const lines = [`# Open actions (${actions.length})`, ""];
  for (const a of actions) {
    const ms = a.expires ? a.expires - now : null;
    lines.push(`- [ ] ${a.text} — ${ms === null ? "kept" : left(ms)}`);
  }
  return {
    title: "Open actions",
    text: lines.join("\n").trimEnd(),
    summary: `${actions.length} action${actions.length === 1 ? "" : "s"}`,
  };
}

export function shareThreadList(threads: Thread[], board?: Board): Shareable {
  const lines = [`# Threads (${threads.length})`, ""];
  for (const t of threads) {
    const last = t.frags.at(-1);
    const open = board ? actionsForThread(board, t).open.length : 0;
    lines.push(
      `- **${t.name}** — ${t.frags.length} fragment${t.frags.length === 1 ? "" : "s"}${
        open ? `, ${open} open action${open === 1 ? "" : "s"}` : ""
      }${last ? ", last " + shortDate(last.at) : ""}`
    );
    const gist = t.summary || last?.text || "";
    if (gist) lines.push(`  ${gist.split("\n")[0].slice(0, 160)}`);
  }
  return {
    title: "Threads",
    text: lines.join("\n").trimEnd(),
    summary: `${threads.length} thread${threads.length === 1 ? "" : "s"}`,
  };
}

export function shareIntentionList(intentions: Intention[]): Shareable {
  const lines = [`# Intentions (${intentions.length})`, ""];
  for (const i of intentions) {
    lines.push(`- (${pad(i.number)}) ${i.expandedIntention}`);
  }
  return {
    title: "Intentions",
    text: lines.join("\n").trimEnd(),
    summary: `${intentions.length} intention${intentions.length === 1 ? "" : "s"}`,
  };
}

/** What the share control would send, given where you currently are. */
export function shareableFor(
  board: Board,
  view:
    | { kind: "thread"; id: string }
    | { kind: "intention"; id: string }
    | { kind: "tab"; tab: "actions" | "threads" | "intentions" }
    /* The record shares itself: what is new since the last time it went
       out, or the whole board the first time. */
    | { kind: "record"; since: number | null },
  now: number
): Shareable | null {
  if (view.kind === "record") {
    /* Send the increment when there is one, the whole board when there is
       not. It used to send nothing at all in that second case, which reads
       as a broken button: the record plainly holds a hundred captures, and
       the app answers "nothing new" — technically about the last handover,
       and useless as an answer to "give me the record". Redundant text is
       cheaper than a dead control. */
    const delta = view.since ? shareRecordSince(board, view.since) : null;
    return delta ?? shareRecord(board);
  }
  if (view.kind === "thread") {
    const t = board.threads.find((x) => x.id === view.id);
    /* The same document the thread's own Copy produces: the standing, and
       the actions that belong with it. Two doors, one paste. */
    return t ? shareThread(t, actionsForThread(board, t)) : null;
  }
  if (view.kind === "intention") {
    const i = board.intentions.find((x) => x.id === view.id);
    return i ? shareIntention(i) : null;
  }
  if (view.tab === "actions") {
    const open = board.actions.filter((a) => !a.done && !a.faded);
    return open.length ? shareActions(open, now) : null;
  }
  if (view.tab === "threads") {
    return board.threads.length
      ? shareThreadList(board.threads, board)
      : null;
  }
  return board.intentions.length ? shareIntentionList(board.intentions) : null;
}

/**
 * Copy without going near the share sheet.
 *
 * Used for a single fragment, where the whole point is speed: getting one
 * paragraph into a chat window should be one tap, not a tap plus hunting for
 * Copy inside the OS sheet. The header control still handles sharing a whole
 * view to a person.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/**
 * Hand text — and, when present, the photos — to the OS share sheet, falling
 * back to the clipboard (which carries the text only).
 *
 * On a phone this is the whole feature: the sheet already offers Messages,
 * Mail, AirDrop, whatever chat apps are installed, and Copy — so the app does
 * not need a destination menu of its own. Dismissing the sheet throws
 * AbortError, which is a choice rather than a failure and is reported as such.
 */
export async function shareText(s: Shareable): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(
        s.files?.length
          ? { title: s.title, text: s.text, files: s.files }
          : { title: s.title, text: s.text }
      );
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // Anything else (unsupported payload, permission) falls through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(s.text);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * What moved since the last copy — the record as a diff, not a clone.
 *
 * Gleb's frame: the record is version control for the board. A thread
 * share is a full checkout of one project; pasting it every day re-sends
 * text the agent already holds and pays for it again. This emits only the
 * threads that moved since the stamp (each still as its whole current
 * unit — state, not edits), the actions that appeared attached to
 * nothing, and the captures made since. Returns null when nothing moved,
 * so the button can say so instead of copying an empty ritual.
 */
export function shareRecordSince(board: Board, since: number): Shareable | null {
  const movedThread = (t: Thread) =>
    (t.updatedAt ?? 0) > since || t.frags.some((f) => f.at > since);
  const moved = board.threads.filter(movedThread);

  const claimed = new Set<string>();
  for (const t of moved)
    for (const a of [
      ...actionsForThread(board, t).open,
      ...actionsForThread(board, t).done,
    ])
      claimed.add(a.id);
  const loose = board.actions.filter(
    (a) => !a.done && a.at > since && !claimed.has(a.id)
  );
  const rows = [...(board.ledger ?? [])]
    .filter((e) => e.at > since)
    .sort((a, b) => b.at - a.at)
    .slice(0, 50);

  if (!moved.length && !loose.length && !rows.length) return null;

  const lines: string[] = [
    `# Capture board — new since ${shortDate(since)}`,
    "",
  ];
  if (moved.length) {
    lines.push("## Threads that moved");
    for (const t of moved) {
      lines.push("", `### ${t.name}`);
      if (t.summary) lines.push("", t.summary);
      if (t.next) lines.push("", `Next: ${t.next}`);
      const acts = actionsForThread(board, t);
      if (acts.open.length || acts.done.length) {
        lines.push("");
        for (const a of acts.open) lines.push(`- [ ] ${a.text}`);
        for (const a of acts.done) lines.push(`- [x] ${a.text}`);
      }
    }
  }
  if (loose.length) {
    lines.push("", "## New actions attached to nothing", "");
    for (const a of loose) lines.push(`- [ ] ${a.text}`);
  }
  if (rows.length) {
    const name = (id: string) => board.threads.find((t) => t.id === id)?.name;
    lines.push("", `## Captures since (${rows.length})`, "");
    for (const e of rows) {
      const said = (e.clean || e.raw || "").trim();
      const home =
        (e.kind === "thread" || e.kind === "both") && e.targetId
          ? name(e.targetId)
          : undefined;
      lines.push(
        `- ${shortDate(e.at)} · ${e.kind}${e.undone ? " · undone" : ""}${
          home ? ` · in "${home}"` : ""
        }: ${said}`
      );
    }
  }
  return {
    title: "What's new",
    summary: `${moved.length} threads moved · ${rows.length} captures`,
    text: lines.join("\n"),
  };
}

/**
 * The record as a document an agent can pick up cold.
 *
 * A flat timeline made the reader reassemble the projects; this hands
 * them over assembled. Every thread travels as a connected unit — its
 * name, where it stands, the next move it named, and the actions that
 * belong with it — then the actions attached to nothing, then the recent
 * captures as the tail so the temporal record is still there. One paste
 * is the whole state of the board.
 */
export function shareRecord(board: Board, recentLimit = 15): Shareable {
  const lines: string[] = ["# Capture board", ""];

  if (board.threads.length) {
    lines.push("## Threads");
    const claimed = new Set<string>();
    for (const t of board.threads) {
      lines.push("", `### ${t.name}`);
      if (t.summary) lines.push("", t.summary);
      if (t.next) lines.push("", `Next: ${t.next}`);
      const acts = actionsForThread(board, t);
      for (const a of [...acts.open, ...acts.done]) claimed.add(a.id);
      if (acts.open.length || acts.done.length) {
        lines.push("");
        for (const a of acts.open) lines.push(`- [ ] ${a.text}`);
        for (const a of acts.done) lines.push(`- [x] ${a.text}`);
      }
    }
    const loose = board.actions.filter((a) => !a.done && !claimed.has(a.id));
    if (loose.length) {
      lines.push("", "## Actions attached to nothing", "");
      for (const a of loose) lines.push(`- [ ] ${a.text}`);
    }
  } else {
    const open = board.actions.filter((a) => !a.done);
    if (open.length) {
      lines.push("## Open actions", "");
      for (const a of open) lines.push(`- [ ] ${a.text}`);
    }
  }

  const rows = [...(board.ledger ?? [])]
    .sort((a, b) => b.at - a.at)
    .slice(0, recentLimit);
  if (rows.length) {
    const name = (id: string) => board.threads.find((t) => t.id === id)?.name;
    lines.push("", `## Recent captures (last ${rows.length})`, "");
    for (const e of rows) {
      const said = (e.clean || e.raw || "").trim();
      const home =
        (e.kind === "thread" || e.kind === "both") && e.targetId
          ? name(e.targetId)
          : undefined;
      lines.push(
        `- ${shortDate(e.at)} · ${e.kind}${e.undone ? " · undone" : ""}${
          home ? ` · in "${home}"` : ""
        }: ${said}`
      );
    }
  }

  return {
    title: "Capture board",
    summary: `${board.threads.length} threads · ${
      board.actions.filter((a) => !a.done).length
    } open actions`,
    text: lines.join("\n"),
  };
}
