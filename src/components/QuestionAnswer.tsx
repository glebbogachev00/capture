"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useOwnedState } from "@/hooks/useOwnedState";
import type { Board } from "@/lib/model";
import { getDocumentLifetime, ownedFetch } from "@/lib/ownership";
import {
  isLikelyRecallQuestion,
  recallRequestFingerprint,
  recallRetrievalFingerprint,
  recallSources,
  recallSourcesForThreads,
  recallTopics,
  validateRecallSelection,
  validateRecallAnswer,
  type RecallAnswer,
  type RecallSource,
  type RecallTopic,
} from "@/lib/recall";
import styles from "./QuestionAnswer.module.css";

type Props = {
  board: Board;
  question: string;
  onOpenThread: (id: string, fragId?: string | null) => void;
  onOpenIntention: (id: string) => void;
  session?: QuestionAnswerSession;
  onProgress?: (progress: AnswerProgress) => void;
};
export type AnswerProgress = { question: string; phase: "inactive" | "loading" | "settled" };
export type QuestionAnswerSession = {
  retrievalAttempted: Map<string, number>;
  attempted: Map<string, number>;
  successful: Set<string>;
  answers: Map<string, CachedAnswer>;
  selections: Map<string, string[]>;
  revision: number;
};
export const createQuestionAnswerSession = (): QuestionAnswerSession => ({
  retrievalAttempted: new Map(), attempted: new Map(), successful: new Set(),
  answers: new Map(), selections: new Map(), revision: 0,
});
type Result = {
  answer: RecallAnswer | null;
  sources: RecallSource[];
  error?: string;
  busy?: boolean;
};
type CachedAnswer = { answer: RecallAnswer; sources: RecallSource[] };
type PreparedRequest = {
  retrievalFingerprint: string;
  answerFingerprint: string | null;
  snapshotFingerprint: string;
  selectionKnown: boolean;
  question: string;
  sources: RecallSource[];
  topics: RecallTopic[];
};
type PendingRequest = PreparedRequest & {
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};
type SessionProps = Props & {
  readinessRevision: number;
  attemptRevision: number;
  retrievalAttempted: Map<string, number>;
  attempted: Map<string, number>;
  successful: Set<string>;
  answers: Map<string, CachedAnswer>;
  selections: Map<string, string[]>;
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
const ANSWER_DEBOUNCE_MS = 600;

function prepareRequest(
  board: Board,
  question: string,
  selections: Map<string, string[]>,
): PreparedRequest {
  let sources = recallSources(board, question);
  const topics = sources.length ? [] : recallTopics(board);
  const retrievalFingerprint = recallRetrievalFingerprint(question, sources, topics);
  const selectionKnown = !sources.length && selections.has(retrievalFingerprint);
  if (selectionKnown) {
    sources = recallSourcesForThreads(board, selections.get(retrievalFingerprint)!, question);
  }
  const answerFingerprint = sources.length || selectionKnown
    ? recallRequestFingerprint(question, sources)
    : null;
  return {
    retrievalFingerprint,
    answerFingerprint,
    snapshotFingerprint: answerFingerprint ?? retrievalFingerprint,
    selectionKnown,
    question,
    sources,
    topics,
  };
}

/** Automatic cited answers, separate from Search's existing exact results. */
export function QuestionAnswer(props: Props) {
  const [lifetime] = useState(getDocumentLifetime);
  const status = useSyncExternalStore(lifetime.subscribe, lifetime.snapshot, lifetime.snapshot);
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
  const [localRetrievalAttempted] = useState(() => new Map<string, number>());
  const [localAttempted] = useState(() => new Map<string, number>());
  const [localSuccessful] = useState(() => new Set<string>());
  const [localAnswers] = useState(() => new Map<string, CachedAnswer>());
  const [localSelections] = useState(() => new Map<string, string[]>());
  const [questionVisit, setQuestionVisit] = useState({ question: props.question, revision: 0 });
  if (questionVisit.question !== props.question) {
    setQuestionVisit({ question: props.question, revision: questionVisit.revision + 1 });
  }
  const retrievalAttempted = props.session?.retrievalAttempted ?? localRetrievalAttempted;
  const attempted = props.session?.attempted ?? localAttempted;
  const successful = props.session?.successful ?? localSuccessful;
  const answers = props.session?.answers ?? localAnswers;
  const selections = props.session?.selections ?? localSelections;
  const attemptRevision = props.session?.revision ?? questionVisit.revision;
  // OwnershipLifetime intentionally keeps the same public snapshot during a
  // routine same-owner poll. Subscribe separately so a prepared answer wakes
  // when that poll becomes ready instead of losing its one debounce attempt.
  const [readinessRevision, setReadinessRevision] = useState(0);
  useEffect(() => lifetime.subscribe(() => setReadinessRevision((value) => value + 1)), [lifetime]);

  const progress = props.onProgress;
  const progressQuestion = props.question;
  const active = isLikelyRecallQuestion(props.question) && !(lifetime.cloud && !lifetime.owner) &&
    status === "active" && lifetime.active && online;
  useEffect(() => {
    progress?.({ question: progressQuestion, phase: active ? "loading" : "inactive" });
  }, [active, progress, progressQuestion]);
  if (!active) return null;
  // The outer component survives readiness changes. A transmitted fingerprint
  // gets one attempt per deliberate query visit, while successful fingerprints
  // remain deduplicated for the document lifetime.
  return <AnswerSession key={props.question} {...props}
    readinessRevision={readinessRevision} attemptRevision={attemptRevision}
    retrievalAttempted={retrievalAttempted} attempted={attempted}
    successful={successful} answers={answers} selections={selections} />;
}

function AnswerSession({ board, question, onOpenThread, onOpenIntention, readinessRevision,
  attemptRevision, retrievalAttempted, attempted, successful, answers, selections,
  onProgress }: SessionProps) {
  const { lifetime, data: result, setData: setResult } = useOwnedState<Result | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  const currentFingerprint = useRef<string | null>(null);
  const boardRef = useRef(board);
  const previousBoard = useRef(board);
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  useEffect(() => {
    onProgress?.({ question, phase: !result || result.busy ? "loading" : "settled" });
  }, [onProgress, question, result]);

  const retire = useCallback(() => {
    const request = pending.current;
    pending.current = null;
    if (request) {
      clearTimeout(request.timer);
      request.controller.abort();
    }
  }, []);
  useLayoutEffect(() => () => retire(), [retire]);

  const canDisclose = useCallback(() => {
    if (!navigator.onLine || (lifetime.cloud && !lifetime.owner)) return false;
    try { lifetime.assertOnline(); return true; } catch { return false; }
  }, [lifetime]);

  // A new board object is common during sync. Only a changed bounded source
  // snapshot retires the answer; presentation/profile/other-note changes do not.
  // Layout timing prevents a response for changed evidence from painting once.
  useLayoutEffect(() => {
    boardRef.current = board;
    if (previousBoard.current === board) return;
    previousBoard.current = board;
    if (!currentFingerprint.current) return;
    const next = prepareRequest(board, question, selections);
    if (next.snapshotFingerprint === currentFingerprint.current) return;
    retire();
    currentFingerprint.current = null;
    setPrepared(null);
    setResult(null);
    setSourceRevision((value) => value + 1);
  }, [board, question, retire, selections, setResult]);

  // Retrieval starts only after typing has stabilized. The board ref makes this
  // timer independent of unrelated board identity churn during those 600ms.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = prepareRequest(boardRef.current, question, selections);
      currentFingerprint.current = next.snapshotFingerprint;
      const cached = next.answerFingerprint ? answers.get(next.answerFingerprint) : undefined;
      if (cached) {
        setResult(cached);
        return;
      }
      if (next.answerFingerprint &&
          (successful.has(next.answerFingerprint) || attempted.get(next.answerFingerprint) === attemptRevision)) return;
      if (next.selectionKnown && !next.sources.length && next.answerFingerprint) {
        const insufficient: RecallAnswer = { status: "insufficient", claims: [] };
        successful.add(next.answerFingerprint);
        answers.set(next.answerFingerprint, { answer: insufficient, sources: [] });
        setPrepared(null);
        setResult({ answer: insufficient, sources: [] });
        return;
      }
      if (!next.sources.length && !next.topics.length) {
        setPrepared(null);
        setResult({ answer: null, sources: [] });
        return;
      }
      setResult({ answer: null, sources: next.sources, busy: true });
      setPrepared(next);
    }, ANSWER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [answers, attemptRevision, attempted, question, selections, setResult, sourceRevision, successful]);

  const send = useCallback(async (next: PreparedRequest) => {
    const answerAlreadyHandled = next.answerFingerprint &&
      (successful.has(next.answerFingerprint) || attempted.get(next.answerFingerprint) === attemptRevision);
    const retrievalAlreadyAttempted = !next.selectionKnown && !next.sources.length &&
      retrievalAttempted.get(next.retrievalFingerprint) === attemptRevision;
    if (pending.current || answerAlreadyHandled || retrievalAlreadyAttempted ||
        currentFingerprint.current !== next.snapshotFingerprint || !canDisclose()) return;
    const request: PendingRequest = { ...next, controller: new AbortController() };
    pending.current = request;
    request.timer = setTimeout(() => {
      if (pending.current !== request) return;
      pending.current = null;
      request.controller.abort();
      setResult({ answer: null, sources: request.sources,
        error: "The answer timed out after 45 seconds. Try again; your notes are unchanged." });
    }, 45_000);
    let sources = request.sources;
    try {
      let answerFingerprint = request.answerFingerprint;
      if (!sources.length) {
        retrievalAttempted.set(request.retrievalFingerprint, attemptRevision);
        const selectionResponse = await ownedFetch("/api/recall/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: request.question, topics: request.topics }),
          signal: request.controller.signal,
          cache: "no-store",
        });
        if (pending.current !== request) return;
        lifetime.assertOnline();
        if (!selectionResponse.ok) throw new Error("Selection failed");
        const selection = validateRecallSelection(await selectionResponse.json(), request.topics);
        if (pending.current !== request) return;
        lifetime.assertOnline();
        if (!selection) throw new Error("Invalid selection");
        selections.set(request.retrievalFingerprint, selection.threadIds);
        sources = recallSourcesForThreads(boardRef.current, selection.threadIds, request.question);
        answerFingerprint = recallRequestFingerprint(request.question, sources);
        currentFingerprint.current = answerFingerprint;
        const cached = answers.get(answerFingerprint);
        if (cached) {
          setResult(cached);
          return;
        }
        if (!sources.length) {
          successful.add(answerFingerprint);
          const insufficient: RecallAnswer = { status: "insufficient", claims: [] };
          answers.set(answerFingerprint, { answer: insufficient, sources: [] });
          setResult({ answer: insufficient, sources: [] });
          return;
        }
        if (successful.has(answerFingerprint) || attempted.get(answerFingerprint) === attemptRevision) return;
        setResult({ answer: null, sources, busy: true });
      }
      if (!answerFingerprint) throw new Error("Missing disclosed-source fingerprint");
      // The answer attempt is keyed only after the exact disclosed originals are
      // known. Selection metadata cannot cache or suppress a changed source.
      attempted.set(answerFingerprint, attemptRevision);
      const response = await ownedFetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: request.question, sources }),
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
        setResult({ answer: null, sources,
          error: "Could not verify the answer against the submitted notes. Try again." });
        return;
      }
      successful.add(answerFingerprint);
      answers.set(answerFingerprint, { answer: validated, sources });
      setResult({ answer: validated, sources });
    } catch {
      if (pending.current === request) {
        setResult({ answer: null, sources,
          error: "Could not get an answer. Try again; your notes are unchanged." });
      }
    } finally {
      clearTimeout(request.timer);
      if (pending.current === request) pending.current = null;
    }
  }, [answers, attemptRevision, attempted, canDisclose, lifetime, retrievalAttempted,
    selections, setResult, successful]);

  // Keep the network work out of the debounce callback. A failed readiness check
  // leaves the prepared snapshot intact; the lifetime subscription above re-runs
  // this effect when same-owner verification settles.
  useEffect(() => {
    if (!prepared) return;
    const timer = setTimeout(() => { void send(prepared); }, 0);
    return () => clearTimeout(timer);
  }, [prepared, readinessRevision, send]);

  if (!result || result.busy) return <>
    <p role="status" aria-live="polite" aria-atomic="true" aria-busy="true"
      className={styles.visuallyHidden}>Answering from matching notes…</p>
    <div className={styles.loading} data-testid="answer-loading" aria-hidden="true">
      <div className={styles.loadingDots}><span /><span /><span /></div>
      <p>Capture is answering your question…</p>
    </div>
  </>;
  const statusText = result.busy
    ? "Answering from matching notes…"
    : result.error
      ? result.error
      : result.answer?.status === "answered"
      ? "Answer from your captures"
      : result.answer?.status === "insufficient"
        ? "Not enough evidence in these matching notes to answer."
        : !result.sources.length
          ? "No matching evidence for this question. Try more specific words from your captures."
          : "";
  const answer = result.answer?.status === "answered" ? result.answer : null;
  const connected = answer ? answer.claims.reduce<RecallSource[]>((items, claim) => {
    for (const citation of claim.citations) {
      const source = result.sources.find(candidate => candidate.id === citation.sourceId);
      if (!source || source.kind === "action") continue;
      if (!items.some(item => item.kind === source.kind && item.targetId === source.targetId)) items.push(source);
    }
    return items;
  }, []) : [];

  return <>
    <p role="status" aria-live="polite" aria-atomic="true" aria-busy={!!result.busy}
      className={styles.visuallyHidden}>{statusText}</p>
    {answer && <section className={styles.panel} aria-label="Answer">
      <h3 className={styles.heading}>Answer</h3>
      {answer.claims.map((claim, i) => <div className={styles.claim} key={i}>
        <p className={styles.claimText}>{claim.text}</p>
        <ul className={styles.support} aria-label={`Support for answer ${i + 1}`}>
          {claim.citations.map((citation) => <li key={`${citation.sourceId}:${citation.quote}`}>
            <q>{citation.quote}</q>
          </li>)}
        </ul>
      </div>)}
      {!!connected.length && <div className={styles.connections} aria-label="Connected captures">
        {connected.map(source => source.kind === "thread" ? <button type="button" className={styles.sourceButton}
          key={`thread:${source.targetId}`} onClick={() => { if (canDisclose()) onOpenThread(source.targetId, source.fragId); }}
          aria-label={`Open thread: ${source.title}`}>{source.title}</button> : <button type="button"
          className={styles.sourceButton} key={`intention:${source.targetId}`}
          onClick={() => { if (canDisclose()) onOpenIntention(source.targetId); }}
          aria-label={`Open intention: ${source.title}`}>{source.title}</button>)}
      </div>}
    </section>}
  </>;
}
