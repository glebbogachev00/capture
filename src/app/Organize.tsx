"use client";

/**
 * OrganizeScreen — the tidy review as a place of its own, not a strip of
 * cards squeezed under the header.
 *
 * It reads like a review agent's report: a one-line summary of what it
 * found, then each kind of finding under its own heading ("Threads that
 * cover the same ground", "The same thing, twice"…) with a short hint about
 * what accepting means. Every finding is one yes/no — the engine proposes,
 * the user decides, nothing happens without a tap.
 *
 * Strong claims show first; less certain ones sit behind "Show more", so
 * the page is calm on purpose.
 */

import { useState } from "react";
import type { OrganizeKind, OrganizeProposal } from "@/lib/organize";

type Group = {
  kinds: OrganizeKind[];
  title: string;
  hint: string;
};

const GROUPS: Group[] = [
  {
    kinds: ["merge_threads"],
    title: "Threads that cover the same ground",
    hint: "Merging folds one into the other — one subject, one home.",
  },
  {
    kinds: ["dup_action", "dup_fragment"],
    title: "The same thing, twice",
    hint: "The newer copy is removed; the original stays with its notes and images.",
  },
  {
    kinds: ["move_fragment"],
    title: "Notes sitting in the wrong thread",
    hint: "Each note moves to the thread it clearly belongs with.",
  },
  {
    kinds: ["fold_action"],
    title: "Actions that belong with a thread",
    hint: "Folding turns the action into a note there.",
  },
  {
    kinds: ["extract_action"],
    title: "Tasks to lift out of notes",
    hint: "The task becomes an action; the note stays where it is.",
  },
];

const YES_LABEL: Record<OrganizeKind, string> = {
  dup_action: "Remove",
  dup_fragment: "Remove",
  merge_threads: "Merge",
  fold_action: "Fold in",
  move_fragment: "Move",
  extract_action: "Extract",
};

/** The review's opening line, built from what was found — "1 thread covers
    the same ground as another and 1 note sits in the wrong thread." */
function summaryOf(proposals: OrganizeProposal[]): string {
  const count = (k: OrganizeKind) =>
    proposals.filter((p) => p.kind === k).length;
  const parts: string[] = [];
  const n = count("merge_threads");
  if (n)
    parts.push(
      `${n} ${n === 1 ? "thread" : "threads"} ${n === 1 ? "covers" : "cover"} the same ground as another`
    );
  const d = count("dup_action") + count("dup_fragment");
  if (d)
    parts.push(
      `${d} ${d === 1 ? "thing was" : "things were"} captured twice`
    );
  const m = count("move_fragment");
  if (m)
    parts.push(
      `${m} ${m === 1 ? "note sits" : "notes sit"} in the wrong thread`
    );
  const f = count("fold_action");
  if (f)
    parts.push(
      `${f} ${f === 1 ? "action belongs" : "actions belong"} with a thread`
    );
  const e = count("extract_action");
  if (e)
    parts.push(
      `${e} ${e === 1 ? "task can" : "tasks can"} be lifted out of notes`
    );
  if (!parts.length) return "";
  return parts.length === 1
    ? parts[0] + "."
    : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] + ".";
}

function Explanation({ p }: { p: OrganizeProposal }) {
  if (p.kind === "dup_action" || p.kind === "dup_fragment") {
    return (
      <span className="org-line">
        <em>{p.sourceName}</em> duplicates <em>{p.targetName}</em>
      </span>
    );
  }
  if (p.kind === "extract_action") {
    return (
      <span className="org-line">
        Lift a task out of <em>{p.sourceName}</em>
      </span>
    );
  }
  if (p.kind === "move_fragment") {
    return (
      <span className="org-line">
        Move <em>{p.sourceName}</em> to <em>{p.targetName}</em>
      </span>
    );
  }
  return (
    <span className="org-line">
      <em>{p.sourceName}</em> into <em>{p.targetName}</em>
    </span>
  );
}

export function OrganizeScreen({
  proposals,
  onBack,
  onAccept,
  onDismiss,
}: {
  proposals: OrganizeProposal[];
  onBack: () => void;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const medium = proposals.filter((p) => p.confidence === "medium");
  const summary = summaryOf(proposals);

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← capture
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 6 }}>
        Organize
      </div>

      {proposals.length === 0 ? (
        <p className="int-note">
          Nothing to tidy right now — the board looks clean. Capture a couple
          of similar things and this page will show you where they could come
          together.
        </p>
      ) : (
        <>
          <p className="org-summary">{summary}</p>

          {GROUPS.map((g) => {
            const items = proposals.filter((p) => g.kinds.includes(p.kind));
            if (!items.length) return null;
            const shown = showMore
              ? items
              : items.filter((p) => p.confidence === "high");
            if (!shown.length) return null;
            return (
              <div className="int-block" key={g.title}>
                <h4 className="int-label">
                  {g.title} — {items.length}
                </h4>
                <p className="int-note">{g.hint}</p>
                <div className="org-group">
                  {shown.map((p) => (
                    <div className="org-row" key={p.id}>
                      <span
                        className={
                          "organize-dot " +
                          (p.confidence === "high" ? "high" : "medium")
                        }
                        title={
                          p.confidence === "high"
                            ? "Strong match"
                            : "Possible match"
                        }
                      />
                      <div className="org-body">
                        <Explanation p={p} />
                        <span className="org-why">{p.reason}</span>
                      </div>
                      <div className="org-actions">
                        <button
                          className="suggest-btn suggest-ok"
                          onClick={() => onAccept(p.id)}
                        >
                          {YES_LABEL[p.kind]}
                        </button>
                        <button
                          className="suggest-btn"
                          onClick={() => onDismiss(p.id)}
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {medium.length > 0 && (
            <button className="org-more" onClick={() => setShowMore(!showMore)}>
              {showMore
                ? "Hide less certain suggestions"
                : `Show ${medium.length} ${
                    medium.length === 1 ? "suggestion" : "suggestions"
                  } I'm less sure about`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
