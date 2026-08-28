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
        <span className="tangle-callout-label">These two keep getting mixed up</span>
        {/* One sentence, and it is the offer rather than the evidence. The
            first version said what had happened AND what was proposed, ran
            to three lines above the board, and gave no sign it could be
            opened — the only visible control was the dismiss. How many you
            moved before is why this is here, and it belongs in the review
            where there is room for it. */}
        <span className="tangle-callout-line">
          {move.length} {move.length === 1 ? "note" : "notes"} in{" "}
          {pair.fromName} look like they belong in {pair.toName}
        </span>
      </button>
      <span className="tangle-callout-go" aria-hidden="true">
        <ChevronRight size={15} strokeWidth={2} />
      </span>
      <button
        className="tangle-callout-x"
        onClick={onDismiss}
        aria-label="Not now"
        title="Not now"
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
  onAccept: (fragIds: string[], rename: boolean) => void;
  onBack: () => void;
}) {
  const { pair, move, rename } = tangle;
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(move.map((m) => m.id))
  );
  /* Off by default. The suggestion is right when the name lists a kind of
     note that is leaving — it proposed "Bugs" for "Bugs, Issues and
     Additions" — and wrong when it is just renaming whatever thread it was
     handed, which it also did. A wrong rename is worse than a missed one,
     because it is the thread's identity. */
  const [takeName, setTakeName] = useState(false);

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
        ← capture
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 6 }}>
        {pair.fromName} and {pair.toName}
      </div>
      <p className="int-note" style={{ marginBottom: 18 }}>
        You&apos;ve already moved {pair.times}{" "}
        {pair.times === 1 ? "note" : "notes"} from {pair.fromName} to{" "}
        {pair.toName}{" "}
        by hand. These look like they belong there too — untick anything that
        doesn&apos;t, then move the rest.
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
            Rename <b>{pair.fromName}</b> to <b>{rename}</b> — its name is part
            of why this keeps happening
          </span>
        </button>
      )}

      <div className="tangle-do">
        <button
          className="primary"
          disabled={!picked.size && !(rename && takeName)}
          onClick={() => onAccept([...picked], takeName)}
        >
          {picked.size
            ? `Move ${picked.size} to ${pair.toName}`
            : "Rename only"}
        </button>
      </div>
    </div>
  );
}
