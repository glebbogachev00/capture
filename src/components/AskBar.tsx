"use client";

import { useEffect, useRef } from "react";
import { useOwnedState } from "@/hooks/useOwnedState";
import type { Board } from "@/lib/model";
import { getDocumentLifetime, ownedFetch } from "@/lib/ownership";
import { answerBlocks, askContext, readAnswer, type AskResult, type Span } from "@/lib/ask";
import styles from "./Ask.module.css";

type Asked = {
  question: string;
  phase: "loading" | "done" | "error";
  result?: AskResult;
  omitted?: number;
  error?: string;
};

type Props = {
  board: Board;
  now: number;
  query: string;
  onQuery: (next: string) => void;
  onOpenThread: (id: string) => void;
  onOpenIntention: (id: string) => void;
  onOpenActions: () => void;
  /** Whether an answer is showing (or on its way) for the current query. */
  onAnswering: (answering: boolean) => void;
};

const Text = ({ spans }: { spans: Span[] }) =>
  <>{spans.map((s, i) => s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>)}</>;

/**
 * The search box, and the question it can be asked.
 *
 * Typing searches locally, instantly, as it always has. Asking is a
 * separate, explicit step — the Ask button or Enter — because it sends the
 * board to the model, and that should never happen on a keystroke.
 */
export function AskBar({ board, now, query, onQuery, onOpenThread, onOpenIntention, onOpenActions, onAnswering }: Props) {
  const { data: asked, setData: setAsked } = useOwnedState<Asked | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const current = asked && asked.question === query.trim() ? asked : null;
  const answering = !!current;
  useEffect(() => { onAnswering(answering); }, [answering, onAnswering]);
  useEffect(() => () => inflight.current?.abort(), []);

  const ask = async () => {
    const question = query.trim();
    if (question.length < 2 || (current && current.phase !== "error")) return;
    inflight.current?.abort();
    const lifetime = getDocumentLifetime();
    try {
      if (!navigator.onLine || (lifetime.cloud && !lifetime.owner)) throw new Error("offline");
      lifetime.assertOnline();
    } catch {
      setAsked({ question, phase: "error", error: "Ask needs the model, and it can't be reached right now. Search still works." });
      return;
    }
    const context = askContext(board, now);
    const controller = new AbortController();
    inflight.current = controller;
    setAsked({ question, phase: "loading" });
    try {
      const response = await ownedFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, board: context.text }),
        signal: controller.signal,
        cache: "no-store",
      });
      const value: unknown = await response.json().catch(() => null);
      if (inflight.current !== controller) return;
      if (!response.ok) {
        const message = (value as { error?: unknown } | null)?.error;
        throw new Error(typeof message === "string" ? message : "");
      }
      const result = readAnswer(value, context.refs);
      if (!result) throw new Error("");
      setAsked({ question, phase: "done", result, omitted: context.omitted });
    } catch (error) {
      if (inflight.current !== controller || controller.signal.aborted) return;
      const message = error instanceof Error && error.message ? ` ${error.message}` : "";
      setAsked({ question, phase: "error", error: `Couldn't get an answer.${message} Your notes are unchanged — try again.` });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  };

  const clear = () => {
    inflight.current?.abort();
    inflight.current = null;
    setAsked(null);
    onQuery("");
  };
  const result = current?.phase === "done" ? current.result : undefined;

  return <>
    <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search, or ask your board a question"
        aria-label="Search, or ask your board a question"
        enterKeyHint="send"
      />
      {query.trim().length >= 2 && (
        <button type="submit" className="ghost" disabled={current?.phase === "loading"}>Ask</button>
      )}
      {!!query && <button type="button" className="ghost" onClick={clear}>Clear</button>}
    </form>

    <p role="status" aria-live="polite" className={styles.visuallyHidden}>
      {current?.phase === "loading" ? "Reading your board…" : result ? "Answer ready." : ""}
    </p>
    {current?.phase === "loading" && (
      <div className={styles.loading} data-testid="answer-loading" aria-hidden="true">
        <div className={styles.loadingDots}><span /><span /><span /></div>
        <p>Reading your board…</p>
      </div>
    )}
    {current?.phase === "error" && <p className={styles.error} role="alert">{current.error}</p>}
    {result && (
      <section className={styles.panel} aria-label="Answer">
        <h3 className={styles.heading}>{result.found ? "From your board" : "Not on your board"}</h3>
        <div className={styles.body}>
          {answerBlocks(result.answer).map((block, i) =>
            block.type === "p" ? <p key={i}><Text spans={block.spans} /></p>
              : block.type === "ul" ? <ul key={i}>{block.items.map((item, j) => <li key={j}><Text spans={item} /></li>)}</ul>
                : <ol key={i}>{block.items.map((item, j) => <li key={j}><Text spans={item} /></li>)}</ol>
          )}
        </div>
        {!!result.refs.length && (
          <div className={styles.connections} aria-label="Drawn from">
            {result.refs.map((ref) => (
              <button type="button" key={`${ref.kind}:${ref.id}`} className={styles.sourceButton}
                aria-label={`Open ${ref.kind}: ${ref.name}`}
                onClick={() => ref.kind === "thread" ? onOpenThread(ref.id)
                  : ref.kind === "intention" ? onOpenIntention(ref.id) : onOpenActions()}>
                {ref.name.length > 48 ? ref.name.slice(0, 47).trimEnd() + "…" : ref.name}
              </button>
            ))}
          </div>
        )}
        {!!current?.omitted && (
          <p className={styles.note}>Your board is large, so its {current.omitted} oldest notes were summarised rather than read.</p>
        )}
      </section>
    )}
  </>;
}
