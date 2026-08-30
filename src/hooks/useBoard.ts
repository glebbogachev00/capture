"use client";

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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { stamp } from "@/lib/clock";
import { del, get, keys, set } from "@/lib/storage";
import {
  type Action,
  type Board,
  type Frag,
  type Intention,
  type ShelfLife,
  type Thread,
  DORMANT,
  EMPTY,
  CORRUPT,
  IMG,
  KEY,
  SHELF,
  dropImages,
  hydrate,
  nextNumber,
  pad,
  sweep,
  uid,
} from "@/lib/model";
import { importIntentBackup } from "@/lib/importIntent";
import { threadBriefs } from "@/lib/threadBrief";
import { warmDelay } from "@/lib/tidyWarm";
import {
  dayStats,
  mergeCompletions,
  wrapDue,
  wrapRequest,
  pendingWrap,
  mergeWraps,
  type DayWrap,
} from "@/lib/wrap";
import {
  expiredDays,
  snapshotDay,
  snapshotDays,
  snapshotKey,
  snapshotLabel,
  worthSnapshotting,
} from "@/lib/snapshots";
import {
  type DistillResult,
  type DistillSession,
  DISTILL_KEY,
  EMPTY_DISTILL,
  hydrateDistill,
  findMarker,
  markerHold,
  NOTHING_MARKER,
  READY_MARKER,
} from "@/lib/distill";
import {
  backupFilename,
  buildBackup,
  downloadJSON,
  readJsonFile,
  restoreBackup,
} from "@/lib/backup";
import {
  copyToClipboard,
  shareText,
  shareableFor,
} from "@/lib/share";
import { search } from "@/lib/search";
import {
  byRecency,
  applySorted,
  computeSuggestion,
  type Suggestion,
} from "@/lib/boardOps";
import { arrivedIn, arrivedNote } from "@/lib/arrived";
import { parseCommandPrefix } from "@/lib/command";
import {
  commandRule,
  isRefile,
  refileRule,
  undoRule,
  type SortKind,
} from "@/lib/refiled";
import { expiryFor, parseDue } from "@/lib/due";
import { seriesFor } from "@/lib/series";
import { createPoller } from "@/lib/poll";
import { PLAYGROUND, playgroundError } from "@/lib/playground";
import { degradedTier, type Answered } from "@/lib/degraded";
import { planTidy, keepProposals, type TidyRead } from "@/lib/tidyChanged";
import {
  confusedPairs,
  tangleProposalId,
  type TangleProposal,
} from "@/lib/tangle";
import {
  recordCopiedAt as readRecordCopiedAt,
  recordCopiedAtOnServer,
  stampRecordCopied,
  subscribeRecordCopied,
} from "@/lib/recordCopied";
import { referencedImageIds } from "@/lib/imgSync";
import {
  TOMBSTONE_KEY,
  boardSignature,
  applyTombstones,
  mergeSync,
  mergeTombstones,
  stampChanges,
  type SyncState,
  type Tombstone,
} from "@/lib/sync";
import type { SyncStore } from "@/lib/syncStore";
import type { Draft, IoNote } from "@/app/Intentions";
import {
  mergeCorrections,
  mergeLedgers,
  sourceOf,
  withCorrection,
  withLedger,
  type CorrectionEntry,
  type CaptureSource,
  markUndone,
} from "@/lib/ledger";
import { deriveRules, type LearnedRule } from "@/lib/rules";
import {
  judgedForSignature,
  requestJudgedProposals,
  scanBoard,
  scanStale,
  threadHoldsNote,
  wordMatched,
  type JudgedRead,
  type OrganizeProposal,
} from "@/lib/organize";
import {
  compactBoard,
  mapAiProposals,
  mergeOrganize,
  type RawAiProposal,
} from "@/lib/organizeAi";

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
const TANGLE_EVERY_MS = 20 * 60 * 60 * 1000;
/** When the record last went out to an agent. Per device, never synced. */

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const reasonOf = (error: unknown) => {
  /* The server names its own failures precisely — rate limit, spent quota,
     billing, a rejected key — and those come back as a SortError carrying
     the text. Anything else means no usable answer arrived at all: the
     connection dropped, or the request died before it could reply.
 
     That distinction was invisible. Both showed "The sort didn't go
     through", so a phone on a patchy signal and a rate-limited provider
     looked identical — and the one thing the person could actually act on,
     being offline, was the thing the message hid. */
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

/**
 * Keep today's rollback, drop the ones past the week.
 *
 * Failures are swallowed on purpose: a snapshot that cannot be written is
 * a shame, and an app that will not open because of it is a disaster.
 */
async function keepDailySnapshot(board: Board): Promise<void> {
  if (!worthSnapshotting(board)) return;
  try {
    const today = snapshotKey(snapshotDay(Date.now()));
    const existing = await keys();
    if (!existing.includes(today)) {
      await set(today, JSON.stringify(board));
    }
    for (const day of expiredDays(snapshotDays([...existing, today]))) {
      await del(snapshotKey(day));
    }
  } catch {
    /* out of quota, private mode, storage locked: never block the board */
  }
}

/** The ledger entry `after` has that `before` does not — the one a capture
    just wrote, found before any merge can put someone else's beside it. */
function boardIds(b: Board): Set<string> {
  const s = new Set<string>();
  for (const a of b.actions) s.add(a.id);
  for (const t of b.threads) {
    s.add(t.id);
    for (const f of t.frags) s.add(f.id);
  }
  for (const i of b.intentions) s.add(i.id);
  for (const p of b.principles) s.add(p.id);
  return s;
}

/** The ids `after` has that `before` does not — what one capture created. */
function newIds(before: Board, after: Board): Set<string> {
  const had = boardIds(before);
  return new Set([...boardIds(after)].filter((id) => !had.has(id)));
}

/* Every ledger entry this capture wrote. A split lands in more than one
   thread and writes one entry per destination, so undoing it has to take
   them all back — marking only the first left the other halves counted as
   things that still happened. */
function newLedgerIds(before: Board, after: Board): string[] {
  const had = new Set((before.ledger ?? []).map((e) => e.id));
  return (after.ledger ?? []).filter((e) => !had.has(e.id)).map((e) => e.id);
}

export function useBoard(now: number) {
  /* ------------------------------ state ------------------------------ */
  const [data, setData] = useState<Board>(EMPTY);
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
  /* What the last capture created, so the board can wash those rows once —
     the banner says a capture landed; this shows WHERE. Cleared with the
     banner, and by the animation's own end on each row. */
  const [landedIds, setLandedIds] = useState<string[]>([]);
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
  const [showRecord, setShowRecord] = useState(false);
  /* When the record last went out, per device: what this browser's person
     already handed their agent is a fact about this browser, so it never
     syncs. Re-read whenever the record opens. */
  const recordCopiedAt = useSyncExternalStore(
    subscribeRecordCopied,
    readRecordCopiedAt,
    recordCopiedAtOnServer
  );
  const stampRecordCopy = () => stampRecordCopied(Date.now());
  const [ioNote, setIoNote] = useState<IoNote>(null);
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
  const intentionLedger = useRef<{
    raw: string;
    source: CaptureSource;
    via?: string;
  } | null>(null);

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
  /* The saved session is hydrated asynchronously; a turn sent before that
     resolves must not be clobbered by the stale copy from disk. */
  const distillLoadedRef = useRef(false);

  /* The latest board, read by handlers so async work never builds on stale
     state. `commit` (and the loader) are the only writers. */
  const latest = useRef<Board>(data);

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
  /* When the last exchange with the hub happened, and whether it worked. */
  const [sync, setSync] = useState<
    | { ok: boolean; at: number; note?: string }
    | null
  >(null);
  const syncing = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------ undo ------------------------------ */

  /* The board and tombstones as they were just before the last capture
     landed, so "Undo" can put it back exactly — including the raw words
     (and pictures) that sat in the capture box, so an undone capture can
     be edited and re-submitted instead of being lost. Only the capture
     flows (submit/resort) take the snapshot — summary refreshes and fades
     never do, so Undo always reverts something the user watched land,
     never a background change. */
  /* Only the image IDS ride in the snapshot — the bytes were written to
     IndexedDB before the sort ran and are never garbage-collected, so undo
     re-reads them. Holding the data URLs here pinned ~300KB per photo in
     memory for the rest of the session. */
  const captureSnapshot = useRef<{
    board: Board;
    tombstones: Tombstone[];
    text?: string;
    picIds?: string[];
    /** The ledger entry this capture wrote — the one Undo asks about. */
    ledgerIds?: string[];
    /** Every id this capture created. Undo takes back these and only
        these: anything that arrived from another device in between — the
        push reply and the poll both merge — is not the capture's. */
    addedIds?: Set<string>;
  } | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  /* What the last undo threw away, kept just long enough to ask one
     question about it. Undo on its own says the sorting was wrong and
     nothing about what was right, which is not enough to learn from — so
     the capture waits here while the person taps the kind it should have
     been. Cleared by answering, by dismissing, or by the next capture. */
  const [misfiled, setMisfiled] = useState<{
    text: string;
    wrong: SortKind;
    /* The thread it landed in, when it landed in one. Right kind, wrong
       home is a different mistake from the wrong kind, and the strip can
       only offer to fix it if it knows which thread to move away from. */
    thread?: { id: string; name: string };
  } | null>(null);

  /** The hub revision this device last saw, so a poll can ask "anything
      newer than N?" and get a two-field answer instead of the whole board. */
  const hubRev = useRef<number | null>(null);

  /** Image ids this device has already handed to the hub, so a push does not
      re-upload the same photo every time. Not persisted: after a reload the
      first push re-offers them and the hub answers "already here". */
  const imgsOnHub = useRef<Set<string>>(new Set());

  /**
   * Make the photos match the board.
   *
   * The board syncs as text and carries only image ids, so after a merge a
   * device can hold a fragment whose picture it has never seen — and hold
   * pictures the hub has never seen. Both directions are settled here:
   * anything referenced but missing locally is fetched, anything held
   * locally but not yet offered is uploaded. Failures are silent by design;
   * the next sync tries again, and a missing photo never blocks the text.
   */
  const reconcileImages = useCallback(async (board: Board) => {
    for (const id of referencedImageIds(board)) {
      try {
        const mine = await get(IMG(id));
        if (!mine) {
          const res = await fetch(`/api/img/${id}`);
          if (!res.ok) continue;
          const { src } = (await res.json()) as { src?: string };
          if (src) await set(IMG(id), src);
          imgsOnHub.current.add(id);
          continue;
        }
        if (imgsOnHub.current.has(id)) continue;
        const res = await fetch(`/api/img/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ src: mine }),
        });
        if (res.ok) imgsOnHub.current.add(id);
      } catch {
        /* hub unreachable or disk hiccup — the next sync picks it up */
      }
    }
  }, []);

  /** Send our state to the hub and adopt its merged answer. */
  const pushNow = useCallback(async () => {
    /* Playground: no hub. See lib/playground.ts for why this is a hard stop. */
    if (PLAYGROUND) return;
    if (syncing.current) return;
    syncing.current = true;
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board: latest.current,
          tombstones: tombstones.current,
        } as SyncState),
      });
      if (!res.ok) throw new Error("sync failed");
      const stored = (await res.json()) as SyncStore;
      hubRev.current = stored.rev ?? null;
      /* The hub merged OUR push with whatever else it holds — a superset of
         what we sent. Adopt it, but merge against anything that changed
         locally while the request was in flight so that newer edits win. */
      const merged = mergeSync(
        { board: latest.current, tombstones: tombstones.current },
        { board: stored.board, tombstones: stored.tombstones }
      );
      latest.current = merged.board;
      setData(merged.board);
      tombstones.current = merged.tombstones;
      try {
        await set(KEY, JSON.stringify(merged.board));
        await set(TOMBSTONE_KEY, JSON.stringify(merged.tombstones));
      } catch {
        /* disk hiccup; next commit retries */
      }
      setSync({ ok: true, at: stamp() });
      /* The text is up; hand the pictures over too. Not awaited — a photo
         upload must never hold up the sync status the user is watching. */
      void reconcileImages(merged.board);
    } catch {
      /* hub unreachable — keep everything local, retry on the next change */
      setSync({ ok: false, at: stamp(), note: "Hub unreachable — kept locally" });
    }
    syncing.current = false;
  }, [reconcileImages]);

  /** Coalesce bursts of edits into one push a beat after the last one. */
  const schedulePush = useCallback(() => {
    if (PLAYGROUND) return;
    if (pushTimer.current !== null) return;
    pushTimer.current = setTimeout(() => {
      pushTimer.current = null;
      void pushNow();
    }, 1200);
  }, [pushNow]);

  /**
   * Pull the hub's copy, merge it with ours, and adopt the result. Returns
   * whether anything changed locally. Success/failure is recorded in `sync`
   * either way, so the header dot shows a live hub even when nothing moved.
   */
  const pullNow = useCallback(async (): Promise<boolean> => {
    if (PLAYGROUND) return false;
    try {
      const res = await fetch(
        hubRev.current === null ? "/api/sync" : `/api/sync?rev=${hubRev.current}`
      );
      if (!res.ok) return false;
      const remote = (await res.json()) as SyncStore & { unchanged?: boolean };
      /* Nothing new on the hub since we last looked: the poll is over before
         any parse-and-merge work begins. Local edits still push on their own
         debounce, so skipping here loses nothing. */
      if (remote.unchanged) {
        setSync({ ok: true, at: stamp() });
        return false;
      }
      hubRev.current = remote.rev ?? null;
      const merged = mergeSync(
        { board: latest.current, tombstones: tombstones.current },
        { board: remote.board, tombstones: remote.tombstones }
      );
      /* Item-by-item, not "is the newest thing newer than mine?" — that
         cheaper test silently dropped real edits whenever this device held
         anything fresher than the incoming change. The rev short-circuit
         above means this only runs when the hub genuinely moved. */
      const changed =
        boardSignature(merged.board, merged.tombstones) !==
        boardSignature(latest.current, tombstones.current);
      if (changed) {
        /* Say what actually came in. The merge has always known; staying
           silent made "synced" and "three notes arrived" look identical.
           Additions only — an edit shows itself where it happened. */
        const note = arrivedNote(arrivedIn(latest.current, merged.board));
        latest.current = merged.board;
        setData(merged.board);
        tombstones.current = merged.tombstones;
        if (note) {
          setNotice(note);
          setTimeout(() => setNotice(null), 5000);
        }
        try {
          await set(KEY, JSON.stringify(merged.board));
          await set(TOMBSTONE_KEY, JSON.stringify(merged.tombstones));
        } catch {
          /* next commit retries */
        }
      }
      setSync({ ok: true, at: stamp() });
      // Only push if something actually changed — avoids a redundant round
      // trip on every pull when the board is already in sync.
      /* Every successful pull, not only the ones that changed something.
         A photo that failed to fetch leaves the words in sync and the
         picture missing — and boardSignature knows nothing about images, so
         the merge reads as unchanged from then on and the fetch was never
         retried. The device kept the text and lost the photograph, for
         good. Reconciling is a no-op for images it already holds. */
      void reconcileImages(merged.board);
      if (changed) schedulePush();
      return changed;
    } catch {
      /* hub unreachable; local state stands */
      setSync({ ok: false, at: stamp(), note: "Hub unreachable — kept locally" });
      return false;
    }
  }, [schedulePush, reconcileImages]);

  /** Manual "sync now": bring the other device's changes in, then push ours up. */
  const syncNow = useCallback(async () => {
    if (PLAYGROUND) return;
    if (pushTimer.current !== null) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    await pullNow();
    // pullNow schedules a debounced push; a manual sync should push now.
    if (pushTimer.current !== null) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    await pushNow();
  }, [pullNow, pushNow]);

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
    captureSnapshot.current = null;
    setCanUndo(false);

    /* The capture's own push landed on the hub before the undo window
       opened, so restoring the board alone would let the next pull merge it
       straight back. Two things make the hub agree with the restore:
       - everything the capture ADDED gets a tombstone, so the hub removes it;
       - everything the capture REMOVED (a re-sort replaces the raw action)
         comes back with a fresh updatedAt, so it out-ages the tombstone the
         capture itself pushed for it. */
    const now = Date.now();
    const bump = <T extends { updatedAt?: number }>(x: T): T => ({
      ...x,
      updatedAt: now,
    });
    const had = (list: { id: string }[], id: string) =>
      list.some((x) => x.id === id);
    /* Only what THIS capture created goes. The board as it stands may also
       hold what another device captured in the meantime — the push reply
       at 1.2s and every poll merge the hub in — and diffing the snapshot
       against the board would tombstone that too: an undo here deleting
       a capture made there. Items the snapshot lacks and the capture did
       not create are kept, and the tombstones are computed afterwards
       from a board that still has them. */
    const mine = snap.addedIds ?? new Set<string>();
    const foreign = <T extends { id: string }>(live: T[], snapped: T[]) =>
      live.filter((x) => !mine.has(x.id) && !had(snapped, x.id));
    const board: Board = {
      actions: [
        ...foreign(latest.current.actions, snap.board.actions),
        ...snap.board.actions.map((a) =>
          had(latest.current.actions, a.id) ? a : bump(a)
        ),
      ],
      threads: [
        ...foreign(latest.current.threads, snap.board.threads),
        ...snap.board.threads.map((t) => {
          const live = latest.current.threads.find((x) => x.id === t.id);
          if (!live) return { ...bump(t), frags: t.frags.map(bump) };
          return {
            ...t,
            frags: [
              ...t.frags.map((f) => (had(live.frags, f.id) ? f : bump(f))),
              ...foreign(live.frags, t.frags),
            ],
          };
        }),
      ],
      intentions: [
        ...foreign(latest.current.intentions, snap.board.intentions),
        ...snap.board.intentions.map((i) =>
          had(latest.current.intentions, i.id) ? i : bump(i)
        ),
      ],
      principles: [
        ...snap.board.principles.map((p) =>
          had(latest.current.principles, p.id) ? p : bump(p)
        ),
        ...foreign(latest.current.principles, snap.board.principles),
      ],
      /* History is append-only and keyed by id: the other device's entries
         stay, and only this capture's own entry is taken out. */
      ledger: mergeLedgers(
        snap.board.ledger ?? [],
        markUndone(latest.current.ledger ?? [], snap.ledgerIds ?? [])
      ),
      corrections: mergeCorrections(
        snap.board.corrections ?? [],
        latest.current.corrections ?? []
      ),
      /* Undo reverts ONE capture. It does not revert the day's reading, the
         actions ticked since, or a history wipe — none of which the capture
         created. Rebuilding the board without naming them dropped all three
         silently: a single Undo destroyed every wrap and every tick receipt
         on the device, with nothing on screen to say so. */
      wraps: mergeWraps(snap.board.wraps ?? [], latest.current.wraps ?? []),
      completions: mergeCompletions(
        snap.board.completions ?? [],
        latest.current.completions ?? []
      ),
      historyEpoch: Math.max(
        snap.board.historyEpoch ?? 0,
        latest.current.historyEpoch ?? 0
      ),
    };
    const added = stampChanges(latest.current, board, now).tombstones;

    /* The capture being undone: the one ledger entry the snapshot does not
       have. It carries both halves of the question — what was said, and
       what the sorter decided it was. */
    const undoneEntry = snap.ledgerIds?.length
      ? latest.current.ledger.find((e) => e.id === snap.ledgerIds![0])
      : latest.current.ledger.find(
          (e) => !snap.board.ledger.some((x) => x.id === e.id)
        );
    /* "both" is not a kind anyone can pick, so there is nothing to ask. */
    const wrongKind: SortKind | null =
      undoneEntry && undoneEntry.kind !== "both" ? undoneEntry.kind : null;
    /* Which thread it went to, read from the board as it stands NOW —
       before the restore below removes it. A capture that opened a thread
       of its own is the commonest version of this mistake, and that thread
       exists nowhere else by the time the question is asked. */
    const landedIn =
      undoneEntry &&
      (undoneEntry.kind === "thread" || undoneEntry.kind === "both") &&
      undoneEntry.targetId
        ? latest.current.threads.find((t) => t.id === undoneEntry.targetId)
        : undefined;
    /* The complaint is worth recording even if the question goes
       unanswered: it has no rule attached, so it can never become a
       learned rule on its own, but the record shows the engine was wrong
       here. */
    const learned: Board = wrongKind
      ? withCorrection(board, {
          id: uid(),
          at: now,
          proposalKind: "undone",
          accepted: false,
          context: (undoneEntry!.raw || undoneEntry!.clean).slice(0, 160),
        })
      : board;
    const nextTombstones = mergeTombstones(snap.tombstones, added);

    latest.current = learned;
    setData(learned);
    tombstones.current = nextTombstones;
    if (wrongKind) {
      setMisfiled({
        text: undoneEntry!.raw || undoneEntry!.clean,
        wrong: wrongKind,
        thread: landedIn ? { id: landedIn.id, name: landedIn.name } : undefined,
      });
    }
    try {
      await set(KEY, JSON.stringify(learned));
      await set(TOMBSTONE_KEY, JSON.stringify(nextTombstones));
    } catch {
      /* disk hiccup; next commit retries */
    }
    setLanded(null);
    setLandedIds([]);
    setSuggestion(null);
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
    setTimeout(() => setNotice(null), 4000);
    /* Push now, not on the debounce: a pull landing in the debounce window
       would re-merge the hub's copy (which still holds the capture) before
       our tombstones go out. */
    if (pushTimer.current !== null) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    await pushNow();
  }, [pushNow, text, pics]);

  /**
   * The answer to "then what was it?".
   *
   * One tap, no typing. It writes the lesson the undo could not write on
   * its own — the wrong kind and the right one, anchored on the capture's
   * subject so two corrections about the same subject aggregate instead of
   * splitting — and then re-runs the capture with the destination pinned,
   * so answering the question also does the thing.
   */
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
      const rule = undoRule(words, m.wrong, right);
      if (rule) {
        const learned = withCorrection(latest.current, {
          id: uid(),
          at: stamp(),
          proposalKind: "undone",
          accepted: true,
          context: words.slice(0, 160),
          rule,
        });
        latest.current = learned;
        setData(learned);
        try {
          await set(KEY, JSON.stringify(learned));
        } catch {
          /* disk hiccup; the next commit writes it */
        }
      }
      /* The box holds the restored words, but a re-sort must not depend on
         that: if anything cleared them, the capture being corrected is
         still right here. */
      if (!text.trim()) setText(m.text);
    }
    await submit(false, right, words || undefined);
    /* After the capture lands, not before — the banner says where it went,
       this says why that was the right shape for it. */
    if (m) {
      setNotice(SHAPE_NOTE[right]);
      setTimeout(() => setNotice(null), 6000);
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
    let rule: ReturnType<typeof refileRule> = null;
    if (m && home) {
      rule = refileRule(
        words,
        home.name,
        [home.name, home.summary, ...home.frags.map((f) => f.text)].join(" ")
      );
      if (rule) {
        /* Answered strength: they were asked outright and picked a thread,
           which is the same kind of evidence as answering the kind. */
        const learned = withCorrection(latest.current, {
          id: uid(),
          at: stamp(),
          proposalKind: "undone",
          accepted: true,
          context: words.slice(0, 160),
          rule,
        });
        latest.current = learned;
        setData(learned);
        try {
          await set(KEY, JSON.stringify(learned));
        } catch {
          /* disk hiccup; the next commit writes it */
        }
      }
      if (!text.trim()) setText(m.text);
    }
    await submit(false, "thread", words || undefined, threadId);
    if (home) {
      /* "It will remember" only when a rule was actually written: with no
         shared subject there is nothing to remember by. */
      setNotice(
        rule ? `Filed in ${home.name}. It will remember.` : `Filed in ${home.name}.`
      );
      setTimeout(() => setNotice(null), 6000);
    }
  };

  const commit = useCallback(
    async (next: Board) => {
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
        ...next,
        ledger: mergeLedgers(latest.current.ledger ?? [], next.ledger ?? []),
        corrections: mergeCorrections(
          latest.current.corrections ?? [],
          next.corrections ?? []
        ),
        wraps: mergeWraps(latest.current.wraps ?? [], next.wraps ?? []),
        completions: mergeCompletions(
          latest.current.completions ?? [],
          next.completions ?? []
        ),
      };
      const stamped = stampChanges(
        latest.current,
        applyTombstones(merged, tombstones.current)
      );
      setData(stamped.board);
      latest.current = stamped.board;
      if (stamped.tombstones.length) {
        tombstones.current = mergeTombstones(
          tombstones.current,
          stamped.tombstones
        );
      }
      try {
        await set(KEY, JSON.stringify(stamped.board));
        await set(TOMBSTONE_KEY, JSON.stringify(tombstones.current));
      } catch {
        setErr("Couldn't save that. Your last capture is still on screen — try again.");
      }
      schedulePush();
    },
    [schedulePush]
  );

  /* load, then sweep. A board already on the device that fails to parse is
     set aside rather than silently treated as a fresh start: the unreadable
     copy is parked under a quarantine key before anything new can overwrite
     it, and the UI is told so it can offer a restore. */
  useEffect(() => {
    (async () => {
      let d: Board = EMPTY;
      let quarantined = false;
      try {
        const raw = await get(KEY);
        if (raw) {
          try {
            d = hydrate(JSON.parse(raw));
          } catch {
            quarantined = true;
            try {
              await set(CORRUPT, raw);
            } catch {
              /* quarantine failed; keep going */
            }
          }
        }
      } catch {
        /* first run */
      }
      if (quarantined) setCorrupt(true);
      /* A day's first look at the board is the last moment it is certainly
         the board the person left: before the sweep fades anything and
         before the first pull merges the hub in. Snapshot here or the copy
         is already downstream of whatever went wrong. */
      void keepDailySnapshot(d);
      const { next, faded, cleared } = await sweep(d);
      setData(next);
      latest.current = next;
      if (faded || cleared) {
        try {
          await set(KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        setSwept({ faded, cleared });
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
      // This device's deletions survive a reload, so an offline delete is
      // still pushed to the hub once the connection is back.
      try {
        const tbRaw = await get(TOMBSTONE_KEY);
        if (tbRaw) tombstones.current = JSON.parse(tbRaw);
      } catch {
        /* first run */
      }
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
      setLoaded(true);
    })();
  }, []);

  /* --------------------------- sync loop ---------------------------- */

  /* Pull on load and whenever the tab comes back into focus, then merge the
     hub's copy with ours and adopt the result. The hub merges rather than
     replaces, so two devices editing at once converge instead of clobbering.
     Offline is fine — the next commit just keeps everything local. */
  useEffect(() => {
    if (!loaded || PLAYGROUND) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- the
       canonical subscribe-to-external-system effect: every setState inside
       pullNow happens after a network await, never synchronously. */
    void pullNow();
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
      pull: pullNow,
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
  }, [loaded, pullNow]);

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
    /* The first attached photo, so the sort route can caption it and file
       the capture by what it shows rather than as "(image only)". */
    imgSrc?: string
  ) => {
    const known = threadBriefs(latest.current.threads);
    // A bounded slice of filing history, so the engine files the way this
    // person files and routes into the thread they'd choose. Kept small on
    // purpose — every capture pays for this context, so it stays recent and
    // compact rather than the whole 500-entry ledger.
    const threadName = (id: string) =>
      latest.current.threads.find((t) => t.id === id)?.name || "";
    /* The capture just before this one, if it went to a thread — the only
       thing a series can continue. */
    const prev = (latest.current.ledger ?? []).find(
      (e) =>
        (e.kind === "thread" || e.kind === "both") &&
        e.targetId &&
        latest.current.threads.some((t) => t.id === e.targetId)
    );
    const series = prev
      ? seriesFor(raw, {
          raw: prev.raw,
          at: prev.at,
          threadId: prev.targetId,
          threadName: threadName(prev.targetId),
        })
      : null;
    const recent = (latest.current.ledger ?? []).slice(0, 30).map((e) => ({
      raw: e.raw.length > 120 ? e.raw.slice(0, 120) : e.raw,
      kind: e.kind,
      at: e.at,
      target:
        e.kind === "thread" || e.kind === "both" ? threadName(e.targetId) : "",
    }));
    // The bounded personal model, advisory: top learned rules as plain
    // sentences. Empty until the user has accepted or dismissed enough
    // suggestions for a rule to form — a fresh board sorts exactly as before.
    const rules = deriveRules(
      latest.current.corrections ?? [],
      forgottenRules,
      stamp()
    ).map((r) => r.text);
    const res = await fetch("/api/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw,
        threads: known,
        recent,
        series: series ?? undefined,
        force,
        rules,
        imgs: imgSrc ? [imgSrc] : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new SortError(body.error);
    }
    /* Every answer reports the tier that produced it. Sorting is the most
       frequent call by far, so it is the honest sample of what the app is
       actually running on. */
    const out = await res.json();
    noteVia(out?.via);
    return out;
  };

  /** Fold a sorted result into a board. Shared by first capture and re-sort. */
  /* applySorted moved to @/lib/boardOps (pure, unit-tested). */

  /** Ask the server to rewrite a thread's summary. Throws SortError. */
  const requestSummary = async (
    name: string,
    frags: Frag[]
  ): Promise<{ summary: string; next: string | null; belongs: string | null }> => {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        frags: frags.map((f) => ({ at: f.at, text: f.text })),
        open: latest.current.actions
          .filter((a) => !a.done)
          .slice(0, 30)
          .map((a) => a.text),
        /* The neighbours, so this thread can describe its own edges. A
           summary written alone can never say "that goes next door". */
        siblings: latest.current.threads
          .filter((t) => t.name !== name)
          .slice(0, 40)
          .map((t) => t.name),
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
  const regenerate = async (board: Board, threadId: string): Promise<Board> => {
    const target = board.threads.find((t) => t.id === threadId);
    if (!target?.frags.length) return board;
    setSummarising("Updating what this thread says now");
    let result = board;
    try {
      /* One retry, because the failure is invisible and permanent: a
         rate-limited summarise left "where this stands" and the next step
         describing a thread two layers ago, with nothing on screen to say
         so and nothing to trigger another attempt until the next capture
         happened to land here. */
      const { summary, next, belongs } = await requestSummary(
        target.name,
        target.frags
      ).catch(async () => {
        await new Promise((r) => setTimeout(r, 1200));
        return requestSummary(target.name, target.frags);
      });
      /* The LATEST board, not the one this call started with. While the
         summary was being written the person may have captured again, and
         committing the snapshot this function was handed would take that
         capture back off the board. Nothing else here reads `board`. */
      if (!latest.current.threads.some((t) => t.id === threadId)) {
        return latest.current;
      }
      result = {
        ...latest.current,
        threads: latest.current.threads.map((t) =>
          t.id === threadId
            ? { ...t, summary, next, ...(belongs ? { belongs } : {}) }
            : t
        ),
      };
      await commit(result);
    } catch {
      /* the fragments are saved; the summary can lag */
    }
    setSummarising(null);
    return result;
  };

  /** Manual re-run from the thread view. Unlike the automatic path, a failure
   * is shown rather than swallowed, so a stale summary is never silent.
   */
  const refreshSummary = async (threadId: string) => {
    const target = latest.current.threads.find((t) => t.id === threadId);
    if (!target?.frags.length) return;
    setErr("");
    setBusy("Updating what this thread says now");
    try {
      const { summary, next } = await requestSummary(target.name, target.frags);
      await commit(
        noteCorrection(
          {
            ...latest.current,
            threads: latest.current.threads.map((t) =>
              t.id === threadId ? { ...t, summary, next } : t
            ),
          },
          {
            proposalKind: "refresh_summary",
            accepted: true,
            context: target.name,
          }
        )
      );
      setNotice("Summary refreshed.");
      setTimeout(() => setNotice(null), 4000);
    } catch (error) {
      setErr(reasonOf(error) + " The summary was left as it was.");
    }
    setBusy(null);
  };

  /**
   * Keep a capture that no model would sort.
   *
   * Losing what you just said because a free tier ran dry is the worst thing
   * this app could do, so the text is saved verbatim and flagged for sorting
   * later. Where it lands follows what you were looking at: an open thread
   * takes it as a fragment, the Threads tab starts a new one, and otherwise it
   * becomes an action.
   */
  const saveUnsorted = async (
    raw: string,
    imgIds: string[],
    at: number,
    reason: string,
    dictated = false
  ) => {
    const b = latest.current;
    const body = raw || "(image only)";
    const openThread = b.threads.find((t) => t.id === open);
    const frag: Frag = {
      id: uid(),
      at,
      text: body,
      imgs: imgIds,
      unsorted: true,
    };

    let next: Board;
    let targetId = "";
    let targetFragId: string | undefined;
    if (openThread) {
      next = {
        ...b,
        threads: b.threads.map((t) =>
          t.id === openThread.id ? { ...t, frags: [...t.frags, frag] } : t
        ),
      };
      targetId = openThread.id;
      targetFragId = frag.id;
      setLanded(openThread.name + " — saved unsorted");
    } else {
      /* A failed sort NEVER invents a thread.
 
         This used to branch on whichever tab happened to be open: standing
         on Threads when the model did not answer minted a new thread named
         after the first five words of what was said. So an error path made
         a permanent structural decision about the board — and every retry
         made another. Four attempts at one thought left four threads, and
         undoing them left the wreckage in the record.
 
         It also fed back into the thing it was breaking. The sorter routes
         by reading thread names, so "The next issue is action" sitting on
         the board made every later capture harder to place. A failure that
         degrades the next attempt is the worst shape a failure can take.
 
         An unsorted action is the honest holding place: flat, reversible,
         visibly marked, and `resort` can later turn it into a thread, an
         action or an intention — everything the invented thread offered,
         with none of the commitment. */
      const action: Action = {
        id: uid(),
        text: body,
        done: false,
        at,
        src: body,
        imgs: imgIds,
        shelf: "keep",
        expires: null,
        unsorted: true,
      };
      next = { ...b, actions: [action, ...b.actions] };
      targetId = action.id;
      /* Say where it is and that it is not lost. "Kept unsorted" told you
         a state; this tells you where to find it and that it can still be
         sorted once the model answers again. */
      setLanded("Kept in Actions, unsorted — sort it when the model is back");
    }

    // The fallback is still a capture — the ledger records it exactly as it
    // was said, flagged by the kind it fell back to.
    next = withLedger(next, {
      id: uid(),
      at,
      raw,
      clean: body,
      kind: openThread || tab === "threads" ? "thread" : "action",
      source: sourceOf(raw, dictated, imgIds.length > 0),
      targetId,
      targetFragId,
      imgs: imgIds.length ? imgIds : undefined,
    });

    setText("");
    setPics([]);
    // The fallback still lands something — Undo can take it back, words
    // and all, so the raw capture is never lost.
    captureSnapshot.current = {
      board: latest.current,
      tombstones: tombstones.current,
      text,
      picIds: pics.map((p) => p.id),
      ledgerIds: newLedgerIds(latest.current, next),
      addedIds: newIds(latest.current, next),
    };
    setCanUndo(true);
    await commit(next);
    setErr(reason + " Saved as it is, so nothing is lost — sort it later.");
  };

  /** Run a capture that was saved raw back through the sorter. */
  const resort = async (a: Action) => {
    setErr("");
    setBusy("Sorting");
    try {
      /* An unsorted capture with a photo re-sorts by what it shows, like the
         main path — the first image is read back and captioned. */
      let imgSrc: string | undefined;
      if (a.imgs?.[0]) {
        try {
          imgSrc = (await get(IMG(a.imgs[0]))) || undefined;
        } catch {
          /* gone — sort the text alone */
        }
      }
      const out = await requestSort(a.src || a.text, undefined, imgSrc);
      const board = {
        ...latest.current,
        actions: latest.current.actions.filter((x) => x.id !== a.id),
      };
      const { next, targetId, landed, source, landedIds: fresh } = applySorted(
        out,
        a.imgs || [],
        a.at,
        board
      );
      setLanded(landed);
      setLandedIds(fresh);
      setTab(out.kind === "action" ? "actions" : "threads");
      // Snapshot right before the re-sort lands — Undo reverts exactly this,
      // and puts the raw words back in the box.
      captureSnapshot.current = {
        board: latest.current,
        tombstones: tombstones.current,
        text: a.src || a.text,
        ledgerIds: newLedgerIds(latest.current, next),
      addedIds: newIds(latest.current, next),
      };
      setCanUndo(true);
      await commit(next);
      setSuggestion(computeSuggestion(next, out.clean, source));
      if (targetId) await regenerate(next, targetId);
    } catch (error) {
      setErr(reasonOf(error) + " It is still here, untouched.");
    }
    setBusy(null);
    /* Same widened window as the main capture — Undo lives here too. */
    setTimeout(() => {
      setLanded(null);
      setLandedIds([]);
      setSuggestion(null);
    }, 9000);
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

  /** Write a command's lesson on its own.
      The forced-intention branch hands off to the intention engine and
      never reaches the capture's commit, so its lesson is recorded here or
      nowhere. Same shape as the one folded into a filed capture. */
  const noteCommand = async (rule: string, context: string) => {
    const learned = noteCorrection(latest.current, {
      proposalKind: "commanded",
      accepted: true,
      context: context.slice(0, 160),
      rule,
    });
    latest.current = learned;
    setData(learned);
    try {
      await set(KEY, JSON.stringify(learned));
    } catch {
      /* disk hiccup; the next commit writes it */
    }
  };

  /** Praise be. The main capture, sorted and filed.
      `dictated` says the words came from the microphone — the ledger records
      that so a later export can tell speech from typing. */
  const submit = async (
    dictated = false,
    pinned?: SortKind,
    /* The words to sort, when the caller holds them and the box may not
       yet — a re-sort after undo runs a tick before the draft is back. */
    override?: string,
    /* The thread the person picked by hand. Unlike the series hint, this
       is not a default the model may talk itself out of: they were asked
       and they answered, so it is applied to whatever comes back. */
    pinnedThread?: string
  ) => {
    const raw = (override ?? text).trim();
    /* A leading command pins the destination: the command word is
       stripped and the rest goes through the sorter with the destination
       already decided. Works typed (/action …) or spoken ("slash action …"
       or "action. …") — the parser accepts all the forms dictation and
       keyboards actually produce. */
    const { force: typed, payload } = parseCommandPrefix(raw);
    /* A kind chosen after an undo outranks a typed prefix: the person has
       just been asked the question outright and answered it. */
    const force = pinned ?? typed;
    /* A destination named up front is a statement about where this kind of
       thing belongs, so it teaches — the same loop an answered undo feeds.
       Only a TYPED command: a re-sort after undo has already written its
       own, stronger lesson, and recording both would count one correction
       twice. */
    const commandLesson =
      !pinned && typed ? commandRule(payload, typed) : null;
    if (!payload && !pics.length) return;
    setErr("");
    setSwept(null);
    // A new capture takes over the banner: no stale proposal survives.
    setSuggestion(null);
    /* Asking about the previous capture stops making sense once a new one
       is on its way. A re-sort passes `pinned`, and must keep its own
       question alive long enough to have written the rule. */
    if (!pinned) setMisfiled(null);
    setBusy("Sorting");

    const at = stamp();
    // Stored before the sort so both outcomes keep the pictures.
    const imgIds: string[] = [];
    for (const p of pics) {
      try {
        await set(IMG(p.id), p.src);
        imgIds.push(p.id);
      } catch {
        /* skip */
      }
    }

    try {
      // A forced intention is declared rather than filed, and the intention
      // engine rewrites the words from scratch — the sorter's output would
      // be thrown away, so it is never asked. A destination the model chose
      // on its own still goes through the sorter to learn the kind first.
      if (force === "intention") {
        captureSnapshot.current = null;
        setCanUndo(false);
        setText("");
        setPics([]);
        /* This branch never reaches the commit below, so the lesson is
           written here or not at all. */
        if (commandLesson) await noteCommand(commandLesson, payload);
        await expandIntention(payload, {
          raw: payload,
          source: sourceOf(payload, dictated, imgIds.length > 0),
        });
        setTimeout(() => setLanded(null), 4500);
        return;
      }

      const sorted = await requestSort(
        payload || "(image only)",
        force,
        pics[0]?.src
      );
      const out = pinnedThread
        ? { ...sorted, threadId: pinnedThread, threadName: null }
        : sorted;

      // An intention is declared rather than filed, so it takes a second
      // pass through its own engine and stops at a review step instead of
      // landing on the board. Nothing has committed yet, so there is
      // nothing to undo — the draft is the undo.
      if (out.kind === "intention") {
        captureSnapshot.current = null;
        setCanUndo(false);
        setText("");
        setPics([]);
        await expandIntention(payload, {
          raw: payload,
          source: sourceOf(payload, dictated, imgIds.length > 0),
        });
        setTimeout(() => setLanded(null), 4500);
        return;
      }

      const {
        next,
        targetId,
        landed,
        source,
        landedIds: fresh,
        alsoLanded,
      } = applySorted(out, imgIds, at, latest.current);
      /* One identity for the whole utterance, carried by every entry it
         writes. `raw` is what was said and is the same on all of them;
         `clean` is that destination's share. */
      const captureId = uid();
      const split = (alsoLanded?.length ?? 0) > 0 && !!out.primaryText?.trim();
      // The capture records itself in the ledger before it lands: what was
      // said, what it became, where it went, and which model tier sorted it.
      const filed = withLedger(next, {
        id: uid(),
        captureId,
        at,
        raw,
        /* When it split, this entry holds the primary's share — the other
           shares have entries of their own. Keeping the whole sentence here
           counted the same words in two places. */
        clean: (split ? out.primaryText!.trim() : out.clean) || payload,
        kind: out.kind,
        source: sourceOf(payload, dictated, imgIds.length > 0),
        targetId:
          out.kind === "action"
            ? source?.id ?? next.actions[0]?.id ?? ""
            : (source?.id ?? targetId ?? ""),
        targetFragId: source?.fragId,
        modelVia: out.via,
        transcript: transcript.trim() || undefined,
        imgs: imgIds.length ? imgIds : undefined,
      });
      /* A split capture landed in more than one place, and each place needs
         its own entry: the ledger is what Undo walks back and what the daily
         wrap counts, so a fragment it cannot see is a fragment that silently
         does not exist. Same raw words, same moment — only the destination
         and the share differ. */
      const withAll = (alsoLanded ?? []).reduce(
        (board, piece) =>
          withLedger(board, {
            id: uid(),
            captureId,
            at,
            raw,
            clean: piece.text,
            kind: "thread",
            source: sourceOf(payload, dictated, imgIds.length > 0),
            targetId: piece.threadId,
            targetFragId: piece.fragId,
            modelVia: out.via,
          }),
        filed
      );
      const recorded = commandLesson
        ? noteCorrection(withAll, {
            proposalKind: "commanded",
            accepted: true,
            context: payload.slice(0, 160),
            rule: commandLesson,
          })
        : withAll;
      setLanded(landed);
      setLandedIds(fresh);
      setTab(out.kind === "action" ? "actions" : "threads");
      setText("");
      setPics([]);
      setTranscript("");
      // Snapshot right before it lands — edits made while the sort ran
      // survive; only the capture itself is reverted by Undo, and the raw
      // words come back to the box so the capture can be edited and
      // re-submitted.
      captureSnapshot.current = {
        board: latest.current,
        tombstones: tombstones.current,
        text,
        picIds: pics.map((p) => p.id),
        ledgerIds: newLedgerIds(latest.current, recorded),
      addedIds: newIds(latest.current, recorded),
      };
      setCanUndo(true);
      await commit(recorded);
      /* A quiet proposal, never applied: if this capture clearly belongs
         with an existing thread, offer the fold. An explicit /action,
         /thread or /intention command is respected — only the model's
         choice is ever second-guessed. Computed before the summary refresh
         so it lands with the banner, never a model round-trip later. */
      setSuggestion(
        force ? null : computeSuggestion(filed, out.clean, source)
      );
      /* Not awaited. The capture has landed, the banner is up, and the box
         is free for the next thought; the summary catches up behind it. */
      /* Every thread this capture reached, not just the first. A split left
         the secondary thread holding a new fragment and an account of itself
         written before that fragment arrived — so the thread said one thing
         and contained another, and the sorter went on routing against the
         stale description. */
      for (const id of new Set(
        [targetId, ...(alsoLanded ?? []).map((p) => p.threadId)].filter(
          (v): v is string => !!v
        )
      ))
        scheduleSummary(id);
    } catch (error) {
      await saveUnsorted(raw, imgIds, at, reasonOf(error), dictated);
    }

    setBusy(null);
    /* Same widened window as the main capture — Undo lives here too. */
    setTimeout(() => {
      setLanded(null);
      setLandedIds([]);
      setSuggestion(null);
    }, 9000);
  };

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
    setSuggestion(null);
    let context = "";
    if (s.kind === "duplicate") {
      context = `dropped a duplicate of ${s.targetName}`;
      const rule = `Drop duplicates of "${s.targetName}"`;
      if (s.sourceKind === "thread") {
        /* The copy is a note; drop that fragment (or its whole fresh thread
           when it was the only note) and re-summarise. The original stays
           where it was. The notice goes out before the refresh — the model
           call can take a second, and the outcome is the same either way. */
        setNotice("Removed the duplicate.");
        setTimeout(() => setNotice(null), 4000);
        await deleteFrag(s.sourceId, s.sourceFragId!);
      } else {
        const dup = latest.current.actions.find((x) => x.id === s.sourceId);
        await dropImages(dup?.imgs);
        await commit(
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
      }
      setNotice("Removed the duplicate.");
      setTimeout(() => setNotice(null), 4000);
      // The thread-fragment branch committed inside deleteFrag; record the
      // outcome on top of whatever it left behind.
      if (s.sourceKind === "thread") {
        await commit(
          noteCorrection(latest.current, {
            proposalKind: "related_suggestion",
            accepted: true,
            context,
            rule,
          })
        );
      }
      return;
    }
    const article = s.sourceKind === "action" ? "an action" : "a thread";
    context =
      s.verb === "Merge"
        ? `merged ${article} into ${s.targetName}`
        : `moved ${article} into ${s.targetName}`;
    const rule =
      s.verb === "Merge"
        ? `Merge ${s.sourceKind}s into "${s.targetName}"`
        : `Move ${s.sourceKind}s into "${s.targetName}"`;
    if (s.sourceKind === "action") {
      await foldActionIntoThread(s.sourceId, s.targetId);
    } else if (s.fragId) {
      await moveFrag(s.sourceId, s.fragId, s.targetId);
    } else {
      await mergeThreads(s.targetId, s.sourceId);
    }
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
  const dismissSuggestion = () => {
    const s = suggestion;
    setSuggestion(null);
    if (!s) return;
    const article = s.sourceKind === "action" ? "an action" : "a thread";
    const context =
      s.kind === "duplicate"
        ? `kept the duplicate of ${s.targetName}`
        : `kept ${article} out of ${s.targetName}`;
    const rule =
      s.kind === "duplicate"
        ? `Don't treat "${s.targetName}" as a duplicate`
        : `Keep ${s.sourceKind}s out of "${s.targetName}"`;
    void commit(
      noteCorrection(latest.current, {
        proposalKind: "related_suggestion",
        accepted: false,
        context,
        rule,
      })
    );
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
  const [answers, setAnswers] = useState<Answered[]>([]);
  const noteVia = useCallback((via?: string | null) => {
    if (!via) return;
    setAnswers((prev) => [...prev, { via, at: Date.now() }].slice(-12));
  }, []);
  const degraded = degradedTier(answers);

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
        if (!out?.line) return;
        /* Against the board as it is now: the day was already over when the
           request left, but the wraps list may not have been. */
        const now = latest.current;
        if ((now.wraps ?? []).some((w) => w.day === day)) return;
        const stats = dayStats(now, day);
        if (!stats) return;
        const wrap: DayWrap = {
          day,
          at: Date.now(),
          stats,
          line: out.line,
          insights: out.insights ?? [],
          tomorrow: out.tomorrow ?? "",
          via: out.via,
        };
        await commit({ ...now, wraps: [...(now.wraps ?? []), wrap] });
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
    setShowWrap(false);
    const b = latest.current;
    const ws = b.wraps ?? [];
    if (!ws.some((w) => !w.seen)) return;
    await commit({
      ...b,
      wraps: ws.map((w) => (w.seen ? w : { ...w, seen: true })),
    });
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
  const tangleAskedAt = useRef<number | null>(null);
  const tangleDismissed = useRef<string[]>([]);
  /* Word-matches that survived the judge, kept against the board they were
     judged about — asking twice about an unchanged board should not produce
     two different answers, the same reason the model read is cached. */
  const judgedRead = useRef<JudgedRead | null>(null);
  /* Bumped by Tidy to ask for a check on demand. The daily gate exists so
     the app does not interrupt; it should never stop a person who came
     looking. */
  const [tangleNudge, setTangleNudge] = useState(0);
  const tangleHandled = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const asked = await get(TANGLE_ASKED_KEY);
        tangleAskedAt.current = asked ? Number(asked) : null;
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
    const asked = tangleAskedAt.current;
    const askedFor = tangleNudge > tangleHandled.current;
    if (!askedFor && asked && Date.now() - asked < TANGLE_EVERY_MS) return;
    tangleHandled.current = tangleNudge;

    /* Claim the day BEFORE the work, so two renders cannot both start it —
       but remember what the clock said, because a failure has to give it
       back. */
    const askedBefore = tangleAskedAt.current;
    tangleTried.current.add(tangleProposalId(pair));
    tangleAskedAt.current = Date.now();
    void set(TANGLE_ASKED_KEY, String(Date.now()));
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
        tangleAskedAt.current = askedBefore;
        if (askedBefore === null) void del(TANGLE_ASKED_KEY);
        else void set(TANGLE_ASKED_KEY, String(askedBefore));
      } finally {
        setTangleBusy(false);
      }
    })();
  }, [loaded, data, tangle, tangleBusy, tangleNudge]);

  /** Move everything ticked, and take the new name if one was offered. */
  const acceptTangle = useCallback(
    async (
      fragIds: string[],
      rename: boolean,
      /* Take every note in the thread, not just the ones the model listed.
 
         Without this the merge was unreachable in practice. The judge
         proposes the notes it is confident about — twenty-two of a larger
         thread — so "tick everything" emptied the review, never the thread,
         and the board came back saying "Moved 22" while both names stayed
         in the list. The person who has already moved notes between these
         two threads seven times by hand is not asking about twenty-two of
         them. */
      takeAll = false
    ) => {
      const t = tangle;
      if (!t) return;
      setTangle(null);

      /* Moved in ONE pass, not by calling the single-note move twenty times.
         That helper re-summarises both threads after every move — two model
         calls each — so a batch of twenty-one became forty-two sequential
         calls: minutes of work, a rate limit hit halfway, and a screen that
         looks stuck while two of the twenty-one land. The batch does the
         whole move at once and summarises each thread once at the end. */
      const board = latest.current;
      const from = board.threads.find((x) => x.id === t.pair.fromId);
      const taking = new Set(
        takeAll ? (from?.frags ?? []).map((f) => f.id) : fragIds
      );
      const going = (from?.frags ?? []).filter((f) => taking.has(f.id));
      if (!going.length && !(rename && t.rename)) return;

      /* Taking every note is a merge, whatever it was called on the way in.
 
         The app does not merge threads on its own — not on shared words,
         not on a model's opinion — and that rule stands. This one case is
         different in kind: the pair was raised because the person had
         already moved notes between these two threads by hand, several
         times, and they have just agreed to move the rest. Leaving the
         emptied thread behind would keep the name that caused the
         confusion sitting in the list, where the sorter reads it and files
         into it again. The clutter this removes is the clutter that was
         making everything else file wrongly. */
      const emptied =
        (from?.frags ?? []).length > 0 &&
        (from?.frags ?? []).every((f) => taking.has(f.id));

      const threads = board.threads
        .map((x) => {
          if (x.id === t.pair.fromId) {
            const left = x.frags.filter((f) => !taking.has(f.id));
            return {
              ...x,
              frags: left,
              ...(rename && t.rename ? { name: t.rename } : {}),
            };
          }
          if (x.id === t.pair.toId)
            return {
              ...x,
              frags: [...x.frags, ...going].sort((a, b) => a.at - b.at),
            };
          return x;
        })
        .filter((x) => !(emptied && x.id === t.pair.fromId));

      /* Actions remember the thread they arrived with, and that thread is
         about to stop existing. They follow the notes rather than becoming
         orphans pointing at nothing. */
      const actions = emptied
        ? board.actions.map((a) =>
            a.threadId === t.pair.fromId ? { ...a, threadId: t.pair.toId } : a
          )
        : board.actions;

      /* One correction for the batch. Twenty-one of them would drown the
         signal the correction ledger exists to carry. */
      await commit(
        noteCorrection(
          { ...board, threads, actions },
          {
            proposalKind: "related_suggestion",
            accepted: true,
            context: emptied
              ? `merged ${t.pair.fromName} into ${t.pair.toName}`
              : `untangled ${t.pair.fromName} and ${t.pair.toName}`,
            rule: `Notes like these belong in "${t.pair.toName}", not "${t.pair.fromName}"`,
          }
        )
      );
      /* Both accounts of themselves are now wrong: one gained a pile, the
         other lost one. Once each, after the move. */
      const after = await regenerate(latest.current, t.pair.toId);
      if (threads.some((x) => x.id === t.pair.fromId && x.frags.length))
        await regenerate(after, t.pair.fromId);
      setNotice(
        emptied
          ? `Merged ${t.pair.fromName} into ${t.pair.toName} · ${going.length} ${
              going.length === 1 ? "note" : "notes"
            }`
          : `Moved ${going.length} to ${t.pair.toName}` +
            (rename && t.rename ? ` · renamed to ${t.rename}` : "")
      );
      setTimeout(() => setNotice(null), 5000);
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
      noteVia(out?.via);
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
    /* `noteVia` only ever appends to a bounded list through a setter, so it
       is stable in every way that matters here; listing it would rebuild
       the warm on every render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ask the judge which word-matches mean anything, and show the ones
      that do. Never throws into the caller: no judgement means no extra
      rows, which is what the panel shows today. */
  const judgeWordMatches = async () => {
    const board = latest.current;
    const sig = boardSignature(board, []);
    const cached = judgedRead.current;
    /* A different board must stop seeing the prior board's judgement before
       this function yields to the network. Every visible read is also gated. */
    judgedRead.current = cached?.sig === sig ? cached : null;

    /* Loose on purpose. The strict thresholds exist for claims that talk
       to a person directly; a candidate the scan never emits is one the
       judge never gets to keep. */
    const candidates = wordMatched(
      scanBoard(board, dismissedOrganize.current, Date.now(), { loose: true })
    );
    const result = await requestJudgedProposals({
      board,
      sig,
      cached,
      candidates,
      currentSig: () => boardSignature(latest.current, []),
      request: async (sent) =>
        fetch("/api/judge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidates: sent }),
        }),
    });

    /* A later request for a newer board owns the cache now. */
    if (boardSignature(latest.current, []) !== sig) return;
    judgedRead.current = result.read;
    noteVia(result.via);
    const kept = judgedForSignature(result.read, sig);
    if (!kept.length) return;
    setOrganize((cur) =>
      mergeOrganize(
        [...(cur ?? []), ...kept],
        scanStale(latest.current, dismissedOrganize.current)
      )
    );
  };

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
    void judgeWordMatches();

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
        mergeOrganize(
          [
            ...cached.ai.filter((p) => !dismissedOrganize.current.includes(p.id)),
            ...judgedForSignature(judgedRead.current, sig).filter(
              (p) => !dismissedOrganize.current.includes(p.id)
            ),
          ],
          scanStale(latest.current, dismissedOrganize.current)
        )
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
      let via: string | undefined;
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
        via = out.via;
        raw.push(...(out.proposals ?? []));
      }
      noteVia(via);
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
        mergeOrganize(
          [
            ...ai,
            ...judgedForSignature(
              judgedRead.current,
              boardSignature(latest.current, [])
            ),
          ],
          scanStale(latest.current, dismissedOrganize.current)
        )
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

  /**
   * Apply one Organize proposal. Each kind routes through the same handlers
   * the capture suggestions use, so the outcome and its ledger record are
   * consistent with the rest of the app — then the panel re-scans so a
   * resolved pair never lingers.
   */
  /**
   * Apply one Organize proposal. Each kind routes through the same handlers
   * the capture suggestions use, so the outcome and its ledger record are
   * consistent with the rest of the app. Returns whether the change was
   * applied — an extraction that failed leaves its card in the list so the
   * user can retry; everything else applies or is already resolved.
   */
  const acceptOrganize = async (id: string): Promise<boolean> => {
    const p = organize?.find((x) => x.id === id);
    if (!p) return false;
    /* The row leaves the list immediately, and the applied change must not
       ride back in from the cached AI results on a future scan — a
       resolved proposal is resolved. */
    aiOrganize.current = aiOrganize.current.filter((x) => x.id !== id);
    setOrganize((cur) => (cur ? cur.filter((x) => x.id !== id) : cur));
    if (p.kind === "dup_action") {
      const a = latest.current.actions.find((x) => x.id === p.sourceId);
      await dropImages(a?.imgs);
      await commit(
        noteCorrection(
          {
            ...latest.current,
            actions: latest.current.actions.filter(
              (x) => x.id !== p.sourceId
            ),
          },
          {
            proposalKind: "related_suggestion",
            accepted: true,
            context: `dropped a duplicate of ${p.targetName}`,
            rule: `Drop duplicates of "${p.targetName}"`,
          }
        )
      );
      setNotice(`Removed the duplicate of ${p.targetName}.`);
      setTimeout(() => setNotice(null), 4000);
      return true;
    } else if (p.kind === "dup_fragment") {
      setNotice(`Removed the duplicate of ${p.targetName}.`);
      setTimeout(() => setNotice(null), 4000);
      await deleteFrag(p.sourceThreadId!, p.sourceFragId!);
      await commit(
        noteCorrection(latest.current, {
          proposalKind: "related_suggestion",
          accepted: true,
          context: `dropped a duplicate of ${p.targetName}`,
          rule: `Drop duplicates of "${p.targetName}"`,
        })
      );
      return true;
    } else if (p.kind === "fold_action") {
      await foldActionIntoThread(p.sourceId, p.targetId);
      await commit(
        noteCorrection(latest.current, {
          proposalKind: "related_suggestion",
          accepted: true,
          context: `moved an action into ${p.targetName}`,
          rule: `Move actions into "${p.targetName}"`,
        })
      );
      return true;
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
      await commit({
        ...latest.current,
        actions: latest.current.actions.map((x) =>
          x.id === p.sourceId
            ? { ...x, faded: true, fadedAt: at, updatedAt: at }
            : x
        ),
      });
      setNotice("Let go — it sits in Faded for two weeks if you want it back.");
      setTimeout(() => setNotice(null), 5000);
      return true;
    } else if (p.kind === "revisit_intention") {
      /* Saying it is still true IS the revisit. Nothing about the intention
         changes except when it was last stood behind, which is exactly what
         was being asked about — so it goes quiet for another two months.

         No correction is recorded: standing by a declared state says
         nothing about how captures should be filed. */
      const still = latest.current.intentions.find((x) => x.id === p.sourceId);
      if (!still) return false;
      const at = stamp();
      await commit({
        ...latest.current,
        intentions: latest.current.intentions.map((x) =>
          x.id === p.sourceId ? { ...x, updatedAt: at } : x
        ),
      });
      setNotice("Still yours. It won't ask again for a while.");
      setTimeout(() => setNotice(null), 5000);
      return true;
    } else if (p.kind === "move_fragment") {
      await moveFrag(p.sourceThreadId!, p.sourceFragId!, p.targetId);
      await commit(
        noteCorrection(latest.current, {
          proposalKind: "related_suggestion",
          accepted: true,
          context: `moved a note into ${p.targetName}`,
          rule: `Move notes into "${p.targetName}"`,
        })
      );
      return true;
    } else if (p.kind === "split_fragment") {
      await moveFragToNew(p.sourceThreadId!, p.sourceFragId!);
      await commit(
        noteCorrection(latest.current, {
          proposalKind: "related_suggestion",
          accepted: true,
          context: `split a note out of ${p.targetName}`,
        })
      );
      return true;
    } else if (p.kind === "extract_action") {
      /* extractAction records its own correction and notice. Extraction leaves
         the note in place, so a success also remembers the proposal by id —
         otherwise the same card would re-propose on every scan. A failure
         keeps the card, so the user can retry — the row was removed at the
         top, so a failed extraction puts it back. */
      const ok = await extractAction(p.sourceThreadId!, p.sourceFragId!);
      if (ok) {
        dismissedOrganize.current = [...dismissedOrganize.current, p.id];
        void set(ORGANIZE_DISMISSED_KEY, JSON.stringify(dismissedOrganize.current));
      } else {
        setOrganize((cur) => (cur ? [p, ...cur] : cur));
        aiOrganize.current = [p, ...aiOrganize.current];
      }
      return ok;
    } else if (p.kind === "merge_fragments") {
      /* The same idea lives in two notes — move the newer one into the
         thread that already holds it. moveFrag interleaves by date, carries
         images, re-summarises, and removes an emptied source thread. */
      await moveFrag(p.sourceThreadId!, p.sourceFragId!, p.targetId);
      await commit(
        noteCorrection(latest.current, {
          proposalKind: "related_suggestion",
          accepted: true,
          context: `merged a note into ${p.targetName}`,
          rule: `Move notes into "${p.targetName}"`,
        })
      );
      return true;
    }
    /* The row is already gone from the list (removed above); the board
       change is committed, so a future scan will not re-propose it. */
    return true;
  };

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
    /* A row that throws must not brick the button for the rest of the
       session — the guard is cleared even when a handler misbehaves. */
    try {
      for (const p of list) {
        if (await acceptOrganize(p.id)) applied++;
      }
    } finally {
      applyingOrganize.current = false;
    }
    const diff = list.length - applied;
    setNotice(
      applied === list.length
        ? `Applied all ${applied} ${applied === 1 ? "suggestion" : "suggestions"}.`
        : `Applied ${applied} of ${list.length} — ${diff} ${
            diff === 1
              ? "couldn't be applied and is still listed"
              : "couldn't be applied and are still listed"
          }.`
    );
    setTimeout(() => setNotice(null), 6000);
  };

  /** Wave an Organize proposal off — remembered by id so it never reappears,
      and recorded in the correction ledger as a waved-off merge. */
  const dismissOrganize = (id: string) => {
    const p = organize?.find((x) => x.id === id);
    if (!p) return;
    aiOrganize.current = aiOrganize.current.filter((x) => x.id !== id);
    setOrganize((cur) =>
      cur ? cur.filter((x) => x.id !== id) : cur
    );
    dismissedOrganize.current = [...dismissedOrganize.current, id];
    void set(ORGANIZE_DISMISSED_KEY, JSON.stringify(dismissedOrganize.current));
    void commit(
      noteCorrection(latest.current, {
        proposalKind: "related_suggestion",
        accepted: false,
        context: `kept "${p.sourceName}" separate from "${p.targetName}"`,
      })
    );
  };

  /* ---------------------------- actions ----------------------------- */

  /** Ticking an action completes it — and completion removes it. The
      app's promise is that a finished task stops existing; keeping a
      done list would make ticking the start of a new chore. */
  const toggleAction = async (id: string) => {
    const a = latest.current.actions.find((x) => x.id === id);
    await dropImages(a?.imgs);
    /* The board holds what is still open, so a tick takes the row away. It
       used to take the fact with it: a day of finishing things left the same
       trace as a day of none. The receipt is kept instead — append-only,
       keyed by the action's own id so a re-tick cannot double-count. */
    const done = a
      ? [
          ...(latest.current.completions ?? []),
          { id: a.id, text: a.text, at: stamp(), threadId: a.threadId },
        ]
      : latest.current.completions;
    await commit({
      ...latest.current,
      actions: latest.current.actions.filter((x) => x.id !== id),
      completions: done,
    });
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
    await dropImages(a.imgs);
    await commit({
      ...latest.current,
      actions: latest.current.actions.filter((x) => x.id !== a.id),
    });
    setShelfFor(null);
  };

  const moveToThread = async (a: Action) => {
    const t: Thread = {
      id: uid(),
      name: a.text.split(" ").slice(0, 5).join(" "),
      summary: "",
      frags: [
        { id: uid(), at: a.at, text: a.src || a.text, imgs: a.imgs || [] },
      ],
    };
    await commit({
      ...latest.current,
      actions: latest.current.actions.filter((x) => x.id !== a.id),
      threads: [t, ...latest.current.threads],
    });
    setTab("threads");
  };

  /**
   * Fold a captured action into an existing thread — the accepted "this
   * belongs with X" suggestion. The action becomes a fragment of the thread
   * (interleaved by date, images carried over) and the thread is re-summarised.
   */
  const foldActionIntoThread = async (actionId: string, threadId: string) => {
    const a = latest.current.actions.find((x) => x.id === actionId);
    const t = latest.current.threads.find((x) => x.id === threadId);
    if (!a || !t) return;
    /* A fold-back must never duplicate: extraction leaves the note in the
       thread, so an action extracted from it folds right back into the very
       fragment it came from. When the thread already holds the note, the
       action is still retired (it was a task, not a note) but nothing is
       appended — this is the safety net that guarantees approve-all can
       never stack copies, whatever a stale proposal or cached AI pass says. */
    const already = threadHoldsNote(t.frags, a.src || a.text, a.text);
    /* Folded within minutes of landing: the sorter called it a task when it
       was really a note on a subject already open. Same correction as a
       re-filed fragment, from the other direction. */
    const foldLesson = isRefile(a.at, stamp())
      ? refileRule(
          a.src || a.text,
          t.name,
          [t.name, t.summary, ...t.frags.map((f) => f.text)].join(" ")
        )
      : null;

    const folded = {
      ...latest.current,
      actions: latest.current.actions.filter((x) => x.id !== actionId),
      threads: already
        ? latest.current.threads
        : latest.current.threads.map((x) =>
            x.id === threadId
              ? {
                  ...x,
                  frags: [
                    ...x.frags,
                    {
                      id: uid(),
                      at: a.at,
                      text: a.src || a.text,
                      imgs: a.imgs || [],
                    },
                  ].sort((p, q) => p.at - q.at),
                }
              : x
          ),
    };
    await commit(
      foldLesson
        ? noteCorrection(folded, {
            proposalKind: "refiled",
            accepted: true,
            context: (a.src || a.text).slice(0, 160),
            rule: foldLesson,
          })
        : folded
    );
    setNotice(
      already
        ? `${t.name} already has this note — task retired.`
        : `Moved into ${t.name}.`
    );
    setTimeout(() => setNotice(null), 4500);
    if (!already) await regenerate(latest.current, threadId);
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
        setTimeout(() => setNotice(null), 4000);
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

  const renameThread = (id: string, name: string) => {
    const prev = latest.current.threads.find((t) => t.id === id)?.name;
    if (!name.trim() || name === prev) return;
    commit(
      noteCorrection(
        {
          ...latest.current,
          threads: latest.current.threads.map((t) =>
            t.id === id ? { ...t, name } : t
          ),
        },
        {
          proposalKind: "rename_thread",
          accepted: true,
          context: prev || "",
          correctionText: name,
          rule: `threads get named "${name}"`,
        }
      )
    );
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
        await set(IMG(id), src);
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
    // A save that changed nothing spends no model call and no push.
    if (
      latest.current.threads
        .find((t) => t.id === threadId)
        ?.frags.find((f) => f.id === fragId)?.text === text
    )
      return;
    // The edit lands immediately — saving never waits on a model call.
    const next = {
      ...latest.current,
      threads: latest.current.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              frags: t.frags.map((f) => (f.id === fragId ? { ...f, text } : f)),
            }
          : t
      ),
    };
    await commit(next);
    // Then the proofread pass catches typos before they stick. Only applied
    // if the note still reads as the text we checked — a newer edit is
    // never clobbered by a stale correction.
    const fixed = await proofreadEdit(text);
    if (fixed !== text) {
      const current = latest.current;
      const frag = current.threads
        .find((t) => t.id === threadId)
        ?.frags.find((f) => f.id === fragId);
      if (frag && frag.text === text) {
        await commit(
          noteCorrection(
            {
              ...current,
              threads: current.threads.map((t) =>
                t.id === threadId
                  ? {
                      ...t,
                      frags: t.frags.map((f) =>
                        f.id === fragId ? { ...f, text: fixed } : f
                      ),
                    }
                  : t
              ),
            },
            {
              proposalKind: "clean_fragment",
              accepted: true,
              context: frag.text.slice(0, 120),
              correctionText: fixed.slice(0, 120),
            }
          )
        );
        setNotice("Fixed a couple of typos.");
        setTimeout(() => setNotice(null), 4000);
      }
    }
    await regenerate(latest.current, threadId);
  };

  const deleteFrag = async (threadId: string, fragId: string) => {
    const target = latest.current.threads.find((t) => t.id === threadId);
    const frag = target?.frags.find((f) => f.id === fragId);
    /* Idempotency: a fast double-tap on a delete already consumed the frag;
       a second run would otherwise re-commit and re-summarise a board that
       did not change. */
    if (!frag) return;
    await dropImages(frag?.imgs);

    const remaining = (target?.frags || []).filter((f) => f.id !== fragId);

    // A thread with nothing left in it is just a name; drop it and go back.
    if (!remaining.length) {
      await commit({
        ...latest.current,
        threads: latest.current.threads.filter((t) => t.id !== threadId),
      });
      setOpen(null);
      return;
    }

    const next = {
      ...latest.current,
      threads: latest.current.threads.map((t) =>
        t.id === threadId ? { ...t, frags: remaining } : t
      ),
    };
    await commit(next);
    await regenerate(next, threadId);
  };

  /**
   * Move one fragment to another thread.
   *
   * The sorter puts a fragment on the wrong thread often enough that the only
   * remedy being "delete it and say it again" was a real loss. Both threads
   * are re-summarised afterwards.
   */
  const moveFrag = async (fromId: string, fragId: string, toId: string) => {
    const from = latest.current.threads.find((t) => t.id === fromId);
    const frag = from?.frags.find((f) => f.id === fragId);
    if (!from || !frag) return;

    const remaining = from.frags.filter((f) => f.id !== fragId);
    const to = latest.current.threads.find((t) => t.id === toId);
    if (!to) return;

    let threads = latest.current.threads.map((t) =>
      t.id === toId
        ? { ...t, frags: [...t.frags, frag].sort((a, b) => a.at - b.at) }
        : t
    );

    const emptied = remaining.length === 0;
    threads = emptied
      ? threads.filter((t) => t.id !== fromId)
      : threads.map((t) => (t.id === fromId ? { ...t, frags: remaining } : t));

    /* A note moved out within minutes of landing is the sorter being told it
       was wrong, with the right home attached. That is the strongest signal
       the app gets, and until now it went unrecorded — the ledger only ever
       heard about proposals the engine itself had offered. */
    const lesson = isRefile(frag.at, stamp())
      ? refileRule(
          frag.text,
          to.name,
          [to.name, to.summary, ...to.frags.map((f) => f.text)].join(" ")
        )
      : null;

    const next = lesson
      ? noteCorrection(
          { ...latest.current, threads },
          {
            proposalKind: "refiled",
            accepted: true,
            context: frag.text.slice(0, 160),
            rule: lesson,
          }
        )
      : { ...latest.current, threads };
    await commit(next);
    setNotice(
      emptied
        ? `Moved to ${to.name}. ${from.name} was left empty and removed.`
        : lesson
          ? `Moved to ${to.name} — noted for next time.`
          : `Moved to ${to.name}.`
    );
    setTimeout(() => setNotice(null), 4500);

    if (emptied) setOpen(toId);
    const afterTo = await regenerate(next, toId);
    if (!emptied) await regenerate(afterTo, fromId);
  };

  /** Split a fragment out into a thread of its own. */
  const moveFragToNew = async (fromId: string, fragId: string) => {
    const from = latest.current.threads.find((t) => t.id === fromId);
    const frag = from?.frags.find((f) => f.id === fragId);
    if (!from || !frag) return;

    const fresh: Thread = {
      id: uid(),
      name: frag.text.split(/\s+/).slice(0, 5).join(" "),
      summary: "",
      frags: [frag],
    };
    const remaining = from.frags.filter((f) => f.id !== fragId);
    const emptied = remaining.length === 0;

    const threads = [
      fresh,
      ...(emptied
        ? latest.current.threads.filter((t) => t.id !== fromId)
        : latest.current.threads.map((t) =>
            t.id === fromId ? { ...t, frags: remaining } : t
          )),
    ];
    const next = { ...latest.current, threads };
    await commit(next);
    setOpen(fresh.id);
    setNotice(`Split into a new thread. Rename it if the name is wrong.`);
    setTimeout(() => setNotice(null), 5000);

    const afterNew = await regenerate(next, fresh.id);
    if (!emptied) await regenerate(afterNew, fromId);
  };

  const copyFragment = async (threadId: string, fragId: string) => {
    const frag = latest.current.threads
      .find((t) => t.id === threadId)
      ?.frags.find((f) => f.id === fragId);
    if (!frag) return;
    const ok = await copyToClipboard(frag.text);
    setNotice(ok ? "Note copied." : "Couldn't reach the clipboard.");
    setTimeout(() => setNotice(null), 3000);
  };

  const copyWhole = async (s: { text: string; summary: string } | null) => {
    if (!s) return;
    const ok = await copyToClipboard(s.text);
    setNotice(ok ? `Copied — ${s.summary}.` : "Couldn't reach the clipboard.");
    setTimeout(() => setNotice(null), 3000);
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
      await commit(
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
      );
      setNotice("Added to your actions.");
      setTimeout(() => setNotice(null), 5000);
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was added.");
    }
    setBusy(null);
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
      await commit(
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
      );
      setNotice(
        `${count(items.length, "action")} taken from this note. The note stays here.`
      );
      setTimeout(() => setNotice(null), 5000);
      setBusy(null);
      return true;
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was added.");
      setBusy(null);
      return false;
    }
  };

  const deleteThread = async (id: string) => {
    const target = latest.current.threads.find((t) => t.id === id);
    for (const f of target?.frags || []) await dropImages(f.imgs);
    await commit({
      ...latest.current,
      threads: latest.current.threads.filter((t) => t.id !== id),
    });
    setOpen(null);
  };

  /**
   * Fold `fromId` into `intoId`.
   *
   * Fragments are interleaved by date rather than appended, so the merged
   * thread reads as one history, and the summary is rebuilt from the whole.
   */
  const mergeThreads = async (intoId: string, fromId: string) => {
    const into = latest.current.threads.find((t) => t.id === intoId);
    const from = latest.current.threads.find((t) => t.id === fromId);
    if (!into || !from) return;

    const frags = [...into.frags, ...from.frags].sort((a, b) => a.at - b.at);
    const next: Board = {
      ...latest.current,
      threads: latest.current.threads
        .filter((t) => t.id !== fromId)
        .map((t) => (t.id === intoId ? { ...t, frags } : t)),
    };
    await commit(next);
    setNotice(from.name + " folded into " + into.name + ".");
    setTimeout(() => setNotice(null), 4500);
    await regenerate(next, intoId);
  };

  /* --------------------------- intentions -------------------------- */

  /** Run raw words through the intention engine and open the review step.
      `ledger` describes the capture that opened this draft; when the draft is
      saved, saveDraft records it in the ledger. Absent for conversions of
      things already captured (an action made into an intention). */
  const expandIntention = async (
    rawInput: string,
    ledger?: { raw: string; source: CaptureSource } | null
  ) => {
    intentionLedger.current = ledger ?? null;
    setErr("");
    setBusy("Finding the intention");
    try {
      const res = await fetch("/api/intention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "expand",
          rawInput,
          principles: latest.current.principles,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new SortError(body.error);
      }
      const out = await res.json();
      if (intentionLedger.current) intentionLedger.current.via = out.via;
      setDraft({
        rawInput,
        expandedIntention: out.expandedIntention,
        recommendedActions: out.recommendedActions || [],
        counterIntentions: out.counterIntentions || [],
      });
      setTab("intentions");
      setOpenIntention(null);
      setBusy(null);
      return true;
    } catch (error) {
      setBusy(null);
      throw error;
    }
  };

  /** Save the reviewed draft as a record on the board. */
  const saveDraft = async () => {
    if (!draft) return;
    const at = stamp();
    const intention: Intention = {
      id: uid(),
      number: nextNumber(latest.current.intentions),
      rawInput: draft.rawInput,
      expandedIntention: draft.expandedIntention,
      recommendedActions: draft.recommendedActions,
      counterIntentions: draft.counterIntentions,
      at,
      updatedAt: at,
    };
    let next: Board = {
      ...latest.current,
      intentions: [intention, ...latest.current.intentions],
    };
    // This draft came from converting an action; the action only goes once
    // the intention is actually saved — discarding the draft keeps it.
    // Its photos stay on disk: Undo below can bring the action back, and a
    // restored action pointing at bytes we deleted is worse than a stray
    // picture nobody references.
    if (pendingSource) {
      next = {
        ...next,
        actions: latest.current.actions.filter((a) => a.id !== pendingSource),
      };
    }
    // A capture that became this intention records itself in the ledger:
    // what was said (raw) and what it became (the reviewed wording).
    const fromCapture = intentionLedger.current;
    if (fromCapture) {
      next = withLedger(next, {
        id: uid(),
        at,
        raw: fromCapture.raw,
        clean: draft.expandedIntention,
        kind: "intention",
        source: fromCapture.source,
        targetId: intention.id,
        modelVia: fromCapture.via,
      });
      intentionLedger.current = null;
    }
    /* Saving is the first commit on this path. The capture fork threw the
       snapshot away because a draft can just be discarded — but the moment
       the intention is on the board, discarding is no longer on offer and
       Undo is the only way back, exactly as it is for an action or a
       thread. The words return to the capture box only when they came from
       it; a converted action returns as the action itself. */
    captureSnapshot.current = {
      board: latest.current,
      tombstones: tombstones.current,
      text: fromCapture ? draft.rawInput : undefined,
      ledgerIds: newLedgerIds(latest.current, next),
      addedIds: newIds(latest.current, next),
    };
    setCanUndo(true);
    await commit(next);
    setDraft(null);
    setPendingSource(null);
    setTab("intentions");
    setLanded("Intention " + pad(intention.number));
    setLandedIds([]);
    /* The banner is NOT cleared on a timer here, unlike everywhere else
       that shows one for a moment.
 
       The Undo button lives inside this banner, and this is the only path
       that offers an undo and then took it away again after four and a half
       seconds. An intention is the slowest thing the app makes — several
       minutes of talking before it appears — so the window closed before
       there was anything to read, and undoing became impossible rather than
       merely awkward. Every other capture leaves its banner up until the
       next capture or an undo clears it; this one does the same now. */
  };

  /** Close the intention draft without saving; the source action stays put. */
  const discardDraft = () => {
    setPendingSource(null);
    intentionLedger.current = null;
    setDraft(null);
  };

  const updateIntention = (next: Intention) =>
    commit({
      ...latest.current,
      intentions: latest.current.intentions.map((i) =>
        i.id === next.id ? { ...next, updatedAt: stamp() } : i
      ),
    });

  const deleteIntention = async (id: string) => {
    await commit({
      ...latest.current,
      intentions: latest.current.intentions.filter((i) => i.id !== id),
    });
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

  /** End the session: clear the login cookie and let the gate send us back. */
  const logout = async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      /* server unreachable; the reload below still clears the local view */
    }
    window.location.href = "/";
  };

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
          ? { kind: "record", since: recordCopiedAt }
          : openIntention
            ? { kind: "intention", id: openIntention }
            : open
              ? { kind: "thread", id: open }
              : { kind: "tab", tab },
        now
      ),
    [data, showRecord, recordCopiedAt, openIntention, open, tab, now]
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
    const outcome = await shareText({
      ...shareable,
      files: files.length ? files : undefined,
    });
    if (outcome === "cancelled") return;
    /* The record going out is the thing the next diff measures from. */
    if (showRecord) stampRecordCopy();
    setNotice(
      outcome === "shared"
        ? `Shared — ${shareable.summary}.`
        : outcome === "copied"
          ? `Copied to the clipboard — ${shareable.summary}.`
          : "Couldn't share that."
    );
    setTimeout(() => setNotice(null), 3500);
  };

  /* ----------------------- getting data in/out ---------------------- */

  /* A backup carries the photos too — the board stores image ids, and the
     bytes live in IndexedDB under IMG(id). Collecting them here is what makes
     a restore bring the pictures back instead of silently dropping them. */
  const exportBoard = async () => {
    try {
      const b = latest.current;
      /* referencedImageIds, not a walk written out again here. This walked
         actions and fragments and forgot thread covers, so every backup
         dropped every cover: 8 of 26 references in Gleb's 2026-08-27
         export had no bytes behind them, and all 8 were covers. The sync
         path already had the fix — with a comment describing this exact
         failure — and the export never got it. One function now, so the
         two cannot disagree again. */
      const ids = new Set<string>(referencedImageIds(b));
      const images: Record<string, string> = {};
      await Promise.all(
        [...ids].map(async (id) => {
          try {
            const v = await get(IMG(id));
            if (v) images[id] = v;
          } catch {
            /* gone — the text still backs up */
          }
        })
      );
      downloadJSON(buildBackup(b, images), backupFilename());
      setIoNote({
        text: `Saved ${count(latest.current.actions.length, "action")}, ${count(latest.current.threads.length, "thread")} and ${count(latest.current.intentions.length, "intention")} — with ${Object.keys(images).length} image${Object.keys(images).length === 1 ? "" : "s"} — to a file. Keep it somewhere that isn't this phone.`,
        ok: true,
      });
    } catch {
      setIoNote({ text: "The download didn't start.", ok: false });
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
      const snap = hydrate(JSON.parse(raw));
      const result = restoreBackup(
        { app: "capture", version: 2, board: snap },
        latest.current
      );
      const at = Date.now();
      const fresh = <T extends { id: string; updatedAt?: number }>(
        before: T[],
        after: T[]
      ) =>
        after.map((x) =>
          before.some((y) => y.id === x.id) ? x : { ...x, updatedAt: at }
        );
      const board: Board = {
        ...result.board,
        actions: fresh(latest.current.actions, result.board.actions),
        threads: fresh(latest.current.threads, result.board.threads),
        intentions: fresh(latest.current.intentions, result.board.intentions),
      };
      const added =
        result.actions + result.threads + result.intentions + result.principles;
      await commit(board);
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

  const restoreFromFile = async (file: File) => {
    setIoNote(null);
    try {
      const result = restoreBackup(await readJsonFile(file), latest.current);
      /* Bring the photos back too — the backup carries their bytes since v2.
         Written after the board so a storage hiccup never blocks the text
         restore. Only newly added items get their backup image: an id that
         was already on this device keeps the photo it already has ("existing
         always wins", same rule as the board merge), and a stray id the
         board doesn't reference is skipped. */
      if (result.images) {
        const boardIds = new Set<string>();
        for (const a of result.board.actions)
          for (const i of a.imgs || []) boardIds.add(i);
        for (const t of result.board.threads)
          for (const f of t.frags) for (const i of f.imgs || []) boardIds.add(i);
        const preexisting = new Set<string>();
        for (const a of latest.current.actions)
          for (const i of a.imgs || []) preexisting.add(i);
        for (const t of latest.current.threads)
          for (const f of t.frags)
            for (const i of f.imgs || []) preexisting.add(i);
        await Promise.all(
          Object.entries(result.images).map(([id, url]) =>
            boardIds.has(id) && !preexisting.has(id)
              ? set(IMG(id), url).catch(() => {
                  /* photo skipped; board still restored */
                })
              : Promise.resolve()
          )
        );
      }
      /* What the restore brought back may have been deleted here since the
         backup was taken, and commit re-applies tombstones. Stamp the
         returned items fresh so they out-age those tombstones — on this
         device and, once pushed, on the hub — the same way Undo does. */
      const now = Date.now();
      const fresh = <T extends { id: string; updatedAt?: number }>(
        before: T[],
        after: T[]
      ) =>
        after.map((x) =>
          before.some((y) => y.id === x.id) ? x : { ...x, updatedAt: now }
        );
      result.board = {
        ...result.board,
        actions: fresh(latest.current.actions, result.board.actions),
        threads: fresh(latest.current.threads, result.board.threads),
        intentions: fresh(latest.current.intentions, result.board.intentions),
      };
      const added =
        result.actions +
        result.threads +
        result.intentions +
        result.principles;
      // A restore that added anything records itself in the ledger.
      await commit(
        added
          ? withLedger(result.board, {
              id: uid(),
              at: stamp(),
              raw: file.name,
              clean: `Restored ${count(result.actions, "action")}, ${count(result.threads, "thread")} and ${count(result.intentions, "intention")} from a backup.`,
              kind:
                result.actions > 0
                  ? "action"
                  : result.threads > 0
                    ? "thread"
                    : "intention",
              source: "import",
              targetId: "",
            })
          : result.board
      );
      setIoNote({
        text: added
          ? `Restored ${count(result.actions, "action")}, ${count(result.threads, "thread")}, ${count(result.intentions, "intention")} and ${count(result.principles, "principle")}.`
          : "Nothing new in that file — everything in it was already here.",
        ok: true,
      });
    } catch (error) {
      setIoNote({
        text:
          error instanceof Error ? error.message : "Could not read that file.",
        ok: false,
      });
    }
  };

  const importBackup = async (file: File) => {
    setIoNote(null);
    try {
      const result = importIntentBackup(await readJsonFile(file), latest.current);
      // An import that added anything records itself in the ledger.
      await commit(
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
      );

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
    setDistillOpen(true);
  };

  const closeDistill = () => {
    setDistillOpen(false);
    setDistillInput("");
  };

  /** Start a fresh conversation, clearing the saved session. */
  const resetDistill = async () => {
    setSettled(null);
    setDistillErr("");
    setDistillInput("");
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

    const userTurn = { role: "user" as const, text, at: stamp() };
    const withUser: DistillSession = {
      id: base.id || uid(),
      at: base.at || stamp(),
      turns: [...base.turns, userTurn],
    };
    setDistillSession(withUser);
    setDistillInput("");
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
            if (marker.kind === "ready") setDistillReady(true);
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
      // The raw conversation the settlement came from — the ledger's `raw`.
      const transcript = distillSession.turns
        .map((t) => t.text)
        .filter(Boolean)
        .join(" ");
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
        await expandIntention(finalClean, {
          raw: transcript,
          source: "distill",
        });
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
        await commit(
          withLedger(
            { ...latest.current, actions: [...items, ...latest.current.actions] },
            {
              id: uid(),
              at,
              raw: transcript,
              clean: finalClean,
              kind: "action",
              source: "distill",
              targetId: items[0]?.id ?? "",
              modelVia: settled.via,
            }
          )
        );
        setNotice(
          `${count(items.length, "action")} distilled from the conversation.` +
            skipNote
        );
        setTimeout(() => setNotice(null), 5000);
        await resetDistill();
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
            raw: transcript,
            clean: finalClean,
            kind: "thread",
            source: "distill",
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
        await commit(next);
        setNotice("Distilled into a thread." + skipNote);
        setTimeout(() => setNotice(null), 5000);
        await regenerate(next, thread.id);
        await resetDistill();
        setTab("threads");
      }
    } catch (error) {
      setDistillErr(reasonOf(error) + " Nothing was saved.");
    }
    setDistillBusy(false);
    distillBusyRef.current = false;
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
    closeDistill();
  };

  /* --------------------------- derivations -------------------------- */

  /* All memoized: this hook re-renders on every keystroke in the capture
     box, and these must not recompute (or change identity — the grouped
     lens memoizes on `live`) unless the board itself moved. */
  const live = useMemo(
    () => data.actions.filter((a) => !a.done && !a.faded),
    [data.actions]
  );
  const fadedList = useMemo(
    () => data.actions.filter((a) => a.faded && !a.done),
    [data.actions]
  );
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
  /* The bounded personal model, derived fresh from the correction ledger:
     advisory sentences the sort engine weighs, capped, clearable. */
  const learnedRules: LearnedRule[] = useMemo(
    () => deriveRules(data.corrections ?? [], forgottenRules, now),
    [data.corrections, forgottenRules, now]
  );

  /** Forget a learned rule for good: it stops being injected into the sort
      prompt and stops appearing here. The corrections stay — history is
      never rewritten — the cleared key just filters them out. Remembered
      on this device only (v1); the settings screen says so. */
  const clearRule = async (key: string) => {
    if (forgottenRules.includes(key)) return;
    const next = [...forgottenRules, key];
    setForgottenRules(next);
    try {
      await set(FORGOTTEN_RULES_KEY, JSON.stringify(next));
    } catch {
      /* disk hiccup; next clear retries */
    }
    setNotice("That rule is forgotten — sorting won't follow it anymore.");
    setTimeout(() => setNotice(null), 4000);
  };

  return {
    data,
    loaded,
    corrupt,
    text,
    setText,
    pics,
    setPics,
    setTranscript,
    busy,
    err,
    landed,
    landedIds,
    summarising,
    suggestion,
    acceptSuggestion,
    dismissSuggestion,
    organize,
    organizeAiStatus,
    runOrganize,
    closeOrganize,
    wrap,
    showWrap,
    setShowWrap,
    dismissWrap,
    degraded,
    tangle,
    acceptTangle,
    dismissTangle,
    tidyHint,
    acceptOrganize,
    acceptOrganizeAll,
    dismissOrganize,
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
    stampRecordCopy,
    setShowSettings,
    ioNote,
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
    fadedList,
    active,
    resting,
    thread,
    intention,
    hits,
    searching,
    shareable,
    submit,
    resort,
    toggleAction,
    setShelf,
    restore,
    removeNow,
    moveToThread,
    editActionText,
    renameThread,
    setThreadCover,
    editFrag,
    addFragImages,
    deleteFrag,
    moveFrag,
    moveFragToNew,
    copyFragment,
    copyWhole,
    extractAction,
    takeNext,
    dismissNext,
    deleteThread,
    mergeThreads,
    expandIntention,
    saveDraft,
    discardDraft,
    refreshSummary,
    updateIntention,
    deleteIntention,
    makeIntention,
    logout,
    togglePrinciple,
    addPrinciple,
    deletePrinciple,
    distillOpen,
    distillSession,
    distillInput,
    setDistillInput,
    distillBusy,
    distillErr,
    distillReady,
    settled,
    openDistill,
    closeDistill,
    resetDistill,
    sendDistill,
    settleDistill,
    saveSettled,
    discardSettled,
    exitDistill,
    discardDistill,
    exportBoard,
    restoreFromFile,
    listSnapshots,
    restoreSnapshot,
    importBackup,
    doShare,
    sync,
    syncNow,
    canUndo,
    undo,
    misfiled,
    sortAgainAs,
    sortAgainIntoThread,
    dismissMisfiled: () => setMisfiled(null),
    learnedRules,
    clearRule,
  };
}
