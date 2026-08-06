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

import { useCallback, useEffect, useRef, useState } from "react";
import { stamp } from "@/lib/clock";
import { get, set } from "@/lib/storage";
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
  left,
  nextNumber,
  pad,
  sweep,
  uid,
} from "@/lib/model";
import { importIntentBackup } from "@/lib/importIntent";
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
import { copyToClipboard, shareText, shareableFor } from "@/lib/share";
import { search } from "@/lib/search";
import {
  bestActionDuplicate,
  bestFragmentDuplicate,
  bestThreadHome,
} from "@/lib/related";
import { parseCommandPrefix } from "@/lib/command";
import {
  TOMBSTONE_KEY,
  mergeSync,
  mergeTombstones,
  stampChanges,
  type SyncState,
  type Tombstone,
} from "@/lib/sync";
import type { SyncStore } from "@/lib/syncStore";
import type { Draft, IoNote } from "@/app/Intentions";
import {
  sourceOf,
  withCorrection,
  withLedger,
  type CorrectionEntry,
  type CaptureSource,
} from "@/lib/ledger";
import { deriveRules, type LearnedRule } from "@/lib/rules";
import {
  scanBoard,
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

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const reasonOf = (error: unknown) =>
  error instanceof SortError && error.message
    ? error.message
    : "The sort didn't go through.";

/** What /api/sort returns. Validated server-side against a schema. */
type SortResult = {
  clean: string;
  kind: "action" | "thread" | "intention" | "both";
  title: string;
  actions?: string[];
  shelfLife?: string;
  threadId?: string | null;
  threadName?: string | null;
  /* Which model tier sorted it — recorded in the capture ledger. */
  via?: string;
};

/* What a capture just landed as — the thing a suggestion would act on. */
type LandedSource = {
  kind: "action" | "thread";
  id: string;
  /* The landed fragment inside the thread (a thread that already existed);
     absent when the thread was just created, so the whole thread folds. */
  fragId?: string;
};

/**
 * A quiet post-capture proposal — never applied; the user confirms or
 * dismisses it. One tap either way.
 *
 * "home": the capture clearly belongs with an existing thread. Merge when
 *   a fresh thread folds in, Move when a fragment or a captured action
 *   moves over.
 * "duplicate": a captured action or note is the same task/note as an
 *   existing one. The copy that just landed is removed; the original
 *   stays. For a note, sourceFragId names the fragment to drop.
 */
type Suggestion =
  | {
      kind: "home";
      targetId: string;
      targetName: string;
      reason: string;
      sourceKind: "action" | "thread";
      sourceId: string;
      fragId?: string;
      verb: "Merge" | "Move";
    }
  | {
      kind: "duplicate";
      targetId: string;
      targetName: string;
      reason: string;
      sourceId: string;
      sourceKind: "action" | "thread";
      sourceFragId?: string;
    };

export function useBoard(now: number) {
  /* ------------------------------ state ------------------------------ */
  const [data, setData] = useState<Board>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [corrupt, setCorrupt] = useState(false);
  const [text, setText] = useState("");
  const [pics, setPics] = useState<{ id: string; src: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [landed, setLanded] = useState<string | null>(null);
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
  const [organizeAiStatus, setOrganizeAiStatus] = useState<
    "idle" | "thinking" | "done" | "offline"
  >("idle");
  /* The last AI results, kept so a board change re-merges them instead of
     dropping them from an open panel. Stale proposals are harmless — accept
     routes through the id-guarded handlers, which no-op when the item is
     gone. AI only re-runs on the button press, so this costs nothing. */
  const aiOrganize = useRef<OrganizeProposal[]>([]);

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
     landed, so "Undo" can put it back exactly. Only the capture flows
     (submit/resort) take the snapshot — summary refreshes and fades never
     do, so Undo always reverts something the user watched land, never a
     background change. */
  const captureSnapshot = useRef<{ board: Board; tombstones: Tombstone[] } | null>(
    null
  );
  const [canUndo, setCanUndo] = useState(false);

  /** Send our state to the hub and adopt its merged answer. */
  const pushNow = useCallback(async () => {
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
    } catch {
      /* hub unreachable — keep everything local, retry on the next change */
      setSync({ ok: false, at: stamp(), note: "Hub unreachable — kept locally" });
    }
    syncing.current = false;
  }, []);

  /** Coalesce bursts of edits into one push a beat after the last one. */
  const schedulePush = useCallback(() => {
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
    try {
      const res = await fetch("/api/sync");
      if (!res.ok) return false;
      const remote = (await res.json()) as SyncStore;
      const merged = mergeSync(
        { board: latest.current, tombstones: tombstones.current },
        { board: remote.board, tombstones: remote.tombstones }
      );
      const changed =
        JSON.stringify(merged.board) !== JSON.stringify(latest.current) ||
        merged.tombstones.length !== tombstones.current.length;
      if (changed) {
        latest.current = merged.board;
        setData(merged.board);
        tombstones.current = merged.tombstones;
        try {
          await set(KEY, JSON.stringify(merged.board));
          await set(TOMBSTONE_KEY, JSON.stringify(merged.tombstones));
        } catch {
          /* next commit retries */
        }
      }
      setSync({ ok: true, at: stamp() });
      // Our local additions ride up on the next debounced push.
      schedulePush();
      return changed;
    } catch {
      /* hub unreachable; local state stands */
      setSync({ ok: false, at: stamp(), note: "Hub unreachable — kept locally" });
      return false;
    }
  }, [schedulePush]);

  /** Manual "sync now": bring the other device's changes in, then push ours up. */
  const syncNow = useCallback(async () => {
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
   * to exactly how they were before it landed.
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
    const added = stampChanges(latest.current, snap.board, now).tombstones;
    const bump = <T extends { updatedAt?: number }>(x: T): T => ({
      ...x,
      updatedAt: now,
    });
    const had = (list: { id: string }[], id: string) =>
      list.some((x) => x.id === id);
    const board: Board = {
      actions: snap.board.actions.map((a) =>
        had(latest.current.actions, a.id) ? a : bump(a)
      ),
      threads: snap.board.threads.map((t) => {
        const live = latest.current.threads.find((x) => x.id === t.id);
        if (!live) return { ...bump(t), frags: t.frags.map(bump) };
        return {
          ...t,
          frags: t.frags.map((f) =>
            had(live.frags, f.id) ? f : bump(f)
          ),
        };
      }),
      intentions: snap.board.intentions.map((i) =>
        had(latest.current.intentions, i.id) ? i : bump(i)
      ),
      principles: snap.board.principles.map((p) =>
        had(latest.current.principles, p.id) ? p : bump(p)
      ),
      ledger: snap.board.ledger,
      corrections: snap.board.corrections,
    };
    const nextTombstones = mergeTombstones(snap.tombstones, added);

    latest.current = board;
    setData(board);
    tombstones.current = nextTombstones;
    try {
      await set(KEY, JSON.stringify(board));
      await set(TOMBSTONE_KEY, JSON.stringify(nextTombstones));
    } catch {
      /* disk hiccup; next commit retries */
    }
    setLanded(null);
    setSuggestion(null);
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
  }, [pushNow]);

  const commit = useCallback(
    async (next: Board) => {
      /* Every mutation funnels through here, so the sync bookkeeping lives in
         one place: diff what changed, stamp the changed items, tombstone the
         deletions, then push. */
      const stamped = stampChanges(latest.current, next);
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
    if (!loaded) return;
    void pullNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pullNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    /* A pull used to fire only on load and tab-focus, so a desktop tab left
       open and focused never saw the other device's changes. Poll gently so
       the phone's updates land within a few seconds without any interaction.
       Browsers throttle background tabs, which suits us — idle tabs poll less. */
    const poll = setInterval(() => void pullNow(), 10_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(poll);
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
    force?: "action" | "thread" | "intention"
  ) => {
    const known = latest.current.threads.map((t) => ({
      id: t.id,
      name: t.name,
      about: t.summary?.slice(0, 160) || "",
    }));
    // A bounded slice of filing history, so the engine files the way this
    // person files and routes into the thread they'd choose. Kept small on
    // purpose — every capture pays for this context, so it stays recent and
    // compact rather than the whole 500-entry ledger.
    const threadName = (id: string) =>
      latest.current.threads.find((t) => t.id === id)?.name || "";
    const recent = (latest.current.ledger ?? []).slice(0, 30).map((e) => ({
      raw: e.raw.length > 120 ? e.raw.slice(0, 120) : e.raw,
      kind: e.kind,
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
      body: JSON.stringify({ raw, threads: known, recent, force, rules }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new SortError(body.error);
    }
    return res.json();
  };

  /** Fold a sorted result into a board. Shared by first capture and re-sort. */
  const applySorted = (
    out: SortResult,
    imgIds: string[],
    at: number,
    board: Board
  ): {
    next: Board;
    targetId: string | null;
    landed: string;
    source: LandedSource | null;
  } => {
    if (out.kind === "action") {
      const span = SHELF[out.shelfLife as ShelfLife] ?? null;
      const items: Action[] = (out.actions?.length ? out.actions : [out.title]).map(
        (t: string) => ({
          id: uid(),
          text: t,
          done: false,
          at,
          src: out.clean,
          imgs: imgIds,
          shelf: (out.shelfLife || "keep") as ShelfLife,
          expires: span ? stamp() + span : null,
        })
      );
      return {
        next: { ...board, actions: [...items, ...board.actions] },
        targetId: null,
        /* A single action can fold into a thread; several cannot, so only a
           lone action is ever offered a home. */
        source: items.length === 1 ? { kind: "action", id: items[0].id } : null,
        landed:
          items.length +
          " action" +
          (items.length > 1 ? "s" : "") +
          (span ? " · fades in " + left(span) : " · kept"),
      };
    }

    // "both": the capture holds a task to close AND thinking to keep. The
    // thinking goes to a thread (its durable home, so images ride with the
    // fragment) and the task(s) become actions with no images of their own —
    // deleting a closed action must never drop an image the thread still uses.
    if (out.kind === "both") {
      const span = SHELF[out.shelfLife as ShelfLife] ?? null;
      const items: Action[] = (out.actions ?? []).map((t) => ({
        id: uid(),
        text: t,
        done: false,
        at,
        src: out.clean,
        imgs: [],
        shelf: (out.shelfLife || "keep") as ShelfLife,
        expires: span ? stamp() + span : null,
      }));
      const bothFrag: Frag = { id: uid(), at, text: out.clean, imgs: imgIds };
      const home = board.threads.find((x) => x.id === out.threadId);
      const threads = home
        ? board.threads.map((x) =>
            x.id === home.id ? { ...x, frags: [...x.frags, bothFrag] } : x
          )
        : [
            {
              id: uid(),
              name: out.threadName || out.title,
              summary: "",
              frags: [bothFrag],
            } as Thread,
            ...board.threads,
          ];
      const homeId = home ? home.id : threads[0].id;
      const homeName = home ? home.name : threads[0].name;
      return {
        next: { ...board, actions: [...items, ...board.actions], threads },
        targetId: homeId,
        source: { kind: "thread", id: homeId, fragId: bothFrag.id },
        landed:
          count(items.length, "action") + " + thread — " + homeName,
      };
    }

    const frag: Frag = { id: uid(), at, text: out.clean, imgs: imgIds };
    const existing = board.threads.find((x) => x.id === out.threadId);
    if (existing) {
      return {
        next: {
          ...board,
          threads: board.threads.map((x) =>
            x.id === existing.id ? { ...x, frags: [...x.frags, frag] } : x
          ),
        },
        targetId: existing.id,
        source: { kind: "thread", id: existing.id, fragId: frag.id },
        landed: existing.name + " — thread updated",
      };
    }
    const fresh: Thread = {
      id: uid(),
      name: out.threadName || out.title,
      summary: "",
      frags: [frag],
    };
    return {
      next: { ...board, threads: [fresh, ...board.threads] },
      targetId: fresh.id,
      source: { kind: "thread", id: fresh.id, fragId: frag.id },
      landed: fresh.name + " — thread updated",
    };
  };

  /** Ask the server to rewrite a thread's summary. Throws SortError. */
  const requestSummary = async (name: string, frags: Frag[]) => {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        frags: frags.map((f) => ({ at: f.at, text: f.text })),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new SortError(body.error);
    }
    return res.json();
  };

  /** Rewrite a thread's "Where this stands" from its current fragments. */
  const regenerate = async (board: Board, threadId: string): Promise<Board> => {
    const target = board.threads.find((t) => t.id === threadId);
    if (!target?.frags.length) return board;
    setBusy("Updating what this thread says now");
    let result = board;
    try {
      const { summary } = await requestSummary(target.name, target.frags);
      result = {
        ...board,
        threads: board.threads.map((t) =>
          t.id === threadId ? { ...t, summary } : t
        ),
      };
      await commit(result);
    } catch {
      /* the fragments are saved; the summary can lag */
    }
    setBusy(null);
    return result;
  };

  /**
   * Manual re-run from the thread view. Unlike the automatic path, a failure
   * is shown rather than swallowed, so a stale summary is never silent.
   */
  const refreshSummary = async (threadId: string) => {
    const target = latest.current.threads.find((t) => t.id === threadId);
    if (!target?.frags.length) return;
    setErr("");
    setBusy("Updating what this thread says now");
    try {
      const { summary } = await requestSummary(target.name, target.frags);
      await commit(
        noteCorrection(
          {
            ...latest.current,
            threads: latest.current.threads.map((t) =>
              t.id === threadId ? { ...t, summary } : t
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
    } else if (tab === "threads") {
      const fresh: Thread = {
        id: uid(),
        name: body.split(/\s+/).slice(0, 5).join(" "),
        summary: "",
        frags: [frag],
      };
      next = { ...b, threads: [fresh, ...b.threads] };
      targetId = fresh.id;
      targetFragId = frag.id;
      setLanded(fresh.name + " — new thread, unsorted");
    } else {
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
      setLanded("Kept unsorted");
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
    // The fallback still lands something — Undo can take it back.
    captureSnapshot.current = {
      board: latest.current,
      tombstones: tombstones.current,
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
      const out = await requestSort(a.src || a.text);
      const board = {
        ...latest.current,
        actions: latest.current.actions.filter((x) => x.id !== a.id),
      };
      const { next, targetId, landed, source } = applySorted(
        out,
        a.imgs || [],
        a.at,
        board
      );
      setLanded(landed);
      setTab(out.kind === "action" ? "actions" : "threads");
      // Snapshot right before the re-sort lands — Undo reverts exactly this.
      captureSnapshot.current = {
        board: latest.current,
        tombstones: tombstones.current,
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
      setSuggestion(null);
    }, 9000);
  };

  /** Praise be. The main capture, sorted and filed.
      `dictated` says the words came from the microphone — the ledger records
      that so a later export can tell speech from typing. */
  const submit = async (dictated = false) => {
    const raw = text.trim();
    /* A leading command pins the destination: the command word is
       stripped and the rest goes through the sorter with the destination
       already decided. Works typed (/action …) or spoken ("slash action …"
       or "action. …") — the parser accepts all the forms dictation and
       keyboards actually produce. */
    const { force, payload } = parseCommandPrefix(raw);
    if (!payload && !pics.length) return;
    setErr("");
    setSwept(null);
    // A new capture takes over the banner: no stale proposal survives.
    setSuggestion(null);
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
        await expandIntention(payload, {
          raw: payload,
          source: sourceOf(payload, dictated, imgIds.length > 0),
        });
        setTimeout(() => setLanded(null), 4500);
        return;
      }

      const out = await requestSort(payload || "(image only)", force);

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

      const { next, targetId, landed, source } = applySorted(
        out,
        imgIds,
        at,
        latest.current
      );
      // The capture records itself in the ledger before it lands: what was
      // said, what it became, where it went, and which model tier sorted it.
      const filed = withLedger(next, {
        id: uid(),
        at,
        raw,
        clean: out.clean || payload,
        kind: out.kind,
        source: sourceOf(payload, dictated, imgIds.length > 0),
        targetId:
          out.kind === "action"
            ? source?.id ?? next.actions[0]?.id ?? ""
            : (source?.id ?? targetId ?? ""),
        targetFragId: source?.fragId,
        modelVia: out.via,
        imgs: imgIds.length ? imgIds : undefined,
      });
      setLanded(landed);
      setTab(out.kind === "action" ? "actions" : "threads");
      setText("");
      setPics([]);
      // Snapshot right before it lands — edits made while the sort ran
      // survive; only the capture itself is reverted by Undo.
      captureSnapshot.current = {
        board: latest.current,
        tombstones: tombstones.current,
      };
      setCanUndo(true);
      await commit(filed);
      /* A quiet proposal, never applied: if this capture clearly belongs
         with an existing thread, offer the fold. An explicit /action,
         /thread or /intention command is respected — only the model's
         choice is ever second-guessed. Computed before the summary refresh
         so it lands with the banner, never a model round-trip later. */
      setSuggestion(
        force ? null : computeSuggestion(filed, out.clean, source)
      );
      if (targetId) await regenerate(filed, targetId);
    } catch (error) {
      await saveUnsorted(raw, imgIds, at, reasonOf(error), dictated);
    }

    setBusy(null);
    /* Same widened window as the main capture — Undo lives here too. */
    setTimeout(() => {
      setLanded(null);
      setSuggestion(null);
    }, 9000);
  };

  /* ----------------------- capture suggestion ----------------------- */

  /**
   * Whether a just-landed capture is worth proposing something about.
   *
   * Two claims, both deliberately strict — only a shared phrase (never a
   * lone shared word, however rare) earns a proposal:
   *   - a captured action that duplicates an existing action — the same
   *     task twice — the strongest, most actionable claim, checked first;
   *   - a capture that clearly belongs with an existing thread, in which
   *     case the thread it landed in is never offered as its own home.
   * The user's explicit destination (a /action, /thread or /intention
   * command) is respected: only the model's choice is ever second-guessed.
   */
  const computeSuggestion = (
    board: Board,
    text: string,
    source: LandedSource | null
  ): Suggestion | null => {
    if (!source || !text.trim()) return null;
    if (source.kind === "action") {
      /* The engine is handed the source id so the capture's own text — which
         it always phrase-matches, and which sits at the front of the list —
         is never reported as its own duplicate. The counterpart must also be
         live: re-capturing a task that is already fading away is a refresh,
         not a duplicate. */
      const dup = bestActionDuplicate(board, text, source.id);
      const dupLive =
        dup && !board.actions.find((a) => a.id === dup.id)?.faded;
      if (dup && dupLive) {
        return {
          kind: "duplicate",
          targetId: dup.id,
          targetName: dup.name,
          reason: dup.reason,
          sourceId: source.id,
          sourceKind: "action",
        };
      }
    }
    /* A capture that landed as a note can still duplicate a note already on
       the board — the same thing pasted twice lands as two fragments. The
       fragment duplicate beats the thread home: if it is the same note
       again, offer to drop the copy instead of merging it in silently. The
       engine excludes the just-landed fragment itself, which always
       phrase-matches its own text. */
    if (source.kind === "thread") {
      const fragDup = bestFragmentDuplicate(board, text, source.fragId);
      if (fragDup) {
        const crossThread = source.fragId && fragDup.threadId !== source.id;
        return {
          kind: "duplicate",
          targetId: fragDup.threadId,
          targetName:
            fragDup.name +
            (crossThread ? ` (in "${fragDup.threadName}")` : ""),
          reason: fragDup.reason,
          sourceKind: "thread",
          sourceId: source.id,
          sourceFragId: source.fragId,
        };
      }
    }
    const hit = bestThreadHome(board, text, source.id);
    if (!hit) return null;
    if (source.kind === "action") {
      return {
        kind: "home",
        targetId: hit.id,
        targetName: hit.name,
        reason: hit.reason,
        sourceKind: "action",
        sourceId: source.id,
        verb: "Move",
      };
    }
    return source.fragId
      ? {
          kind: "home",
          targetId: hit.id,
          targetName: hit.name,
          reason: hit.reason,
          sourceKind: "thread",
          sourceId: source.id,
          fragId: source.fragId,
          verb: "Move",
        }
      : {
          kind: "home",
          targetId: hit.id,
          targetName: hit.name,
          reason: hit.reason,
          sourceKind: "thread",
          sourceId: source.id,
          verb: "Merge",
        };
  };

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
  const runOrganize = async () => {
    /* The local scan is shown immediately; the AI results merge in when
       they arrive. Both are read from the LATEST board at their moment, so
       a board change mid-fetch is never overwritten by a stale snapshot. */
    setOrganize(scanBoard(latest.current, dismissedOrganize.current));
    setOrganizeAiStatus("thinking");
    try {
      const res = await fetch("/api/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compactBoard(latest.current)),
      });
      if (!res.ok) {
        setOrganizeAiStatus("offline");
        return;
      }
      const out = (await res.json()) as {
        proposals?: RawAiProposal[];
      };
      const ai = mapAiProposals(
        compactBoard(latest.current),
        out.proposals ?? []
      );
      aiOrganize.current = ai;
      setOrganize(
        mergeOrganize(
          ai,
          scanBoard(latest.current, dismissedOrganize.current)
        )
      );
      setOrganizeAiStatus("done");
    } catch {
      /* The model is a bonus layer; its absence never breaks the scan. */
      setOrganizeAiStatus("offline");
    }
  };

  /* Keep the badge live: re-scan whenever the board changes, so a capture
     that duplicates something lights the count without being asked. The
     local scan is instant — no model call per keystroke — and a dismissed
     pair stays filtered out of both passes. The last AI results ride along
     (minus the dismissed ones), so an open panel keeps its semantic rows
     across a background change (a sync pull, a sweep) instead of losing
     them. */
  useEffect(() => {
    if (!loaded) return;
    const dropped = new Set(dismissedOrganize.current);
    setOrganize(
      mergeOrganize(
        aiOrganize.current.filter((p) => !dropped.has(p.id)),
        scanBoard(latest.current, dismissedOrganize.current)
      )
    );
  }, [loaded, data]);

  /**
   * Apply one Organize proposal. Each kind routes through the same handlers
   * the capture suggestions use, so the outcome and its ledger record are
   * consistent with the rest of the app — then the panel re-scans so a
   * resolved pair never lingers.
   */
  const acceptOrganize = async (id: string) => {
    const p = organize?.find((x) => x.id === id);
    if (!p) return;
    /* The applied change must not ride back in from the cached AI results
       on the next re-scan — a resolved proposal is resolved. */
    aiOrganize.current = aiOrganize.current.filter((x) => x.id !== id);
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
    } else if (p.kind === "extract_action") {
      /* extractAction records its own correction and notice. Extraction leaves
         the note in place, so a success also remembers the proposal by id —
         otherwise the same card would re-propose on every scan. A failure
         keeps the card, so the user can retry. */
      const ok = await extractAction(p.sourceThreadId!, p.sourceFragId!);
      if (ok) {
        dismissedOrganize.current = [...dismissedOrganize.current, p.id];
        void set(ORGANIZE_DISMISSED_KEY, JSON.stringify(dismissedOrganize.current));
      }
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
    }
    /* The board changed — the [loaded, data] effect re-scans, and the
       resolved pair is gone from the panel on the next render. */
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
    await commit({
      ...latest.current,
      actions: latest.current.actions.filter((x) => x.id !== id),
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
    await commit({
      ...latest.current,
      actions: latest.current.actions.filter((x) => x.id !== actionId),
      threads: latest.current.threads.map((x) =>
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
    });
    setNotice(`Moved into ${t.name}.`);
    setTimeout(() => setNotice(null), 4500);
    await regenerate(latest.current, threadId);
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

    const next = { ...latest.current, threads };
    await commit(next);
    setNotice(
      emptied
        ? `Moved to ${to.name}. ${from.name} was left empty and removed.`
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
  const extractAction = async (threadId: string, fragId: string) => {
    const frag = latest.current.threads
      .find((t) => t.id === threadId)
      ?.frags.find((f) => f.id === fragId);
    if (!frag) return;

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
    if (pendingSource) {
      const src = latest.current.actions.find((a) => a.id === pendingSource);
      if (src) await dropImages(src.imgs);
      next = {
        ...next,
        actions: latest.current.actions.filter((a) => a.id !== pendingSource),
      };
    }
    // A capture that became this intention records itself in the ledger:
    // what was said (raw) and what it became (the reviewed wording).
    if (intentionLedger.current) {
      next = withLedger(next, {
        id: uid(),
        at,
        raw: intentionLedger.current.raw,
        clean: draft.expandedIntention,
        kind: "intention",
        source: intentionLedger.current.source,
        targetId: intention.id,
        modelVia: intentionLedger.current.via,
      });
      intentionLedger.current = null;
    }
    await commit(next);
    setDraft(null);
    setPendingSource(null);
    setTab("intentions");
    setNotice("Intention " + pad(intention.number) + " set.");
    setTimeout(() => setNotice(null), 4500);
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
  const shareable = shareableFor(
    data,
    openIntention
      ? { kind: "intention", id: openIntention }
      : open
        ? { kind: "thread", id: open }
        : { kind: "tab", tab },
    now
  );

  const doShare = async () => {
    if (!shareable) return;
    const outcome = await shareText(shareable);
    if (outcome === "cancelled") return;
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

  const exportBoard = () => {
    try {
      downloadJSON(buildBackup(latest.current), backupFilename());
      setIoNote({
        text: `Saved ${count(latest.current.actions.length, "action")}, ${count(latest.current.threads.length, "thread")} and ${count(latest.current.intentions.length, "intention")} to a file. Keep it somewhere that isn't this phone.`,
        ok: true,
      });
    } catch {
      setIoNote({ text: "The download didn't start.", ok: false });
    }
  };

  const restoreFromFile = async (file: File) => {
    setIoNote(null);
    try {
      const result = restoreBackup(await readJsonFile(file), latest.current);
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
        const items: Action[] = realActions.map((t) => ({
          id: uid(),
          text: t,
          done: false,
          at,
          src: finalClean,
          imgs: [],
          shelf: (shelfLife || "keep") as ShelfLife,
          expires: span ? stamp() + span : null,
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
        const thread: Thread = {
          id: uid(),
          name: title || finalClean.split(/\s+/).slice(0, 5).join(" "),
          summary: "",
          frags: [{ id: uid(), at: stamp(), text: finalClean }],
        };
        const next = withLedger(
          {
            ...latest.current,
            threads: [thread, ...latest.current.threads],
          },
          {
            id: uid(),
            at: stamp(),
            raw: transcript,
            clean: finalClean,
            kind: "thread",
            source: "distill",
            targetId: thread.id,
            targetFragId: thread.frags[0]?.id,
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

  const live = data.actions.filter((a) => !a.done && !a.faded);
  const fadedList = data.actions.filter((a) => a.faded && !a.done);
  const active = data.threads.filter(
    (t) => now - (t.frags.at(-1)?.at || 0) < DORMANT
  );
  const resting = data.threads.filter(
    (t) => now - (t.frags.at(-1)?.at || 0) >= DORMANT
  );
  const thread = data.threads.find((t) => t.id === open);
  const intention = data.intentions.find((i) => i.id === openIntention);
  const hits = search(data, debouncedQuery);
  const searching = debouncedQuery.trim().length > 0;
  /* The bounded personal model, derived fresh from the correction ledger:
     advisory sentences the sort engine weighs, capped, clearable. */
  const learnedRules: LearnedRule[] = deriveRules(
    data.corrections ?? [],
    forgottenRules,
    now
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
    busy,
    err,
    landed,
    suggestion,
    acceptSuggestion,
    dismissSuggestion,
    organize,
    organizeAiStatus,
    runOrganize,
    acceptOrganize,
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
    editFrag,
    deleteFrag,
    moveFrag,
    moveFragToNew,
    copyFragment,
    copyWhole,
    extractAction,
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
    importBackup,
    doShare,
    sync,
    syncNow,
    canUndo,
    undo,
    learnedRules,
    clearRule,
  };
}
