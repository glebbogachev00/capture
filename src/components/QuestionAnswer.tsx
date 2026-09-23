"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useOwnedState } from "@/hooks/useOwnedState";
import type { Board } from "@/lib/model";
import { getDocumentLifetime, ownedFetch } from "@/lib/ownership";
import {
  isLikelyRecallQuestion,
  recallCandidateSources,
  recallRequestFingerprint,
  validateRecallAnswer,
  type RecallAnswer,
  type RecallSource,
} from "@/lib/recall";
import styles from "./QuestionAnswer.module.css";

type Props = {
  board: Board;
  question: string;
  onOpenThread: (id: string, fragId?: string | null) => void;
  onOpenIntention: (id: string) => void;
  session?: QuestionAnswerSession;
};
export type QuestionAnswerSession = {
  attempted: Map<string, number>;
  successful: Set<string>;
  answers: Map<string, RecallAnswer>;
  revision: number;
};
export const createQuestionAnswerSession = (): QuestionAnswerSession => ({
  attempted: new Map(), successful: new Set(), answers: new Map(), revision: 0,
});
type Result = {
  answer: RecallAnswer | null;
  sources: RecallSource[];
  error?: string;
  busy?: boolean;
};
type PreparedRequest = {
  fingerprint: string;
  question: string;
  sources: RecallSource[];
};
type PendingRequest = PreparedRequest & {
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};
type SessionProps = Props & {
  readinessRevision: number;
  attemptRevision: number;
  attempted: Map<string, number>;
  successful: Set<string>;
  answers: Map<string, RecallAnswer>;
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

/** Automatic cited answers, separate from Search's existing exact results. */
export function QuestionAnswer(props: Props) {
  const [lifetime] = useState(getDocumentLifetime);
  const status = useSyncExternalStore(lifetime.subscribe, lifetime.snapshot, lifetime.snapshot);
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
  const [localAttempted] = useState(() => new Map<string, number>());
  const [localSuccessful] = useState(() => new Set<string>());
  const [localAnswers] = useState(() => new Map<string, RecallAnswer>());
  const [questionVisit, setQuestionVisit] = useState({ question: props.question, revision: 0 });
  if (questionVisit.question !== props.question) {
    setQuestionVisit({ question: props.question, revision: questionVisit.revision + 1 });
  }
  const attempted = props.session?.attempted ?? localAttempted;
  const successful = props.session?.successful ?? localSuccessful;
  const answers = props.session?.answers ?? localAnswers;
  const attemptRevision = props.session?.revision ?? questionVisit.revision;
  // OwnershipLifetime intentionally keeps the same public snapshot during a
  // routine same-owner poll. Subscribe separately so a prepared answer wakes
  // when that poll becomes ready instead of losing its one debounce attempt.
  const [readinessRevision, setReadinessRevision] = useState(0);
  useEffect(() => lifetime.subscribe(() => setReadinessRevision((value) => value + 1)), [lifetime]);

  if (!isLikelyRecallQuestion(props.question)) return null;
  if (lifetime.cloud && !lifetime.owner) return null;
  if (status !== "active" || !lifetime.active || !online) return null;
  // The outer component survives readiness changes. A transmitted fingerprint
  // gets one attempt per deliberate query visit, while successful fingerprints
  // remain deduplicated for the document lifetime.
  return <AnswerSession key={props.question} {...props}
    readinessRevision={readinessRevision} attemptRevision={attemptRevision}
    attempted={attempted} successful={successful} answers={answers} />;
}

function AnswerSession({ board, question, onOpenThread, onOpenIntention, readinessRevision,
  attemptRevision, attempted, successful, answers }: SessionProps) {
  const { lifetime, data: result, setData: setResult } = useOwnedState<Result | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  const currentFingerprint = useRef<string | null>(null);
  const boardRef = useRef(board);
  const previousBoard = useRef(board);
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);

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
    const sources = recallCandidateSources(board, question);
    const fingerprint = recallRequestFingerprint(question, sources);
    if (fingerprint === currentFingerprint.current) return;
    retire();
    currentFingerprint.current = null;
    setPrepared(null);
    setResult(null);
    setSourceRevision((value) => value + 1);
  }, [board, question, retire, setResult]);

  // Retrieval starts only after typing has stabilized. The board ref makes this
  // timer independent of unrelated board identity churn during those 600ms.
  useEffect(() => {
    const timer = setTimeout(() => {
      const sources = recallCandidateSources(boardRef.current, question);
      const fingerprint = recallRequestFingerprint(question, sources);
      currentFingerprint.current = fingerprint;
      const cached = answers.get(fingerprint);
      if (cached) {
        setResult({ answer: cached, sources });
        return;
      }
      if (successful.has(fingerprint) || attempted.get(fingerprint) === attemptRevision) return;
      if (!sources.length) {
        setPrepared(null);
        setResult({ answer: null, sources });
        return;
      }
      const next = { fingerprint, question, sources };
      setResult({ answer: null, sources, busy: true });
      setPrepared(next);
    }, ANSWER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [answers, attemptRevision, attempted, question, setResult, sourceRevision, successful]);

  const send = useCallback(async (next: PreparedRequest) => {
    if (pending.current || successful.has(next.fingerprint) || attempted.get(next.fingerprint) === attemptRevision ||
        currentFingerprint.current !== next.fingerprint || !canDisclose()) return;
    const request: PendingRequest = { ...next, controller: new AbortController() };
    pending.current = request;
    request.timer = setTimeout(() => {
      if (pending.current !== request) return;
      pending.current = null;
      request.controller.abort();
      setResult({ answer: null, sources: request.sources,
        error: "The answer timed out after 45 seconds. Try again; your notes are unchanged." });
    }, 45_000);
    try {
      // Claim the visit before invoking ownedFetch. Failures and ownership churn
      // cannot create an automatic loop; a query change or source change can.
      attempted.set(request.fingerprint, attemptRevision);
      const responsePromise = ownedFetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: request.question, sources: request.sources }),
        signal: request.controller.signal,
        cache: "no-store",
      });
      const response = await responsePromise;
      if (pending.current !== request) return;
      lifetime.assertOnline();
      if (!response.ok) throw new Error("Request failed");
      const value: unknown = await response.json();
      if (pending.current !== request) return;
      lifetime.assertOnline();
      const validated = validateRecallAnswer(value, request.sources);
      if (!validated) {
        setResult({ answer: null, sources: request.sources,
          error: "Could not verify the answer against the submitted notes. Try again." });
        return;
      }
      successful.add(request.fingerprint);
      answers.set(request.fingerprint, validated);
      setResult({ answer: validated, sources: request.sources });
    } catch {
      if (pending.current === request) {
        setResult({ answer: null, sources: request.sources,
          error: "Could not get an answer. Try again; your notes are unchanged." });
      }
    } finally {
      clearTimeout(request.timer);
      if (pending.current === request) pending.current = null;
    }
  }, [answers, attemptRevision, attempted, canDisclose, lifetime, setResult, successful]);

  // Keep the network work out of the debounce callback. A failed readiness check
  // leaves the prepared snapshot intact; the lifetime subscription above re-runs
  // this effect when same-owner verification settles.
  useEffect(() => {
    if (!prepared || successful.has(prepared.fingerprint) || attempted.get(prepared.fingerprint) === attemptRevision) return;
    const timer = setTimeout(() => { void send(prepared); }, 0);
    return () => clearTimeout(timer);
  }, [attemptRevision, attempted, prepared, readinessRevision, send, successful]);

  if (!result) return null;
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
      {answer.claims.map((claim, i) => <p className={styles.claimText} key={i}>{claim.text}</p>)}
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
