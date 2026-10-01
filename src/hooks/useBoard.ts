"use client";
import { useOwnedState } from "./useOwnedState";
import { logoutAndNavigate, ownedFetch as fetch } from "@/lib/ownership";
/**
 * useBoard — owns the whole board: its state, its persistence, and every
 * operation that changes it.
 *
 * Two reasons this lives in a hook rather than the render component. It takes
 * the bulk of the handling out of a 2,100-line file, and — the real fix — every
 * mutation reads the LATEST board through a ref instead of the snapshot the
 * current render captured. That is what stops two overlapping async operations
 * (a slow sort while a thread re-summarises, say) from having the second build
 * on stale state and clobber the first.
 *
 * The hook owns the display state too (which tab, which thread, the draft), so
 * the component is free to be purely presentational. `commit` sets both the
 * reactive state React renders and the ref the handlers read.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stamp } from "@/lib/clock";
import { del, get, keys, set } from "@/lib/storage";
import {
  type Action,
  type Board,
  type Frag,
  type Intention, type ProfileUpdate,
  type ShelfLife,
  type Thread,
  DORMANT,
  EMPTY,
  IMG,
  SHELF,
  dropImages,
  hydrate,
  pad,
  sweep,
  uid,
} from "@/lib/model";
import { actionViews } from "@/lib/actionViews";
import { applyProfileUpdate } from "@/lib/intentionShowcasePrefs";
import { hasCloudEntitlement } from "@/lib/cloudEntitlement";
import { useDegradedProviderStatus } from "@/hooks/useDegradedProviderStatus";
import { useBackupNavigationGuard } from "@/hooks/useBackupNavigationGuard";
import { importIntentBackup } from "@/lib/importIntent";
import { semanticSiblingNames, threadBriefs } from "@/lib/threadBrief";
import { warmDelay } from "@/lib/tidyWarm";
import { acceptWrap, markWrapsSeen, type DayWrap,
  mergeCompletions,
  wrapDue,
  wrapRequest,
  pendingWrap,
  mergeWraps,
} from "@/lib/wrap";
import { snapshotDays, snapshotKey, snapshotLabel } from "@/lib/snapshots";
import {
  type DistillResult,
  type DistillSession,
  DISTILL_KEY,
  EMPTY_DISTILL,
  hydrateDistill,
  distillSource, appendDistillUserTurn,
  findMarker,
  markerHold, openDistillDraft, closeDistillDraft, replyCanBeReady, NOTHING_MARKER,
  READY_MARKER,
} from "@/lib/distill";
import {
  backupFilename,
  downloadJSON,
  readJsonFile,
  restoreBackup,
  stampRestoredAdditions,
} from "@/lib/backup";
import { backupProgressText } from "@/lib/backupTransfer";
import { commitLegacyBackup, createBackupClient } from "@/lib/backupClient";
import { BackupOperationGate, createBackupMutationGuard, type BackupOperationToken } from "@/lib/backupOperation";
import {
  copyToClipboard,
  shareText,
  shareableFor,
} from "@/lib/share";
import { search } from "@/lib/search";
import {
  byRecency,
  computeSuggestion,
  type Suggestion,
} from "@/lib/boardOps";
import { repeatedThought } from "@/lib/repeatedThought";
import { settleSimpleSort } from "@/lib/simpleSortSettlement";
import type { SimpleSortItem } from "@/lib/simpleSort";
import { resolveCapture } from "@/lib/command";
import {
  answeredKindCorrection,
  type SortKind,
} from "@/lib/refiled";
import { expiryFor, parseDue } from "@/lib/due";
import { createPoller } from "@/lib/poll";
import { createCaptureGate, PLAYGROUND, TRIAL_LIMIT, isTrialExhausted, playgroundError, trialState } from "@/lib/playground";
import { useCaptureLimit } from "@/hooks/useCaptureLimit";
import { planTidy, keepProposals, type TidyRead } from "@/lib/tidyChanged";
import {
  confusedPairs,
  tangleProposalId,
  type TangleProposal,
} from "@/lib/tangle";
import { dayKey } from "@/lib/record";
import { imgSave } from "@/lib/imgCache";
import { adoptHubState } from "@/lib/adopt";
import { createPushGovernor, type PushGovernor } from "@/lib/pushGovernor";
import { createReceiptWindow, type ReceiptWindow } from "@/lib/receiptWindow";
import { receiptLines } from "@/lib/receiptCopy";
import { createHeldImages, type HeldImages } from "@/lib/heldImages";
import { organizeCorrection } from "@/lib/organizeOps";
import type { CleanupChange } from "@/lib/cleanup";
import {
  applyFragDelete,
  applyFragEdit,
  applyFragMove,
  applyFragResolve,
  applyFragSplit,
  applyFragUnresolve,
  applyThreadDelete,
  applyThreadMerge,
} from "@/lib/fragOps";
import {
  applyActionDone,
  applyActionFold,
  applyActionToNewThread,
} from "@/lib/actionOps";
import { suggestionOutcome } from "@/lib/suggestionRecord";
import { acceptSummary, threadFingerprint } from "@/lib/summaryAccept";
import { createTangleGate, type TangleGate } from "@/lib/tangleGate";
import { applySaveDraft, type CaptureOrigin } from "@/lib/intentionOps";
import { completeIntentionDetails } from "@/lib/completeIntentionDetails";
import { editUnsortedCapture, removeUnsortedCapture } from "@/lib/unsortedOps";
import { pendingDraftAction, pendingEntry, prepareResortedCapture, requestBoardSort,
  requestIntentionExpansion, resortIntentionOrigin } from "@/lib/resortOps";
import { CloudQuotaError } from "@/lib/cloudQuotaMessage";
import { applyTangleAccept } from "@/lib/tangleOps";
import { approveAllNotice, assemblePanel } from "@/lib/tidyPanel";
import { captureUndoOutcome, restoreCapture, tombstonesAfterUndo } from "@/lib/undoOps";
import { unreferencedImageIds } from "@/lib/imgSync";
import {
  imageSyncStatus,
  reconcileBoardImages,
  type SyncStatus,
} from "@/lib/imageReconciliation";
import {
  boardSignature,
  stampChanges,
  type SyncState,
  type Tombstone,
} from "@/lib/sync";
import type { SyncStore } from "@/lib/syncStore";
import type { Draft, IoNote } from "@/app/Intentions";
import { backupRestoreCloudSavedNotice, backupRestoreCloudUnconfirmedNotice, backupRestoreFailureNotice, backupRestoreSuccessNotice } from "@/lib/backupRestoreNotice";
import { CloudRestoreLocalCacheError, CloudRestoreOutcomeUnknownError } from "@/lib/backupTransfer";
import {
  mergeCorrections,
  mergeLedgers,
  sourceOf,
  withCorrection,
  withLedger,
  type CaptureEntry,
  type CorrectionEntry,
} from "@/lib/ledger";
import { setRuleEnabled, type RulePreference } from "@/lib/rules";
import { deriveCorrectionExamples } from "@/lib/correctionExamples";
import {
  scanStale,
  type OrganizeProposal,
} from "@/lib/organize";
import {
  compactBoard,
  mapAiProposals,
  type RawAiProposal,
} from "@/lib/organizeAi";
import { playgroundUsage } from "@/lib/playgroundUsageClient";
import { reconcilePersistedComposerImages, stagePlannedRoutingIntake } from "@/lib/plannedRoutingIntake";
import type { PlannedSettlementResult } from "@/lib/plannedRoutingSettlement";
import { useManualFiling } from "./useManualFiling";
import { MANUAL_ROUTING_UNDO_KEY } from "@/lib/manualRoutingUndo";
import { finalizingPendingTargetIds, PlannedSortAuthority } from "@/lib/plannedSortAuthority";
import { applyThreadRename } from "@/lib/threadRename";
import {
  captureUndoSnapshot,
  newCaptureIds as newIds,
  preserveDraftOrigin,
  type CaptureUndoSnapshot,
} from "@/lib/captureTransaction";
import {
  DurableBoardCommitQueue,
  prepareDurableBoardCommit,
  rebaseBoardMutation,
  runDurableBoardMutation,
  type DurableMutation, type DurableMutationResult, type DurableFinalizationClaim,
} from "@/lib/durableBoardCommit";
import { loadStartupBoard } from "@/lib/startupBoard";
import { PENDING_RECOVERY_BACKOFF_MS, PENDING_RECOVERY_KEY, exactPendingSnapshot,
  snapshotMatchesPending, type PendingRecoverySnapshot } from "@/lib/pendingRecovery";
import { PendingRecoveryOrchestrator } from "@/lib/pendingRecoveryOrchestrator";
import { usePendingRecoveryWake } from "./usePendingRecoveryWake";
/* Carries the server's explanation so the board can show it verbatim. */
class SortError extends Error {}
/* Which learned rules this device has cleared, by normalised key. */
const FORGOTTEN_RULES_KEY = "capture:forgotten-rules";
/* Organize proposals this device has waved off, by deterministic id — a
   dismissed pair stays dismissed, like a cleared rule. Device-local on
   purpose (v1): the proposal ids embed item ids that are stable per device. */
const ORGANIZE_DISMISSED_KEY = "capture:organize-dismissed";
/* Pairs the person has waved away, by `fromId>toId`. Per device: which
   observations you have already considered is a fact about you, not the
   board. */
const TANGLE_DISMISSED_KEY = "capture:tangle-dismissed";
/* When the untangle question was last asked of the model.
 
   The pair it finds changes about monthly, but the check ran on every app
   open — three or four paced model calls, roughly ten thousand tokens, each
   time. On a phone opened a dozen times a day that was the single largest
   consumer of a 200,000-token daily allowance, spent re-deriving an answer
   that had not changed. Once a day is more often than the question is. */
const TANGLE_ASKED_KEY = "capture:tangle-asked-at";
/** When the record last went out to an agent. Per device, never synced. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function createHydrationGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const reasonOf = (error: unknown) => {
  if (error instanceof CloudQuotaError) return error.message;
  if (error instanceof SortError && error.message) {
    return playgroundError(error.message) as string;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "No connection — nothing was sent. It is saved here; sort it when you are back online.";
  }
  return "The request didn't complete — connection or a timeout, not the sorter. Saved as it is.";
};

/* SortResult, LandedSource, Suggestion, applySorted and computeSuggestion now
   live in @/lib/boardOps — the pure board logic, testable without React. */

export function useBoard(now: number) {
  /* ------------------------------ state ------------------------------ */
  const { lifetime, ownershipStatus, data, setData } = useOwnedState<Board>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [corrupt, setCorrupt] = useState(false);
  const [text, setText] = useState("");
  const [pics, setPics] = useState<{ id: string; src: string }[]>([]);
  /* What the recogniser actually heard, before the cleanup pass rewrote it.
     Held only until the capture lands, then recorded in the ledger beside
     the words that were filed — evidence, not a second copy to manage. */
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /* Work that is genuinely in the background. `busy` disables the capture
     box, which is right while a sentence is being sorted — the person is
     waiting for it to land. It is wrong for the summary rewrite that
     follows: the capture is already on the board and on screen, and
     holding the box through a second model call meant the next thought
     had to wait for a paragraph nobody was reading. Live, that measured
     at thirty-five seconds. */
  const [summarising, setSummarising] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [landed, setLanded] = useState<string | null>(null);
  const [landedLines, setLandedLines] = useState<string[]>([]);
  const [pendingReceiptId, setPendingReceiptId] = useState<string | null>(null);
  const [autoSortingIds, setAutoSortingIds] = useState<string[]>([]);
  const pendingReceiptRef = useRef<string | null>(null);
  /* How long a receipt stays, and why a second one is never blanked by the
     first one's clock — lib/receiptWindow owns the timing. Everything that
     leaves with the banner leaves through its one close channel. */
  const receiptWindow = useRef<ReceiptWindow | null>(null);
  if (!receiptWindow.current)
    receiptWindow.current = createReceiptWindow(() => {
      setLanded(null);
      setLandedLines([]);
      pendingReceiptRef.current = null;
      setPendingReceiptId(null);
      setLandedIds([]);
      setSuggestion(null);
    });
  const showReceipt = useCallback((text: string, pendingTargetId: string | null = null, lines = text === "Actions" ? ["Actions"] : receiptLines(text)) => {
    setLanded(text);
    setLandedLines(lines);
    pendingReceiptRef.current = pendingTargetId;
    setPendingReceiptId(pendingTargetId);
    receiptWindow.current!.open();
  }, []);
  /* What the last capture created, so the board can wash those rows once —
     the banner says a capture landed; this shows WHERE. Cleared with the
     banner, and by the animation's own end on each row. */
  const [landedIds, setLandedIds] = useState<string[]>([]), [finalizingCaptureIds, setFinalizingCaptureIds] = useState<string[]>([]);
  /* The "this also belongs with X" proposal, shown under the landed line
     until it is acted on, dismissed, or the landed window closes. */
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  /* Reads as a whole sentence, unlike `landed` which is "Landed in <x>". */
  const [notice, setNotice] = useState<string | null>(null);
  const [swept, setSwept] = useState<{ faded: number; cleared: number } | null>(null);
  const [tab, setTab] = useState<"actions" | "threads" | "intentions">("actions");
  const [open, setOpen] = useState<string | null>(null);
  /* When a search result opens a thread, this names the exact fragment it
     came from, so the thread can open scrolled to it rather than at the top. */
  const [openFrag, setOpenFrag] = useState<string | null>(null);
  const [openIntention, setOpenIntention] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showRecord, setShowRecordState] = useState(false);
  /* The Record and its header share one selected calendar day. Opening the
     Record starts at today, just as its formerly local state did. */
  const [recordDay, setRecordDay] = useState(() => dayKey(now));
  const setShowRecord = (show: boolean) => {
    if (show) setRecordDay(dayKey(now));
    setShowRecordState(show);
  };
  const [ioNote, setIoNote] = useState<IoNote>(null);
  const [ioBusy, setIoBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; src: string } | null>(null);
  const [shelfFor, setShelfFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showFaded, setShowFaded] = useState(false);
  const [showResting, setShowResting] = useState(false);
  /* The action being converted to an intention; removed only once the draft
     is saved, never when it is discarded. */
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  /* What an in-flight intention draft should record in the ledger when it is
     saved: set by whichever flow opened the draft (a typed/dictated capture,
     or a Distill settlement), consumed by saveDraft, cleared on discard. */
  const intentionLedger = useRef<CaptureOrigin | null>(null);
  const pendingIntentionSource = useRef<Action | null>(null);
  /* ----------------------- learned rules ------------------------ */
  /* Rules the user cleared in Settings, by normalised key. Device-local on
     purpose (v1): the correction ledger itself syncs, so both devices learn
     the same rules, but a clearing is a personal "stop telling me that"
     and is remembered here, in this browser. */
  const [forgottenRules, setForgottenRules] = useState<string[]>([]);

  /* ---------------------------- organize ---------------------------- */

  /* The board-wide tidy scan. null = never run this session; the button
     scans on first open. A dismissal is remembered by proposal id so the
     same pair never reappears on a later scan. */
  const [organize, setOrganize] = useState<OrganizeProposal[] | null>(null);
  const dismissedOrganize = useRef<string[]>([]);
  /* Whether the model's semantic pass has run, is running, or failed — the
     review screen shows a quiet row while it thinks, and a "instant scan
     only" note when it couldn't run (so the user knows the semantic layer
     is offline, not that the board is clean). */
  /* The last reading, kept against the board it was made about. */
  const organizeRead = useRef<{ sig: string; ai: OrganizeProposal[] } | null>(
    null
  );
  const [organizeAiStatus, setOrganizeAiStatus] = useState<
    "idle" | "thinking" | "done" | "offline"
  >("idle");
  /* The last AI results, kept so a board change re-merges them instead of
     dropping them from an open panel. Stale proposals are harmless — accept
     routes through the id-guarded handlers, which no-op when the item is
     gone. AI only re-runs on the button press, so this costs nothing. */
  const aiOrganize = useRef<OrganizeProposal[]>([]);
  /* Two approve-all runs must never overlap — the second would re-apply a
     list that the first is already resolving, on a board mid-change. */
  const applyingOrganize = useRef(false);

  /* ---------------------------- distill ---------------------------- */
  const [distillOpen, setDistillOpen] = useState(false);
  const [distillSession, setDistillSession] =
    useState<DistillSession>(EMPTY_DISTILL);
  const [distillInput, setDistillInput] = useState("");
  const [distillTranscript, setDistillTranscript] = useState("");
  const [distillBusy, setDistillBusy] = useState(false);
  const [distillErr, setDistillErr] = useState("");
  /* Whether the engine said the conversation is ready to be filed — the
     clarifier ends its reply with [ready] when it has enough. Lights up
     the Distill button so the user knows the interrogation is over. */
  const [distillReady, setDistillReady] = useState(false);
  const [settled, setSettled] = useState<DistillResult | null>(null);
  /* Mirrors distillBusy in a ref so two taps in the same tick can't both
     start a request before React has re-rendered. */
  const distillBusyRef = useRef(false);
  const captureGate = useRef(createCaptureGate());
  /* The saved session is hydrated asynchronously; a turn sent before that
     resolves must not be clobbered by the stale copy from disk. */
  const distillLoadedRef = useRef(false);

  /* The latest board, read by handlers so async work never builds on stale
     state. `commit` (and the loader) are the only writers. */
  const latest = useRef<Board>(data);
  const durableBoardCommits = useRef(new DurableBoardCommitQueue());
  const [hydrationGate] = useState(createHydrationGate);
  const hydrationSucceeded = useRef(false);
  const backupGate = useRef(new BackupOperationGate());
  useBackupNavigationGuard(backupGate);
  const { applies: dailyTrialApplies, ready: captureLimitReady } = useCaptureLimit();
  const trialExhaustedNow = () => {
    const appliesNow = lifetime.cloud && lifetime.owner &&
      lifetime.snapshot() === "offline"
      ? !hasCloudEntitlement(lifetime.owner)
      : dailyTrialApplies;
    return appliesNow && isTrialExhausted(latest.current.ledger ?? [], Date.now());
  };
  const rejectDistillAtLimit = () => {
    if (!trialExhaustedNow()) return false;
    setDistillErr(`You have used today's ${TRIAL_LIMIT} captures. Come back tomorrow.`);
    return true;
  };
  /* Append a proposal-outcome record to a board about to be committed: what
     the user did with the engine's suggestion — accepted, dismissed, or
     corrected. Invisible in the UI; the correction ledger is the learning
     signal for the bounded personal model. */
  const noteCorrection = (
    next: Board,
    c: Omit<CorrectionEntry, "id" | "at">
  ): Board => withCorrection(next, { id: uid(), at: stamp(), ...c });

  /* ------------------------------ sync ------------------------------ */

  /* This device's deletions, remembered locally so an offline delete is
     still pushed once the hub is reachable again. Persisted under its own
     key, next to the board. */
  const tombstones = useRef<Tombstone[]>([]);
  const pendingRecovery = useRef(new PendingRecoveryOrchestrator());
  /* When the last exchange with the hub happened, and whether it worked. */
  const [sync, setSync] = useState<SyncStatus>(null);
  /* Push scheduling lives in lib/pushGovernor — the state machine that
     cannot drop: an edit made during an in-flight push becomes pending,
     and the finishing push re-schedules it. The old timer-plus-flag pair
     here had exactly that race, staged and pinned in pushGovernor.test. */
  const pushGovernor = useRef<PushGovernor | null>(null);
  useEffect(() => {
    const stop = lifetime.subscribe(() => {
      if (lifetime.snapshot() === "revoked") pushGovernor.current?.dispose();
    });
    return () => { stop(); pushGovernor.current?.dispose(); pushGovernor.current = null; };
  }, [lifetime]);

  /* ------------------------------ undo ------------------------------ */

  /* Exact inverse ownership plus composer evidence for the last user-visible
     landing. Image ids ride here; bytes remain in IndexedDB. */
  const captureSnapshot = useRef<CaptureUndoSnapshot | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  /* Tidy Undo rides on the notice rather than the capture receipt. */
  const [noticeUndoable, setNoticeUndoable] = useState(false);

  /* Give each undoable Tidy notice a full receipt window. */
  const tidyNoticeWindow = useRef<ReceiptWindow | null>(null);
  if (!tidyNoticeWindow.current)
    tidyNoticeWindow.current = createReceiptWindow(() => {
      setNotice(null);
      setNoticeUndoable(false);
    });
  /* Generation prevents an older timer from clearing a newer Undo notice. */
  const noticeGen = useRef(0);
  const clearNoticeIn = (ms: number) => {
    const gen = ++noticeGen.current;
    setTimeout(() => {
      if (noticeGen.current !== gen) return;
      setNotice(null);
      setNoticeUndoable(false);
    }, ms);
  };
  const showTidyNotice = (text: string) => {
    noticeGen.current++;
    setNotice(text);
    tidyNoticeWindow.current!.open();
  };

  /* Pictures belonging to something Undo can still bring back — the rule
     for when one is safe to destroy lives in lib/heldImages. */
  const dropUnreferencedImages = (ids: string[] | undefined) =>
    dropImages(unreferencedImageIds(latest.current, ids));
  const heldImages = useRef<HeldImages | null>(null);
  if (!heldImages.current) heldImages.current = createHeldImages();
  const holdImages = (ids: string[] | undefined) =>
    heldImages.current!.hold(ids);
  /* The previous undo is being superseded: whatever it was protecting can
     never be brought back now, so the bytes go. */
  const releaseHeldImages = () => {
    const stale = heldImages.current!.release();
    if (stale.length) void backupGate.current.trackMutation(dropUnreferencedImages(stale));
  };

  /* What the last undo threw away, kept just long enough to ask one
     question about it. Undo on its own says the sorting was wrong and
     nothing about what was right, which is not enough to learn from — so
     the capture waits here while the person taps the kind it should have
     been. Cleared by answering, by dismissing, or by the next capture. */
  const [misfiled, setMisfiled] = useState<{
    text: string;
    wrong?: SortKind; // absent when mixed or manual: nothing to learn, still asked
    captureId: string;
    /* The thread it landed in, when it landed in one. Right kind, wrong
       home is a different mistake from the wrong kind, and the strip can
       only offer to fix it if it knows which thread to move away from. */
    thread?: { id: string; name: string };
  } | null>(null);

  /** The hub revision this device last saw, so a poll can ask "anything
      newer than N?" and get a two-field answer instead of the whole board. */
  const hubRev = useRef<number | null>(null);

  /** Image ids this device has already confirmed on the hub, so a push does
      not check the same photo every time. Not persisted: after a reload the
      first reconciliation asks with HEAD and sends bytes only when missing. */
  const imgsOnHub = useRef<Set<string>>(new Set());

  const reconcileImages = useCallback(
    (board: Board) => reconcileBoardImages(board, imgsOnHub.current),
    [],
  );

  // Saved Cloud edits must wait for a successful read/merge, including after
  // reconnect. A failed read must not consume this pending work.
  const offlineChangesPending = useRef(lifetime.cloud && lifetime.owner !== null);

  const adoptSyncState = useCallback((
    remote: SyncState,
  ): Promise<DurableMutationResult<ReturnType<typeof adoptHubState>>> =>
    runDurableBoardMutation<ReturnType<typeof adoptHubState>>({
    queue: durableBoardCommits.current,
    allowed: () => hydrationSucceeded.current && lifetime.active && backupGate.current.allowMutation(),
    read: () => ({ board: latest.current, tombstones: tombstones.current }),
    build: (current, currentTombstones) => {
      const adopted = adoptHubState(
        { board: current, tombstones: currentTombstones },
        remote,
      );
      return adopted.changed
        ? { next: adopted.board, replaceTombstones: adopted.tombstones, value: adopted, asIs: true }
        : { skip: adopted };
    },
    adopt: (state) => {
      latest.current = state.board;
      tombstones.current = state.tombstones;
      setData(state.board);
    },
    /* Sync adoption already came from the hub. Scheduling another push is a
       caller decision after the read/merge gate, never a queue side effect. */
    committed: () => {},
  }), [lifetime, setData]);

  /** Send our state to the hub and adopt its merged answer. */
  const pushNow = useCallback(async () => {
    /* Playground: no hub. See lib/playground.ts for why this is a hard stop.
       Serialization is the governor's job now, not a flag's. */
    if (!hydrationSucceeded.current || PLAYGROUND || !lifetime.active || (lifetime.cloud && lifetime.owner === null)) return;
    if (backupGate.current.restoreActive) return;
    const generation = backupGate.current.generation;
    // Also gate debounced edits and Undo, not only manual sync.
    if (offlineChangesPending.current) return;
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board: latest.current,
          tombstones: tombstones.current,
        } as SyncState),
      });
      if (!backupGate.current.isCurrent(generation)) return;
      if (!res.ok) throw new Error("sync failed");
      const stored = (await res.json()) as SyncStore;
      if (!backupGate.current.isCurrent(generation)) return;

      /* The adoption policy lives in lib/adopt — pure, and pinned by tests
         that replay sync's shipped incidents (the in-flight capture eaten
         by its own reply, the cheap changed-test dropping edits). The note
         is deliberately unused here: a push's job is sending, and the next
         pull narrates arrivals. */
      const durable = await adoptSyncState({
        board: stored.board,
        tombstones: stored.tombstones,
      });
      if (durable.status === "failed") throw new Error("sync persistence failed");
      const adopted = durable.value;
      hubRev.current = stored.rev ?? null;
      const images = await reconcileImages(adopted.board);
      if (!backupGate.current.isCurrent(generation)) return;
      setSync(imageSyncStatus(images));
    } catch {
      if (!backupGate.current.isCurrent(generation)) return;
      /* hub unreachable — keep everything local, retry on the next change */
      setSync({ ok: false, at: stamp(), note: "Hub unreachable — kept locally" });
    }
  }, [adoptSyncState, reconcileImages, lifetime]);

  /** Coalesce bursts of edits into one push a beat after the last one. */
  const schedulePush = useCallback(() => {
    if (!hydrationSucceeded.current || PLAYGROUND || !lifetime.active || (lifetime.cloud && lifetime.owner === null)) return;
    if (backupGate.current.restoreActive) return;
    if (!pushGovernor.current)
      pushGovernor.current = createPushGovernor(pushNow);
    pushGovernor.current.schedule();
  }, [pushNow, lifetime]);

  const transactDurable = useCallback(async <T,>(
    build: (current: Board, currentTombstones: Tombstone[]) => DurableMutation<T>,
    authority?: { guard: () => boolean; signal: AbortSignal; finalize?: () => DurableFinalizationClaim | null },
  ): Promise<DurableMutationResult<T>> => {
    await hydrationGate.promise;
    return runDurableBoardMutation({
    queue: durableBoardCommits.current,
    allowed: () => hydrationSucceeded.current && lifetime.active && backupGate.current.allowMutation(),
    guard: authority?.guard,
    signal: authority?.signal,
    finalize: authority?.finalize,
    read: () => ({ board: latest.current, tombstones: tombstones.current }),
    build,
    adopt: (state) => {
      latest.current = state.board; tombstones.current = state.tombstones; setData(state.board);
    },
    committed: schedulePush,
    });
  }, [hydrationGate, lifetime, schedulePush, setData]);

  /**
   * Pull the hub's copy, merge it with ours, and adopt the result. Returns
   * success separately from whether anything changed locally. Success/failure
   * is recorded in `sync`, so an unchanged successful read still shows a live hub.
   */
  const pullNow = useCallback(async (): Promise<{ ok: false } | { ok: true; changed: boolean }> => {
    if (!hydrationSucceeded.current || PLAYGROUND || !lifetime.active || (lifetime.cloud && lifetime.owner === null)) return { ok: false };
    if (backupGate.current.restoreActive) return { ok: false };
    const generation = backupGate.current.generation;
    try {
      const res = await fetch(
        hubRev.current === null ? "/api/sync" : `/api/sync?rev=${hubRev.current}`
      );
      if (!backupGate.current.isCurrent(generation)) return { ok: false };
      if (!res.ok) throw new Error("sync failed");
      const remote = (await res.json()) as SyncStore & { unchanged?: boolean };
      if (!backupGate.current.isCurrent(generation)) return { ok: false };
      /* Nothing new in the board document since the last pull. Skip the
         parse-and-merge work, but retry referenced images because their bytes
         arrive separately and do not move the board revision. */
      if (remote.unchanged) {
        const images = await reconcileImages(latest.current);
        if (!backupGate.current.isCurrent(generation)) return { ok: false };
        setSync(imageSyncStatus(images));
        if (offlineChangesPending.current) {
          offlineChangesPending.current = false;
          schedulePush();
        }
        return { ok: true, changed: false };
      }

      /* One policy for both halves of sync — see lib/adopt for the rules
         and the incidents behind them. */
      const durable = await adoptSyncState({
        board: remote.board,
        tombstones: remote.tombstones,
      });
      if (durable.status === "failed") throw new Error("sync persistence failed");
      const adopted = durable.value;
      const changed = adopted.changed;
      hubRev.current = remote.rev ?? null;
      if (changed && adopted.note) {
        setNotice(adopted.note);
        clearNoticeIn(5000);
      }

      // Push merged changes or retained offline work; an ordinary unchanged
      // poll still avoids a redundant round trip.
      /* Every successful pull, not only the ones that changed something.
         A photo that failed to fetch leaves the words in sync and the
         picture missing — and boardSignature knows nothing about images, so
         the merge reads as unchanged from then on and the fetch was never
         retried. The device kept the text and lost the photograph, for
         good. Reconciling is a no-op for images it already holds. */
      const images = await reconcileImages(adopted.board);
      if (!backupGate.current.isCurrent(generation)) return { ok: false };
      setSync(imageSyncStatus(images));
      const pending = offlineChangesPending.current;
      offlineChangesPending.current = false;
      if (changed || pending) schedulePush();
      return { ok: true, changed };
    } catch {
      if (!backupGate.current.isCurrent(generation)) return { ok: false };
      /* hub unreachable; local state stands */
      setSync({ ok: false, at: stamp(), note: "Hub unreachable — kept locally" });
      return { ok: false };
    }
  }, [adoptSyncState, schedulePush, reconcileImages, lifetime]);

  /** Manual "sync now": bring the other device's changes in, then push ours up. */
  const syncNow = useCallback(async () => {
    if (!hydrationSucceeded.current || PLAYGROUND || !lifetime.active || (lifetime.cloud && lifetime.owner === null)) return;
    if (backupGate.current.restoreActive) return;
    const pulled = await pullNow();
    if (!pulled.ok) return;
    /* A manual sync pushes NOW — flush cancels any pending debounce and
       still serializes behind an in-flight push. */
    if (!pushGovernor.current)
      pushGovernor.current = createPushGovernor(pushNow);
    await pushGovernor.current.flush();
  }, [pullNow, pushNow, lifetime]);

  /**
   * Undo the last capture: put the board and this device's tombstones back
   * to exactly how they were before it landed — and give the capture box
   * its words (and pictures) back, so the capture can be edited and
   * re-submitted.
   *
   * Only captures take a snapshot, so this reverts precisely what the user
   * watched land — never a summary refresh or a fade that happened in the
   * background. The hub merges rather than replaces, so undoing on one
   * device and pushing leaves the other device's edits intact.
   */
  const undo = useCallback(async () => {
    const snap = captureSnapshot.current;
    if (!snap) return;
    const durable = await transactDurable<{
      wrongKind: SortKind | null;
      undoneEntry: CaptureEntry | undefined;
      landedIn: { id: string; name: string } | undefined;
    }>((current, currentTombstones) => {
      /* Restore only the exact inverse recorded when this transition landed.
         The live Board and tombstones may already contain newer sync work. */
      const now = Date.now();
      const captureArtifacts = snap.captureId
        ? new Set(current.ledger
            .filter((entry) =>
              entry.kind !== "pending" &&
              (entry.captureId ?? entry.id) === snap.captureId
            )
            .flatMap((entry) => [entry.targetId, entry.targetFragId]
              .filter((id): id is string => !!id)))
        : new Set<string>();
      const additionsSinceSnapshot = newIds(snap.board, current);
      const ownedAddedIds = new Set([
        ...(snap.addedIds ?? []),
        ...[...captureArtifacts].filter((id) => additionsSinceSnapshot.has(id)),
      ]);
      const board = restoreCapture(current, { ...snap, addedIds: ownedAddedIds }, now);
      const added = stampChanges(current, board, now).tombstones;
      const settlementEntries = snap.ledgerIds?.length
        ? current.ledger.filter((entry) => snap.ledgerIds!.includes(entry.id))
        : current.ledger.filter((entry) =>
            !snap.board.ledger.some((prior) => prior.id === entry.id)
          );
      const outcome = captureUndoOutcome(settlementEntries);
      const undoneEntry = outcome.representative;
      const wrongKind = outcome.learningKind;
      const threadEntry = settlementEntries.find((entry) =>
        (entry.kind === "thread" || entry.kind === "both") && entry.targetId
      );
      const landed = threadEntry
        ? current.threads.find((thread) => thread.id === threadEntry.targetId)
        : undefined;
      const learned = wrongKind
        ? withCorrection(board, {
            id: uid(), at: now, proposalKind: "undone", accepted: false,
            context: (undoneEntry!.raw || undoneEntry!.clean).slice(0, 160),
          })
        : board;
      return {
        next: learned,
        replaceTombstones: tombstonesAfterUndo(
          currentTombstones,
          snap.ownedTombstones ?? [],
          added,
          now,
        ),
        value: {
          wrongKind,
          undoneEntry,
          landedIn: landed ? { id: landed.id, name: landed.name } : undefined,
        },
      };
    });
    if (durable.status !== "committed") {
      setErr("Couldn't save Undo. Nothing was changed.");
      return;
    }
    captureSnapshot.current = null;
    setCanUndo(false);
    setNoticeUndoable(false);
    /* The durable restore brought back whatever held these image ids. */
    heldImages.current!.cancel();
    const { wrongKind, undoneEntry, landedIn } = durable.value;
    /* Always ask where it goes: split, manual, or pending captures stay placeable by hand. */
    const undoneText = undoneEntry ? undoneEntry.raw || undoneEntry.clean : snap.text ?? "";
    const undoneCaptureId = undoneEntry ? undoneEntry.captureId ?? undoneEntry.id : snap.captureId;
    if (undoneText.trim() && undoneCaptureId)
      setMisfiled({ text: undoneText, wrong: wrongKind ?? undefined, captureId: undoneCaptureId, thread: landedIn });
    receiptWindow.current!.retire();
    /* The capture box gets its words back too — Undo returns the draft as
       it was, not just the board. A brand-new draft already being typed is
       left alone rather than clobbered. */
    if (!text.trim() && !pics.length) {
      setText(snap.text ?? "");
      /* The bytes come back from IndexedDB — the snapshot holds only ids. */
      const restored = (
        await Promise.all(
          (snap.picIds ?? []).map(async (id) => {
            try {
              const src = await get(IMG(id));
              return src ? { id, src } : null;
            } catch {
              return null;
            }
          })
        )
      ).filter((p): p is { id: string; src: string } => !!p);
      setPics(restored);
    }
    setNotice("Undone — back to how it was.");
    clearNoticeIn(4000);
    /* Push now, not on the debounce: a pull landing in the debounce window
       would re-merge the hub's copy (which still holds the capture) before
       our tombstones go out. */
    if (!pushGovernor.current)
      pushGovernor.current = createPushGovernor(pushNow);
    await pushGovernor.current.flush();
  }, [pushNow, text, pics, transactDurable]);

  /**
   * The answer to "then what was it?".
   *
   * One tap, no typing. It writes the lesson the undo could not write on
   * its own — the wrong kind and the right one, anchored on the capture's
   * subject so two corrections about the same subject aggregate instead of
   * splitting — and then re-runs the capture with the destination pinned,
   * so answering the question also does the thing.
   *
   * Deliberately NOT memoised. Undo restores the draft text one tick after
   * it raises this question, so a useCallback keyed on the question would
   * close over the render before the words came back, and re-submit an
   * empty box. Defined fresh each render, it always reads the box as it
   * actually is.
   */
  const sortAgainAs = async (right: SortKind) => {
    const m = misfiled;
    setMisfiled(null);
    /* The box may have been edited since Undo put the words back; what is
       re-sorted and what the lesson cites is the draft as it stands. */
    const words = text.trim() || m?.text || "";
    if (m) {
      if (m.wrong !== right && words.trim()) {
        const learned = withCorrection(latest.current, {
          id: uid(),
          at: stamp(),
          proposalKind: "undone",
          accepted: true,
          context: words.slice(0, 160),
          routing: { kind: right },
        });
        if (!await commit(learned)) return;
      }
      /* The box holds the restored words, but a re-sort must not depend on
         that: if anything cleared them, the capture being corrected is
         still right here. */
      if (!text.trim()) setText(m.text);
    }
    await submit(false, right, words || undefined, undefined, m?.captureId);
    /* After the capture lands, not before — the banner says where it went,
       this says why that was the right shape for it. */
    if (m) {
      setNotice(SHAPE_NOTE[right]);
      clearNoticeIn(6000);
    }
  };

  /**
   * "Another thread" — the answer when the kind was right and the home
   * was wrong.
   *
   * Undo asks what KIND it should have been, which is no help at all when
   * the kind was right: a post draft that belongs in "Capture X posts" and
   * landed in "Capture." is a thread either way, and tapping "a thread"
   * would just file it wrong again. Moving the fragment by hand does teach
   * — that is the refile rule — but it is two more steps in another screen,
   * and nobody takes them.
   *
   * So the strip offers the threads instead, and picking one both files it
   * there and writes the lesson the manual move would have written. The
   * capture still goes through the sorter, so it is cleaned and recorded
   * like any other; only the destination is taken out of the model's hands.
   */
  const sortAgainIntoThread = async (threadId: string) => {
    const m = misfiled;
    setMisfiled(null);
    const home = latest.current.threads.find((t) => t.id === threadId);
    const words = text.trim() || m?.text || "";
    if (m && home) {
      if (words.trim()) {
        const learned = withCorrection(latest.current, {
          id: uid(),
          at: stamp(),
          proposalKind: "undone",
          accepted: true,
          context: words.slice(0, 160),
          routing: { kind: "thread", threadId: home.id, threadName: home.name },
        });
        if (!await commit(learned)) return;
      }
      if (!text.trim()) setText(m.text);
    }
    await submit(false, "thread", words || undefined, threadId, m?.captureId);
    if (home) {
      setNotice(`Filed in ${home.name}. It will remember.`);
      clearNoticeIn(6000);
    }
  };

  const commit = useCallback(
    async (
      next: Board,
      restoreToken?: BackupOperationToken,
      legacyImages?: Record<string, string>,
    ): Promise<boolean> => {
      await hydrationGate.promise;
      if (!hydrationSucceeded.current) return false;
      const base = latest.current;
      if (legacyImages) return durableBoardCommits.current.run(async () => {
        if (!lifetime.active || !backupGate.current.allowMutation(restoreToken)) return false;
        const rebased = rebaseBoardMutation(base, next, latest.current);
        if (!rebased) return false;
        const prepared = prepareDurableBoardCommit(
          latest.current, rebased, tombstones.current,
        );
        if (!await commitLegacyBackup(lifetime, prepared, legacyImages)
          .then(() => true, () => false)) {
          setErr("Couldn't save that restore. Your existing board is unchanged.");
          return false;
        }
        latest.current = prepared.board;
        tombstones.current = prepared.tombstones;
        setData(prepared.board);
        schedulePush();
        return true;
      });

      const durable = await transactDurable<boolean>((current) => {
        if (!backupGate.current.allowMutation(restoreToken)) return { skip: false };
        const rebased = rebaseBoardMutation(base, next, current);
        if (!rebased) return { skip: false };
      /* Every mutation funnels through here, so the sync bookkeeping lives in
         one place: diff what changed, stamp the changed items, tombstone the
         deletions, then push.

         Tombstones are re-applied first, because a write can be older than
         it looks. A thread's summary is fetched in the background; if the
         capture that created the thread is undone while that request is in
         flight, the reply arrives holding a thread the board no longer has,
         and committing it put the thread back — empty, since its fragment
         had been tombstoned separately — and stamped it fresh, so it then
         out-aged its own tombstone and survived every later merge. A
         deletion must not be undone by a writer that set out before it. */
      /* History is union-merged rather than taken wholesale, for the same
         reason tombstones are re-applied: a write can be older than it
         looks. A thread capture kicks off a summary refresh, and that
         request carries the board as it was when it set out. Committing
         its reply used to hand back `next.corrections` verbatim — quietly
         reverting any lesson recorded while it was in flight, which is
         exactly when lessons are recorded. The ledger and the corrections
         are append-only and keyed by id, so unioning them is always safe
         and never loses a record to a slow reply. */
      const merged: Board = {
        ...rebased,
        ledger: mergeLedgers(current.ledger ?? [], rebased.ledger ?? []),
        corrections: mergeCorrections(
          current.corrections ?? [],
          rebased.corrections ?? []
        ),
        wraps: mergeWraps(current.wraps ?? [], rebased.wraps ?? []),
        completions: mergeCompletions(
          current.completions ?? [],
          rebased.completions ?? []
        ),
      };
        return { next: merged, value: true };
      });
      if (durable.status === "committed") return true;
      setErr("Couldn't save that. Your last capture is still on screen — try again.");
      return false;
    },
    [hydrationGate, schedulePush, lifetime, setData, transactDurable]
  );

  /* load, then sweep. A board already on the device that fails to parse is
     set aside rather than silently treated as a fresh start: the unreadable
     copy is parked under a quarantine key before anything new can overwrite
     it, and the UI is told so it can offer a restore. */
  useEffect(() => {
    (async () => {
      let startup: Awaited<ReturnType<typeof loadStartupBoard>> = null;
      try {
        startup = await loadStartupBoard(
          durableBoardCommits.current,
          () => lifetime.active,
        );
      } catch {
        /* surfaced below without adopting an unpersisted Board */
      }
      if (!startup) {
        setErr("Couldn't finish opening your saved board. Nothing new was written.");
        hydrationGate.resolve();
        return;
      }
      if (startup.quarantined) setCorrupt(true);
      latest.current = startup.board;
      tombstones.current = startup.tombstones;
      setData(startup.board);
      if (startup.faded || startup.cleared) {
        setSwept({ faded: startup.faded, cleared: startup.cleared });
      }
      // A half-finished Distill conversation is a capture like any other.
      // A turn sent before this resolves already adopted the disk copy and
      // marked the ref; don't clobber that in-flight session.
      try {
        const distillRaw = await get(DISTILL_KEY);
        if (distillRaw && !distillLoadedRef.current) {
          setDistillSession(hydrateDistill(distillRaw));
        }
      } catch {
        /* first run */
      }
      if (!distillLoadedRef.current) distillLoadedRef.current = true;
      // Cleared learning rules survive a reload too.
      try {
        const frRaw = await get(FORGOTTEN_RULES_KEY);
        if (frRaw) setForgottenRules(JSON.parse(frRaw));
      } catch {
        /* first run */
      }
      // Waved-off Organize proposals survive a reload too.
      try {
        const oRaw = await get(ORGANIZE_DISMISSED_KEY);
        if (oRaw) dismissedOrganize.current = JSON.parse(oRaw);
      } catch {
        /* first run */
      }
      pendingRecovery.current.load(await get(PENDING_RECOVERY_KEY).catch(() => null), startup.board);
      restoreManualReceipt(
        await get(MANUAL_ROUTING_UNDO_KEY).catch(() => null),
        startup.board, tombstones.current,
      );
      hydrationSucceeded.current = true;
      setLoaded(true);
      hydrationGate.resolve();
    })();
  }, [hydrationGate, lifetime, setData]);

  /* --------------------------- sync loop ---------------------------- */
  /* Pull on load and whenever the tab comes back into focus, then merge the
     hub's copy with ours and adopt the result. The hub merges rather than
     replaces, so two devices editing at once converge instead of clobbering.
     Offline is fine — the next commit just keeps everything local. */
  useEffect(() => {
    if (ownershipStatus === "offline") offlineChangesPending.current = true;
    if (!loaded || PLAYGROUND || ownershipStatus !== "active" || (lifetime.cloud && lifetime.owner === null)) return;
    if (offlineChangesPending.current) {
      void syncNow();
    } else void pullNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pullNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    /* A pull used to fire only on load and tab-focus, so a desktop tab left
       open and focused never saw the other device's changes. Poll gently so
       the phone's updates land within a few seconds without any interaction.
       Browsers throttle background tabs, which suits us — idle tabs poll less.
       Skip polling entirely when the device reports no connectivity — saves
       battery on mobile and avoids spurious sync errors when the Mac is off. */
    /* Thirty seconds, not ten, and nothing at all while the tab is hidden.
       Ten-second polls from two devices were 17,000 hub reads a day for a
       board that mostly had not changed, and the blob store got suspended
       for it. A change made on the other device now shows within half a
       minute of looking, which is the only time it matters.

       A failed pull doubles the wait, up to five minutes: a hub that is down
       does not need to be asked again in thirty seconds. */
    const poller = createPoller({
      pull: async () => (await pullNow()).ok,
      active: () => document.visibilityState === "visible" && navigator.onLine,
    });
    const startPoll = poller.start;
    const stopPoll = poller.stop;
    const onOnline = () => { void pullNow(); startPoll(); };
    const onOffline = () => stopPoll();
    const onHidden = () => {
      if (document.visibilityState === "hidden") stopPoll();
      else startPoll();
    };
    document.addEventListener("visibilitychange", onHidden);
    if (navigator.onLine) startPoll();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onHidden);
      stopPoll();
    };
  }, [loaded, pullNow, syncNow, ownershipStatus, lifetime]);

  /* Expiry is continuous, not just at open: sweep on the minute tick too, so
     stale actions fade and cleared ones drop while the app stays open. The
     open-time notice is only shown by the loader above; tick sweeps are quiet.

     sweep() awaits image cleanup, so the board is only committed if it has not
     changed since we read it — a concurrent mutation is never reverted by a
     stale sweep; the next tick re-runs it over the newer board. */
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      const before = latest.current;
      const { next, faded, cleared } = await sweep(before);
      if ((faded || cleared) && latest.current === before) {
        await commit(next);
      }
    })();
  }, [now, loaded, commit]);

  /* Search is computed on every keystroke; a short settle keeps typing smooth
     and cheap as the board grows, with no visible pause. Clearing goes through
     a 0ms timer so it is near-instant without a synchronous set in the effect. */
  useEffect(() => {
    const id = setTimeout(
      () => setDebouncedQuery(query),
      query ? 160 : 0
    );
    return () => clearTimeout(id);
  }, [query]);

  /* Every banner auto-clears — the "Cleanup ran on open" line and the error
     line were the two that sat until the next capture. A stale error is
     worse than a gone one: the text is never at risk, and the banner has
     said its piece. */
  useEffect(() => {
    if (!swept) return;
    const id = setTimeout(() => setSwept(null), 9000);
    return () => clearTimeout(id);
  }, [swept]);

  useEffect(() => {
    if (!err) return;
    const id = setTimeout(() => setErr(""), 12000);
    return () => clearTimeout(id);
  }, [err]);
  /* --------------------------- sorting ----------------------------- */
  const plannedSortAuthority = useRef(new PlannedSortAuthority(setFinalizingCaptureIds));
  /**
   * Ask the server to sort a capture. Throws SortError with the reason.
   *
   * `force` is for when the destination is already decided and only the
   * wording needs working out — pulling an action out of a fragment, or a
   * capture that started with /action, /thread or /intention.
   */
  const requestSort = async (
    raw: string,
    force?: "action" | "thread" | "intention",
    /* Every attached photo. Image-dependent sorting is authorized only when
       all referenced bytes were loaded; callers fail closed before this seam. */
    imgSrcs?: string[],
    plannedCaptureId?: string,
    plannedSignal?: AbortSignal,
  ) => requestBoardSort({
    request: fetch, board: latest.current, raw, forgottenRules, force,
    imageSources: imgSrcs, captureId: plannedCaptureId, signal: plannedSignal,
    noteVia, errorFor: (message) => new SortError(message),
  });

  /** Fold a sorted result into a board. Shared by first capture and re-sort. */
  /* applySorted moved to @/lib/boardOps (pure, unit-tested). */

  /** Ask the server to rewrite a thread's summary. Throws SortError. */
  const requestSummary = async (
    threadId: string,
    name: string,
    frags: Frag[]
  ): Promise<{ summary: string; next: string | null; belongs: string | null }> => {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        frags: frags.filter((frag) => !frag.unsorted).map((f) => ({ at: f.at, text: f.text })),
        open: latest.current.actions
          .filter((a) => !a.done && !a.unsorted)
          .slice(0, 30)
          .map((a) => a.text),
        /* The neighbours, so this thread can describe its own edges. A
           summary written alone can never say "that goes next door". */
        siblings: semanticSiblingNames(latest.current.threads, threadId).slice(0, 40),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new SortError(body.error);
    }
    const out = await res.json();
    return {
      summary: out.summary,
      next: out.next ?? null,
      belongs: out.belongs ?? null,
    };
  };

  /* Summaries wait, and rapid captures collapse into one.
 
     A capture costs a sort of roughly 3,700 tokens; the summary that
     follows costs another 2,300. The fastest provider allows 8,000 a
     minute, so two captures in quick succession pushed the second onto a
     weaker model — which is the intermittent "sometimes it is fine,
     sometimes it is stupid" that has no pattern from the outside.
 
     The summary is background work: nobody is waiting on it, and rewriting
     it three times while someone is mid-flow was always wasted anyway. So
     it is deferred, and a further capture into the same thread resets the
     timer — three captures in a minute now produce one summary instead of
     three, and leave the sort with room to run on the good model. */
  const summaryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const SUMMARY_AFTER_MS = 20_000;

  const scheduleSummary = useCallback((threadId: string) => {
    const timers = summaryTimers.current;
    const pending = timers.get(threadId);
    if (pending) clearTimeout(pending);
    timers.set(
      threadId,
      setTimeout(() => {
        timers.delete(threadId);
        /* Against the board as it is when the timer fires, not as it was
           when the capture landed. */
        if (!latest.current.threads.some((t) => t.id === threadId)) return;
        void regenerate(latest.current, threadId);
      }, SUMMARY_AFTER_MS)
    );
    /* `regenerate` is deliberately not a dependency: it is redefined every
       render, and depending on it would rebuild this scheduler constantly
       for no gain. The timer reads the latest board through a ref when it
       fires, so a stale closure cannot commit stale state. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Nothing half-written left behind when the board unmounts. */
  useEffect(() => {
    const timers = summaryTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  /** Rewrite a thread's "Where this stands" from its current fragments. */
  const activeSummaries = useRef(0);
  const regenerate = async (board: Board, threadId: string): Promise<Board> => {
    const target = board.threads.find((t) => t.id === threadId);
    if (!target?.frags.length || target.temporaryName) return board;
    activeSummaries.current += 1;
    setSummarising("Updating what this thread says now");
    let result = board;
    try {
      /* One retry, because the failure is invisible and permanent: a
         rate-limited summarise left "where this stands" and the next step
         describing a thread two layers ago, with nothing on screen to say
         so and nothing to trigger another attempt until the next capture
         happened to land here. */
      /* Fingerprinted at departure: the reply may only land on the exact
         content it summarized — see lib/summaryAccept (gate 6). */
      const sentFingerprint = threadFingerprint(target);
      const { summary, next, belongs } = await requestSummary(
        target.id,
        target.name,
        target.frags
      ).catch(async () => {
        await new Promise((r) => setTimeout(r, 1200));
        return requestSummary(target.id, target.name, target.frags);
      });
      const accepted = acceptSummary(latest.current, threadId, sentFingerprint, {
        summary,
        next,
        belongs,
      });
      if (!accepted) return latest.current;
      result = accepted;
      await commit(result);
    } catch {
      /* the fragments are saved; the summary can lag */
    } finally {
      activeSummaries.current -= 1;
      if (!activeSummaries.current) setSummarising(null);
    }
    return result;
  };

  /** Manual re-run from the thread view. Unlike the automatic path, a failure
   * is shown rather than swallowed, so a stale summary is never silent.
   */
  const refreshSummary = async (threadId: string) => {
    const target = latest.current.threads.find((t) => t.id === threadId);
    if (!target?.frags.length || target.temporaryName) return;
    setErr("");
    setBusy("Updating what this thread says now");
    try {
      const sentFingerprint = threadFingerprint(target);
      const out = await requestSummary(target.id, target.name, target.frags);
      const accepted = acceptSummary(latest.current, threadId, sentFingerprint, out);
      if (!accepted) return;
      if (!await commit(
        noteCorrection(
          accepted,
          {
            proposalKind: "refresh_summary",
            accepted: true,
            context: target.name,
          }
        )
      )) return;
      setNotice("Summary refreshed.");
      clearNoticeIn(4000);
    } catch (error) {
      setErr(reasonOf(error) + " The summary was left as it was.");
    } finally {
      setBusy(null);
    }
  };

  const sortMounted = useRef(true);
  useEffect(() => {
    sortMounted.current = true;
    return () => { sortMounted.current = false; };
  }, []);

  const resort = async (a: Action, pinned?: SortKind, automaticBudget?: number) => {
    const sentRecovery = exactPendingSnapshot(latest.current, a.id);
    const force = pinned ?? sentRecovery?.force;
    const sentPending = sentRecovery ? latest.current.ledger.find((entry) =>
      entry.id === sentRecovery.pendingId) : undefined;
    const sentCaptureId = sentPending && (sentPending.captureId ?? sentPending.id);
    const attempt = sentCaptureId
      ? plannedSortAuthority.current.begin(sentCaptureId, automaticBudget ?? 55_000)
      : null;
    setErr("");
    if (automaticBudget === undefined) receiptWindow.current!.retire();
    if (!attempt) setBusy("Sorting");
    try {
      const work = async () => {
        const imageIds = a.imgs ?? [];
        const imageSources = await Promise.all(imageIds.map(async (id) => {
          const src = await get(IMG(id));
          if (!src) throw new Error(`missing image ${id}`);
          return src;
        }));
        if (sentRecovery && !snapshotMatchesPending(sentRecovery, latest.current)) return;
        if (attempt && !attempt.authoritative()) return;
        const sorted = await requestSort(
          a.src || a.text || "(image only)",
          force,
          imageSources,
          undefined,
          attempt?.signal,
        );
        if (attempt && !attempt.authoritative()) return;
        if (automaticBudget !== undefined && ("planned" in sorted ||
            typeof sorted.clean !== "string" || !["action", "thread", "both", "intention"].includes(sorted.kind))) {
          throw new Error("invalid legacy recovery response");
        }
        if (force && sorted.kind !== force) throw new Error("command kind conflict");
        const prepared = prepareResortedCapture(latest.current, a, sorted, uid);
        if (!prepared) return;
        if (prepared.kind === "intention") {
          const origin = resortIntentionOrigin(prepared.current, prepared.pending, prepared.out.via);
          if (await expandIntention(
            prepared.current.src || prepared.current.text,
            origin,
            prepared.current,
            !!attempt,
            attempt?.signal,
            attempt?.authoritative,
          )) setPendingSource(prepared.current.id);
          return;
        }
        const durable = await transactDurable((boardNow, tombstonesNow) => {
          if (attempt && !attempt.authoritative()) return { skip: null };
          if (sentRecovery && !snapshotMatchesPending(sentRecovery, boardNow)) return { skip: null };
          const next = prepareResortedCapture(boardNow, a, sorted, uid);
          if (!next || next.kind !== "settled") return { skip: null };
          return {
            next: next.board,
            value: {
              beforeBoard: boardNow,
              beforeTombstones: [...tombstonesNow],
              ...next,
              recorded: next.board,
            },
          };
        }, attempt ? {
          guard: attempt.authoritative,
          signal: attempt.signal,
          finalize: attempt.claimFinalization,
        } : undefined);
        if (durable.status === "failed") {
          if (!attempt?.signal.aborted) {
            setErr("Couldn't save that sort. It is still safely Unsorted.");
          }
          return;
        }
        if (durable.status !== "committed" || !durable.value) return;
        const {
          beforeBoard,
          beforeTombstones,
          current: committedPending,
          out: committedOut,
          applied,
          recorded,
          summaryTargets,
        } = durable.value;
        const { targetId, landed, landedLines, source, landedIds: fresh } = applied;
        captureSnapshot.current = captureUndoSnapshot(
          beforeBoard,
          beforeTombstones,
          recorded,
          durable.tombstones,
          { text: committedPending.src || committedPending.text, captureId: sentCaptureId },
        );
        releaseHeldImages();
        setNoticeUndoable(false);
        setCanUndo(true);
        showReceipt(landed, null, landedLines); setLandedIds(fresh);
        setTab(committedOut.kind === "action" ? "actions" : "threads");
        setSuggestion(computeSuggestion(recorded, committedOut.clean, source));
        if (targetId) {
          if (attempt) scheduleSummary(targetId);
          else await regenerate(recorded, targetId);
        }
        for (const id of summaryTargets) if (id !== targetId) scheduleSummary(id);
      };
      if (attempt) await attempt.run(work());
      else await work();
    } catch (error) {
      if (automaticBudget === undefined &&
          (!sentCaptureId || !plannedSortAuthority.current.claimed(sentCaptureId))) {
        setErr(attempt?.signal.aborted
          ? "Saved here. Sorting is unavailable right now."
          : error instanceof CloudQuotaError
          ? a.unsorted ? error.captureMessage : `${error.message} The item is unchanged.`
          : reasonOf(error) + " It is still here, untouched.");
      }
    } finally {
      attempt?.finish();
      if (!attempt) setBusy(null);
    }
  };

  /**
   * What the distinction actually is, said once, at the only moment it
   * matters.
   *
   * Not an explanation of every filing — that would be a machine narrating
   * itself. This fires only after a correction, when the person has just
   * demonstrated that the difference between these kinds was not obvious,
   * and is therefore the one moment they might want to know it.
   */
  const SHAPE_NOTE: Record<SortKind, string> = {
    action: "An action, then — there is something to close.",
    thread: "A thread, then — nothing to close, so it keeps.",
    intention: "An intention, then — a state, not a task.",
  };

  const runPlannedSort = async (input: PendingRecoverySnapshot) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (!sortMounted.current || !lifetime.active || !snapshotMatchesPending(input, latest.current)) return;
    const deadline = Date.now() + 55_000;
    const attempt = plannedSortAuthority.current.begin(input.captureId, 55_000);
    setAutoSortingIds((ids) => [...new Set([...ids, input.targetId])]);
    if (pendingReceiptRef.current === input.targetId) showReceipt("Saved. Sorting…", input.targetId);
    try {
      if (input.imageIds.length) {
        const pending = latest.current.actions.find((action) => action.id === input.targetId);
        attempt.finish();
        if (pending) await resort(pending, input.force, deadline - Date.now());
        return;
      }
      const work = async () => {
        const response = await requestBoardSort<{ sort?: { items?: SimpleSortItem[] }; via?: string }>({
          request: fetch, board: latest.current, raw: input.source, forgottenRules, force: input.force,
          simple: true, captureId: input.captureId, signal: attempt.signal, noteVia, errorFor: (message) => new SortError(message),
        });
      if (!attempt.authoritative()) return;
      const items = response.sort?.items;
      if (!items?.length) throw new Error("invalid sort response");
      const commanded = input.force === "thread" ? "thought" : input.force;
      if (commanded && items.some((item) => item.kind !== commanded)) throw new Error("sort ignored the command");
      if (!snapshotMatchesPending(input, latest.current)) return;
      /* A capture that is only an intention opens the intention preview. */
      if (items.every((item) => item.kind === "intention")) {
        const pendingEntryForCapture = latest.current.ledger.find((entry) =>
          entry.kind === "pending" &&
          !entry.undone &&
          (entry.captureId ?? entry.id) === input.captureId &&
          (entry.pendingRevision ?? 1) === input.revision
        );
        const expected = pendingEntryForCapture
          ? latest.current.actions.find((action) =>
              action.id === pendingEntryForCapture.targetId && action.unsorted
            )
          : undefined;
        if (!expected || !attempt.authoritative()) return;
        const origin = resortIntentionOrigin(expected, pendingEntryForCapture, response.via);
        if (await expandIntention(input.source, origin, expected, true, attempt.signal, attempt.authoritative)) {
          setPendingSource(expected.id);
        }
        return;
      }
      const durable = await transactDurable<PlannedSettlementResult | null>((current) => {
        if (!attempt.authoritative()) return { skip: null };
        if (!snapshotMatchesPending(input, current)) return { skip: null };
        const settled = settleSimpleSort(current, {
          captureId: input.captureId,
          revision: input.revision,
          items,
          now: stamp(),
          via: response.via,
        });
        return settled.status === "applied"
          ? { next: settled.board, tombstones: settled.tombstones, value: settled }
          : { skip: settled };
      }, {
        guard: attempt.authoritative,
        signal: attempt.signal,
        finalize: attempt.claimFinalization,
      });
      if (
        durable.status !== "committed" ||
        !durable.value ||
        durable.value.status !== "applied"
      ) return;
      const settled = durable.value;
      void completeIntentionDetails(settled.intentionIds, () => latest.current,
        build => transactDurable(current => { const next = build(current); return next ? { next, value: null } : { skip: null }; }),
        () => lifetime.active && sortMounted.current,
      ).catch(() => {
        if (lifetime.active && captureSnapshot.current?.captureId === input.captureId)
          setNotice("Intention saved. Details are unavailable right now.");
      });
      for (const id of settled.summaryThreadIds) scheduleSummary(id);
      playgroundUsage.captureSorted(response.via);
      if (captureSnapshot.current?.captureId !== input.captureId) return;
      const beforeUndo = captureSnapshot.current;
      captureSnapshot.current = captureUndoSnapshot(
        beforeUndo.board,
        beforeUndo.tombstones,
        durable.board,
        durable.tombstones,
        {
          text: beforeUndo.text,
          picIds: beforeUndo.picIds,
          captureId: beforeUndo.captureId,
        },
      );
      setLandedIds([
        ...settled.actionIds,
        ...settled.threadIds,
        ...settled.intentionIds,
      ]);
      const lines = [
        ...(settled.actionIds.length ? ["Actions"] : []),
        ...settled.summaryThreadIds.flatMap((id) => {
          const thread = settled.board.threads.find((item) => item.id === id);
          return thread ? [`Thread: ${thread.name}`] : [];
        }),
        ...(settled.intentionIds.length ? ["Intentions"] : []),
      ];
      if (!lines.length && settled.pendingActionIds.length) {
        showReceipt("Saved. Awaiting sorting or placement", settled.pendingActionIds[0]);
      } else {
        setTab(settled.actionIds.length && !settled.threadIds.length ? "actions" : "threads");
        showReceipt(lines.join(" · "), null, lines);
      }
      setSuggestion(repeatedThought(beforeUndo.board, durable.board, settled.summaryThreadIds));
      };
      await attempt.run(work());
    } catch (error) {
      if (error instanceof CloudQuotaError) {
        if (attempt.authoritative() && snapshotMatchesPending(input, latest.current))
          setErr(error.captureMessage);
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0 && attempt.authoritative() && lifetime.active && sortMounted.current &&
          (typeof navigator === "undefined" || navigator.onLine) &&
          snapshotMatchesPending(input, latest.current)) {
        const pending = latest.current.actions.find((action) => action.id === input.targetId);
        if (pending) {
          attempt.finish();
          await resort(pending, input.force, remaining);
          return;
        }
      }
      const stillPending = latest.current.ledger.some((entry) =>
        entry.kind === "pending" &&
        !entry.undone &&
        (entry.captureId ?? entry.id) === input.captureId &&
        (entry.pendingRevision ?? 1) === input.revision
      );
      if (
        stillPending &&
        pendingReceiptRef.current !== input.targetId &&
        (attempt.authoritative() ||
          (attempt.signal.aborted && !plannedSortAuthority.current.claimed(input.captureId)))
      )
        setErr("Saved here. Sorting is unavailable right now.");
    } finally {
      attempt.finish();
      setAutoSortingIds((ids) => ids.filter((id) => id !== input.targetId));
      if (sortMounted.current && pendingReceiptRef.current === input.targetId &&
          snapshotMatchesPending(input, latest.current)) {
        showReceipt("Saved. Awaiting sorting or placement", input.targetId);
      }
    }
  };

  /** Persist one complete pending envelope before launching one bounded sort. */
  const submit = async (
    dictated = false,
    pinned?: SortKind,
    override?: string,
    pinnedThread?: string,
    existingCaptureId?: string,
    origin?: CaptureOrigin | null
  ) => {
    const composerText = text;
    const composerPics = [...pics];
    const composerTranscript = transcript;
    const submittedRaw = override ?? text;
    const { payload, force, commandCorrection } = resolveCapture(submittedRaw.trim(), pinned);
    const raw = force ? submittedRaw : submittedRaw.trim();
    if (!payload && !composerPics.length) return;
    if (!captureGate.current.enter()) return;
    if (!existingCaptureId && trialExhaustedNow()) {
      captureGate.current.leave();
      playgroundUsage.trialLimitReached();
      setErr(`You have used today's ${TRIAL_LIMIT} captures. Your board is still here.`);
      return;
    }

    setErr("");
    setSwept(null);
    setSuggestion(null);
    if (!pinned) setMisfiled(null);
    receiptWindow.current!.retire();
    const at = stamp();
    const captureId = existingCaptureId ?? uid();
    const ids = { itemId: uid(), ledgerId: uid() };
    const online = typeof navigator === "undefined" || navigator.onLine;
    let durable: DurableMutationResult<{
      before: Board;
      beforeTombstones: Tombstone[];
      staged: ReturnType<typeof stagePlannedRoutingIntake>;
      recoveryStore: ReturnType<PendingRecoveryOrchestrator["nextForIntake"]>;
    }>;
    try {
      durable = await transactDurable((current, currentTombstones) => {
        const staged = stagePlannedRoutingIntake(current, {
          captureId,
          raw,
          payload,
          transcript: (origin?.transcript ?? composerTranscript) || undefined,
          images: composerPics,
          imageIds: origin?.imgs,
          at: origin?.at ?? at,
          dictated: origin?.source === "dictated" || dictated,
          openThreadId: pinnedThread ?? open ?? undefined,
        }, ids);
        let pendingBoard = preserveDraftOrigin(current, staged.board, origin);
        if (force) pendingBoard = {
          ...pendingBoard,
          actions: pendingBoard.actions.map((action) => action.id === staged.target.id
            ? { ...action, pendingForce: force } : action),
        };
        if (commandCorrection) {
          pendingBoard = noteCorrection(pendingBoard, {
            proposalKind: "commanded",
            accepted: true,
            context: payload.slice(0, 160),
            routing: { kind: commandCorrection.kind },
          });
        }
        const recoverySnapshot = exactPendingSnapshot(pendingBoard, staged.target.id);
        if (!recoverySnapshot) throw new Error("pending recovery snapshot mismatch");
        const immediateAttempt = online;
        const recoveryStore = pendingRecovery.current.nextForIntake(
          current,
          recoverySnapshot,
          immediateAttempt ? 1 : 0,
          immediateAttempt ? at + PENDING_RECOVERY_BACKOFF_MS : at,
        );
        return {
          next: pendingBoard,
          entries: [
            ...staged.imageEntries,
            [recoveryStore.key, recoveryStore.serialized] as [string, string],
            [MANUAL_ROUTING_UNDO_KEY, "null"] as [string, string],
          ],
          value: {
            before: current,
            beforeTombstones: [...currentTombstones],
            staged,
            recoveryStore,
          },
        };
      });
    } catch {
      durable = { status: "failed" };
    } finally {
      captureGate.current.leave();
    }
    if (durable.status !== "committed") {
      setErr("Couldn't save that. Your capture is still in the composer.");
      return;
    }
    const { before, beforeTombstones, staged, recoveryStore } = durable.value;
    pendingRecovery.current.adopt(recoveryStore.records);
    const committed = durable.board;

    captureSnapshot.current = captureUndoSnapshot(
      before,
      beforeTombstones,
      committed,
      durable.tombstones,
      {
        text: override ?? composerText,
        picIds: composerPics.map((picture) => picture.id),
        captureId,
      },
    );
    releaseHeldImages();
    setManualUndo(null);
    setNoticeUndoable(false);
    setCanUndo(true);
    showReceipt("Saved. Awaiting sorting or placement", staged.target.id);
    setText((current) => current === composerText ? "" : current);
    setPics((current) => reconcilePersistedComposerImages(current, composerPics, uid));
    setTranscript((current) => current === composerTranscript ? "" : current);
    const expected = latest.current.actions.find((action) => action.id === staged.target.id);
    if (expected && force === "intention") {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return;
      }
      const pending = pendingEntry(latest.current, expected.id);
      const intentionOrigin = resortIntentionOrigin(expected, pending);
      void expandIntention(payload, intentionOrigin, expected, true).then((opened) => {
        if (opened) setPendingSource(expected.id);
      });
      return;
    }
    if (expected && (pinned || pinnedThread || existingCaptureId || origin)) {
      await resort(expected, force);
      return;
    }
    // Image captures use the existing byte-complete legacy path, not text planning.
    const recovery = recoveryStore.records.find((record) => record.targetId === staged.target.id);
    if (recovery) void runPlannedSort(recovery);
  };

  const pendingRecoveryAccess = () => ({ board: () => latest.current,
    allowed: () => hydrationSucceeded.current && lifetime.active, persist: set,
    exclusive: <T,>(work: () => Promise<T>) => durableBoardCommits.current.run(work) });
  usePendingRecoveryWake({ loaded, board: data, orchestrator: pendingRecovery.current,
    access: pendingRecoveryAccess, now: stamp, run: async (snapshot) => {
      return runPlannedSort(snapshot);
    } });

  /* ----------------------- capture suggestion ----------------------- */

  /* computeSuggestion (the deterministic proposal logic) is in @/lib/boardOps. */

  /**
   * The accepted suggestion.
   *   - duplicate: the copy that just landed is removed; the original
   *     stays with its shelf life and notes.
   *   - home: move or merge the capture where it belongs.
   * The landed banner is kept, not cleared: its Undo button is the only
   * way back from a merge that deletes an emptied thread, and the
   * handler's own notice reads as the outcome underneath it.
   */
  const acceptSuggestion = async () => {
    const s = suggestion;
    if (!s) return;
    /* The wording — the rules the personal model learns from — lives in
       lib/suggestionRecord, mirror-tested against dismiss. */
    const { context, rule } = suggestionOutcome(s, true);
    if (s.kind === "duplicate") {
      if (s.sourceKind === "thread") {
        if (!await deleteFrag(s.sourceId, s.sourceFragId!)) return;
        /* The deletion is already durable. Record the learning outcome on the
           latest board; failure keeps the truthful deletion without claiming
           that the correction was saved. */
        await commit(
          noteCorrection(latest.current, {
            proposalKind: "related_suggestion",
            accepted: true,
            context,
            rule,
          })
        );
      } else {
        const dup = latest.current.actions.find((x) => x.id === s.sourceId);
        const saved = await commit(
          noteCorrection(
            {
              ...latest.current,
              actions: latest.current.actions.filter(
                (x) => x.id !== s.sourceId
              ),
            },
            {
              proposalKind: "related_suggestion",
              accepted: true,
              context,
              rule,
            }
          )
        );
        if (!saved) return;
        await backupGate.current.trackMutation(dropUnreferencedImages(dup?.imgs));
      }
      setSuggestion(null);
      setNotice("Removed the duplicate.");
      clearNoticeIn(4000);
      return;
    }
    const applied = s.sourceKind === "action"
      ? await foldActionIntoThread(s.sourceId, s.targetId)
      : s.fragId
        ? await moveFrag(s.sourceId, s.fragId, s.targetId)
        : await mergeThreads(s.targetId, s.sourceId);
    if (!applied) return;
    setSuggestion(null);
    await commit(
      noteCorrection(latest.current, {
        proposalKind: "related_suggestion",
        accepted: true,
        context,
        rule,
      })
    );
  };

  /** Keep it where it landed — and remember that the proposal was waved off,
      so the personal model can weigh it. */
  const dismissSuggestion = async () => {
    const s = suggestion;
    if (!s) return;
    const { context, rule } = suggestionOutcome(s, false);
    if (!await commit(
      noteCorrection(latest.current, {
        proposalKind: "related_suggestion",
        accepted: false,
        context,
        rule,
      })
    )) return;
    setSuggestion(null);
  };

  /* ---------------------------- organize ---------------------------- */

  /**
   * Run the board-wide tidy scan against the latest board.
   *
   * Two passes, both rendered in the one review screen:
   *   - the local scan is instant and free — it shows immediately;
   *   - the model's semantic pass follows — it sees the same idea in
   *     different words, which word-matching never can — and its results
   *     merge in behind the local ones.
   * The app never blocks on the model: if the route fails (no keys, quota
   * spent, network), the local scan stands and the screen notes that the
   * semantic pass is offline.
   */
  /**
   * What the local scan finds without being asked.
   *
   * The badge used to be counted from `organize`, which stays null until
   * the Tidy button is pressed — so the number that exists to prompt the
   * tap only appeared after the tap. The board scan costs nothing (no
   * model, pure string work over the board), so it can run on its own and
   * the button can carry a real number. The model pass stays behind the
   * tap, where it is paid for deliberately.
   */
  /* scanStale, not scanBoard. scanBoard finds everything the word matcher
     can claim — duplicates, merges — and scanStale is the subset the review
     screen actually shows (let_go and revisit_intention; the note on
     scanStale says why the rest was taken off that screen). Counting the
     wider one made the badge promise things the panel could never display:
     "2 to tidy", tap, nothing to tidy. A badge may under-count, because the
     model pass adds rows the tap pays for — it must never over-count. */
  const tidyHint = useMemo(
    () =>
      scanStale(data, dismissedOrganize.current, now).filter(
        (p) => p.confidence === "high"
      ).length,
    [data, now]
  );

  /** Leaving the review. `organize` held the last reading for the whole
      session, and the warm treats a non-null reading as "a review is open,
      do not touch the cache" — so after one Tidy the warm never ran again
      and every tap after the first was cold. Closing the panel clears it;
      the badge falls back to the free local scan, which is what it shows
      before the first tap anyway. */
  const closeOrganize = useCallback(() => {
    setOrganize(null);
    setOrganizeAiStatus("idle");
  }, []);

  /* THE DAILY WRAP.

     It is not a place in the app. There is no tab, no archive and no badge
     to clear: yesterday's reading appears once, above the board, the first
     time Capture is opened on a new day. Look at it or dismiss it; either
     way it stops asking, and the day stays stored so the next wrap can say
     "third day running on bugs".

     Writing is one-shot and guarded, because a wrap is frozen once written:
     a second pass would produce different words for a day the person may
     already have read. */
  /* Which model has been answering lately.
 
     The chain falls through silently — a spent tier must not stop a capture
     landing — but the silence was its own bug: the fastest provider allows
     a fixed number of tokens per minute, and everything over that was
     answered by a weaker model with nothing on screen to say so. Weeks of
     "it randomly got worse" was a rate limit nobody could see. */
  /* What Tidy last read, per thread, so the next run can ask about less. */
  const tidyRead = useRef<TidyRead | null>(null);
  const { degraded, noteVia } = useDegradedProviderStatus();

  const [showWrap, setShowWrap] = useState(false);
  const writingWrap = useRef(false);
  /* Days this tab has already tried. The stored wrap is the real guard, but
     it only works once the commit has landed, and this effect re-runs on
     every board change — so a slow write could be started again from a
     render in between. Attempting a day at most once per session closes
     that window, and costs nothing when the stored guard is doing its job. */
  const wrapTried = useRef(new Set<string>());

  useEffect(() => {
    if (PLAYGROUND || !loaded || writingWrap.current) return;
    const board = latest.current;
    const day = wrapDue(board, board.wraps ?? [], Date.now());
    if (!day || wrapTried.current.has(day)) return;
    wrapTried.current.add(day);
    const body = wrapRequest(board, day, board.wraps ?? []);
    if (!body) return;
    writingWrap.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/wrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return;
        const out = (await res.json()) as Omit<DayWrap, "day" | "at" | "stats">;
        /* Guards and assembly live in lib/wrap.acceptWrap — against the
           board as it is NOW, including the two-devices race. */
        const accepted = out?.line
          ? acceptWrap(latest.current, day, out, Date.now())
          : null;
        if (accepted) await commit(accepted);
      } catch {
        /* No wrap today. The day stays in the ledger, so the next open
           tries again — nothing is lost by failing here. */
      } finally {
        writingWrap.current = false;
      }
    })();
  }, [loaded, data, commit]);

  /** Yesterday's reading, on offer for the whole of today. */
  const wrap = pendingWrap(latest.current.wraps ?? data.wraps ?? [], now);

  /** Read once: the line stays, it just stops calling attention to itself. */
  const dismissWrap = useCallback(async () => {
    const next = markWrapsSeen(latest.current);
    if (next && !await commit(next)) return;
    setShowWrap(false);
  }, [commit]);

  /* TWO THREADS THAT KEEP BEING CONFUSED.
 
     Measured on a real board, one pair caused a third of all misfiling —
     not because the boundary was hard but because it was absent: the same
     kind of thought went to both for months. Three engines failed on it
     identically, so no amount of sorting skill was going to help. The fix
     belongs on the board, and only the person can make it.
 
     This is the one finding that arrives unasked. It is rare — a board of
     nineteen threads produced exactly one pair — and acting on it changes
     how everything files afterwards, which is what earns the interruption.
     Everything else Tidy notices stays behind the button. */
  const [tangle, setTangle] = useState<TangleProposal | null>(null);
  const [tangleBusy, setTangleBusy] = useState(false);
  const tangleTried = useRef(new Set<string>());
  /* The gate's rules (once a day, the nudge, failure gives the day back)
     live in lib/tangleGate as behavior — the hook keeps only persistence. */
  const tangleGate = useRef<TangleGate>(createTangleGate(null));
  const tangleDismissed = useRef<string[]>([]);
  /* Bumped by Tidy to ask for a check on demand. The daily gate exists so
     the app does not interrupt; it should never stop a person who came
     looking. */
  const [tangleNudge, setTangleNudge] = useState(0);
  const tangleHandled = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const asked = await get(TANGLE_ASKED_KEY);
        tangleGate.current = createTangleGate(asked ? Number(asked) : null);
        const raw = await get(TANGLE_DISMISSED_KEY);
        tangleDismissed.current = raw ? JSON.parse(raw) : [];
      } catch {
        tangleDismissed.current = [];
      }
    })();
  }, []);

  useEffect(() => {
    if (PLAYGROUND || !loaded || tangle || tangleBusy) return;
    const board = latest.current;
    const pair = confusedPairs(board).find(
      (p) =>
        !tangleDismissed.current.includes(tangleProposalId(p)) &&
        !tangleTried.current.has(tangleProposalId(p))
    );
    if (!pair) return;
    const from = board.threads.find((t) => t.id === pair.fromId);
    const to = board.threads.find((t) => t.id === pair.toId);
    if (!from?.frags.length || !to?.frags.length) return;

    /* Asked at most once a day. Everything above this is free — the pair
       itself is read off the board's own history with no model involved —
       so the cheap half still runs every time and only the expensive half
       is rationed. */
    const askedFor = tangleNudge > tangleHandled.current;
    if (!tangleGate.current.tryClaim(Date.now(), askedFor)) return;
    tangleHandled.current = tangleNudge;
    tangleTried.current.add(tangleProposalId(pair));
    void set(TANGLE_ASKED_KEY, String(tangleGate.current.askedAt()));
    setTangleBusy(true);
    void (async () => {
      try {
        /* Batched and paced HERE, not inside the route.
 
           The judging has to be split — a whole thread at once is more
           tokens than the fast provider accepts in a minute — but doing the
           splitting server-side made one request that ran for eighty to
           ninety seconds, and every route in this app is capped at sixty.
           It worked on a developer machine and was killed in production
           every single time, which is why this proposal never once appeared
           on the real phone. The client has no such ceiling. */
        const BATCH = 8;
        const PACE_MS = 22_000;
        const rule =
          from.belongs || to.belongs
            ? [
                from.belongs && `"${from.name}": ${from.belongs}`,
                to.belongs && `"${to.name}": ${to.belongs}`,
              ]
                .filter(Boolean)
                .join("\n")
            : undefined;
        const toSide = {
          name: to.name,
          frags: to.frags.slice(0, 30).map((f) => ({ text: f.text })),
        };

        const found = new Map<string, { id: string; why: string }>();
        let rename: string | null = null;
        const all = from.frags.slice(0, 60);

        for (let i = 0; i < all.length; i += BATCH) {
          if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
          const res = await fetch("/api/untangle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              from: {
                name: from.name,
                frags: all.slice(i, i + BATCH).map((f) => ({ id: f.id, text: f.text })),
              },
              to: toSide,
              rule,
            }),
          });
          /* One failed batch is not a failed proposal: keep what the others
             found rather than throwing the lot away. */
          if (!res.ok) continue;
          const out = (await res.json()) as {
            move?: { id: string; why: string }[];
            rename?: string | null;
          };
          for (const m of out.move ?? []) if (!found.has(m.id)) found.set(m.id, m);
          if (!rename && out.rename) rename = out.rename;
        }

        const live = latest.current.threads.find((t) => t.id === pair.fromId);
        const move = [...found.values()].filter((m) =>
          live?.frags.some((f) => f.id === m.id)
        );
        /* Nothing to say is the common and correct answer. */
        if (!move.length) return;
        setTangle({
          pair,
          move,
          rename,
          fromFrags: (from?.frags ?? []).length,
        });
      } catch {
        /* Give the day back.
 
           The clock was started before the work, and this used to leave it
           started — so an attempt that never produced a proposal still
           cost twenty hours of silence. While the providers were out of
           quota every attempt failed, which meant the callout could not
           appear at all: a board with seven corrections between the same
           two threads went a week without ever being asked about them. The
           symptom read as "it never suggests anything", and the cause was
           this line doing nothing. */
        tangleGate.current.release();
        const back = tangleGate.current.askedAt();
        if (back === null) void del(TANGLE_ASKED_KEY);
        else void set(TANGLE_ASKED_KEY, String(back));
      } finally {
        setTangleBusy(false);
      }
    })();
  }, [loaded, data, tangle, tangleBusy, tangleNudge]);

  /** Move everything ticked, and take the new name if one was offered. */
  const acceptTangle = useCallback(
    async (fragIds: string[], rename: boolean, takeAll = false) => {
      const t = tangle;
      if (!t) return;

      /* The merge math lives in lib/tangleOps — pure, and pinned by
         behavior tests that replay this feature's two shipped bugs. This
         callback owns only what React owns: the correction ledger entry,
         the summary refreshes, and the notice. */
      const out = applyTangleAccept(latest.current, t, fragIds, rename, takeAll);
      if (!out) return;

      /* One correction for the batch. Twenty-one of them would drown the
         signal the correction ledger exists to carry. */
      if (!await commit(
        noteCorrection(out.board, {
          proposalKind: "related_suggestion",
          accepted: true,
          context: out.emptied
            ? `merged ${t.pair.fromName} into ${t.pair.toName}`
            : `untangled ${t.pair.fromName} and ${t.pair.toName}`,
          rule: `Notes like these belong in "${t.pair.toName}", not "${t.pair.fromName}"`,
        })
      )) return;
      setTangle(null);
      /* Both accounts of themselves are now wrong: one gained a pile, the
         other lost one — unless it stopped existing. Once each, after. */
      const after = await regenerate(latest.current, t.pair.toId);
      if (!out.emptied) await regenerate(after, t.pair.fromId);
      setNotice(out.notice);
      clearNoticeIn(5000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tangle, commit]
  );

  /** Waved away: this pair stops being raised on this device. */
  const dismissTangle = useCallback(() => {
    if (tangle) {
      tangleDismissed.current = [
        ...tangleDismissed.current,
        tangleProposalId(tangle.pair),
      ];
      void set(TANGLE_DISMISSED_KEY, JSON.stringify(tangleDismissed.current));
    }
    setTangle(null);
  }, [tangle]);

  /** One in-flight warm at a time, and the clock since the last one. */
  const warming = useRef(false);
  const lastWarm = useRef(0);

  /**
   * Fetch the model's tidy pass into the cache without showing anything.
   *
   * The badge is a free local scan, so it appears the instant something is
   * worth looking at — and then tapping it started a cold model call over
   * the whole board and made the person wait ten to twenty seconds for
   * work that had not begun. The badge was promising a result that did not
   * exist yet.
   *
   * This does the same request `runOrganize` would, and writes only
   * `organizeRead.current`. No state is set, so the rule above holds: the
   * badge does not churn, and an open review is never rewritten under the
   * reader. When the tap comes, the signature matches and the cached read
   * is served instantly.
   *
   * It is deliberately stingy, because a warm spends the same quota a tap
   * would and spends it even if the tap never comes:
   *   - only when the local scan already found something (the badge is up);
   *   - only after the board has been still for a while, which is when a
   *     person is between captures and might actually look;
   *   - at most once every few minutes, so a busy capture session does not
   *     buy a reading per sentence;
   *   - never with a review open, and never on the playground, where the
   *     visitor is spending someone else's quota.
   */
  const warmOrganize = useCallback(async () => {
    if (PLAYGROUND || warming.current) return;
    const sig = boardSignature(latest.current, []);
    if (organizeRead.current?.sig === sig) return;
    warming.current = true;
    lastWarm.current = Date.now();
    try {
      const res = await fetch("/api/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compactBoard(latest.current)),
      });
      if (!res.ok) return;
      const out = (await res.json()) as { proposals?: RawAiProposal[]; via?: string };
      const ai = mapAiProposals(
        compactBoard(latest.current),
        out.proposals ?? []
      );
      /* Against the board as it is NOW, not as it was when the request
         left — a capture mid-flight must invalidate this, not inherit it. */
      const after = boardSignature(latest.current, []);
      if (after !== sig) return;
      aiOrganize.current = ai;
      organizeRead.current = { sig, ai };
    } catch {
      /* A warm that fails costs nothing: the tap falls back to asking. */
    } finally {
      warming.current = false;
    }
  }, []);

  /* Word-match rows are gone from Tidy, by decision (2026-09-01). The
     history, so nobody rebuilds it: raw word-matches shipped and second-
     guessed real filings; a judge was added to keep only the meaningful
     ones (measured: 2 of 8 kept on the good provider, 0 on the weak); the
     survivors still kept appearing and still helped nothing — "it just
     matches words." The panel is the local stale scan plus the model's
     semantic pass, and nothing else. */

  const runOrganize = async () => {
    /* Tidy also asks about a tangled pair.
 
       Two threads that keep swallowing each other's notes is the largest
       clutter a board can have, and the scan below is forbidden to propose
       it — merging threads is the one restructuring this app does not do
       on its own. So the only thing that ever raises it is the daily
       callout, which is easy to miss and, until now, was silenced for
       twenty hours by its own failures. A board with seven corrections
       between the same two threads went a week without being asked.
 
       Tidy is the button people press when the board feels wrong. Pressing
       it should therefore be a way to ask, not just a way to wait: the
       daily gate is there so the app does not interrupt, and it has no
       business stopping someone who came looking. Free either way — the
       pair is read off the board's own history with no model involved. */
    tangleTried.current.clear();
    setTangleNudge((n) => n + 1);

    /* The word-matches, sent to be judged.

       These never reach the panel on their own — scanStale drops them,
       because on a real board word overlap was wrong more often than right
       and a suggestion that is usually wrong teaches you to dismiss the
       panel unread. What the scan is genuinely good at is finding pairs
       worth LOOKING at, cheaply and instantly, and that is what it does
       here: a loose pass proposes candidates and a model that can read the
       notes decides which mean anything.

       One request, so its answers land well before the whole-board pass
       finishes. It runs alongside rather than in front — a judgement that
       never arrives must not hold up everything else.

       Measured on a real board: eight candidates in, two kept, and the
       reasons came back as reasons ("both address design considerations
       for the Retake feature") rather than the evidence restated. The same
       eight sent to a weaker provider kept none, which is why this is
       routed to the measured-best one and why a failure here shows nothing
       rather than falling back to the unjudged claims. Nothing extra is
       exactly what the panel shows today. */
    /* The local scan is shown immediately; the AI results merge in when
       they arrive. Both are read from the LATEST board at their moment, so
       a board change mid-fetch is never overwritten by a stale snapshot. */
    setOrganize(scanStale(latest.current, dismissedOrganize.current));

    /* Asking a model the same question twice does not get the same answer:
       one unchanged board gave 0, then 3, then 3 proposals on consecutive
       taps. That reads as the app changing its mind rather than the person
       changing the board, and it makes the badge untrustworthy. So a
       reading is kept against the exact board it was made about, and
       re-tapping shows that reading again rather than buying a new one.

       The fingerprint is the sync signature — which items exist and how
       fresh each one is — so the cache invalidates itself the moment
       anything actually changes, including a pull from the other device.
       Dismissals are re-applied on the way out rather than being baked in,
       so waving a row away does not cost a re-read. */
    const sig = boardSignature(latest.current, []);
    const cached = organizeRead.current;
    if (cached && cached.sig === sig) {
      setOrganize(
        assemblePanel({
          board: latest.current,
          ai: cached.ai,
          judged: [],
          dismissed: dismissedOrganize.current,
        })
      );
      setOrganizeAiStatus("done");
      return;
    }

    /* Only the threads that actually moved.
 
       Reading the whole board takes three to five minutes, and that is a
       rate limit rather than a tuning problem: 15,000 tokens against an
       allowance of 8,000 a minute is a two-minute floor before the model
       thinks. But a person captures one thought and taps Tidy, and
       eighteen of their nineteen threads are exactly as they were the last
       time it read them. Re-reading those buys nothing but the wait. */
    const planned = planTidy(latest.current, tidyRead.current);
    setOrganizeAiStatus("thinking");
    try {
      const whole = compactBoard(latest.current);

      /* One pass per request, paced HERE.
 
         The board is read in groups because the whole of it is more tokens
         than the fast provider accepts in a minute. Doing that grouping
         inside the route made a single request that ran for eighty-odd
         seconds — and every route in this app is capped at sixty, because
         that is the platform's ceiling. It passed on a developer machine
         and was killed in production every time. The client can wait. */
      const PER_PASS = 5;
      const PACE_MS = 22_000;
      const sending = whole.threads.filter((t) =>
        planned.send.some((s) => s.id === t.id)
      );
      const groups: (typeof sending)[] = [];
      for (let i = 0; i < sending.length; i += PER_PASS)
        groups.push(sending.slice(i, i + PER_PASS));
      if (!groups.length) groups.push([]);

      const raw: RawAiProposal[] = [];
      let answeredAny = false;
      for (const [i, threads] of groups.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
        const res = await fetch("/api/organize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...whole,
            threads,
            /* Actions and intentions ride with the first pass only, or the
               same claim comes back once per pass. */
            actions: i === 0 ? whole.actions : [],
            intentions: i === 0 ? whole.intentions : [],
          }),
        });
        /* A failed pass costs its own threads, not the whole review. */
        if (!res.ok) continue;
        const out = (await res.json()) as {
          proposals?: RawAiProposal[];
          via?: string;
        };
        answeredAny = true;
        raw.push(...(out.proposals ?? []));
      }
      if (!answeredAny) {
        setOrganizeAiStatus("offline");
        return;
      }

      /* Mapped against the WHOLE board: a proposal names ids, and the ids
         have to resolve against everything, not only what was sent. */
      const fresh = mapAiProposals(whole, raw);
      const allThreadIds = new Set(latest.current.threads.map((t) => t.id));
      const ai = [
        ...keepProposals(aiOrganize.current, planned.unchanged, allThreadIds),
        ...fresh,
      ];
      tidyRead.current = planned.read;
      aiOrganize.current = ai;
      organizeRead.current = { sig: boardSignature(latest.current, []), ai };
      setOrganize(
        assemblePanel({
          board: latest.current,
          ai,
          judged: [],
          dismissed: dismissedOrganize.current,
        })
      );
      setOrganizeAiStatus("done");
    } catch {
      /* The model is a bonus layer; its absence never breaks the scan. */
      setOrganizeAiStatus("offline");
    }
  };

  /* The warm runs on a lull, not on a change: the timer restarts on every
     board change, so a capture session never reaches the end of it and
     only the pause afterwards does. Every reason not to warm lives in
     warmDelay, where it can be argued with in a test. */
  useEffect(() => {
    const wait = warmDelay({
      playground: PLAYGROUND,
      hint: tidyHint,
      reviewOpen: organize !== null,
      sig: boardSignature(latest.current, []),
      cachedSig: organizeRead.current?.sig ?? null,
      inFlight: warming.current,
      lastWarmAt: lastWarm.current,
      now: Date.now(),
    });
    if (wait === null) return;
    const t = setTimeout(() => void warmOrganize(), wait);
    return () => clearTimeout(t);
  }, [tidyHint, data, organize, warmOrganize]);

  /* No automatic re-scan on board changes — by design. A live scan would
     make the badge (and an open review) churn as the board shifts under
     the user: a sync pull adds an item and the count jumps, a sweep fades
     an action and a duplicate vanishes, the AI pass lands late and items
     appear after the fact. The review the user asked for stays exactly as
     it was when they asked; only the rows they act on (or wave off) leave
     the list. A fresh scan happens when they press the button again. */

  /* Commit a tidy change together with whatever it teaches the sorter —
     lib/organizeOps owns which kinds teach anything at all. */
  const commitTidy = async (p: OrganizeProposal, next: Board): Promise<boolean> => {
    const note = organizeCorrection(p);
    return commit(note ? noteCorrection(next, note) : next);
  };

  /**
   * Apply one Organize proposal. Each kind routes through the same handlers
   * the capture suggestions use, so the outcome and its ledger record are
   * consistent with the rest of the app. Returns whether the change was
   * applied — an extraction that failed leaves its card in the list so the
   * user can retry; everything else applies or is already resolved.
   *
   * The mutation on its own, with no undo bookkeeping: split out so that
   * "Approve all" can wrap a whole run in a SINGLE snapshot, because the
   * user watched one gesture change many rows and one Undo has to put all
   * of them back.
   */
  const applyOrganizeProposal = async (
    p: OrganizeProposal
  ): Promise<boolean> => {
    const id = p.id;
    const acknowledge = () => {
      aiOrganize.current = aiOrganize.current.filter((item) => item.id !== id);
      setOrganize((current) =>
        current ? current.filter((item) => item.id !== id) : current
      );
      return true;
    };
    if (p.kind === "dup_action") {
      const a = latest.current.actions.find((x) => x.id === p.sourceId);
      /* Held, not dropped: this delete is undoable, and destroying the
         bytes here would restore an action pointing at a missing photo. */
      if (!await commitTidy(p, {
        ...latest.current,
        actions: latest.current.actions.filter((x) => x.id !== p.sourceId),
      })) return false;
      holdImages(a?.imgs);
      showTidyNotice(`Removed the duplicate of ${p.targetName}.`);
      return acknowledge();
    } else if (p.kind === "dup_fragment") {
      const out = applyFragDelete(latest.current, p.sourceThreadId!, p.sourceFragId!);
      if (!out || !await commitTidy(p, out.board)) return false;
      holdImages(out.imgs);
      if (out.removedThread) setOpen(null);
      else await regenerate(out.board, p.sourceThreadId!);
      showTidyNotice(`Removed the duplicate of ${p.targetName}.`);
      return acknowledge();
    } else if (p.kind === "fold_action") {
      const out = applyActionFold(latest.current, p.sourceId, p.targetId, stamp(), uid);
      if (!out || !await commitTidy(p, out.board)) return false;
      if (!out.already) await regenerate(out.board, p.targetId);
      showTidyNotice(
        out.already
          ? `${out.threadName} already has this note — task retired.`
          : `Moved into ${out.threadName}.`,
      );
      return acknowledge();
    } else if (p.kind === "looks_done") {
      /* The label, not a deletion: the note stays in its thread with a
         "resolved" mark, and an open action born from the same note is
         ticked in the same gesture — lib/fragOps owns both. No correction
         is recorded: resolving says nothing about how captures are FILED. */
      const out = applyFragResolve(
        latest.current,
        p.sourceThreadId ?? p.sourceId,
        p.sourceFragId!,
        stamp()
      );
      if (!out || !await commit(out.board)) return false;
      showTidyNotice(
        out.tickedActionText
          ? "Labeled resolved — its action is ticked off too."
          : "Labeled resolved — the note stays in the thread."
      );
      return acknowledge();
    } else if (p.kind === "let_go") {
      /* Fade it, never delete it. The action moves to Faded exactly as it
         would have if it had a shelf life that ran out — recoverable for
         two weeks, then gone. Getting light must never be a tap you regret,
         and fading is the app's own word for letting something go.

         No correction is recorded: letting go of a stale task says nothing
         about how captures should be FILED, and feeding it to the learning
         loop would teach the sorter a lesson that was never about sorting. */
      const gone = latest.current.actions.find((x) => x.id === p.sourceId);
      if (!gone) return false;
      const at = stamp();
      if (!await commit({
        ...latest.current,
        actions: latest.current.actions.map((x) =>
          x.id === p.sourceId
            ? { ...x, faded: true, fadedAt: at, updatedAt: at }
            : x
        ),
      })) return false;
      showTidyNotice("Let go — it sits in Faded for two weeks if you want it back.");
      return acknowledge();
    } else if (p.kind === "revisit_intention") {
      /* Saying it is still true IS the revisit. Nothing about the intention
         changes except when it was last stood behind, which is exactly what
         was being asked about — so it goes quiet for another two months.

         No correction is recorded: standing by a declared state says
         nothing about how captures should be filed. */
      const still = latest.current.intentions.find((x) => x.id === p.sourceId);
      if (!still) return false;
      const at = stamp();
      if (!await commit({
        ...latest.current,
        intentions: latest.current.intentions.map((x) =>
          x.id === p.sourceId ? { ...x, updatedAt: at } : x
        ),
      })) return false;
      showTidyNotice("Still yours. It won't ask again for a while.");
      return acknowledge();
    } else if (p.kind === "move_fragment" || p.kind === "merge_fragments") {
      const out = applyFragMove(
        latest.current,
        p.sourceThreadId!,
        p.sourceFragId!,
        p.targetId,
        stamp(),
      );
      if (!out || !await commitTidy(p, out.board)) return false;
      const afterTarget = await regenerate(out.board, p.targetId);
      if (!out.emptied) await regenerate(afterTarget, p.sourceThreadId!);
      return acknowledge();
    } else if (p.kind === "split_fragment") {
      const out = applyFragSplit(latest.current, p.sourceThreadId!, p.sourceFragId!, uid);
      if (!out || !await commitTidy(p, out.board)) return false;
      const afterNew = await regenerate(out.board, out.freshId);
      if (!out.emptied) await regenerate(afterNew, p.sourceThreadId!);
      return acknowledge();
    } else if (p.kind === "extract_action") {
      /* Extraction owns its model request and durable commit. Only a committed
         extraction retires this proposal and its deterministic dismissal id. */
      const ok = await extractAction(p.sourceThreadId!, p.sourceFragId!);
      if (!ok) return false;
      dismissedOrganize.current = [...dismissedOrganize.current, p.id];
      void set(ORGANIZE_DISMISSED_KEY, JSON.stringify(dismissedOrganize.current));
      return acknowledge();
    }
    return false;
  };

  /**
   * Arm Undo for a tidy change that has just landed.
   *
   * Organize is the one place the app makes structural changes to a record
   * the user cannot re-derive — a note moves, a task is dropped, an idea is
   * merged into another thread. Every one of those was reviewed and tapped,
   * but "I approved it" and "I meant it" are not the same thing, and the
   * damage from a wrong one shows up later, when the thought is looked for
   * in the place it no longer is. So the same Undo a capture gets applies
   * here: the board and this device's tombstones as they were, restored by
   * the same pure code path.
   */
  const armOrganizeUndo = (before: Board, beforeTombstones: Tombstone[]) => {
    captureSnapshot.current = captureUndoSnapshot(
      before,
      beforeTombstones,
      latest.current,
      tombstones.current,
      {},
      false,
    );
    setCanUndo(true);
    setNoticeUndoable(true);
  };

  /* One tidy gesture, one Undo: the board as it was before the first change,
     and the pictures the previous Undo protected released only if it lands. */
  const tidyGesture = async (run: () => Promise<boolean>): Promise<boolean> => {
    const before = latest.current;
    const beforeTombstones = tombstones.current;
    const previouslyHeld = heldImages.current!.release();
    if (!await run()) { holdImages(previouslyHeld); return false; }
    if (previouslyHeld.length) void backupGate.current.trackMutation(dropUnreferencedImages(previouslyHeld));
    armOrganizeUndo(before, beforeTombstones);
    return true;
  };

  const acceptOrganize = async (id: string): Promise<boolean> => {
    const p = organize?.find((x) => x.id === id);
    return !!p && tidyGesture(() => applyOrganizeProposal(p));
  };

  /* A Clean up batch (lib/cleanup) — old photos or one-liners — lands as one
     commit behind one Undo; the pictures it drops wait until that Undo expires. */
  const applyCleanup = (change: (board: Board) => CleanupChange | null) => tidyGesture(async () => {
    const out = change(latest.current);
    if (!out || !await commit(out.board)) return false;
    holdImages(out.imgs);
    out.threads.forEach(scheduleSummary);
    showTidyNotice(out.notice);
    return true;
  });

  /**
   * Approve every proposal on the board at once — the "Approve all" button.
   * Each row routes through the same per-kind application as a single tap
   * (duplicates drop, notes move, tasks lift out), sequentially so later
   * proposals always read the latest board. Extractions that fail stay in
   * the list; the summary notice says exactly how many were applied. The
   * user confirms the bulk action in a modal before this is ever reached.
   */
  const acceptOrganizeAll = async () => {
    const list = organize ?? [];
    if (!list.length || applyingOrganize.current) return;
    applyingOrganize.current = true;
    let applied = 0;
    /* ONE snapshot for the whole run, taken before the first row lands.
       Approve-all is the most destructive gesture in the app — a single tap
       can drop duplicates, move notes and merge threads' contents together
       — so Undo has to take the whole run back, not just the last row.
       A row that throws must not brick the button for the rest of the
       session — the guard is cleared even when a handler misbehaves. */
    try {
      await tidyGesture(async () => {
        for (const p of list) if (await applyOrganizeProposal(p)) applied++;
        return applied > 0;
      });
    } finally {
      applyingOrganize.current = false;
    }
    if (applied) showTidyNotice(approveAllNotice(applied, list.length));
  };

  /** Wave an Organize proposal off — remembered by id so it never reappears,
      and recorded in the correction ledger as a waved-off merge. */
  const dismissOrganize = async (id: string) => {
    const p = organize?.find((x) => x.id === id);
    if (!p) return;
    const next = noteCorrection(latest.current, {
      proposalKind: "related_suggestion",
      accepted: false,
      context: `kept "${p.sourceName}" separate from "${p.targetName}"`,
    });
    if (!await commit(next)) return;
    aiOrganize.current = aiOrganize.current.filter((x) => x.id !== id);
    setOrganize((cur) =>
      cur ? cur.filter((x) => x.id !== id) : cur
    );
    dismissedOrganize.current = [...dismissedOrganize.current, id];
    void set(ORGANIZE_DISMISSED_KEY, JSON.stringify(dismissedOrganize.current));
  };

  /* ---------------------------- actions ----------------------------- */

  /** Ticking an action completes it — and completion removes it. The
      app's promise is that a finished task stops existing; keeping a
      done list would make ticking the start of a new chore. */
  const toggleAction = async (id: string) => {
    /* The tick receipt and its double-tap guard live in lib/actionOps. */
    const out = applyActionDone(latest.current, id, stamp());
    if (!out) return;
    if (!await commit(out.board)) return;
    /* Bytes AFTER the durable board attempt. A refused commit leaves both the
       action and its pictures untouched. */
    if (out.imgs.length) void backupGate.current.trackMutation(dropUnreferencedImages(out.imgs));
  };

  const setShelf = (id: string, span: number | null, label: ShelfLife) =>
    commit({
      ...latest.current,
      actions: latest.current.actions.map((a) =>
        a.id === id
          ? {
              ...a,
              shelf: label,
              expires: span ? stamp() + span : null,
              faded: false,
              fadedAt: null,
            }
          : a
      ),
    });

  const restore = (id: string) => setShelf(id, null, "keep");

  const removeNow = async (a: Action) => {
    if (!await commit({
      ...latest.current,
      actions: latest.current.actions.filter((x) => x.id !== a.id),
    })) return;
    await backupGate.current.trackMutation(dropUnreferencedImages(a.imgs));
    setShelfFor(null);
  };
  const clearManualPendingState = (shown: Action) => {
    if (pendingIntentionSource.current?.id === shown.id) {
      intentionLedger.current = null; pendingIntentionSource.current = null;
      setPendingSource(null); setDraft(null);
    }
    captureSnapshot.current = null;
    releaseHeldImages();
    setNoticeUndoable(false);
    setCanUndo(false);
  };
  const { manualSort, manualSplit, manualUndo, setManualUndo, restoreManualReceipt, undoManual } = useManualFiling({
    read: () => latest.current,
    authority: plannedSortAuthority.current,
    transact: transactDurable,
    now: stamp,
    clearPending: clearManualPendingState,
    fail: setErr,
    notice: (message) => { setNotice(message); clearNoticeIn(4500); },
    receipt: showReceipt,
    retire: () => receiptWindow.current!.retire(),
    highlight: setLandedIds,
    tab: setTab,
    open: setOpen,
    summarize: scheduleSummary,
  });
  const editUnsorted = async (id: string, text: string): Promise<boolean> => {
    const pending = latest.current.ledger.find((entry) =>
      entry.kind === "pending" && !entry.undone && entry.targetId === id
    );
    if (!pending) return false;
    const captureId = pending.captureId ?? pending.id;
    const owner = plannedSortAuthority.current.claim(captureId);
    if (!owner) return false;
    try {
      const durable = await transactDurable((current) => {
        const next = editUnsortedCapture(current, id, text);
        return next ? { next, value: true } : { skip: false };
      });
      if (durable.status !== "committed") {
        setErr("Couldn't save that. Your last capture is still on screen — try again.");
        return false;
      }
      plannedSortAuthority.current.cancel(captureId);
      if (captureSnapshot.current?.captureId === captureId) {
        captureSnapshot.current.text = text.trim();
      }
      return true;
    } finally {
      plannedSortAuthority.current.release(captureId, owner);
    }
  };

  const removeUnsorted = async (a: Action): Promise<boolean> => {
    const pending = latest.current.ledger.find((entry) =>
      entry.kind === "pending" && !entry.undone && entry.targetId === a.id
    );
    if (!pending) return false;
    const captureId = pending.captureId ?? pending.id;
    const owner = plannedSortAuthority.current.claim(captureId);
    if (!owner) return false;
    try {
      const durable = await transactDurable((current) => {
        const next = removeUnsortedCapture(current, a);
        return next ? { next, value: true } : { skip: false };
      });
      if (durable.status !== "committed") {
        setErr("Couldn't save that. Your last capture is still on screen — try again.");
        return false;
      }
      plannedSortAuthority.current.cancel(captureId);
      if (a.imgs?.length) void backupGate.current.trackMutation(dropUnreferencedImages(a.imgs));
      return true;
    } finally {
      plannedSortAuthority.current.release(captureId, owner);
    }
  };

  const moveToThread = async (a: Action) => {
    const out = applyActionToNewThread(latest.current, a.id, uid);
    if (!out || !await commit(out.board)) return;
    setTab("threads");
  };

  /**
   * Fold a captured action into an existing thread — the accepted "this
   * belongs with X" suggestion. The action becomes a fragment of the thread
   * (interleaved by date, images carried over) and the thread is re-summarised.
   */
  const foldActionIntoThread = async (actionId: string, threadId: string): Promise<boolean> => {
    /* The dedupe safety net (approve-all can never stack copies) and the
       fold-as-correction lesson both live in lib/actionOps. */
    const out = applyActionFold(latest.current, actionId, threadId, stamp(), uid);
    if (!out) return false;
    if (!await commit(
      out.corrected
        ? noteCorrection(out.board, {
            proposalKind: "refiled",
            accepted: true,
            context: out.foldedText.slice(0, 160),
            routing: { kind: "thread", threadId, threadName: out.threadName },
          })
        : out.board
    )) return false;
    setNotice(
      out.already
        ? `${out.threadName} already has this note — task retired.`
        : `Moved into ${out.threadName}.`
    );
    clearNoticeIn(4500);
    if (!out.already) await regenerate(latest.current, threadId);
    return true;
  };

  /* ---------------------------- threads ----------------------------- */

  /**
   * A quiet proofread pass over a typed edit. Never blocks or fails the
   * save: the user's text lands first, and if the pass finds slips the
   * corrected wording replaces it with a notice saying so. A failure or a
   * rate-limit simply leaves the edit as typed — nothing is ever lost.
   */
  const proofreadEdit = async (text: string): Promise<string> => {
    if (!text.trim() || text.length > 4000) return text;
    try {
      const res = await fetch("/api/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "proofread", text }),
      });
      if (!res.ok) return text;
      const out = (await res.json()) as { text?: string };
      const fixed = out.text?.trim();
      return fixed && fixed !== text ? fixed : text;
    } catch {
      return text;
    }
  };

  const editActionText = async (id: string, text: string) => {
    // A save that changed nothing spends no model call and no push.
    if (latest.current.actions.find((a) => a.id === id)?.text === text) return;
    // The edit lands immediately — saving never waits on a model call.
    await commit({
      ...latest.current,
      actions: latest.current.actions.map((a) => (a.id === id ? { ...a, text } : a)),
    });
    // Then the proofread pass catches typos before they stick. Only applied
    // if the action still reads as the text we checked — a newer edit is
    // never clobbered by a stale correction.
    const fixed = await proofreadEdit(text);
    if (fixed !== text) {
      const current = latest.current;
      const a = current.actions.find((x) => x.id === id);
      if (a && a.text === text) {
        await commit(
          noteCorrection(
            {
              ...current,
              actions: current.actions.map((x) =>
                x.id === id ? { ...x, text: fixed } : x
              ),
            },
            {
              proposalKind: "clean_fragment",
              accepted: true,
              context: a.text.slice(0, 120),
              correctionText: fixed.slice(0, 120),
            }
          )
        );
        setNotice("Fixed a couple of typos.");
        clearNoticeIn(4000);
      }
    }
  };

  /**
   * Set (or clear) a thread's cover.
   *
   * Display only: the summary, the fragments and the sort engine never see
   * it. It rides the normal commit path, so it stamps, syncs and lands on
   * the other device like any other thread edit — and a photo cover's bytes
   * travel by the same image reconcile as any other picture.
   */
  const setThreadCover = (id: string, cover: string | null) => {
    const t = latest.current.threads.find((x) => x.id === id);
    if (!t || (t.cover ?? null) === cover) return;
    void commit({
      ...latest.current,
      /* Clearing drops the key rather than storing null, so a coverless
         thread serialises exactly as it did before covers existed. */
      threads: latest.current.threads.map((x) => {
        if (x.id !== id) return x;
        if (cover) return { ...x, cover };
        const next = { ...x };
        delete next.cover;
        return next;
      }),
    });
  };
  const renameThread = async (id: string, name: string) => {
    const renamed = applyThreadRename(latest.current, id, name);
    if (!renamed) return;
    await commit(renamed.wasTemporary ? renamed.board : noteCorrection(renamed.board, {
      proposalKind: "rename_thread", accepted: true, context: renamed.previous,
      correctionText: name, rule: `threads get named "${name}"`,
    }));
    await regenerate(latest.current, id);
  };
  /**
   * Add pictures to a note that already exists.
   *
   * A photo could only ever be attached at the moment of capture, which is
   * the one moment you often do not have it — the screenshot arrives after
   * the thought. The bytes go to IndexedDB under a fresh id and the note
   * keeps the id, exactly as a captured photo does, so everything
   * downstream already works: the thread view reads them by id,
   * reconcileImages uploads and re-fetches them on sync, and a backup
   * carries them.
   */
  const addFragImages = async (
    threadId: string,
    fragId: string,
    srcs: string[]
  ) => {
    if (!srcs.length) return;
    const ids: string[] = [];
    for (const src of srcs) {
      const id = uid();
      try {
        await imgSave(id, src);
        ids.push(id);
      } catch {
        /* out of disk — skip this one rather than lose the note */
      }
    }
    if (!ids.length) return;
    const next = {
      ...latest.current,
      threads: latest.current.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              frags: t.frags.map((f) =>
                f.id === fragId ? { ...f, imgs: [...(f.imgs || []), ...ids] } : f
              ),
            }
          : t
      ),
    };
    await commit(next);
  };

  const editFrag = async (threadId: string, fragId: string, text: string) => {
    // The edit lands immediately — saving never waits on a model call. A
    // save that changed nothing spends neither (fragOps returns null).
    const next = applyFragEdit(latest.current, threadId, fragId, text);
    if (!next) return;
    await commit(next);
    // A confirmed manual correction is authoritative, not a proofreading
    // proposal. Rebuild only derived metadata; never rewrite these words.
    await regenerate(latest.current, threadId);
  };

  const deleteFrag = async (threadId: string, fragId: string): Promise<boolean> => {
    /* Idempotency, empty-thread removal, and the image handover all live
       in fragOps — a double-tap comes back null before any work. */
    const out = applyFragDelete(latest.current, threadId, fragId);
    if (!out || !await commit(out.board)) return false;
    await backupGate.current.trackMutation(dropUnreferencedImages(out.imgs));
    if (out.removedThread) {
      setOpen(null);
      return true;
    }
    await regenerate(out.board, threadId);
    return true;
  };

  /**
   * Move one fragment to another thread.
   *
   * The sorter puts a fragment on the wrong thread often enough that the only
   * remedy being "delete it and say it again" was a real loss. Both threads
   * are re-summarised afterwards.
   */
  const moveFrag = async (fromId: string, fragId: string, toId: string): Promise<boolean> => {
    /* The board math, the time-order landing, and the refile lesson (a
       note moved out within minutes of landing is the sorter being told it
       was wrong, with the right home attached) all live in fragOps. */
    const out = applyFragMove(latest.current, fromId, fragId, toId, stamp());
    if (!out) return false;
    const next = out.corrected
      ? noteCorrection(out.board, {
          proposalKind: "refiled",
          accepted: true,
          context: out.movedText.slice(0, 160),
          routing: { kind: "thread", threadId: toId, threadName: out.toName },
        })
      : out.board;
    if (!await commit(next)) return false;
    setNotice(
      out.emptied
        ? `Moved to ${out.toName}. ${out.fromName} was left empty and removed.`
        : out.corrected
          ? `Moved to ${out.toName} — noted for next time.`
          : `Moved to ${out.toName}.`
    );
    clearNoticeIn(4500);

    if (out.emptied) setOpen(toId);
    const afterTo = await regenerate(next, toId);
    if (!out.emptied) await regenerate(afterTo, fromId);
    return true;
  };

  /** Split a fragment out into a thread of its own. */
  /** The by-hand label — for the backlog of things done in real life
      that the board was never told about. Tidy can only claim what the
      board's own evidence shows; this is how a person sweeps the rest.
      lib/fragOps owns both directions. */
  const resolveFrag = async (threadId: string, fragId: string) => {
    const out = applyFragResolve(latest.current, threadId, fragId, stamp());
    if (!out || !await commit(out.board)) return;
    setNotice(
      out.tickedActionText
        ? "Labeled resolved — its action is ticked off too."
        : "Labeled resolved."
    );
    clearNoticeIn(4000);
  };

  const unresolveFrag = async (threadId: string, fragId: string) => {
    const next = applyFragUnresolve(latest.current, threadId, fragId, stamp());
    if (!next) return;
    await commit(next);
  };

  const moveFragToNew = async (fromId: string, fragId: string): Promise<boolean> => {
    const out = applyFragSplit(latest.current, fromId, fragId, uid);
    if (!out || !await commit(out.board)) return false;
    setOpen(out.freshId);
    setNotice(`Split into a new thread. Rename it if the name is wrong.`);
    clearNoticeIn(5000);

    const afterNew = await regenerate(out.board, out.freshId);
    if (!out.emptied) await regenerate(afterNew, fromId);
    return true;
  };

  const copyFragment = async (threadId: string, fragId: string) => {
    const frag = latest.current.threads
      .find((t) => t.id === threadId)
      ?.frags.find((f) => f.id === fragId);
    if (!frag) return;
    const ok = await copyToClipboard(frag.text, lifetime.assertDisclosure);
    setNotice(ok ? "Note copied." : "Couldn't reach the clipboard.");
    clearNoticeIn(3000);
  };

  const copyWhole = async (s: { text: string; summary: string } | null) => {
    if (!s) return;
    const ok = await copyToClipboard(s.text, lifetime.assertDisclosure);
    setNotice(ok ? `Copied — ${s.summary}.` : "Couldn't reach the clipboard.");
    clearNoticeIn(3000);
  };

  /**
   * Pull a doable thing out of a fragment.
   *
   * The fragment stays where it is. Everywhere else these moves consume the
   * source, but a thread is a record of thinking and lifting the sentence out
   * would leave a hole in it.
   */
  /**
   * "Next: …" under a thread's summary, taken.
   *
   * The step goes through the sorter like any capture — cleaned, given a
   * shelf life, recorded — and the thread stops offering it. Taking it is
   * a signal worth keeping: the record shows the board named a move and
   * the person agreed.
   */
  const takeNext = async (threadId: string) => {
    const thread = latest.current.threads.find((t) => t.id === threadId);
    const step = thread?.next;
    if (!thread || !step) return;
    setErr("");
    setBusy("Adding the step");
    try {
      const out = await requestSort(step, "action");
      const span = SHELF[(out.shelfLife || "keep") as ShelfLife] ?? null;
      const action: Action = {
        id: uid(),
        text: out.actions?.[0] || out.title || step,
        done: false,
        at: stamp(),
        src: step,
        imgs: [],
        shelf: (out.shelfLife || "keep") as ShelfLife,
        expires: span ? stamp() + span : null,
        threadId,
      };
      if (!await commit(
        noteCorrection(
          {
            ...latest.current,
            actions: [action, ...latest.current.actions],
            threads: latest.current.threads.map((t) =>
              t.id === threadId ? { ...t, next: null, nextDismissed: step } : t
            ),
          },
          {
            proposalKind: "next_step",
            accepted: true,
            context: step.slice(0, 120),
          }
        )
      )) return;
      setNotice("Added to your actions.");
      clearNoticeIn(5000);
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was added.");
    } finally {
      setBusy(null);
    }
  };

  /** Not now: the step stays hidden until the thread names a different one. */
  const dismissNext = async (threadId: string) => {
    const thread = latest.current.threads.find((t) => t.id === threadId);
    if (!thread?.next) return;
    await commit({
      ...latest.current,
      threads: latest.current.threads.map((t) =>
        t.id === threadId ? { ...t, nextDismissed: t.next ?? undefined } : t
      ),
    });
  };

  const extractAction = async (threadId: string, fragId: string) => {
    const frag = latest.current.threads
      .find((t) => t.id === threadId)
      ?.frags.find((f) => f.id === fragId);
    /* The note is gone — nothing was applied, so the caller keeps the card
       listed rather than pretending the extraction succeeded. */
    if (!frag) return false;

    setErr("");
    setBusy("Finding the action");
    try {
      const out = await requestSort(frag.text, "action");
      const items: Action[] = (out.actions?.length ? out.actions : [out.title]).map(
        (t: string) => {
          const span = SHELF[(out.shelfLife || "keep") as ShelfLife] ?? null;
          return {
            id: uid(),
            text: t,
            done: false,
            at: stamp(),
            src: frag.text,
            imgs: [],
            shelf: (out.shelfLife || "keep") as ShelfLife,
            expires: span ? stamp() + span : null,
            threadId,
          };
        }
      );
      if (!await commit(
        noteCorrection(
          {
            ...latest.current,
            actions: [...items, ...latest.current.actions],
          },
          {
            proposalKind: "extract_action",
            accepted: true,
            context: frag.text.slice(0, 120),
          }
        )
      )) return false;
      setNotice(
        `${count(items.length, "action")} taken from this note. The note stays here.`
      );
      clearNoticeIn(5000);
      setBusy(null);
      return true;
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was added.");
      setBusy(null);
      return false;
    }
  };

  const deleteThread = async (id: string): Promise<boolean> => {
    const out = applyThreadDelete(latest.current, id);
    if (!out || !await commit(out.board)) return false;
    await backupGate.current.trackMutation(dropUnreferencedImages(out.imgs));
    setOpen(null);
    return true;
  };

  /**
   * Fold `fromId` into `intoId`.
   *
   * Fragments are interleaved by date rather than appended, so the merged
   * thread reads as one history, and the summary is rebuilt from the whole.
   */
  const mergeThreads = async (intoId: string, fromId: string): Promise<boolean> => {
    const out = applyThreadMerge(latest.current, intoId, fromId);
    if (!out || !await commit(out.board)) return false;
    setNotice(out.fromName + " folded into " + out.intoName + ".");
    clearNoticeIn(4500);
    await regenerate(out.board, intoId);
    return true;
  };

  /* --------------------------- intentions -------------------------- */

  /** Run raw words through the intention engine and open the review step.
      `ledger` describes the capture that opened this draft; when the draft is
      saved, saveDraft records it in the ledger. Absent for conversions of
      things already captured (an action made into an intention). */
  const expandIntention = async (
    rawInput: string,
    ledger?: CaptureOrigin | null,
    expectedPending?: Action,
    background = false,
    signal?: AbortSignal,
    authoritative?: () => boolean,
  ) => {
    setErr("");
    if (!background) setBusy("Finding the intention");
    try {
      const result = await requestIntentionExpansion(
        fetch, rawInput, latest.current.principles, () => latest.current, expectedPending,
        (message) => new SortError(message),
        signal,
      );
      if (!result || signal?.aborted || (authoritative && !authoritative())) {
        intentionLedger.current = null;
        pendingIntentionSource.current = null;
        return false;
      }
      intentionLedger.current = ledger ?? null;
      pendingIntentionSource.current = expectedPending ?? null;
      if (intentionLedger.current) intentionLedger.current.via = result.via;
      setDraft(result.draft);
      setTab("intentions");
      setOpenIntention(null);
      return true;
    } finally {
      if (!background) setBusy(null);
    }
  };

  /** Save the reviewed draft as a record on the board. */
  const saveDraft = async () => {
    if (!draft) return;
    const expectedPending = pendingIntentionSource.current;
    if (expectedPending && !pendingDraftAction(latest.current, expectedPending, pendingSource)) {
      intentionLedger.current = null;
      pendingIntentionSource.current = null;
      setPendingSource(null); setDraft(null);
      return;
    }
    const at = stamp();
    /* The board math lives in lib/intentionOps — pure and behavior-tested:
       the full rawInput rides on the intention, a converted action retires
       only now, and a capture-born draft writes its ledger entry. This
       callback keeps what React owns. */
    const fromCapture = intentionLedger.current;
    const beforeBoard = latest.current;
    const beforeTombstones = tombstones.current;
    const { board: next, intention } = applySaveDraft(
      beforeBoard,
      draft,
      { pendingSource, capture: fromCapture },
      { intentionId: uid(), ledgerId: uid() },
      at
    );
    if (!await commit(next)) return;
    if (fromCapture) intentionLedger.current = null;
    pendingIntentionSource.current = null;
    /* Saving is the first commit on this path. The capture fork threw the
       snapshot away because a draft can just be discarded — but the moment
       the intention is on the board, discarding is no longer on offer and
       Undo is the only way back, exactly as it is for an action or a
       thread. The words return to the capture box only when they came from
       it; a converted action returns as the action itself. */
    captureSnapshot.current = captureUndoSnapshot(
      beforeBoard,
      beforeTombstones,
      next,
      tombstones.current,
      { text: fromCapture ? draft.rawInput : undefined, captureId: fromCapture?.captureId },
    );
    releaseHeldImages();
    setNoticeUndoable(false);
    setCanUndo(true);
    setDraft(null);
    setPendingSource(null);
    setTab("intentions");
    showReceipt("Intention " + pad(latest.current.intentions.length - latest.current.intentions.findIndex(item => item.id === intention.id)));
    setLandedIds([]);
    /* The receipt expires separately from the saved capture and Undo state. */
  };

  /** Correct an intention classification without losing its source or Undo. */
  const draftToThread = async () => {
    const d = draft;
    if (!d?.rawInput.trim()) return;
    const expectedPending = pendingIntentionSource.current;
    const opened = intentionLedger.current;
    let source = pendingDraftAction(latest.current, expectedPending, pendingSource);
    setPendingSource(null);
    intentionLedger.current = null;
    pendingIntentionSource.current = null;
    setDraft(null);
    if (expectedPending && !source) return;
    const lesson = opened && answeredKindCorrection(d.rawInput, "intention", "thread");
    if (lesson) await commit(noteCorrection(latest.current, lesson));
    if (source) {
      if ((source.src || source.text) !== d.rawInput.trim()) {
        const edited = editUnsortedCapture(latest.current, source.id, d.rawInput);
        if (!edited || !await commit(edited)) return;
        const pending = pendingEntry(latest.current, source.id);
        if (
          pending &&
          captureSnapshot.current?.captureId === (pending.captureId ?? pending.id)
        ) captureSnapshot.current.text = d.rawInput.trim();
        source = latest.current.actions.find((action) => action.id === source!.id);
        if (!source) return;
      }
      await resort(source, "thread");
      return;
    }
    await submit(false, "thread", d.rawInput, undefined, opened?.captureId, opened);
  };

  const discardDraft = async () => {
    const d = draft;
    const fromAction = pendingSource;
    const opened = intentionLedger.current;

    /* Discard goes only to the Record, marked undone so the words remain
       recoverable without creating a board item. An action-born draft writes
       nothing: the existing action already holds its words and stays put. */
    if (!fromAction && d?.rawInput.trim()) {
      if (!await commit(
        withLedger(latest.current, {
          id: uid(),
          captureId: opened?.captureId,
          at: stamp(),
          raw: opened?.raw ?? d.rawInput,
          clean: d.rawInput,
          kind: "intention",
          source: opened?.source ?? sourceOf(d.rawInput, false, false),
          transcript: opened?.transcript,
          /* Nothing was created, so there is nothing to point at — the same
             state an undone capture reaches once its object is removed. */
          targetId: "",
          undone: true,
        })
      )) return;
    }
    setPendingSource(null);
    intentionLedger.current = null;
    pendingIntentionSource.current = null;
    setDraft(null);
    if (fromAction || !d?.rawInput.trim()) return;
    setNotice("Discarded — it's in the record if you want it back");
    clearNoticeIn(6000);
  };

  const updateIntention = (next: Intention) =>
    commit({
      ...latest.current,
      intentions: latest.current.intentions.map((i) =>
        i.id === next.id ? { ...next, updatedAt: stamp() } : i
      ),
    });

  const deleteIntention = async (id: string) => {
    if (!await commit({
      ...latest.current,
      intentions: latest.current.intentions.filter((i) => i.id !== id),
    })) return;
    setOpenIntention(null);
  };

  /**
   * Turn an action into an intention when the sort missed it.
   *
   * Only opens the draft; the action is removed by saveDraft once the draft
   * is saved, and stays put if it is discarded.
   */
  const makeIntention = async (rawInput: string, sourceId: string) => {
    try {
      await expandIntention(rawInput);
      setPendingSource(sourceId);
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was moved.");
    }
  };

  /** Revoke immediately; only confirmed logout permits success navigation. */
  const logout = logoutAndNavigate;

  /* --------------------------- principles -------------------------- */

  const togglePrinciple = (id: string) =>
    commit({
      ...latest.current,
      principles: latest.current.principles.map((p) =>
        p.id === id ? { ...p, enabled: !p.enabled } : p
      ),
    });

  const addPrinciple = (name: string, description: string) =>
    commit({
      ...latest.current,
      principles: [
        ...latest.current.principles,
        { id: uid(), name, description, enabled: true },
      ],
    });

  const deletePrinciple = (id: string) =>
    commit({
      ...latest.current,
      principles: latest.current.principles.filter((p) => p.id !== id),
    });

  /* --------------------------- sharing ----------------------------- */

  /**
   * What the share control would send from wherever you are standing.
   *
   * Deriving the target from the current view is what keeps this to one
   * control: there is no need to say what to share when you are already
   * looking at it, and no row anywhere grows a share button.
   */
  /* Memoized because it builds the full markdown of the open view — typing
     in the capture box re-renders this hook per keystroke, and rebuilding a
     long thread's export each time was measurable jank. */
  const shareable = useMemo(
    () =>
      shareableFor(
        data,
        showRecord
          ? { kind: "record", day: recordDay }
          : openIntention
            ? { kind: "intention", id: openIntention }
            : open
              ? { kind: "thread", id: open }
              : { kind: "tab", tab },
        now
      ),
    [data, showRecord, recordDay, openIntention, open, tab, now]
  );

  /* A thread share carries its photos as real files in the OS sheet — the
     text tells the story, the pictures go along with it. The bytes come from
     IndexedDB, so they are fetched only at the moment of sharing. */
  const doShare = async () => {
    if (!shareable) return;
    const files: File[] = [];
    if (shareable.imgIds?.length) {
      for (const id of shareable.imgIds.slice(0, 4)) {
        try {
          const url = await get(IMG(id));
          if (!url) continue;
          const blob = await (await fetch(url)).blob();
          const ext = blob.type === "image/webp" ? "webp" : "jpg";
          files.push(
            new File([blob], `capture-${id.slice(0, 8)}.${ext}`, {
              type: blob.type || "image/jpeg",
            })
          );
        } catch {
          /* one photo failing to load never blocks the share */
        }
      }
    }
    if (!lifetime.active) return;
    const outcome = await shareText({
      ...shareable,
      files: files.length ? files : undefined,
    }, lifetime.assertDisclosure);
    if (outcome === "cancelled") return;
    setNotice(
      outcome === "shared"
        ? `Shared — ${shareable.summary}.`
        : outcome === "copied"
          ? `Copied to the clipboard — ${shareable.summary}.`
          : "Couldn't share that."
    );
    clearNoticeIn(3500);
  };

  /* ----------------------- getting data in/out ---------------------- */

  /* v3 is created only after the authoritative state and every canonical
     image reference have been verified. */
  const exportBoard = async () => {
    const operation = backupGate.current.start("export");
    if (!operation) return;
    setIoNote(null); setIoBusy("Preparing backup…");
    try {
      const backup = await createBackupClient(lifetime).exportV3(
        { board: latest.current, tombstones: tombstones.current },
        (progress) => setIoBusy(backupProgressText(progress)),
      );
      downloadJSON(backup, backupFilename());
      setIoNote({
        text: `Saved ${count(backup.board.actions.length, "action")}, ${count(backup.board.threads.length, "thread")} and ${count(backup.board.intentions.length, "intention")} — with ${count(Object.keys(backup.images).length, "image")} — to a file. Keep it somewhere that isn't this phone.`,
        ok: true,
      });
    } catch (error) {
      setIoNote({ text: error instanceof Error ? error.message : "The download didn't start.", ok: false });
    } finally {
      backupGate.current.finish(operation);
      setIoBusy(null);
    }
  };

  /** The days this device can roll back to, newest first. */
  const listSnapshots = async (): Promise<string[]> => {
    try {
      return snapshotDays(await keys());
    } catch {
      return [];
    }
  };

  /**
   * Roll the board back to a day's copy.
   *
   * Additive, exactly like a file restore: what is here stays, what the
   * snapshot has and the board lost comes back stamped fresh so it
   * out-ages any tombstone still carrying the deletion. A rollback that
   * could remove things would be a new way to lose work.
   */
  const restoreSnapshot = async (day: string) => {
    setIoNote(null);
    try {
      const raw = await get(snapshotKey(day));
      if (!raw) throw new Error("That day is not on this device any more.");
      const result = stampRestoredAdditions(restoreBackup(
        { app: "capture", version: 2, board: hydrate(JSON.parse(raw)) },
        latest.current,
      ), latest.current, Date.now());
      const added =
        result.actions + result.threads + result.intentions + result.principles;
      if (!await commit(result.board)) throw new Error("That snapshot could not be saved. Your board is unchanged.");
      setIoNote({
        text: added
          ? `Brought back ${count(result.actions, "action")}, ${count(result.threads, "thread")} and ${count(result.intentions, "intention")} from ${snapshotLabel(day)}.`
          : `Nothing was missing — ${snapshotLabel(day)} is already on the board.`,
        ok: true,
      });
    } catch (error) {
      setIoNote({
        text: error instanceof Error ? error.message : "That snapshot wouldn't open.",
        ok: false,
      });
    }
  };
  const restoreFromFile = async (file: File): Promise<void> => {
    const reserved = backupGate.current.startRestore();
    if (!reserved) {
      setIoNote({ text: "Finish the current change before restoring a backup.", ok: false });
      return;
    }
    let pushAfterRestore = false;
    setIoNote(null); setIoBusy("Waiting for current changes…");
    const operation = reserved instanceof Promise ? await reserved : reserved;
    setIoBusy("Opening backup…");
    try {
      const parsed = await readJsonFile(file);
      if ((parsed as { version?: unknown } | null)?.version === 3) {
        const restored = await createBackupClient(lifetime).restoreV3(
          parsed,
          { board: latest.current, tombstones: tombstones.current },
          (progress) => setIoBusy(backupProgressText(progress, true)),
        );
        latest.current = restored.state.board;
        tombstones.current = restored.state.tombstones;
        hubRev.current = null;
        setData(restored.state.board);
        const contentAdded = restored.actions + restored.threads + restored.fragments +
          restored.intentions + restored.principles;
        const historyAdded = restored.ledger + restored.corrections + restored.wraps + restored.completions;
        const added = contentAdded + historyAdded + restored.profile;
        setIoNote(backupRestoreSuccessNotice({
          actions: restored.actions, threads: restored.threads, fragments: restored.fragments,
          intentions: restored.intentions, principles: restored.principles,
          history: historyAdded, images: Object.keys(restored.images).length, added,
        }, lifetime.cloud ? "cloud" : "local"));
        pushAfterRestore = !lifetime.cloud;
        return;
      }

      // v1/v2 compatibility remains additive and keeps destination conflicts.
      const result = stampRestoredAdditions(
        restoreBackup(parsed, latest.current), latest.current, Date.now(),
      );
      const added = result.actions + result.threads + result.intentions + result.principles;
      const board = added ? withLedger(result.board, {
        id: uid(), at: stamp(), raw: file.name,
        clean: `Restored ${count(result.actions, "action")}, ${count(result.threads, "thread")} and ${count(result.intentions, "intention")} from a backup.`,
        kind: result.actions ? "action" : result.threads ? "thread" : "intention",
        source: "import", targetId: "",
      }) : result.board;
      if (!await commit(board, operation, result.images ?? {})) {
        throw new Error("That backup could not be saved. Your existing board is unchanged.");
      }
      setIoNote({
        text: added
          ? `Restored ${count(result.actions, "action")}, ${count(result.threads, "thread")}, ${count(result.intentions, "intention")} and ${count(result.principles, "principle")}.`
          : "Nothing new in that file — everything in it was already here.",
        ok: true,
      });
    } catch (error) {
      setIoNote(error instanceof CloudRestoreLocalCacheError
        ? backupRestoreCloudSavedNotice()
        : error instanceof CloudRestoreOutcomeUnknownError
          ? backupRestoreCloudUnconfirmedNotice()
          : backupRestoreFailureNotice(error));
    } finally {
      backupGate.current.finish(operation);
      setIoBusy(null);
      if (pushAfterRestore) schedulePush();
    }
  };
  const importBackup = async (file: File) => {
    setIoNote(null);
    try {
      const result = importIntentBackup(await readJsonFile(file), latest.current);
      // An import that added anything records itself in the ledger.
      if (!await commit(
        result.added
          ? withLedger(result.board, {
              id: uid(),
              at: stamp(),
              raw: file.name,
              clean: `Brought in ${count(result.added, "intention")} from an intent backup.`,
              kind: "intention",
              source: "import",
              targetId: "",
            })
          : result.board
      )) throw new Error("That import could not be saved. Your board is unchanged.");

      const parts = [`Brought in ${count(result.added, "intention")}`];
      if (result.duplicates) parts.push(`${result.duplicates} already here`);
      if (result.malformed) {
        parts.push(
          `${result.malformed} could not be read and ${result.malformed === 1 ? "was" : "were"} left out`
        );
      }
      if (result.principlesAdded) {
        parts.push(`${count(result.principlesAdded, "new principle")}`);
      }
      setIoNote({ text: parts.join(" · ") + ".", ok: result.added > 0 });
    } catch (error) {
      setIoNote({
        text:
          error instanceof Error ? error.message : "Could not read that file.",
        ok: false,
      });
    }
  };

  /* ---------------------------- distill ---------------------------- */

  /** A half-finished Distill conversation is persisted after every turn. */
  const persistDistill = async (session: DistillSession) => {
    try {
      await set(DISTILL_KEY, JSON.stringify(session));
    } catch {
      /* the session stays on screen; the next turn tries again */
    }
  };

  const openDistill = () => {
    setDistillErr("");
    const drafts = openDistillDraft(text, distillInput);
    if (text.trim() && !distillInput.trim()) {
      setDistillTranscript(transcript);
      setTranscript("");
    }
    setText(drafts.capture); setDistillInput(drafts.distill); setDistillOpen(true);
  };

  const closeDistill = () => {
    const drafts = closeDistillDraft(text, distillInput);
    if (!text.trim() && distillInput.trim()) {
      setTranscript(distillTranscript);
      setDistillTranscript("");
    }
    setText(drafts.capture); setDistillInput(drafts.distill); setDistillOpen(false);
  };

  /** Start a fresh conversation, clearing the saved session. */
  const resetDistill = async () => {
    setSettled(null);
    setDistillErr("");
    setDistillInput("");
    setDistillTranscript("");
    setDistillReady(false);
    const fresh: DistillSession = { id: uid(), at: stamp(), turns: [] };
    setDistillSession(fresh);
    await persistDistill(fresh);
  };

  /**
   * Send one user turn and stream the assistant's clarifying reply back.
   *
   * The user turn is persisted before the request goes out and the completed
   * assistant turn after it lands, so the transcript is never more than one
   * half-answer behind the network.
   */
  const sendDistill = async (raw?: string) => {
    const text = (raw ?? distillInput).trim();
    if (!text || distillBusyRef.current) return;
    if (rejectDistillAtLimit()) return;
    setDistillErr("");
    setSettled(null);
    // A fresh reply re-judges readiness from scratch.
    setDistillReady(false);
    distillBusyRef.current = true;

    // A session from a previous visit may still be hydrating; adopt the disk
    // copy up front so the new turn joins the real conversation and the saved
    // transcript is never briefly replaced by an empty one.
    let base: DistillSession = distillSession;
    if (!distillLoadedRef.current) {
      try {
        const savedRaw = await get(DISTILL_KEY);
        if (savedRaw) {
          const saved = hydrateDistill(savedRaw);
          if (saved.turns.length) base = saved;
        }
      } catch {
        /* keep the in-memory session */
      }
      distillLoadedRef.current = true;
    }

    const withUser = appendDistillUserTurn(
      base, text, stamp(), uid(), raw === undefined ? distillTranscript : undefined,
    );
    setDistillSession(withUser);
    if (raw === undefined) { setDistillInput(""); setDistillTranscript(""); }
    await persistDistill(withUser);

    setDistillBusy(true);
    const assistantTurn = { role: "assistant" as const, text: "", at: stamp() };
    setDistillSession({ ...withUser, turns: [...withUser.turns, assistantTurn] });

    try {
      const res = await fetch("/api/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "chat",
          turns: withUser.turns.map((t) => ({ role: t.role, text: t.text })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new SortError(body.error);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      /* The end-markers are stripped as they stream so they never reach the
         transcript — and therefore never appear on screen or get spoken
         aloud by the voice layer, which chunks the live text as it lands.
         [ready] lights the Distill button; a stray [nothing] is a model
         misfire — stripped and ignored, never allowed to end or clear the
         conversation. Only characters that could begin either marker are
         held back across chunks, so a marker split at a chunk boundary is
         still caught while ordinary text streams with no lag. */
      let carry = "";
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const raw = carry + decoder.decode(value, { stream: true });
          const marker = findMarker(raw);
          if (marker) {
            // Only [ready] means anything; [nothing] is stripped like any
            // other marker and the conversation simply continues.
            if (marker.kind === "ready" && replyCanBeReady(acc + raw.slice(0, marker.at)))
              setDistillReady(true);
            const markerText =
              marker.kind === "ready" ? READY_MARKER : NOTHING_MARKER;
            carry = raw.slice(marker.at + markerText.length);
            acc += raw.slice(0, marker.at);
          } else {
            /* Longest suffix that could start a marker; hold it for the
               next chunk, stream everything before it. */
            const hold = markerHold(raw);
            carry = hold ? raw.slice(-hold) : "";
            acc += raw.slice(0, raw.length - hold);
          }
          // Update the streaming turn in place.
          setDistillSession((s) => ({
            ...s,
            turns: s.turns.map((t, i) =>
              i === s.turns.length - 1 ? { ...t, text: acc } : t
            ),
          }));
        }
      }
      /* Trailing bytes that never completed a marker (end of a normal reply).
         A marker left over here is a model misfire, not a boundary — strip
         it so a stray marker can never reach the screen or the voice. */
      acc += carry
        .split(READY_MARKER)
        .join("")
        .split(NOTHING_MARKER)
        .join("");
      const doneSession: DistillSession = {
        ...withUser,
        turns: [...withUser.turns, { ...assistantTurn, text: acc.trim() }],
      };
      setDistillSession(doneSession);
      await persistDistill(doneSession);
    } catch (error) {
      // A reply that died mid-stream may have set the flag already; without
      // this the button would glow over a transcript with no assistant turn.
      setDistillReady(false);
      setDistillErr(reasonOf(error) + " Your words are saved; ask again.");
      // Drop the trailing assistant turn — whether it never produced text or
      // died mid-answer — so a broken partial reply doesn't stay on the
      // transcript. The user's own words were already persisted above.
      setDistillSession((s) => {
        const turns = s.turns.slice();
        if (turns.at(-1)?.role === "assistant") turns.pop();
        return { ...s, turns };
      });
    }
    setDistillBusy(false);
    distillBusyRef.current = false;
  };

  /**
   * The save-time proofread: speech-to-text artifacts ride into the settled
   * wording, so before anything is filed the engine gets one final pass over
   * exactly what the user reviewed. A failure never blocks the save — the
   * reviewed text goes in untouched rather than the conversation being lost.
   */
  const polishDistill = async (clean: string, actions: string[]) => {
    const res = await fetch("/api/distill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "polish",
        clean,
        actions,
        turns: distillSession.turns.map((t) => ({ role: t.role, text: t.text })),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new SortError(body.error);
    }
    return res.json();
  };

  /** Run the whole conversation through the settling engine. */
  const settleDistill = async () => {
    if (!distillSession.turns.length || distillBusyRef.current) return;
    if (rejectDistillAtLimit()) return;
    setDistillErr("");
    distillBusyRef.current = true;
    setDistillBusy(true);
    try {
      const res = await fetch("/api/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "settle",
          turns: distillSession.turns.map((t) => ({
            role: t.role,
            text: t.text,
          })),
          /* The same thread context the sorter gets, so a conversation can
             continue a subject already on the board instead of starting a
             second thread about it. */
          threads: threadBriefs(latest.current.threads),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new SortError(body.error);
      }
      setSettled(await res.json());
    } catch (error) {
      setDistillErr(reasonOf(error));
    }
    setDistillBusy(false);
    distillBusyRef.current = false;
  };

  /**
   * File the settled result on the board.
   *
   * Action: creates actions with the judged shelf life. Thread: creates a
   * thread carrying the distilled wording as its first fragment, then
   * summarises it. Intention: re-runs the distilled wording through the
   * intention engine and opens the review draft.
   */
  const saveSettled = async (
    clean: string,
    actions: string[],
    shelfLife: string
  ) => {
    if (!settled || distillBusyRef.current) return;
    if (rejectDistillAtLimit()) return;
    const { kind, title } = settled;
    setDistillErr("");
    distillBusyRef.current = true;
    setDistillBusy(true);
    try {
      // A conversation came in through a microphone; the wording the engine
      // settled on can carry speech-to-text artifacts. Fix them before filing
      // — but only when the pass succeeds. The save must never be held hostage
      // by a quota error, so the reviewed text stands in if it fails.
      let finalClean = clean;
      let finalActions = actions;
      let proofreadSkipped = false;
      try {
        const polished = await polishDistill(clean, actions);
        finalClean = polished.clean || clean;
        finalActions = polished.actions?.length
          ? polished.actions
          : actions;
      } catch {
        // Keep the reviewed wording, and say so — a silent skip would look
        // like the proofread never happened. The skip note is folded into the
        // success notice below so it can't be overwritten by it.
        proofreadSkipped = true;
      }
      // Computed after the try/catch so it reads the final flag value.
      const skipNote = proofreadSkipped
        ? " The proofread pass couldn't run — saved as reviewed."
        : "";
      const source = distillSource(distillSession);
      // The route already reconciles this, but the review screen lets the
      // actions be emptied by hand — so guard again here. An action with no
      // task is filed as a thread, never as one action holding the whole
      // conversation.
      const realActions = finalActions.map((a) => a.trim()).filter(Boolean);
      const effectiveKind =
        kind === "action" && realActions.length === 0 ? "thread" : kind;
      if (effectiveKind === "intention") {
        setDistillOpen(false);
        // The reviewed draft records the conversation in the ledger when it
        // is saved (saveDraft consumes the pending ledger note).
        await expandIntention(finalClean, source);
        await resetDistill();
      } else if (effectiveKind === "action") {
        const span = SHELF[shelfLife as ShelfLife] ?? null;
        // One timestamp for the actions and their ledger entry, so the
        // record points at exactly the items it describes.
        const at = stamp();
        /* A deadline said out loud in the conversation counts the same as one
           typed into the capture box: it holds the action on the board until
           its date. Distill used to drop it, so "I'll send it Friday" could
           fade before Friday. */
        const due = parseDue(settled.due, at);
        const items: Action[] = realActions.map((t) => ({
          id: uid(),
          text: t,
          done: false,
          at,
          src: finalClean,
          imgs: [],
          shelf: (shelfLife || "keep") as ShelfLife,
          due,
          expires: expiryFor(span, due, at),
        }));
        if (!await commit(
          withLedger(
            { ...latest.current, actions: [...items, ...latest.current.actions] },
            {
              id: uid(),
              at,
              ...source,
              clean: finalClean,
              kind: "action",
              targetId: items[0]?.id ?? "",
              modelVia: settled.via,
            }
          )
        )) return;
        setNotice(
          `${count(items.length, "action")} distilled from the conversation.` +
            skipNote
        );
        clearNoticeIn(5000);
        await resetDistill();
        if (trialExhaustedNow()) setDistillOpen(false);
        setTab("actions");
      } else {
        /* Continue the thread this conversation was actually about. Distill
           used to mint a fresh thread every time, so thinking a subject
           through a second time split it across two near-identical threads
           — the sorter has always routed; the settler simply was not asked
           to, and the answer was thrown away when it did. */
        const home = settled.threadId
          ? latest.current.threads.find((t) => t.id === settled.threadId)
          : undefined;
        const frag: Frag = { id: uid(), at: stamp(), text: finalClean };
        const thread: Thread = home ?? {
          id: uid(),
          name:
            settled.threadName ||
            title ||
            finalClean.split(/\s+/).slice(0, 5).join(" "),
          summary: "",
          frags: [],
        };
        const next = withLedger(
          {
            ...latest.current,
            threads: home
              ? latest.current.threads.map((t) =>
                  t.id === home.id ? { ...t, frags: [...t.frags, frag] } : t
                )
              : [{ ...thread, frags: [frag] }, ...latest.current.threads],
          },
          {
            id: uid(),
            at: stamp(),
            ...source,
            clean: finalClean,
            kind: "thread",
            targetId: thread.id,
            /* The fragment this distillation just inserted, not the thread's
               first one. Pointing at `frags[0]` named whatever happened to
               already be there — or nothing at all when the thread was new —
               so the ledger's record of where a distillation went led back
               to someone else's words. */
            targetFragId: frag.id,
            modelVia: settled.via,
          }
        );
        if (!await commit(next)) return;
        setNotice("Distilled into a thread." + skipNote);
        clearNoticeIn(5000);
        await regenerate(next, thread.id);
        await resetDistill();
        if (trialExhaustedNow()) setDistillOpen(false);
        setTab("threads");
      }
    } catch (error) {
      setDistillErr(reasonOf(error) + " Nothing was saved.");
    } finally {
      setDistillBusy(false);
      distillBusyRef.current = false;
    }
  };

  const discardSettled = () => setSettled(null);
  /** Leave Distill entirely without filing anything.

      The settled review is cleared and the view closes — same effect as the
      "← capture" back on the conversation. The transcript itself stays saved
      (a half-finished conversation survives a reload by design), so reopening
      Distill picks it back up rather than losing it. */
  const exitDistill = () => {
    setSettled(null);
    setDistillErr("");
    closeDistill();
  };

  /** A true clean slate: wipe the transcript along with the review.

      Unlike exitDistill — which keeps the half-finished conversation for a
      later session — this forgets it entirely. resetDistill persists a fresh
      empty session, so reopening Distill starts completely clean; nothing is
      filed and nothing is kept. */
  const discardDistill = async () => {
    await resetDistill();
    setDistillOpen(false);
  };

  /* --------------------------- derivations -------------------------- */

  /* All memoized: this hook re-renders on every keystroke in the capture
     box, and these must not recompute (or change identity — the grouped
     lens memoizes on `live`) unless the board itself moved. */
  const actionLists = useMemo(() => actionViews(data.actions), [data.actions]);
  const live = actionLists.live;
  const unsorted = actionLists.unsorted;
  const finalizingUnsortedIds = useMemo(() => finalizingPendingTargetIds(data.ledger, finalizingCaptureIds), [data.ledger, finalizingCaptureIds]);
  const fadedList = actionLists.faded;
  const active = useMemo(
    () =>
      data.threads
        .filter((t) => now - (t.frags.at(-1)?.at || 0) < DORMANT)
        .sort(byRecency),
    [data.threads, now]
  );
  const resting = useMemo(
    () =>
      data.threads
        .filter((t) => now - (t.frags.at(-1)?.at || 0) >= DORMANT)
        .sort(byRecency),
    [data.threads, now]
  );
  const thread = data.threads.find((t) => t.id === open);
  const intention = data.intentions.find((i) => i.id === openIntention);
  const hits = useMemo(() => search(data, debouncedQuery), [data, debouncedQuery]);
  const searching = debouncedQuery.trim().length > 0;
  /* All correction examples remain visible so an off switch can be turned
     back on. Only enabled examples reach the sort prompt above. */
  const learnedRules: RulePreference[] = useMemo(
    () =>
      deriveCorrectionExamples(data.corrections ?? [], data.threads).map((example) => ({
        key: example.key,
        text: example.text,
        accepts: 1,
        dismisses: 0,
        confidence: 1,
        lastAt: example.lastAt,
        enabled: !forgottenRules.includes(example.key),
      })),
    [data.corrections, data.threads, forgottenRules]
  );

  /** Enable or disable one advisory sorting preference. The correction
      history stays intact, and this device remembers only the switch state. */
  const toggleLearnedRule = async (key: string, enabled: boolean) => {
    const next = setRuleEnabled(forgottenRules, key, enabled);
    setForgottenRules(next);
    try {
      await set(FORGOTTEN_RULES_KEY, JSON.stringify(next));
    } catch {
      /* disk hiccup; the next toggle retries */
    }
  };

  const updateProfile = async (update: ProfileUpdate): Promise<void> => {
    const durable = await transactDurable((current) => ({
      next: applyProfileUpdate(current, update), value: undefined,
    }));
    if (durable.status === "failed") setErr("Couldn't save that profile change. Try again.");
  };

  const guardMutation = createBackupMutationGuard(backupGate.current, () =>
    setErr("Restore is still finishing. Nothing else was changed."));

  const leaveSettings = () => backupGate.current.leaveRestore(
    () => setIoNote({ text: "Restore is still finishing. Stay here until it completes.", ok: false }),
    () => { setShowSettings(false); setIoNote(null); },
  );

  return {
    data: lifetime.active ? data : EMPTY,
    trial: dailyTrialApplies && captureLimitReady && loaded && lifetime.active
      ? trialState(data.ledger ?? [], now)
      : null,
    loaded: loaded && lifetime.active,
    corrupt,
    text,
    setText,
    pics,
    setPics,
    setTranscript,
    captureDictated: !!transcript,
    busy,
    err,
    landed, landedLines,
    pendingReceiptId,
    autoSortingIds,
    landedIds,
    summarising,
    suggestion,
    acceptSuggestion: guardMutation(acceptSuggestion),
    dismissSuggestion: guardMutation(dismissSuggestion),
    organize,
    organizeAiStatus,
    runOrganize: guardMutation(runOrganize),
    closeOrganize,
    wrap,
    showWrap,
    setShowWrap,
    dismissWrap: guardMutation(dismissWrap),
    degraded,
    tangle,
    acceptTangle: guardMutation(acceptTangle),
    dismissTangle: guardMutation(dismissTangle),
    tidyHint,
    acceptOrganize: guardMutation(acceptOrganize),
    acceptOrganizeAll: guardMutation(acceptOrganizeAll),
    applyCleanup: guardMutation(applyCleanup),
    dismissOrganize: guardMutation(dismissOrganize),
    notice,
    swept,
    tab,
    setTab,
    open,
    setOpen,
    openFrag,
    setOpenFrag,
    openIntention,
    setOpenIntention,
    draft,
    setDraft,
    showSettings,
    showRecord,
    setShowRecord,
    recordDay,
    setRecordDay,
    setShowSettings,
    ioNote,
    ioBusy,
    setIoNote,
    editing,
    setEditing,
    shelfFor,
    setShelfFor,
    query,
    setQuery,
    showFaded,
    setShowFaded,
    showResting,
    setShowResting,
    live,
    unsorted,
    finalizingUnsortedIds,
    fadedList,
    active,
    resting,
    thread,
    intention,
    hits,
    searching,
    shareable,
    submit: guardMutation(submit),
    resort: guardMutation(resort),
    manualSort: guardMutation(manualSort),
    manualSplit: guardMutation(manualSplit),
    editUnsorted: guardMutation(editUnsorted),
    removeUnsorted: guardMutation(removeUnsorted),
    toggleAction: guardMutation(toggleAction),
    setShelf: guardMutation(setShelf),
    restore: guardMutation(restore),
    removeNow: guardMutation(removeNow),
    moveToThread: guardMutation(moveToThread),
    editActionText: guardMutation(editActionText),
    renameThread: guardMutation(renameThread),
    setThreadCover: guardMutation(setThreadCover),
    editFrag: guardMutation(editFrag),
    addFragImages: guardMutation(addFragImages),
    deleteFrag: guardMutation(deleteFrag),
    moveFrag: guardMutation(moveFrag),
    moveFragToNew: guardMutation(moveFragToNew),
    resolveFrag: guardMutation(resolveFrag),
    unresolveFrag: guardMutation(unresolveFrag),
    copyFragment,
    copyWhole,
    extractAction: guardMutation(extractAction),
    takeNext: guardMutation(takeNext),
    dismissNext: guardMutation(dismissNext),
    deleteThread: guardMutation(deleteThread),
    mergeThreads: guardMutation(mergeThreads),
    expandIntention: guardMutation(expandIntention),
    saveDraft: guardMutation(saveDraft),
    discardDraft: guardMutation(discardDraft),
    draftToThread: guardMutation(draftToThread),
    refreshSummary: guardMutation(refreshSummary),
    updateIntention: guardMutation(updateIntention),
    updateProfile: guardMutation(updateProfile),
    deleteIntention: guardMutation(deleteIntention),
    makeIntention: guardMutation(makeIntention),
    logout: guardMutation(logout),
    togglePrinciple: guardMutation(togglePrinciple),
    addPrinciple: guardMutation(addPrinciple),
    deletePrinciple: guardMutation(deletePrinciple),
    distillOpen,
    distillSession,
    distillInput,
    setDistillInput,
    setDistillTranscript,
    distillBusy,
    distillErr,
    distillReady,
    settled,
    openDistill,
    closeDistill,
    resetDistill: guardMutation(resetDistill),
    sendDistill: guardMutation(sendDistill),
    settleDistill: guardMutation(settleDistill),
    saveSettled: guardMutation(saveSettled),
    discardSettled,
    exitDistill,
    discardDistill: guardMutation(discardDistill),
    exportBoard,
    restoreFromFile,
    listSnapshots,
    restoreSnapshot: guardMutation(restoreSnapshot),
    importBackup: guardMutation(importBackup),
    doShare,
    sync: ownershipStatus === "offline" ? { ok: false, at: now, note: "Offline — local changes are not synced; AI unavailable" } : sync,
    syncNow,
    canUndo,
    canUndoManual: !!manualUndo,
    noticeUndoable,
    undo: guardMutation(undo),
    undoManual: guardMutation(undoManual),
    misfiled,
    sortAgainAs: guardMutation(sortAgainAs),
    sortAgainIntoThread: guardMutation(sortAgainIntoThread),
    dismissMisfiled: guardMutation(() => setMisfiled(null)),
    learnedRules,
    toggleLearnedRule: guardMutation(toggleLearnedRule),
    leaveSettings,
  };
}
