"use client";

import { useMemo, useState } from "react";
import { useStoredImage } from "@/hooks/useStoredImage";
import { stamp } from "@/lib/clock";
import { DAY, uid, type Board } from "@/lib/model";
import { ownedFetch } from "@/lib/ownership";
import {
  applyOneLiners, oldPhotos, oneLinerContext, oneLiners, readVerdicts, removePhotos,
  type CleanupChange, type OneLinerProposal,
} from "@/lib/cleanup";
import { applyCombine, combineContext, readCombine, type CombineProposal } from "@/lib/combine";
import styles from "./TidyCleanup.module.css";

type Apply = (change: (board: Board) => CleanupChange | null) => Promise<boolean>;

const AGES = [
  { days: 30, label: "a month", chip: "1 month" },
  { days: 90, label: "3 months", chip: "3 months" },
  { days: 180, label: "6 months", chip: "6 months" },
  { days: 0, label: "any age", chip: "All" },
];
const GRID_MAX = 60;
const KEPT_KEY = "capture:cleanup-kept";
/* The notice with its Undo sits at the top of the screen; bring it into view. */
const showUndo = () => window.scrollTo({ top: 0, behavior: "smooth" });

/* Per-device convenience: a scrap the person (or the model) chose to keep is
   not offered again. Losing it only means one more look, never lost data. */
const COMBINE_KEPT_KEY = "capture:combine-kept";
function readKept(key = KEPT_KEY): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
}
function saveKept(kept: Set<string>, key = KEPT_KEY) {
  try { localStorage.setItem(key, JSON.stringify([...kept].slice(-2000))); } catch { /* per-device only */ }
}

/** POST a rendered board to a Tidy route; the route's own error text on failure. */
async function review(route: string, board: string): Promise<unknown> {
  const res = await ownedFetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ board }),
    cache: "no-store",
  });
  const value: unknown = await res.json().catch(() => null);
  if (res.ok) return value;
  const message = (value as { error?: unknown } | null)?.error;
  throw new Error(typeof message === "string" ? message : "");
}

function Thumb({ id, kept, onToggle }: { id: string; kept: boolean; onToggle: () => void }) {
  const src = useStoredImage(id);
  return (
    <button type="button" className={`${styles.thumb} ${kept ? styles.kept : ""}`} onClick={onToggle}
      aria-pressed={kept} aria-label={kept ? "Kept — tap to remove with the rest" : "Will be removed — tap to keep"}>
      {/* A data: URL from IndexedDB — nothing for next/image to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" /> : <span className={styles.missing} />}
      {kept && <span className={styles.badge}>Keep</span>}
    </button>
  );
}

function Confirm({ title, hint, yes, onYes, onNo }: {
  title: string; hint: string; yes: string; onYes: () => void; onNo: () => void;
}) {
  return (
    <div className="modal" onClick={onNo}>
      <div className="modal-in" onClick={(e) => e.stopPropagation()}>
        <p className="discard-title">{title}</p>
        <p className="discard-hint">{hint}</p>
        <div className="tools">
          <button className="ghost warn" onClick={onYes}>{yes}</button>
          <button className="ghost" onClick={onNo}>Not yet</button>
        </div>
      </div>
    </div>
  );
}

function OldPhotos({ board, now, onApply }: { board: Board; now: number; onApply: Apply }) {
  const [age, setAge] = useState(30);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const any = useMemo(() => oldPhotos(board, Infinity).length, [board]);
  const photos = useMemo(() => oldPhotos(board, age ? now - age * DAY : Infinity), [board, now, age]);
  if (!any) return null;
  const going = photos.filter((p) => !keep.has(p.id)).map((p) => p.id);
  const label = AGES.find((a) => a.days === age)!.label;
  const toggle = (id: string) => setKeep((k) => {
    const next = new Set(k);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <section className={styles.section} aria-label="Old photos">
      <h3 className={styles.title}>Old photos</h3>
      <div className={styles.ages} role="group" aria-label="Older than">
        <span className={styles.agesLabel} aria-hidden="true">Older than</span>
        {AGES.map((a) => (
          <button key={a.days} type="button" aria-pressed={a.days === age}
            className={`${styles.age} ${a.days === age ? styles.on : ""}`} onClick={() => setAge(a.days)}>
            {a.chip}
          </button>
        ))}
      </div>
      {!photos.length ? (
        <p className={styles.hint}>No photos older than {label}.</p>
      ) : (
        <>
          <p className={styles.hint}>
            {photos.length} {photos.length === 1 ? "photo" : "photos"}. Tap any you want to keep; the words they came with always stay.
          </p>
          <div className={styles.grid}>
            {photos.slice(0, GRID_MAX).map((p) => (
              <Thumb key={p.id} id={p.id} kept={keep.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </div>
          {photos.length > GRID_MAX && <p className={styles.hint}>…and {photos.length - GRID_MAX} older ones, removed with the rest.</p>}
          <div className="org-approve">
            <button className="suggest-btn suggest-ok" disabled={!going.length} onClick={() => setConfirm(true)}>
              Remove {going.length} {going.length === 1 ? "photo" : "photos"}
            </button>
          </div>
        </>
      )}
      {confirm && (
        <Confirm
          title={`Remove ${going.length} ${going.length === 1 ? "photo" : "photos"}?`}
          hint="They come off the board and out of this device's storage. The notes they came with stay; a note that was only a photo goes with it. You can Undo right after."
          yes="Remove"
          onNo={() => setConfirm(false)}
          onYes={() => {
            setConfirm(false);
            const ids = going;
            void onApply((b) => removePhotos(b, ids, stamp())).then((ok) => { if (ok) { setKeep(new Set()); showUndo(); } });
          }}
        />
      )}
    </section>
  );
}

function Row({ p, onDo, onKeep }: { p: OneLinerProposal; onDo: () => void; onKeep: () => void }) {
  const text = <em>{p.item.text}</em>;
  const line = p.verdict === "move"
    ? <>{p.item.kind === "action" ? "File" : "Move"} {text} {p.item.kind === "action" ? "into" : "to"} <em>{p.to!.name}</em></>
    : p.item.kind === "action" ? <>Let go of {text}</> : <>Delete {text}</>;
  const verb = p.verdict === "move" ? (p.item.kind === "action" ? "File" : "Move") : p.item.kind === "action" ? "Let go" : "Delete";
  return (
    <div className="org-row">
      <div className="org-body">
        <span className="org-line">{line}</span>
        <span className="org-why">{p.reason}</span>
      </div>
      <div className="org-actions">
        <button className="suggest-btn suggest-ok" onClick={onDo}>{verb}</button>
        <button className="suggest-btn" onClick={onKeep}>Keep</button>
      </div>
    </div>
  );
}

function OneLiners({ board, now, onApply }: { board: Board; now: number; onApply: Apply }) {
  const [kept, setKept] = useState(readKept);
  const [phase, setPhase] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<OneLinerProposal[]>([]);
  const [confirm, setConfirm] = useState(false);
  const candidates = useMemo(() => oneLiners(board, kept), [board, kept]);
  const remember = (keys: string[]) => setKept((k) => {
    const next = new Set([...k, ...keys]);
    saveKept(next);
    return next;
  });
  const drop = (done: OneLinerProposal[]) => setRows((r) => r.filter((x) => !done.includes(x)));

  const run = async () => {
    const ctx = oneLinerContext(board, candidates, now);
    setPhase("reading");
    setError("");
    try {
      const proposals = readVerdicts(await review("/api/cleanup", ctx.text), ctx);
      if (!proposals) throw new Error("");
      /* Everything the model read and did not flag was judged worth keeping;
         the next review moves on to scraps it has not seen. */
      const flagged = new Set(proposals.map((p) => p.item.key));
      remember(Object.values(ctx.items).filter((i) => !flagged.has(i.key)).map((i) => i.key));
      setRows(proposals);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "");
      setPhase("error");
    }
  };
  /* A scrap that was just filed is settled — it is not offered again. */
  const apply = (ps: OneLinerProposal[]) =>
    void onApply((b) => applyOneLiners(b, ps, stamp(), uid)).then((ok) => {
      if (ok) { remember(ps.map((p) => p.item.key)); drop(ps); showUndo(); }
    });

  if (!candidates.length && !rows.length && phase !== "reading") {
    return (
      <section className={styles.section} aria-label="One-liners">
        <h3 className={styles.title}>One-liners</h3>
        <p className={styles.hint}>{phase === "done" ? "Done — every short note left reads as worth keeping." : "No short notes to review."}</p>
      </section>
    );
  }
  return (
    <section className={styles.section} aria-label="One-liners">
      <h3 className={styles.title}>One-liners</h3>
      {phase === "reading" ? (
        <p className={styles.hint} role="status">Reading {candidates.length} short notes against the rest of your board…</p>
      ) : !rows.length ? (
        <>
          <p className={styles.hint} role="status">
            {phase === "error"
              ? `The model didn't answer, so nothing was changed.${error ? ` ${error}` : ""} Try again in a moment.`
              : phase === "done"
                ? "Done — the rest read as worth keeping."
                : `${candidates.length} short notes and tasks. The model checks which are leftover noise or filed in the wrong place — you approve each change.`}
          </p>
          {!!candidates.length && (
            <button className="org-more" onClick={() => void run()}>
              Review {candidates.length} {candidates.length === 1 ? "one-liner" : "one-liners"}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="org-group">
            {rows.map((p) => (
              <Row key={p.item.key} p={p} onDo={() => apply([p])}
                onKeep={() => { remember([p.item.key]); drop([p]); }} />
            ))}
          </div>
          <div className="org-approve">
            <button className="suggest-btn suggest-ok" onClick={() => setConfirm(true)}>Approve all ({rows.length})</button>
          </div>
        </>
      )}
      {confirm && (
        <Confirm
          title={`Apply all ${rows.length}?`}
          hint="Notes are deleted or moved, tasks are let go (they wait in Faded for two weeks) or filed into their thread — in one go, with one Undo."
          yes="Approve all"
          onNo={() => setConfirm(false)}
          onYes={() => { setConfirm(false); apply(rows); }}
        />
      )}
    </section>
  );
}

function SimilarNotes({ board, now, onApply }: { board: Board; now: number; onApply: Apply }) {
  const [phase, setPhase] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<CombineProposal[]>([]);
  const [confirm, setConfirm] = useState(false);
  const ready = useMemo(() => Object.keys(combineContext(board, now).notes).length > 0, [board, now]);
  if (!ready && phase === "idle") return null;
  const drop = (done: CombineProposal[]) => setRows((r) => r.filter((x) => !done.includes(x)));

  const run = async () => {
    const ctx = combineContext(board, now);
    setPhase("reading");
    setError("");
    try {
      const proposals = readCombine(await review("/api/combine", ctx.text), ctx, readKept(COMBINE_KEPT_KEY));
      if (!proposals) throw new Error("");
      setRows(proposals);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "");
      setPhase("error");
    }
  };
  const apply = (ps: CombineProposal[]) =>
    void onApply((b) => applyCombine(b, ps, stamp())).then((ok) => { if (ok) { drop(ps); showUndo(); } });
  const keep = (p: CombineProposal) => {
    saveKept(new Set([...readKept(COMBINE_KEPT_KEY), p.key]), COMBINE_KEPT_KEY);
    drop([p]);
  };

  return (
    <section className={styles.section} aria-label="Similar notes">
      <h3 className={styles.title}>Similar notes</h3>
      {phase === "reading" ? (
        <p className={styles.hint} role="status">Reading your threads for notes that say the same thing…</p>
      ) : !rows.length ? (
        <>
          <p className={styles.hint} role="status">
            {phase === "error"
              ? `The model didn't answer, so nothing was changed.${error ? ` ${error}` : ""} Try again in a moment.`
              : phase === "done"
                ? "No notes worth combining — each one adds something."
                : "Notes in one thread that say the same thing, combined into one in your own words. You see each result before it lands."}
          </p>
          {phase !== "done" && <button className="org-more" onClick={() => void run()}>Find similar notes</button>}
        </>
      ) : (
        <>
          <div className="org-group">
            {rows.map((p) => (
              <div className="org-row" key={p.key}>
                <div className="org-body">
                  <span className="org-line">Combine {p.frags.length} notes in <em>{p.threadName}</em></span>
                  <span className="org-why">{p.reason}</span>
                  <ul className={styles.before} aria-label="Now">
                    {p.frags.map((f) => <li key={f.id}>{f.text}</li>)}
                  </ul>
                  <p className={styles.after}><span>Becomes</span>{p.combined}</p>
                </div>
                <div className="org-actions">
                  <button className="suggest-btn suggest-ok" onClick={() => apply([p])}>Combine</button>
                  <button className="suggest-btn" onClick={() => keep(p)}>Keep apart</button>
                </div>
              </div>
            ))}
          </div>
          <div className="org-approve">
            <button className="suggest-btn suggest-ok" onClick={() => setConfirm(true)}>Combine all ({rows.length})</button>
          </div>
        </>
      )}
      {confirm && (
        <Confirm
          title={`Combine all ${rows.length}?`}
          hint="Each group becomes the one note shown under it, with every photo it had — in one go, with one Undo."
          yes="Combine all"
          onNo={() => setConfirm(false)}
          onYes={() => { setConfirm(false); apply(rows); }}
        />
      )}
    </section>
  );
}

/**
 * Clean up — inside Tidy, under its suggestions. Three explicit jobs the rest
 * of Tidy never does: having the model weed the one-line scraps the sorter
 * left behind, combining notes that say the same thing, and clearing old
 * photos in one batch. Nothing changes without a
 * tap, and every batch has one Undo.
 */
export function TidyCleanup({ board, now, onApply }: { board: Board; now: number; onApply: Apply }) {
  return (
    <div className={styles.cleanup}>
      <OneLiners board={board} now={now} onApply={onApply} />
      <SimilarNotes board={board} now={now} onApply={onApply} />
      <OldPhotos board={board} now={now} onApply={onApply} />
    </div>
  );
}
