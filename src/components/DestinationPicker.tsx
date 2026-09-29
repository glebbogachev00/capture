"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Action, Thread } from "@/lib/model";
import type { ManualDestination } from "@/lib/manualRoutingSettlement";

const MAX_THREAD_NAME = 100;

/** Placement state lives above every screen, never inside a recovery card. */
export function useDestinationPicker(threads: Thread[], finalizingIds: string[],
  onChoose: (capture: Action, destination: ManualDestination) => Promise<boolean>) {
  const [selection, setSelection] = useState<{ capture: Action; trigger: HTMLButtonElement } | null>(null);
  const openPlacePicker = (capture: Action, trigger: HTMLButtonElement) => setSelection({ capture, trigger });
  const picker = selection && <DestinationPicker capture={selection.capture} threads={threads}
    busy={finalizingIds.includes(selection.capture.id)} returnFocus={selection.trigger}
    onClose={() => setSelection(null)} onChoose={(destination) => {
      setSelection(null);
      return onChoose(selection.capture, destination);
    }} />;
  return { openPlacePicker, picker };
}

function boundedThreadName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_THREAD_NAME).trim();
}

function threadRecency(thread: Thread) {
  return thread.updatedAt ?? thread.frags.reduce((latest, frag) =>
    Math.max(latest, frag.updatedAt ?? frag.at), 0
  );
}

export function DestinationPicker({
  capture,
  threads,
  busy = false,
  onChoose,
  onClose,
  returnFocus,
}: {
  capture: Action;
  threads: Thread[];
  busy?: boolean;
  onChoose: (destination: ManualDestination) => void | Promise<unknown>;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `destination-picker-title-${capture.id}`;
  const previewId = `destination-picker-preview-${capture.id}`;
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const priorOverflow = document.body.style.overflow;
    const background = [...document.body.children].filter((node) =>
      node !== dialogRef.current?.parentElement && !node.hasAttribute("inert")
    );
    background.forEach((node) => node.setAttribute("inert", ""));
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = priorOverflow;
      background.forEach((node) => node.removeAttribute("inert"));
      document.removeEventListener("keydown", escape);
      returnFocus?.focus();
    };
  }, [returnFocus]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  const normalized = query.trim().toLocaleLowerCase();
  const visibleThreads = useMemo(() => [...threads]
    .sort((left, right) => threadRecency(right) - threadRecency(left))
    .filter((thread) => thread.name.toLocaleLowerCase().includes(normalized))
    .slice(0, normalized ? 8 : 5), [normalized, threads]);

  const choose = (destination: ManualDestination) => {
    if (!busy) void onChoose(destination);
  };
  const createThread = () => {
    const proposed = boundedThreadName(query);
    if (!proposed) {
      setNaming(true);
      return;
    }
    choose({ kind: "thread", threadId: null, threadName: proposed });
  };
  const confirmName = () => {
    const proposed = boundedThreadName(name);
    if (proposed) choose({ kind: "thread", threadId: null, threadName: proposed });
  };

  const layer = <div className="destination-picker-layer">
    <button data-testid="destination-picker-scrim" className="destination-picker-scrim"
      type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} />
    <section ref={dialogRef} className="destination-picker" role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={previewId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled)',
        ) ?? [])];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}>
      <header className="destination-picker-header">
        <div>
          <h2 id={titleId}>Choose a place</h2>
          <p id={previewId}>{capture.src || capture.text}</p>
        </div>
        <button className="destination-picker-close" type="button"
          aria-label="Close destination picker" onClick={onClose}>
          <X size={19} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      <div className="destination-picker-sticky">
        <input ref={searchRef} type="search" aria-label="Find a thread"
          placeholder="Find a thread" value={query}
          onChange={(event) => { setQuery(event.target.value); setNaming(false); }} />
      </div>
      <div className="destination-picker-results">
        <section aria-labelledby={`${titleId}-quick`}>
          <h3 id={`${titleId}-quick`}>Quick destinations</h3>
          <div className="destination-picker-quick">
            <button type="button" disabled={busy} onClick={() => choose({ kind: "action" })}>Action</button>
            <button type="button" disabled={busy} onClick={() => choose({ kind: "intention" })}>Intention</button>
          </div>
        </section>
        <section className="destination-picker-create" aria-label="Create a Thread">
          <button type="button" disabled={busy} onClick={createThread}>Create new thread</button>
          {naming && <div className="destination-picker-name">
            <label htmlFor={`${titleId}-name`}>Thread name</label>
            <div>
              <input ref={nameRef} id={`${titleId}-name`} value={name} maxLength={MAX_THREAD_NAME}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") confirmName(); }} />
              <button type="button" disabled={busy || !boundedThreadName(name)} onClick={confirmName}>Create Thread</button>
            </div>
          </div>}
        </section>
        <section aria-labelledby={`${titleId}-threads`}>
          <h3 id={`${titleId}-threads`}>{normalized ? "Matching threads" : "Recent threads"}</h3>
          <div className="destination-picker-threads">
            {visibleThreads.map((thread) => <button type="button" key={thread.id} disabled={busy}
              onClick={() => choose({ kind: "thread", threadId: thread.id })}>{thread.name}</button>)}
            {!visibleThreads.length && <p>No matching threads.</p>}
          </div>
        </section>
      </div>
    </section>
  </div>;

  return typeof document === "undefined" ? null : createPortal(layer, document.body);
}
