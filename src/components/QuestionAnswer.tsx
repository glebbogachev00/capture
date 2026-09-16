"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useOwnedState } from "@/hooks/useOwnedState";
import type { Board } from "@/lib/model";
import { getDocumentLifetime, ownedFetch } from "@/lib/ownership";
import { PLAYGROUND } from "@/lib/playground";
import { recallSources, validateRecallAnswer, RECALL_MAX_SOURCES, type RecallAnswer, type RecallSource } from "@/lib/recall";
import styles from "./QuestionAnswer.module.css";

type Props = {
  board: Board;
  question: string;
  onOpenThread: (id: string, fragId?: string | null) => void;
  onOpenIntention: (id: string) => void;
};
type Result = {
  answer: RecallAnswer | null;
  sources: RecallSource[];
  error?: string;
  notice?: string;
  busy?: boolean;
};
type PendingRequest = {
  controller: AbortController;
  sources: RecallSource[];
  timer?: ReturnType<typeof setTimeout>;
};

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}
const onlineSnapshot = () => navigator.onLine;

/** A disclosure boundary, separate from Search's existing exact results. */
export function QuestionAnswer(props: Props) {
  const [lifetime] = useState(getDocumentLifetime);
  const status = useSyncExternalStore(lifetime.subscribe, lifetime.snapshot, lifetime.snapshot);
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
  // Reset during render, not a passive effect: old results must never paint on
  // a replacement board/query. A return to a previous query is a new session.
  const [scope, setScope] = useState({ board: props.board, question: props.question, version: 0 });
  if (scope.board !== props.board || scope.question !== props.question) {
    setScope({ board: props.board, question: props.question, version: scope.version + 1 });
  }
  if (PLAYGROUND) return null;
  if (lifetime.cloud && !lifetime.owner) return <p className={styles.notice}>Sign in to answer from your captures.</p>;
  if (status !== "active" || !lifetime.active || !online) {
    return <p className={styles.notice}>Go online and verify your account to answer from your captures.</p>;
  }
  // Hiding also unmounts sensitive state; reconnecting never resurrects it.
  return <AnswerSession key={scope.version} {...props} />;
}

function AnswerSession({ board, question, onOpenThread, onOpenIntention }: Props) {
  const { lifetime, data: result, setData: setResult } = useOwnedState<Result | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  useLayoutEffect(() => () => {
    const request = pending.current;
    pending.current = null;
    if (request) {
      clearTimeout(request.timer);
      request.controller.abort();
    }
  }, []);

  const canDisclose = () => {
    if (PLAYGROUND || !navigator.onLine || (lifetime.cloud && !lifetime.owner)) return false;
    try { lifetime.assertOnline(); return true; } catch { return false; }
  };
  const guardDisclosure = (event: MouseEvent<HTMLElement>) => {
    if (!canDisclose()) event.preventDefault();
  };
  const cancel = () => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    clearTimeout(request.timer);
    request.controller.abort();
    setResult({ answer: null, sources: request.sources, notice: "Answer cancelled. Your notes are unchanged." });
  };
  const validQuestion = question.trim().length >= 3 && question.length <= 500;
  const answer = async () => {
    if (pending.current || !validQuestion || !canDisclose()) return;
    // This is deliberately inside the click handler, never render/useMemo.
    const sources = recallSources(board, question);
    if (!sources.length) { setResult({ answer: null, sources }); return; }
    const request: PendingRequest = { controller: new AbortController(), sources };
    pending.current = request;
    // One deadline covers headers AND body. Aborting alone cannot settle an
    // uncooperative transport; retiring this identity also prevents late writes.
    request.timer = setTimeout(() => {
      if (pending.current !== request) return;
      pending.current = null;
      request.controller.abort();
      setResult({ answer: null, sources, error: "The answer timed out after 45 seconds. Try again; your notes are unchanged." });
    }, 45_000);
    setResult({ answer: null, sources, busy: true });
    try {
      const response = await ownedFetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sources }),
        signal: request.controller.signal,
        cache: "no-store",
      });
      if (pending.current !== request) return;
      lifetime.assertOnline();
      if (!response.ok) throw new Error("Request failed");
      const value: unknown = await response.json();
      if (pending.current !== request) return;
      lifetime.assertOnline();
      const validated = validateRecallAnswer(value, sources);
      if (!validated) {
        setResult({ answer: null, sources, error: "Could not verify the answer against the submitted notes. Try again." });
        return;
      }
      setResult({ answer: validated, sources });
    } catch {
      if (pending.current === request) {
        setResult({ answer: null, sources, error: "Could not get an answer. Try again; your notes are unchanged." });
      }
    } finally {
      clearTimeout(request.timer);
      if (pending.current === request) pending.current = null;
    }
  };

  // Identity, label, date and state all come from the submitted local snapshot,
  // never model-supplied navigation or HTML. Validation accepts no unknown IDs.
  const sourceView = (source: RecallSource, quote: string, evidence = false) => {
    const date = new Date(source.at);
    return <div className={styles.source}>
      <div className={styles.sourceMeta}>
        <span className={styles.sourceTitle}>{source.title}</span>
        {Number.isNaN(date.getTime()) ? <span>Date unavailable</span> : <time dateTime={date.toISOString()}>
          {date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </time>}
        <span aria-hidden="true">·</span><span>{source.state}</span>
      </div>
      <blockquote className={styles.quote}>{quote}</blockquote>
      {source.truncated && <p className={styles.notice}>Excerpt truncated. Only this excerpt was sent.</p>}
      {source.kind === "thread" && <button type="button" className={styles.sourceButton}
        onClick={() => { if (canDisclose()) onOpenThread(source.targetId, source.fragId); }}
        aria-label={`Open thread: ${source.title}`}>Open thread</button>}
      {source.kind === "intention" && <button type="button" className={styles.sourceButton}
        onClick={() => { if (canDisclose()) onOpenIntention(source.targetId); }}
        aria-label={`Open intention: ${source.title}`}>Open intention</button>}
      {source.kind === "action" && !evidence && <details className={styles.disclosure}>
        <summary onClick={guardDisclosure}>Show action source</summary><p className={styles.quote}>{source.text}</p>
      </details>}
    </div>;
  };

  return <section className={styles.panel} aria-label="Answer from captures">
    <div className={styles.controls}>
      <button type="button" className={styles.ask} onClick={answer} disabled={!validQuestion || result?.busy}>Answer from my captures</button>
      {result?.busy && <button type="button" className={styles.cancel} onClick={cancel}>Cancel answer</button>}
    </div>
    <p className={styles.notice}>Sends up to {RECALL_MAX_SOURCES} matching notes to your configured AI. Your notes stay unchanged.</p>
    {!validQuestion && <p className={styles.notice}>Use 3–500 characters for a question.</p>}
    {result && !result.sources.length && <p role="status" className={styles.message}>No matching evidence for this question. Try more specific words from your captures.</p>}
    {result && !!result.sources.length && <div className={styles.result}>
      {result.busy && <p className={styles.notice} role="status">Answering from matching notes…</p>}
      {result.notice && <p className={styles.message} role="status">{result.notice}</p>}
      {result.error && <p className={styles.message} role="alert">{result.error}</p>}
      {result.answer && <h3 className={styles.heading}>Answer from your captures</h3>}
      <p className={styles.notice}>Based on a matching subset, not your entire board. Compare the dates and states below.</p>
      {result.answer?.status === "insufficient" && <p className={styles.message}>Not enough evidence in these matching notes to answer.</p>}
      {result.answer?.claims.map((claim, i) => <div className={styles.claim} key={i}>
        <p className={styles.claimText}>{claim.text}</p>
        {claim.citations.map((citation, j) => {
          const source = result.sources.find(source => source.id === citation.sourceId);
          return source && <div key={j}>{sourceView(source, citation.quote)}</div>;
        })}
      </div>)}
      <details className={styles.disclosure}>
        <summary onClick={guardDisclosure}>Show submitted evidence ({result.sources.length})</summary>
        {result.sources.map(source => <div key={source.id}>{sourceView(source, source.text, true)}</div>)}
      </details>
    </div>}
  </section>;
}
