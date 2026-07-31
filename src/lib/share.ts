import {
  type Action,
  type Board,
  type Intention,
  type Thread,
  left,
  pad,
} from "./model";

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

export type Shareable = { title: string; text: string; summary: string };

export function shareThread(t: Thread): Shareable {
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
  return {
    title: t.name,
    text: lines.join("\n").trimEnd(),
    summary: `Thread · ${t.frags.length} fragment${t.frags.length === 1 ? "" : "s"}`,
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

export function shareThreadList(threads: Thread[]): Shareable {
  const lines = [`# Threads (${threads.length})`, ""];
  for (const t of threads) {
    const last = t.frags.at(-1);
    lines.push(
      `- **${t.name}** — ${t.frags.length} fragment${t.frags.length === 1 ? "" : "s"}${
        last ? ", last " + shortDate(last.at) : ""
      }`
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
    | { kind: "tab"; tab: "actions" | "threads" | "intentions" },
  now: number
): Shareable | null {
  if (view.kind === "thread") {
    const t = board.threads.find((x) => x.id === view.id);
    return t ? shareThread(t) : null;
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
    return board.threads.length ? shareThreadList(board.threads) : null;
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
 * Hand text to the OS share sheet, falling back to the clipboard.
 *
 * On a phone this is the whole feature: the sheet already offers Messages,
 * Mail, AirDrop, whatever chat apps are installed, and Copy — so the app does
 * not need a destination menu of its own. Dismissing the sheet throws
 * AbortError, which is a choice rather than a failure and is reported as such.
 */
export async function shareText(s: Shareable): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: s.title, text: s.text });
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
