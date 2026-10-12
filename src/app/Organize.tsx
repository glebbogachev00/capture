"use client";

/**
 * OrganizeScreen — the tidy review as a place of its own, not a strip of
 * cards squeezed under the header.
 *
 * One row, one sentence, one decision.
 *
 * It used to say everything three times: a prose summary ("1 thing was
 * captured twice"), a heading over the group ("THE SAME THING, TWICE"),
 * and then the row itself ("A duplicates B") — three restatements of one
 * fact, and still no answer to the only question that matters, which is
 * what happens if you tap the button. "A duplicates B" with a button
 * marked "Remove" never says WHICH of the two gets removed.
 *
 * So each row now reads as the change itself, in the imperative, naming
 * the card that will move or go: "Delete «A»", and underneath, why — what
 * the other side already says. The button repeats that verb. Nothing
 * happens without a tap, and the tap does what the sentence says.
 *
 * The product rule: everything here reduces clutter or turns a note into an
 * action. There is no "merge one thread into another" — that change was
 * rejected outright. A note may move; a thread never does.
 *
 * Two passes feed the list: the instant local word-match scan, and the
 * model's semantic review (which can see the same idea in different words).
 * Each row carries a chip saying which pass found it.
 */

import { countNoun, t } from "@/lib/i18n";
import { useState, type ReactNode } from "react";
import { TidyWaiting } from "./TidyWaiting";
import type { OrganizeKind, OrganizeProposal } from "@/lib/organize";
import { splitProposals } from "@/lib/organize";

/* A function, so the labels are in the reader's language when shown. */
const yesLabel = (): Record<OrganizeKind, string> => ({
  dup_action: t("Delete"),
  dup_fragment: t("Delete"),
  merge_fragments: t("Merge"),
  fold_action: t("File"),
  move_fragment: t("Move"),
  split_fragment: t("Split out"),
  extract_action: t("Make action"),
  let_go: t("Let go"),
  revisit_intention: t("Still true"),
  looks_done: t("Mark resolved"),
});

/**
 * The row's sentence: what will happen, to which card, if you tap yes.
 *
 * Always imperative and always naming the card that changes first, because
 * that is the one thing the old wording never made clear — "A duplicates B"
 * is a fact about the board, and leaves you to work out which of the two a
 * button marked Remove was going to take.
 */
function Ask({ p }: { p: OrganizeProposal }) {
  if (p.kind === "dup_action" || p.kind === "dup_fragment") {
    return (
      <span className="org-line">
        {t("Delete")} <em>{p.sourceName}</em>
      </span>
    );
  }
  if (p.kind === "revisit_intention") {
    /* A question, not a claim — the only row here that asks rather than
       proposes, so it is the only one phrased as one. */
    return (
      <span className="org-line">
        {t("Still choosing")} <em>{p.sourceName}</em>?
      </span>
    );
  }
  if (p.kind === "let_go") {
    return (
      <span className="org-line">
        {t("Let go of")} <em>{p.sourceName}</em>
      </span>
    );
  }
  if (p.kind === "extract_action") {
    return (
      <span className="org-line">
        {t("Make an action out of")} <em>{p.sourceName}</em>
      </span>
    );
  }
  if (p.kind === "looks_done") {
    /* Says the outcome, not just the gesture — a first-time user's fear
       with anything that changes a row is "where does it go?", and the
       answer is: nowhere. The note stays; it gets a label. */
    return (
      <span className="org-line">
        {t("Label")} <em>{p.sourceName}</em> {t("resolved — a later note says it happened. The note stays in")} <em>{p.targetName}</em>
      </span>
    );
  }
  if (p.kind === "merge_fragments") {
    return (
      <span className="org-line">
        {t("Merge")} <em>{p.sourceName}</em> {t("into")} <em>{p.targetName}</em>
      </span>
    );
  }
  if (p.kind === "move_fragment") {
    return (
      <span className="org-line">
        {t("Move")} <em>{p.sourceName}</em> {t("to")} <em>{p.targetName}</em>
      </span>
    );
  }
  if (p.kind === "split_fragment") {
    return (
      <span className="org-line">
        {t("Give")} <em>{p.sourceName}</em> {t("its own thread — it shares nothing with")}{" "}
        <em>{p.targetName}</em>
      </span>
    );
  }
  return (
    <span className="org-line">
      {t("File")} <em>{p.sourceName}</em> {t("into")} <em>{p.targetName}</em>
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
  children,
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
  /** Clean up — old photos and one-liners — under the suggestions. */
  children?: ReactNode;
}) {
  const [showMore, setShowMore] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  /* Sure things first, the rest behind one tap. There are no per-kind
     headings any more: each row says its own verb, so a heading over it
     could only repeat the row in different words. */
  const { shown, medium } = splitProposals(proposals, showMore);

  return (
    <div>
      <button className="back" onClick={onBack}>
        {t("← capture")}
      </button>

      {/* "Tidy", not "Organize": the icon is a brush, the prompt constant
          is TIDY, the fixtures are tidyCases and the route calls itself the
          tidy engine. The screen was the only thing using another word. */}
      <div className="tname" style={{ fontSize: 26, marginBottom: 6 }}>
        {t("Tidy")}
      </div>

      {proposals.length === 0 ? (
        aiStatus === "thinking" ? (
          <TidyWaiting />
        ) : (
        <p className="int-note">
          {aiStatus === "offline"
              ? t("The board couldn't be read just now — this pass needs the model, and it didn't answer. Try again in a moment.")
              : t("Nothing worth changing — the board reads clean.")}
        </p>
        )
      ) : (
        <>
          {aiStatus === "thinking" && <TidyWaiting />}
          {aiStatus === "offline" && (
            <p className="org-status">
              {t("Only what the dates alone can tell — the reading pass couldn't run just now.")}
            </p>
          )}

          <div className="org-group">
            {shown.map((p) => (
              <div className="org-row" key={p.id}>
                {p.origin === "ai" && (
                  <span
                    className="org-chip"
                    title={t("Found by the model — the same idea in different words")}
                  >
                    {t("AI")}
                  </span>
                )}
                <div className="org-body">
                  <Ask p={p} />
                  <span className="org-why">{p.reason}</span>
                </div>
                <div className="org-actions">
                  <button
                    className="suggest-btn suggest-ok"
                    onClick={() => onAccept(p.id)}
                  >
                    {yesLabel()[p.kind]}
                  </button>
                  {/* "Keep" read as "keep this card" — which is also what
                      the other button does to one of the two. This one
                      changes nothing at all, so it says so. */}
                  <button
                    className="suggest-btn"
                    onClick={() => onDismiss(p.id)}
                  >
                    {t("Leave it")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {medium.length > 0 && (
            <button className="org-more" onClick={() => setShowMore(!showMore)}>
              {showMore
                ? t("Hide less certain suggestions")
                : t("Show {count} I'm less sure about", { count: countNoun(medium.length, "suggestion") })}
            </button>
          )}

          <div className="org-approve">
            <button
              className="suggest-btn suggest-ok"
              onClick={() => setShowApprove(true)}
            >
              {t("Approve all ({count})", { count: proposals.length })}
            </button>
          </div>
        </>
      )}

      {children}

      {showApprove && (
        <div className="modal" onClick={() => setShowApprove(false)}>
          <div
            className="modal-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="discard-title">
              {t("Approve all {count}?", { count: countNoun(proposals.length, "suggestion") })}
            </p>
            <p className="discard-hint">
              {t("Duplicates get removed, fragments move to the thread they belong with, and tasks lift out as actions — all automatically, in one go. Each change is applied on its own, so keep anything you're not sure about.")}
            </p>
            <div className="tools">
              <button
                className="ghost warn"
                onClick={() => {
                  setShowApprove(false);
                  onApproveAll();
                }}
              >
                {t("Approve all")}
              </button>
              <button className="ghost" onClick={() => setShowApprove(false)}>
                {t("Not yet")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
