"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Action } from "@/lib/model";
import { IMG } from "@/lib/model";
import { getDocumentLifetime } from "@/lib/ownership";
import { get } from "@/lib/storage";

function subscribeToSortReadiness(notify: () => void) {
  const stop = getDocumentLifetime().subscribe(notify);
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    stop();
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

function canSortNow() {
  return navigator.onLine && getDocumentLifetime().snapshot() === "active";
}

/** Preserved captures waiting for classification, separate from real Actions. */
export function UnsortedCaptures({
  items,
  busy,
  onSort,
  onEdit,
  onDelete,
}: {
  items: Action[];
  busy: boolean;
  onSort: (action: Action) => void;
  onEdit: (id: string, text: string) => void | Promise<void>;
  onDelete: (action: Action) => void | Promise<void>;
}) {
  const canSort = useSyncExternalStore(subscribeToSortReadiness, canSortNow, () => false);
  if (!items.length) return null;

  return (
    <section className="unsorted-captures" aria-labelledby="unsorted-captures-title">
      <h2 id="unsorted-captures-title" className="unsorted-title">
        Unsorted <b>{items.length}</b>
      </h2>
      <div className="unsorted-track">
        {items.map((item) => <WaitingCapture key={item.id} item={item} busy={busy}
          canSort={canSort} onSort={onSort} onEdit={onEdit} onDelete={onDelete} />)}
      </div>
    </section>
  );
}

function WaitingCapture({ item, busy, canSort, onSort, onEdit, onDelete }: {
  item: Action;
  busy: boolean;
  canSort: boolean;
  onSort: (action: Action) => void;
  onEdit: (id: string, text: string) => void | Promise<void>;
  onDelete: (action: Action) => void | Promise<void>;
}) {
  const source = item.src || item.text;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(source);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    let current = true;
    Promise.all((item.imgs || []).map((id) => get(IMG(id)).catch(() => null)))
      .then((values) => {
        if (current) setImages(values.filter((value): value is string => !!value));
      });
    return () => { current = false; };
  }, [item.imgs]);

  return (
    <article className="unsorted-card">
      <details className={editing ? "editing" : undefined}>
        <summary>
          <span className="unsorted-preview">{source}</span>
          {!!item.imgs?.length && <span className="unsorted-photo-count">
            {item.imgs.length} {item.imgs.length === 1 ? "photo" : "photos"}
          </span>}
        </summary>
        {editing ? (
          <div className="unsorted-edit">
            <textarea aria-label="Edit unsorted capture" value={text}
              onChange={(event) => setText(event.target.value)} />
            <div className="unsorted-actions">
              <button type="button" onClick={() => {
                void Promise.resolve(onEdit(item.id, text)).then(() => setEditing(false));
              }} disabled={busy || !text.trim()}>Save</button>
              <button className="ghost" type="button" onClick={() => {
                setText(source); setEditing(false);
              }}>Cancel</button>
            </div>
          </div>
        ) : null}
        {!!images.length && <div className="unsorted-images">
          {images.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={item.imgs?.[index] || index} src={src} alt={`Attached capture ${index + 1}`} />
          ))}
        </div>}
        {!editing && <div className="unsorted-detail-actions">
          <button className="ghost" type="button" disabled={busy}
            onClick={() => { setText(source); setEditing(true); }}>Edit</button>
          {confirmDelete ? <>
            <button className="ghost warn" type="button" disabled={busy}
              onClick={() => void onDelete(item)}>Delete</button>
            <button className="ghost" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </> : <button className="ghost warn" type="button" disabled={busy}
            onClick={() => setConfirmDelete(true)}>Delete</button>}
        </div>}
      </details>
      {canSort && <button className="ghost unsorted-sort" type="button" disabled={busy}
        onClick={() => onSort(item)}>Sort now</button>}
    </article>
  );
}
