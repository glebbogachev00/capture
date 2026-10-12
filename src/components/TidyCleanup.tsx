"use client";

import { countOf, t } from "@/lib/i18n";
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

/* A function, so the words are in the reader's language when shown. */
const ages = () => [
  { days: 30, label: t("a month"), chip: t("1 month") },
  { days: 90, label: t("3 months"), chip: t("3 months") },
  { days: 180, label: t("6 months"), chip: t("6 months") },
  { days: 0, label: t("any age"), chip: t("All") },
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
      aria-pressed={kept} aria-label={kept ? t("Kept — tap to remove with the rest") : t("Will be removed — tap to keep")}>
      {/* A data: URL from IndexedDB — nothing for next/image to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" /> : <span className={styles.missing} />}
      {kept && <span className={styles.badge}>{t("Keep")}</span>}
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
          <button className="ghost" onClick={onNo}>{t("Not yet")}</button>
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
  const label = ages().find((a) => a.days === age)!.label;
  const toggle = (id: string) => setKeep((k) => {
    const next = new Set(k);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <section className={styles.section} aria-label={t("Old photos")}>
      <h3 className={styles.title}>{t("Old photos")}</h3>
      <div className={styles.ages} role="group" aria-label={t("Older than")}>
        <span className={styles.agesLabel} aria-hidden="true">{t("Older than")}</span>
        {ages().map((a) => (
          <button key={a.days} type="button" aria-pressed={a.days === age}
            className={`${styles.age} ${a.days === age ? styles.on : ""}`} onClick={() => setAge(a.days)}>
            {a.chip}
          </button>
        ))}
      </div>
      {!photos.length ? (
        <p className={styles.hint}>{t("No photos older than {age}.", { age: label })}</p>
      ) : (
        <>
          <p className={styles.hint}>
            {t("{count}. Tap any you want to keep; the words they came with always stay.", { count: countOf(photos.length, ["photo", "photos"], ["фото", "фото", "фото"]) })}
          </p>
          <div className={styles.grid}>
            {photos.slice(0, GRID_MAX).map((p) => (
              <Thumb key={p.id} id={p.id} kept={keep.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </div>
          {photos.length > GRID_MAX && <p className={styles.hint}>{t("…and {count} older ones, removed with the rest.", { count: photos.length - GRID_MAX })}</p>}
          <div className="org-approve">
            <button className="suggest-btn suggest-ok" disabled={!going.length} onClick={() => setConfirm(true)}>
              {t("Remove {count}", { count: countOf(going.length, ["photo", "photos"], ["фото", "фото", "фото"]) })}
            </button>
          </div>
        </>
      )}
      {confirm && (
        <Confirm
          title={t("Remove {count}?", { count: countOf(going.length, ["photo", "photos"], ["фото", "фото", "фото"]) })}
          hint={t("They come off the board and out of this device's storage. The notes they came with stay; a note that was only a photo goes with it. You can Undo right after.")}
          yes={t("Remove")}
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
  const to = <em>{p.to?.name}</em>;
  const line = p.verdict === "move"
    ? (p.item.kind === "action" ? <>{t("File")} {text} {t("into")} {to}</> : <>{t("Move")} {text} {t("to")} {to}</>)
    : p.item.kind === "action" ? <>{t("Let go of")} {text}</> : <>{t("Delete")} {text}</>;
  const verb = p.verdict === "move" ? (p.item.kind === "action" ? t("File") : t("Move")) : p.item.kind === "action" ? t("Let go") : t("Delete");
  return (
    <div className="org-row">
      <div className="org-body">
        <span className="org-line">{line}</span>
        <span className="org-why">{p.reason}</span>
      </div>
      <div className="org-actions">
        <button className="suggest-btn suggest-ok" onClick={onDo}>{verb}</button>
        <button className="suggest-btn" onClick={onKeep}>{t("Keep")}</button>
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
      <section className={styles.section} aria-label={t("One-liners")}>
        <h3 className={styles.title}>{t("One-liners")}</h3>
        <p className={styles.hint}>{phase === "done" ? t("Done — every short note left reads as worth keeping.") : t("No short notes to review.")}</p>
      </section>
    );
  }
  return (
    <section className={styles.section} aria-label={t("One-liners")}>
      <h3 className={styles.title}>{t("One-liners")}</h3>
      {phase === "reading" ? (
        <p className={styles.hint} role="status">{t("Reading {count} against the rest of your board…", { count: countOf(candidates.length, ["short note", "short notes"], ["короткую заметку", "короткие заметки", "коротких заметок"]) })}</p>
      ) : !rows.length ? (
        <>
          <p className={styles.hint} role="status">
            {phase === "error"
              ? t("The model didn't answer, so nothing was changed.{error} Try again in a moment.", { error: error ? ` ${error}` : "" })
              : phase === "done"
                ? t("Done — the rest read as worth keeping.")
                : t("{count} and tasks. The model checks which are leftover noise or filed in the wrong place — you approve each change.", { count: countOf(candidates.length, ["short note", "short notes"], ["короткая заметка", "короткие заметки", "коротких заметок"]) })}
          </p>
          {!!candidates.length && (
            <button className="org-more" onClick={() => void run()}>
              {t("Review {count}", { count: countOf(candidates.length, ["one-liner", "one-liners"], ["короткую заметку", "короткие заметки", "коротких заметок"]) })}
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
            <button className="suggest-btn suggest-ok" onClick={() => setConfirm(true)}>{t("Approve all ({count})", { count: rows.length })}</button>
          </div>
        </>
      )}
      {confirm && (
        <Confirm
          title={t("Apply all {count}?", { count: rows.length })}
          hint={t("Notes are deleted or moved, tasks are let go (they wait in Faded for two weeks) or filed into their thread — in one go, with one Undo.")}
          yes={t("Approve all")}
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
    <section className={styles.section} aria-label={t("Similar notes")}>
      <h3 className={styles.title}>{t("Similar notes")}</h3>
      {phase === "reading" ? (
        <p className={styles.hint} role="status">{t("Reading your threads for notes that say the same thing…")}</p>
      ) : !rows.length ? (
        <>
          <p className={styles.hint} role="status">
            {phase === "error"
              ? t("The model didn't answer, so nothing was changed.{error} Try again in a moment.", { error: error ? ` ${error}` : "" })
              : phase === "done"
                ? t("No notes worth combining — each one adds something.")
                : t("Notes in one thread that say the same thing, combined into one in your own words. You see each result before it lands.")}
          </p>
          {phase !== "done" && <button className="org-more" onClick={() => void run()}>{t("Find similar notes")}</button>}
        </>
      ) : (
        <>
          <div className="org-group">
            {rows.map((p) => (
              <div className="org-row" key={p.key}>
                <div className="org-body">
                  <span className="org-line">{t("Combine {count} in", { count: countOf(p.frags.length, ["note", "notes"], ["заметку", "заметки", "заметок"]) })} <em>{p.threadName}</em></span>
                  <span className="org-why">{p.reason}</span>
                  <ul className={styles.before} aria-label={t("Now")}>
                    {p.frags.map((f) => <li key={f.id}>{f.text}</li>)}
                  </ul>
                  <p className={styles.after}><span>{t("Becomes")}</span>{p.combined}</p>
                </div>
                <div className="org-actions">
                  <button className="suggest-btn suggest-ok" onClick={() => apply([p])}>{t("Combine")}</button>
                  <button className="suggest-btn" onClick={() => keep(p)}>{t("Keep apart")}</button>
                </div>
              </div>
            ))}
          </div>
          <div className="org-approve">
            <button className="suggest-btn suggest-ok" onClick={() => setConfirm(true)}>{t("Combine all ({count})", { count: rows.length })}</button>
          </div>
        </>
      )}
      {confirm && (
        <Confirm
          title={t("Combine all {count}?", { count: rows.length })}
          hint={t("Each group becomes the one note shown under it, with every photo it had — in one go, with one Undo.")}
          yes={t("Combine all")}
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
