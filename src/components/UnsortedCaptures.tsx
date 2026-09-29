"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MoreHorizontal } from "lucide-react";
import { RecoveryDisclosure } from "./RecoveryDisclosure";
import type { CaptureEntry } from "@/lib/ledger";
import type { Action, Thread } from "@/lib/model";
import type {
  ManualDestination,
  ManualPendingSnapshot,
} from "@/lib/manualRoutingSettlement";
import type { ManualSplitSegment } from "@/lib/manualSplitSettlement";
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

type UnsortedCapturesProps = {
  items: Action[];
  pendingEntries?: CaptureEntry[];
  busy: boolean;
  finalizingIds?: string[];
  threads?: Thread[];
  onSort: (action: Action) => void | Promise<unknown>;
  onManualSort?: (action: Action, destination: ManualDestination) => void | Promise<unknown>;
  onChoosePlace?: (action: Action, trigger: HTMLButtonElement) => void;
  /** Kept at the component boundary while manual split remains safely hidden. */
  onManualSplit?: (
    action: Action,
    segments: ManualSplitSegment[],
    snapshot: ManualPendingSnapshot,
  ) => boolean | Promise<boolean>;
  onEdit: (id: string, text: string) => boolean | Promise<boolean>;
  onDelete: (action: Action) => boolean | Promise<boolean>;
};

/** Preserved captures waiting for classification, separate from real Actions. */
export function UnsortedCaptures({
  items,
  busy,
  finalizingIds = [],
  onSort,
  onManualSort,
  onChoosePlace,
  onEdit,
  onDelete,
}: UnsortedCapturesProps) {
  const canSort = useSyncExternalStore(subscribeToSortReadiness, canSortNow, () => false);
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;

  return (
    <section className="unsorted-captures" aria-label="Unsorted captures">
      <RecoveryDisclosure label="Unsorted" count={items.length} expanded={expanded}
        controls="unsorted-capture-list" onToggle={() => setExpanded((open) => !open)} />
      {expanded && <div id="unsorted-capture-list" className="unsorted-panel">
        <p className="unsorted-status">Saved. Sort later or choose a place.</p>
        <div className="unsorted-track" role="list" aria-label="Unsorted captures">
          {items.map((item) => <WaitingCapture key={item.id} item={item} busy={busy}
            finalizing={finalizingIds.includes(item.id)} canSort={canSort}
            onSort={onSort} onManualSort={onManualSort} onChoosePlace={onChoosePlace}
            onEdit={onEdit} onDelete={onDelete} />)}
        </div>
      </div>}
    </section>
  );
}

function WaitingCapture({ item, busy, finalizing, canSort, onSort, onManualSort, onChoosePlace, onEdit, onDelete }: {
  item: Action;
  busy: boolean;
  finalizing: boolean;
  canSort: boolean;

  onSort: (action: Action) => void | Promise<unknown>;
  onManualSort?: (action: Action, destination: ManualDestination) => void | Promise<unknown>;
  onChoosePlace?: (action: Action, trigger: HTMLButtonElement) => void;
  onEdit: (id: string, text: string) => boolean | Promise<boolean>;
  onDelete: (action: Action) => boolean | Promise<boolean>;
}) {
  const source = item.src || item.text;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(source);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [sortBusy, setSortBusy] = useState(false);
  const sortInFlight = useRef(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!more) return;
    const dismiss = () => { setMore(false); setConfirmDelete(false); };
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) &&
          !moreRef.current?.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { dismiss(); moreRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [more]);

  useEffect(() => {
    let current = true;
    Promise.all((item.imgs || []).map((id) => get(IMG(id)).catch(() => null)))
      .then((values) => {
        if (current) setImages(values.filter((value): value is string => !!value));
      });
    return () => { current = false; };
  }, [item.imgs]);


  const retry = async () => {
    if (sortInFlight.current) return;
    sortInFlight.current = true;
    setSortBusy(true);
    try {
      await onSort(item);
    } finally {
      sortInFlight.current = false;
      setSortBusy(false);
    }
  };

  const cardBusy = busy || finalizing || sortBusy;

  return (
    <article className="unsorted-card" role="listitem">
      <details open={editing || undefined} className={editing ? "editing" : undefined}>
        <summary>
          <span className="unsorted-preview">{source}</span>
          {!!item.imgs?.length && <span className="unsorted-photo-count">
            {item.imgs.length} {item.imgs.length === 1 ? "photo" : "photos"}
          </span>}
        </summary>
        {editing && <div className="unsorted-edit">
          <textarea aria-label="Edit unsorted capture" value={text}
            onChange={(event) => setText(event.target.value)} />
          <div className="unsorted-actions">
            <button type="button" onClick={() => {
              void Promise.resolve(onEdit(item.id, text)).then((saved) => {
                if (saved) setEditing(false);
              });
            }} disabled={cardBusy || !text.trim()}>Save</button>
            <button className="ghost" type="button" onClick={() => {
              setText(source); setEditing(false);
            }}>Cancel</button>
          </div>
        </div>}
        {!!images.length && <div className="unsorted-images">
          {images.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={item.imgs?.[index] || index} src={src} alt={`Attached capture ${index + 1}`} />
          ))}
        </div>}
      </details>

      {!editing && <>
        <div className="unsorted-card-actions">
          {onManualSort && <button className="unsorted-primary" type="button"
            disabled={finalizing}
            onClick={(event) => {
              setMore(false);
              onChoosePlace?.(item, event.currentTarget);
            }}>Choose a place</button>}
          <button ref={moreRef} className="unsorted-more" type="button" aria-label="More" aria-expanded={more}
            disabled={finalizing} onClick={() => {
              setMore((open) => !open);
              setConfirmDelete(false);
            }}><MoreHorizontal size={18} strokeWidth={1.8} aria-hidden="true" /></button>
        </div>

        {more && <div ref={menuRef} className="unsorted-more-menu" role="group" aria-label="More options">
          {canSort && <button type="button" disabled={cardBusy}
            onClick={() => void retry()}>Sort now</button>}
          <button type="button" disabled={cardBusy} onClick={() => {
            setText(source); setEditing(true); setMore(false);
          }}>Edit</button>
          {confirmDelete ? <>
            <button className="warn" type="button" aria-label="Delete capture" disabled={cardBusy}
              onClick={() => void onDelete(item)}>Delete</button>
            <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </> : <button className="warn" type="button" disabled={cardBusy}
            onClick={() => setConfirmDelete(true)}>Delete</button>}
        </div>}
      </>}
    </article>
  );
}
