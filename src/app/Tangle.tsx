"use client";

/**
 * The one observation that comes and finds you.
 *
 * Everything else Tidy notices stays behind a button, because most of it is
 * small: two fragments sharing a phrase changes almost nothing, and a list
 * of those teaches you the button is not worth pressing. This is different.
 * Measured on a real board, one pair of threads caused a third of every
 * misfiling — and not because the boundary was hard, but because it was
 * absent. Acting on it changes how everything files afterwards.
 *
 * So it earns the interruption, and it can afford to: a board of nineteen
 * threads produced exactly one pair. This is a monthly event, not a daily
 * one.
 *
 * Everything is ticked to begin with and can be unticked. That way round on
 * purpose: the judging errs towards including too much, because a note left
 * out is invisible to the person while an extra one costs a glance.
 */

import { countNoun, t } from "@/lib/i18n";
import { useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import type { TangleProposal } from "@/lib/tangle";

export function TangleCallout({
  tangle,
  onOpen,
  onDismiss,
}: {
  tangle: TangleProposal;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { pair, move } = tangle;
  return (
    <div className="tangle-callout">
      <button className="tangle-callout-open" onClick={onOpen}>
        <span className="tangle-callout-label">{t("These two keep getting mixed up")}</span>
        {/* One sentence, and it is the offer rather than the evidence. The
            first version said what had happened AND what was proposed, ran
            to three lines above the board, and gave no sign it could be
            opened — the only visible control was the dismiss. How many you
            moved before is why this is here, and it belongs in the review
            where there is room for it. */}
        {/* The names are quoted because they are the user's own words and
            can carry punctuation: a thread called "Capture." unquoted read
            as "7 notes in Capture. look like…" — a broken sentence. */}
        <span className="tangle-callout-line">
          {t("{count} in “{from}” look like they belong in “{to}”", { count: countNoun(move.length, "note"), from: pair.fromName, to: pair.toName })}
        </span>
      </button>
      <span className="tangle-callout-go" aria-hidden="true">
        <ChevronRight size={15} strokeWidth={2} />
      </span>
      <button
        className="tangle-callout-x"
        onClick={onDismiss}
        aria-label={t("Not now")}
        title={t("Not now")}
      >
        <X size={15} strokeWidth={1.7} />
      </button>
    </div>
  );
}

export function TangleReview({
  tangle,
  fragText,
  onAccept,
  onBack,
}: {
  tangle: TangleProposal;
  /** The note itself, so the person judges the words and not a summary. */
  fragText: (id: string) => string;
  onAccept: (fragIds: string[], rename: boolean, takeAll?: boolean) => void;
  onBack: () => void;
}) {
  const { pair, move, rename, fromFrags } = tangle;
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(move.map((m) => m.id))
  );
  /* Off by default. The suggestion is right when the name lists a kind of
     note that is leaving — it proposed "Bugs" for "Bugs, Issues and
     Additions" — and wrong when it is just renaming whatever thread it was
     handed, which it also did. A wrong rename is worse than a missed one,
     because it is the thread's identity. */
  const [takeName, setTakeName] = useState(false);

  /* Ticking everything is a merge: nothing is left in the old thread, so it
     stops existing. That is a bigger thing than moving some notes, and the
     button has to say so before it is pressed rather than the notice
     explaining it afterwards. */
  const merging = picked.size > 0 && picked.size === fromFrags;
  /* The judge lists what it is confident about, which on a real thread is
     most of it and not all of it. Someone who has moved notes between
     these two threads seven times by hand is asking about the thread, not
     about the confident subset — so the rest is one tap away rather than
     unreachable. */
  const rest = fromFrags - move.length;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <button className="back" onClick={onBack}>
        {t("← capture")}
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 6 }}>
        {t("{from} and {to}", { from: pair.fromName, to: pair.toName })}
      </div>
      <p className="int-note" style={{ marginBottom: 18 }}>
        {t("You’ve already moved {count} from {from} to {to} by hand. These look like they belong there too — untick anything that doesn’t, then move the rest.", { count: countNoun(pair.times, "note"), from: pair.fromName, to: pair.toName })}
      </p>

      <div className="tangle-list">
        {move.map((m) => {
          const on = picked.has(m.id);
          return (
            <button
              key={m.id}
              className={"tangle-row" + (on ? " on" : "")}
              onClick={() => toggle(m.id)}
              aria-pressed={on}
            >
              <span className="tangle-tick" aria-hidden="true">
                {on && <Check size={13} strokeWidth={2.4} />}
              </span>
              <span className="tangle-row-body">
                <span className="tangle-row-text">{fragText(m.id)}</span>
                {!!m.why && <span className="tangle-row-why">{m.why}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* The name is the other half of the fix, and the half that stops it
          happening again: a thread whose name lists a kind of note will go
          on collecting it, whatever the sorter decides. */}
      {rename && (
        <button
          className={"tangle-rename" + (takeName ? " on" : "")}
          onClick={() => setTakeName((v) => !v)}
          aria-pressed={takeName}
        >
          <span className="tangle-tick" aria-hidden="true">
            {takeName && <Check size={13} strokeWidth={2.4} />}
          </span>
          <span>
            {t("Rename")} <b>{pair.fromName}</b> {t("to")} <b>{rename}</b> {t("— its name is part of why this keeps happening")}
          </span>
        </button>
      )}

      {merging && (
        <p className="int-note" style={{ marginTop: 18, marginBottom: 0 }}>
          {t("Every note is moving, so {from} will be absorbed into {to} and stop existing. Anything filed under it comes along. Undo puts it back.", { from: pair.fromName, to: pair.toName })}
        </p>
      )}

      <div className="tangle-do">
        <button
          className="primary"
          disabled={!picked.size && !(rename && takeName)}
          onClick={() => onAccept([...picked], takeName)}
        >
          {!picked.size
            ? t("Rename only")
            : merging
              ? t("Merge {from} into {to}", { from: pair.fromName, to: pair.toName })
              : t("Move {count} to {to}", { count: picked.size, to: pair.toName })}
        </button>
      </div>

      {rest > 0 && (
        <button
          className="tangle-all"
          onClick={() => onAccept([], takeName, true)}
        >
          {t("Or merge the whole thread — {count} more not listed above", { count: countNoun(rest, "note") })}
        </button>
      )}
    </div>
  );
}
