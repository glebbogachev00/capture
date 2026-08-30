"use client";

/**
 * The board's card layer — action rows, thread cards, cover bands, and the
 * narrated wait — moved out of Capture.tsx as pure composition. No logic
 * changed in the move; Capture.tsx keeps orchestration and these keep
 * pixels. (Part of the Capture.tsx ratchet program: the screen file only
 * shrinks.)
 */

import { memo, useEffect, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { imgLoad, imgNow } from "@/lib/imgCache";
import { parseCover, toneColour, type Cover } from "@/lib/cover";
import { DAY, GRACE, fmt, fmtDue, left, type Action, type ShelfLife, type Thread } from "@/lib/model";

const TICK_MS = 420;

/**
 * Memoized on DATA only — function props are treated as stable.
 *
 * Every tick commits the board, and the commit re-rendered every card on
 * screen; on a phone that render was the "wait" between ticking one action
 * and being able to tick the next. The handlers passed in are inline
 * closures (new identity every render) but each one only wraps a stable
 * hook function with a fixed id, so comparing them would defeat the memo
 * for no safety. If a handler ever needs to close over CHANGING data, put
 * that data in a prop instead — the compare below is the contract.
 */
export const Row = memo(function Row({
  a,
  faded,
  landed,
  now,
  shelfOpen,
  onToggle,
  onShelfClick,
  onSetShelf,
  onRestore,
  onRemove,
  onMakeThread,
  onEditText,
  onResort,
  onMakeIntention,
  onCopy,
  onOpenShot,
  busy,
}: {
  a: Action;
  faded?: boolean;
  /** This action is what the last capture created — wash it once. */
  landed?: boolean;
  now: number;
  shelfOpen: boolean;
  onToggle: () => void;
  onShelfClick: () => void;
  onSetShelf: (span: number | null, label: ShelfLife) => void;
  onRestore: () => void;
  onRemove: () => void;
  onMakeThread: () => void;
  onEditText: (text: string) => void;
  onResort: () => void;
  onMakeIntention: () => void;
  onCopy: () => void;
  /** Present only when a picture came in with this capture. */
  onOpenShot?: () => void;
  busy: boolean;
}) {
  const ms = a.expires ? a.expires - now : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.text);
  const [more, setMore] = useState(false);
  /* Ticking used to delete the action mid-tap: the row was gone before your
     finger lifted, so the most-repeated gesture in the app had no payoff.
     The box fills, the text strikes through, and the row folds away — then
     the board commits. Reduced motion still gets the beat, just no slide. */
  const [ticked, setTicked] = useState(false);
  const tick = () => {
    if (ticked) return;
    setTicked(true);
    setTimeout(onToggle, TICK_MS);
  };

  const commit = () => {
    if (draft.trim()) onEditText(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className={
        "act" +
        (faded ? " is-faded" : "") +
        (landed && !ticked ? " focus" : "") +
        (ticked ? " is-done is-ticking" : "")
      }
    >
      <button
        className={"box" + (ticked ? " done" : "")}
        onClick={tick}
        aria-label="Mark done"
      >
        {ticked && <Check size={13} strokeWidth={3} />}
      </button>
      <div className="act-body">
        {editing ? (
          <input
            className="act-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Action text"
            autoFocus
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(a.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="act-text">{a.text}</div>
        )}
        <div className="act-meta">
          <span>{fmt(a.at)}</span>
          {/* A deadline the capture named for itself. Shown because it is
              the reason this action is still here — it holds the row on the
              board until its date, and never leaves the app. */}
          {!!a.due && !faded && (
            <span className={"due" + (a.due - now < DAY ? " soon" : "")}>
              due {fmtDue(a.due)}
            </span>
          )}
          {/* The picture lives on a thread fragment, not here — this is the
              way back to it, so a screenshot is never a thing you captured
              and then could not find. */}
          {!!onOpenShot && (
            <button className="shot-link" onClick={onOpenShot} title="Open the note holding this picture">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.6" />
                <path d="M21 16l-5-5-6 6" />
              </svg>
              picture
            </button>
          )}
          {a.unsorted && <span className="raw">unsorted</span>}
          {faded && (
            <span>
              faded · clears in {left((a.fadedAt || now) + GRACE - now)}
            </span>
          )}
        </div>

        {more && !editing && (
          <div className="row-actions">
            <button className="ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            {/* Tried on the meta line as a one-tap chip and it read as
                clutter on a row that is otherwise just words and a date.
                Back here with the other per-card verbs: a tap further away,
                but the list stays a list. */}
            <button className="ghost" onClick={onCopy}>
              Copy
            </button>
            {a.unsorted && (
              <button className="ghost" onClick={onResort} disabled={busy}>
                Sort now
              </button>
            )}
            {faded ? (
              <button className="ghost" onClick={onRestore}>
                Restore
              </button>
            ) : (
              <>
                <button className="ghost" onClick={onMakeThread}>
                  Make a thread
                </button>
                <button
                  className="ghost"
                  onClick={onMakeIntention}
                  disabled={busy}
                >
                  Make an intention
                </button>
              </>
            )}
          </div>
        )}

        {shelfOpen && (
          <div className="shelf">
            <button onClick={() => onSetShelf(DAY, "hours")}>1 day</button>
            <button onClick={() => onSetShelf(7 * DAY, "days")}>1 week</button>
            <button onClick={() => onSetShelf(30 * DAY, "weeks")}>
              1 month
            </button>
            <button onClick={() => onSetShelf(null, "keep")}>keep</button>
            <button className="warn" onClick={onRemove}>
              delete now
            </button>
          </div>
        )}
      </div>
      <div className="act-tools">
        <button
          className={"chip" + (!ms ? " kept" : ms < DAY ? " soon" : "")}
          onClick={onShelfClick}
          aria-label="Change shelf life"
        >
          {ms === null ? "kept" : left(ms)}
        </button>
        {!editing && (
          <button
            className={"more-btn" + (more ? " open" : "")}
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            aria-label={more ? "Fewer options" : "More options"}
          >
            <MoreHorizontal size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
},
(prev, next) =>
  prev.a === next.a &&
  prev.landed === next.landed &&
  prev.now === next.now &&
  prev.shelfOpen === next.shelfOpen &&
  prev.busy === next.busy
);

/**
 * A thread's cover: a colour band, or a photo band when one was chosen.
 * Photos come back from IndexedDB the same way fragment images do, so a
 * cover picked on the phone appears on the Mac once its bytes sync.
 */
/**
 * The wait, said like it means it.
 *
 * "Sorting…" for eight seconds reads as stuck; the same eight seconds
 * narrated reads as working. Tidy set the pattern — say what is actually
 * happening, in order, claiming no progress the request cannot know — and
 * this brings the two slow capture waits into it. Every line is true
 * whenever it appears: the engine really is doing roughly this, and none
 * of them says a step has finished.
 *
 * Faster cadence than Tidy's, because a sort is seconds rather than a
 * minute and a half — a line that never gets read is not fun, it is
 * furniture. Anything not listed here keeps its plain label.
 */
const BUSY_LINES: Record<string, string[]> = {
  Sorting: [
    "Reading it back.",
    "Deciding what this is — a task, a thought, or a declaration.",
    "Weighing which thread it belongs with.",
    "A new thread is the expensive answer, so it argues itself out of one first.",
    "Taking its time — long thoughts take longer.",
    "Still on it. The words are safe either way.",
  ],
  "Finding the intention": [
    "Reading it back.",
    "Listening for the state underneath the words.",
    "Writing it as already true.",
    "Naming what pulls against it — that part takes the longest.",
    "Still on it. You read everything before it lands.",
  ],
};
const BUSY_EVERY_MS = 3_500;

export function BusyLine({ label }: { label: string }) {
  const lines = BUSY_LINES[label];
  /* The label is the reset: a new job remounts the counter via key below,
     so no state needs writing inside the effect. */
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!lines) return;
    const t = setInterval(
      () => setI((n) => Math.min(n + 1, lines.length - 1)),
      BUSY_EVERY_MS
    );
    return () => clearInterval(t);
  }, [lines]);
  if (!lines) return <>{label}…</>;
  return <>{lines[i]}</>;
}

export function CoverBand({ cover }: { cover: Cover }) {
  /* Memory first: a cover seen once renders on the first frame of every
     later mount, instead of blanking while IndexedDB answers — which it
     does slowly mid-sort, when commits hold the store's write lock. */
  const id = cover.kind === "img" ? cover.id : null;
  const [src, setSrc] = useState<string | null>(() => (id ? imgNow(id) : null));
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void imgLoad(id)
      .then((v) => {
        if (alive) setSrc(v);
      })
      .catch(() => {
        /* not here yet — the next sync fetches it */
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (cover.kind === "tone") {
    return (
      <div
        className="tcover"
        style={{ background: toneColour(cover) || undefined }}
      />
    );
  }
  return (
    <div className="tcover">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" />}
    </div>
  );
}

export function TCard({
  t,
  resting,
  landed,
  onOpen,
}: {
  t: Thread;
  resting?: boolean;
  /** This thread is where the last capture went — wash it once. */
  landed?: boolean;
  onOpen: () => void;
}) {
  const last = t.frags.at(-1);
  const bars = t.frags.slice(-22);
  const cover = parseCover(t.cover);
  return (
    <button
      className={
        "tcard" +
        (resting ? " resting" : "") +
        (landed ? " focus" : "") +
        (cover ? " has-cover" : "")
      }
      onClick={onOpen}
    >
      {/* A thread being built out gets a little identity — a band across the
          top, colour or photo. Threads without one look exactly as they
          always have, so a quiet board stays quiet. */}
      {cover && <CoverBand cover={cover} />}
      <div className="tname">{t.name}</div>
      <div className="tsum">
        {t.summary || (last?.text || "").slice(0, 120) + "…"}
      </div>
      <div className="sed">
        {bars.map((f, i, arr) => (
          <i
            /* The newest bar settles in rather than appearing — a layer of
               sediment landing. Only when this thread just took the capture,
               so the strip is still still on every other render. */
            className={landed && i === arr.length - 1 ? "settling" : undefined}
            key={f.id}
            style={{
              width: Math.min(100, 22 + f.text.length / 7) + "%",
              opacity: 0.2 + (0.75 * (i + 1)) / arr.length,
            }}
          />
        ))}
      </div>
      <div className="act-meta" style={{ marginTop: 9 }}>
        {/* Layers, not fragments: the sediment bars above already say a
            thread accumulates, and this is the line that should agree with
            them. The data model still calls them frags — this is what the
            thread looks like, not what it is stored as. */}
        {t.frags.length} layer{t.frags.length > 1 ? "s" : ""}
        {last ? " · last " + fmt(last.at) : ""}
      </div>
    </button>
  );
}
