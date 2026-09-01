"use client";

/**
 * The thread reading layer — one thread opened, its fragments, and the
 * fragment view — moved out of Capture.tsx as pure composition. Part of
 * the screen-file ratchet program: Capture.tsx keeps orchestration, this
 * keeps the reading experience. No logic changed in the move.
 */

import { useEffect, useRef, useState } from "react";
import { Copy, MoreHorizontal } from "lucide-react";
import { imgLoad, imgNow, imgSave } from "@/lib/imgCache";
import { TONES, TONE_NAMES, imgValue, toneValue } from "@/lib/cover";
import { fmt, uid, type Action, type Frag, type Thread } from "@/lib/model";
import { shrinkFile } from "@/lib/shrink";
import type { DoneItem } from "@/lib/threadActions";
import { ConfirmDelete } from "./ConfirmDelete";

export function ThreadView({
  thread,
  focusFragId,
  onBack,
  onRename,
  onDelete,
  onRefreshSummary,
  onEditFrag,
  onDeleteFrag,
  others,
  onMerge,
  onSetCover,
  onMoveFrag,
  onMoveFragToNew,
  onCopyThread,
  onCopyFrag,
  onExtractAction,
  onAddFragImages,
  onTakeNext,
  onDismissNext,
  fromActions,
  busy,
}: {
  thread: Thread;
  focusFragId?: string | null;
  onBack: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onRefreshSummary: () => void;
  onEditFrag: (fragId: string, text: string) => void;
  onDeleteFrag: (fragId: string) => void;
  others: Thread[];
  onMerge: (fromId: string) => void;
  onSetCover: (cover: string | null) => void;
  onMoveFrag: (fragId: string, toId: string) => void;
  onMoveFragToNew: (fragId: string) => void;
  onCopyThread: () => void;
  onCopyFrag: (fragId: string) => void;
  onExtractAction: (fragId: string) => void;
  onAddFragImages: (fragId: string, files: FileList | null) => void;
  onTakeNext: () => void;
  onDismissNext: () => void;
  /** What this thread gave rise to — shown as one quiet line, and only
      when there is something to show. */
  fromActions: { open: Action[]; done: DoneItem[] };
  busy: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(thread.name);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const coverFile = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  /* The Related line stays collapsed until asked — a quiet affordance,
     never a list sitting in the thread. */

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← all threads
      </button>

      {renaming ? (
        <div className="rename">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Thread name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                onRename(name.trim());
                setRenaming(false);
              }
              if (e.key === "Escape") {
                setName(thread.name);
                setRenaming(false);
              }
            }}
          />
          <button
            className="capture-btn"
            disabled={!name.trim()}
            onClick={() => {
              onRename(name.trim());
              setRenaming(false);
            }}
          >
            Save
          </button>
          <button
            className="ghost"
            onClick={() => {
              setName(thread.name);
              setRenaming(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="tname" style={{ fontSize: 26 }}>
          {thread.name}
        </div>
      )}

      {!renaming && (
        <div style={{ marginBottom: 16 }}>
          <div className="act-meta">
            {/* One tap to the clipboard. The header arrow opens the OS sheet,
                which is the right thing for sending to a person and the wrong
                thing when you only want to paste this into a chat. */}
            <div className="frag-tools">
              <button className="copy-btn" onClick={onCopyThread} aria-label="Copy thread">
                <Copy size={16} strokeWidth={1.6} />
              </button>
              <button
                className={"more-btn" + (more ? " open" : "")}
                onClick={() => {
                  setMore((v) => !v);
                  setMerging(false);
                  setConfirming(false);
                }}
                aria-expanded={more}
                aria-label={more ? "Fewer options" : "More options"}
              >
                <MoreHorizontal size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          {more && (
            <div className="row-actions">
              <button className="ghost" onClick={onRefreshSummary} disabled={busy}>
                Refresh summary
              </button>
              <button className="ghost" onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setPickingCover((v) => !v);
                  setMerging(false);
                  setConfirming(false);
                }}
                aria-expanded={pickingCover}
              >
                Cover
              </button>
              {others.length > 0 && (
                <button
                  className="ghost"
                  onClick={() => {
                    setMerging((v) => !v);
                    setConfirming(false);
                  }}
                >
                  Merge in
                </button>
              )}
              <button
                className="ghost warn"
                onClick={() => {
                  setConfirming((v) => !v);
                  setMerging(false);
                }}
              >
                Delete thread
              </button>
            </div>
          )}
        </div>
      )}

      {pickingCover && (
        <div className="shelf cover-picker">
          <span className="cap-hint" style={{ flex: "1 1 100%" }}>
            A little identity for this thread — a colour, or a picture of your
            own.
          </span>
          {TONE_NAMES.map((t) => (
            <button
              key={t}
              className={
                "tone-swatch" +
                (thread.cover === toneValue(t) ? " on" : "")
              }
              style={{ background: TONES[t] }}
              onClick={() => onSetCover(toneValue(t))}
              aria-label={"Cover: " + t}
              title={t}
            />
          ))}
          <button className="ghost" onClick={() => coverFile.current?.click()}>
            Photo…
          </button>
          {thread.cover && (
            <button className="ghost warn" onClick={() => onSetCover(null)}>
              None
            </button>
          )}
          <input
            ref={coverFile}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              /* Shrunk exactly like a capture photo, stored under the usual
                 image key, so it syncs by the same path as any other picture. */
              void shrinkFile(f)
                .then(async (src) => {
                  const id = uid();
                  await imgSave(id, src);
                  onSetCover(imgValue(id));
                })
                .catch(() => {
                  /* unreadable image — leave the cover as it was */
                });
            }}
          />
        </div>
      )}

      {merging && (
        <div className="picker">
          <p className="picker-hint">
            Pick a thread to fold into <b>{thread.name}</b>. Its fragments join
            this one in date order and the thread itself goes.
          </p>
          {others.map((t) => (
            <button
              key={t.id}
              className="picker-row"
              onClick={() => {
                onMerge(t.id);
                setMerging(false);
              }}
            >
              <span className="picker-name">{t.name}</span>
              <span className="picker-meta">
                {t.frags.length} fragment{t.frags.length > 1 ? "s" : ""}
              </span>
            </button>
          ))}
          <button className="ghost" onClick={() => setMerging(false)}>
            Cancel
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDelete
          title="Delete this thread?"
          hint={
            thread.frags.length
              ? `All ${thread.frags.length} fragment${
                  thread.frags.length > 1 ? "s go" : " goes"
                } with it. This cannot be undone.`
              : "This cannot be undone."
          }
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
        />
      )}

      {thread.summary && (
        <div className="state">
          <h4>Where this stands</h4>
          <p>{thread.summary}</p>
          {/* The move, if the thread has one. One line, one tap: it
              becomes an action through the usual sorter. Waved away, it
              stays away until the summary names a different step. */}
          {thread.next && thread.next !== thread.nextDismissed && (
            <div className="next-step">
              <span className="next-label">Next</span>
              <button
                className="next-take"
                onClick={onTakeNext}
                disabled={busy}
                title="Add this to your actions"
              >
                {thread.next}
              </button>
              <button
                className="next-dismiss"
                onClick={onDismissNext}
                aria-label="Not now"
                title="Not now"
              >
                ×
              </button>
            </div>
          )}
          {/* The actions that belong with this thread — born from it, or
              plainly about it. Same room as the summary and the next step,
              because they are the same kind of fact: where this stands,
              and what is on the list because of it. */}
          {fromActions.open.length > 0 && (
            <div className="state-actions">
              <h4>
                Actions
                {fromActions.done.length > 0 &&
                  ` · ${fromActions.done.length} done`}
              </h4>
              <ul>
                {fromActions.open.map((a) => (
                  <li key={a.id}>
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect
                        x="1.5"
                        y="1.5"
                        width="13"
                        height="13"
                        rx="3.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}


      {[...thread.frags].reverse().map((f) => (
        <FragView
          key={f.id}
          f={f}
          focus={f.id === focusFragId}
          others={others}
          busy={busy}
          onSave={(text) => onEditFrag(f.id, text)}
          onDelete={() => onDeleteFrag(f.id)}
          onMove={(toId) => onMoveFrag(f.id, toId)}
          onMoveToNew={() => onMoveFragToNew(f.id)}
          onCopy={() => onCopyFrag(f.id)}
          onExtract={() => onExtractAction(f.id)}
          onAddImages={(files) => onAddFragImages(f.id, files)}
        />
      ))}
    </div>
  );
}

export function FragView({
  f,
  others,
  focus,
  onSave,
  onDelete,
  onMove,
  onMoveToNew,
  onCopy,
  onExtract,
  onAddImages,
  busy,
}: {
  f: Frag;
  others: Thread[];
  focus?: boolean;
  onSave: (text: string) => void;
  onDelete: () => void;
  onMove: (toId: string) => void;
  onMoveToNew: () => void;
  onCopy: () => void;
  onExtract: () => void;
  onAddImages: (files: FileList | null) => void;
  busy: boolean;
}) {
  const [srcs, setSrcs] = useState<string[]>(() =>
    (f.imgs || []).map((id) => imgNow(id)).filter((v): v is string => !!v)
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(f.text);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [more, setMore] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /* The image-correction scroll must fire once per focus, not on every edit
     save (which hands FragView a fresh `f` and would yank the view). */
  const corrected = useRef(false);

  /* Landed here from a search result: bring the note into view. Respects
     the reduced-motion preference instead of forcing a smooth glide. */
  useEffect(() => {
    if (focus) {
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      root.current?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "center",
      });
    } else {
      corrected.current = false;
    }
  }, [focus]);

  /* Keyed on the image ids, not the frag object: every sync merge rebuilds
     the thread's frag objects, and keying on `f` re-read every image in the
     open thread from IndexedDB on each 10s poll. */
  const imgKey = (f.imgs || []).join(",");
  useEffect(() => {
    (async () => {
      const ids = imgKey ? imgKey.split(",") : [];
      const out = (
        await Promise.all(
          ids.map((id) => imgLoad(id).catch(() => null))
        )
      ).filter((v): v is string => !!v);
      setSrcs(out);
      /* An image above the focused note can land after the first scroll and
         nudge the layout; bring the note back into view once images settle.
         Once per focus only — edits after that must not re-scroll. */
      if (focus && out.length && !corrected.current) {
        corrected.current = true;
        root.current?.scrollIntoView({ behavior: "auto", block: "center" });
      }
    })();
  }, [imgKey, focus]);

  return (
    <div
      className={"frag" + (focus ? " focus" : "")}
      ref={root}
      aria-current={focus ? "true" : undefined}
    >
      <div className="frag-date">
        {fmt(f.at)}
        {f.unsorted && <span className="raw">unsorted</span>}
        {f.resolvedAt && <span className="raw resolved">resolved</span>}
        {!editing && (
          <div className="frag-tools">
            <button className="copy-btn" onClick={onCopy} aria-label="Copy">
              <Copy size={16} strokeWidth={1.6} />
            </button>
            <button
              className={"more-btn" + (more ? " open" : "")}
              onClick={() => {
                setMore((v) => !v);
                setMoving(false);
                setConfirming(false);
              }}
              aria-expanded={more}
              aria-label={more ? "Fewer options" : "More options"}
            >
              <MoreHorizontal size={16} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {more && !editing && (
        <div className="row-actions">
          <button className="ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="ghost" onClick={onExtract} disabled={busy}>
            Make an action
          </button>
          {/* A photo usually turns up after the thought does — a screenshot
              of the bug, the receipt, the whiteboard. Attaching one used to
              be possible only in the second the note was written. */}
          <label className="ghost frag-pic">
            Add an image
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                onAddImages(e.target.files);
                e.target.value = "";
                setMore(false);
              }}
            />
          </label>
          <button
            className="ghost"
            onClick={() => {
              setMoving((v) => !v);
              setConfirming(false);
            }}
          >
            Move
          </button>
          <button
            className="ghost warn"
            onClick={() => {
              setConfirming((v) => !v);
              setMoving(false);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {moving && !editing && (
        <div className="picker">
          <p className="picker-hint">Move this fragment to:</p>
          {/*
            Always offered, not just when there is nowhere else to put it —
            splitting a thread that has drifted into two topics is the common
            case, and it needs a destination that does not exist yet.
          */}
          <button
            className="picker-row picker-new"
            onClick={() => {
              onMoveToNew();
              setMoving(false);
            }}
          >
            <span className="picker-name">＋ A new thread</span>
            <span className="picker-meta">
              named from this fragment, rename it after
            </span>
          </button>
          {others.map((t) => (
            <button
              key={t.id}
              className="picker-row"
              onClick={() => {
                onMove(t.id);
                setMoving(false);
              }}
            >
              <span className="picker-name">{t.name}</span>
              <span className="picker-meta">
                {t.frags.length} fragment{t.frags.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          <button className="ghost" onClick={() => setMoving(false)}>
            Cancel
          </button>
        </div>
      )}

      {editing ? (
        <div className="frag-edit">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Fragment text"
            autoFocus
          />
          <div className="act-meta">
            <button
              className="capture-btn"
              disabled={!draft.trim()}
              onClick={() => {
                onSave(draft.trim());
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              className="ghost"
              onClick={() => {
                setDraft(f.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p>{f.text}</p>
      )}

      {confirming && !editing && (
        <ConfirmDelete
          title="Delete this fragment?"
          confirmLabel="Delete fragment"
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
        />
      )}

      {srcs.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={s} alt="" />
      ))}
    </div>
  );
}
