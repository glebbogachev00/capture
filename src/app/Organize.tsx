"use client";

/**
 * OrganizeScreen — the tidy review as a place of its own, not a strip of
 * cards squeezed under the header.
 *
 * It reads like a review agent's report: a one-line summary of what it
 * found, then each kind of finding under its own heading. Only the
 * essentials — the summary, the rows (verb + names + reason), and one
 * yes/no per finding. The engine proposes, the user decides, nothing
 * happens without a tap.
 *
 * The product rule: everything here reduces clutter or turns a note into an
 * action. There is no "merge one thread into another" — that change was
 * rejected outright. A note may move; a thread never does.
 *
 * Two passes feed the list: the instant local word-match scan, and the
 * model's semantic review (which can see the same idea in different words).
 * Each row carries a chip saying which pass found it.
 */

import { useState } from "react";
import type { OrganizeKind, OrganizeProposal } from "@/lib/organize";

/* Only the essential: a heading per kind of finding. The heading and the
   row's own verb + names say what accepting does — "The same thing, twice"
   with a Remove button needs no further explanation, so the hints are
   gone and the review reads at a glance. */
const GROUPS: { kinds: OrganizeKind[]; title: string }[] = [
  { kinds: ["merge_fragments"], title: "One thought, two notes" },
  { kinds: ["dup_action", "dup_fragment"], title: "The same thing, twice" },
  { kinds: ["move_fragment"], title: "Notes sitting in the wrong thread" },
  { kinds: ["fold_action"], title: "Actions that belong with a thread" },
  { kinds: ["extract_action"], title: "Notes that are really tasks" },
  /* Last, and phrased as a question rather than a claim: everything above
     found something wrong, this one only asks whether you are still
     carrying something. */
  { kinds: ["let_go"], title: "Still carrying these — let them go?" },
];

const YES_LABEL: Record<OrganizeKind, string> = {
  dup_action: "Remove",
  dup_fragment: "Remove",
  merge_fragments: "Merge",
  fold_action: "Fold in",
  move_fragment: "Move",
  extract_action: "Extract",
  let_go: "Let go",
};

/** The review's opening line, built from what was found — "1 thought lives
    twice and 1 note sits in the wrong thread." */
function summaryOf(proposals: OrganizeProposal[]): string {
  const count = (k: OrganizeKind) =>
    proposals.filter((p) => p.kind === k).length;
  const parts: string[] = [];
  const m = count("merge_fragments");
  if (m)
    parts.push(
      `${m} ${m === 1 ? "thought lives" : "thoughts live"} twice, in different words`
    );
  const d = count("dup_action") + count("dup_fragment");
  if (d)
    parts.push(
      `${d} ${d === 1 ? "thing was" : "things were"} captured twice`
    );
  const mv = count("move_fragment");
  if (mv)
    parts.push(
      `${mv} ${mv === 1 ? "note sits" : "notes sit"} in the wrong thread`
    );
  const f = count("fold_action");
  if (f)
    parts.push(
      `${f} ${f === 1 ? "action belongs" : "actions belong"} with a thread`
    );
  const e = count("extract_action");
  if (e)
    parts.push(
      `${e} ${e === 1 ? "note reads" : "notes read"} as a task to lift out`
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
  if (p.kind === "let_go") {
    /* Source and target are the same card here — nothing moves anywhere, it
       just stops being carried. The generic "X into Y" line would read as
       "Sort out the garage into Sort out the garage". */
    return (
      <span className="org-line">
        <em>{p.sourceName}</em>
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
  if (p.kind === "move_fragment" || p.kind === "merge_fragments") {
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
  aiStatus,
  onBack,
  onAccept,
  onDismiss,
  onApproveAll,
}: {
  proposals: OrganizeProposal[];
  /** Whether the model's semantic pass has run. "thinking" shows a quiet
      row while it works; "offline" tells the user the semantic layer
      couldn't run, so they don't mistake a quiet model for a clean board. */
  aiStatus: "idle" | "thinking" | "done" | "offline";
  onBack: () => void;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Apply every proposal at once — gated behind the confirm modal. */
  onApproveAll: () => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
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
          of similar things, then tap the wand again to re-scan.
        </p>
      ) : (
        <>
          <p className="org-summary">{summary}</p>
          {aiStatus === "thinking" && (
            <p className="org-status">
              The model is looking for the same ideas in different words…
            </p>
          )}
          {aiStatus === "offline" && (
            <p className="org-status">
              Instant scan only — the semantic pass couldn&apos;t run right now.
            </p>
          )}

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
                      {p.origin === "ai" && (
                        <span className="org-chip" title="Found by the model — the same idea in different words">
                          AI
                        </span>
                      )}
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

          <div className="org-approve">
            <button
              className="suggest-btn suggest-ok"
              onClick={() => setShowApprove(true)}
            >
              Approve all ({proposals.length})
            </button>
          </div>
        </>
      )}

      {showApprove && (
        <div className="modal" onClick={() => setShowApprove(false)}>
          <div
            className="modal-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="discard-title">
              Approve all {proposals.length}{" "}
              {proposals.length === 1 ? "suggestion" : "suggestions"}?
            </p>
            <p className="discard-hint">
              Duplicates get removed, notes move to the thread they belong
              with, and tasks lift out as actions — all automatically, in one
              go. Each change is applied on its own, so keep anything
              you&apos;re not sure about.
            </p>
            <div className="tools">
              <button
                className="ghost warn"
                onClick={() => {
                  setShowApprove(false);
                  onApproveAll();
                }}
              >
                Approve all
              </button>
              <button className="ghost" onClick={() => setShowApprove(false)}>
                Not yet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
