"use client";

/* ============================================================
   CAPTURE — one capture surface, three destinations, self-clearing.
   Everything you say goes in one place. The system decides whether
   it's something to close (Action), something that thickens over
   time (Thread), or something you are declaring about your life
   (Intention), cleans up the transcription, keeps each Thread's
   "where this stands" block current, and quietly sweeps away what
   has gone stale. Threads are never deleted. Only actions fade.

   This file is deliberately the shell. All board state, persistence
   and operations live in useBoard(); the components below just
   render what it hands back.
   ============================================================ */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BrushCleaning, Image as ImageIcon, Layers, MessagesSquare, Mic, RefreshCw, Settings, Share2 } from "lucide-react";
import { Markup } from "./Markup";
import { BusyLine, Row, TCard } from "@/components/cards";
import { SearchResults } from "@/components/SearchResults";
import { ThreadView } from "@/components/ThreadView";
import { degradedNote } from "@/lib/degraded";
import { TangleCallout, TangleReview } from "./Tangle";

import { DistillView } from "./Distill";
import {
  clockServerSnapshot,
  clockSnapshot,
  subscribeToClock,
} from "@/lib/clock";
import { useRecordedDictation } from "@/hooks/useRecordedDictation";
import { get, set } from "@/lib/storage";
import { shrinkFile } from "@/lib/shrink";
import {
  type Action,
  fmt,
  uid,
} from "@/lib/model";
import {
  IntentionCard,
  IntentionDetail,
  IntentionDraft,
  RecordScreen,
  SettingsScreen,
} from "./Intentions";
import { OrganizeScreen } from "./Organize";
import {
  shareAction,
  shareIntention,
  shareRecord,
  shareThread,
} from "@/lib/share";
import { actionsForThread } from "@/lib/threadActions";
import { useBoard } from "@/hooks/useBoard";
import { ReportBug } from "@/components/ReportBug";
import { PlaygroundNotice } from "@/components/PlaygroundNotice";
import { PLAYGROUND } from "@/lib/playground";
import { groupActions } from "@/lib/group";
import { mapAiGroups, type RawAiGroup } from "@/lib/groupAi";

/** Where the grouped-view toggle is remembered, in the same kv store as the
    board — a view preference that survives reloads on this device. */
const GROUP_VIEW_KEY = "capture:groupView:v1";

/**
 * The sentence offered on each empty tab.
 *
 * Deliberately messy — that it does not need tidying first is half the
 * point — and deliberately a builder's sentence, because that is who this
 * is for. Each one is PINNED: it was run through the live sorter until it
 * produced the same kind every time, and the two lines under it claim only
 * that shape — never the wording, never the thread's name, both of which
 * vary. Change a sentence and its claim has to be re-earned.
 *
 *   actions    8/8 → one action and one thread (it holds both kinds, which
 *              is also the distinction the whole app rests on)
 *   threads    6/6 → thread
 *   intentions 6/6 → intention
 */
const TRY = {
  actions:
    "uh fix the signup bug before friday and i keep going back and forth on usage based pricing vs seats",
  threads:
    "been thinking the onboarding is too long, people drop at the third screen but i don't know what to cut",
  intentions:
    "from now on i ship the rough version first and fix it in public",
} as const;

/** How long a ticked action shows itself done before it leaves. Long enough
    to read as a finish, short enough that nobody waits on it. */

export function Capture() {
  /* The ticking clock the countdowns and shelf lives derive from. */
  const now = useSyncExternalStore(
    subscribeToClock,
    clockSnapshot,
    clockServerSnapshot
  );

  /* Input device plumbing: the hidden file picker, and the speech recogniser
     (shared with Distill — the mic routes to whichever surface is open). */
  const fileRef = useRef<HTMLInputElement>(null);
  /* The Organize screen is presentational; the proposals themselves live in
     useBoard. It opens as a full screen of its own (like Settings), and the
     wand button only appears when the scan has found something worth
     reviewing — a clean board keeps the header to sync / share / settings. */
  const [showOrganize, setShowOrganize] = useState(false);
  /* The undo question, second step: which thread it should have gone to. */
  const [pickingThread, setPickingThread] = useState(false);
  /* The record opens from the masthead count — the line that is always on
     screen becomes the door to what it summarises. */


  /* Grouped view of the Actions tab — a lens, not a structure: nothing is
     written to the board, and toggling off restores the flat list untouched.
     Remembered across visits; read in an effect so hydration stays clean. */
  const [showTangle, setShowTangle] = useState(false);
  const [groupView, setGroupView] = useState(false);
  useEffect(() => {
    void get(GROUP_VIEW_KEY).then((v) => {
      if (v === "1") setGroupView(true);
    });
  }, []);
  const toggleGroupView = () =>
    setGroupView((v) => {
      void set(GROUP_VIEW_KEY, v ? "0" : "1");
      return !v;
    });

  /* Everything else — the board, every operation on it, and the derived
     views — comes from useBoard. This destructure is the whole logic
     surface of the screen. */
  const {
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
    setOpen,
    openFrag,
    setOpenFrag,
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
    resolveFrag,
    unresolveFrag,
    copyFragment,
    copyWhole,
    extractAction,
    takeNext,
    dismissNext,
    deleteThread,
    mergeThreads,
    saveDraft,
    discardDraft,
    draftToThread,
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
    misfiled,
    sortAgainAs,
    sortAgainIntoThread,
    dismissMisfiled,
    undo,
    learnedRules,
    toggleLearnedRule,
  } = useBoard(now);

  /* The rollback days, read when Settings opens — a list this short is
     cheaper to re-read than to keep in sync with every write. */
  const [snapDays, setSnapDays] = useState<string[]>([]);
  useEffect(() => {
    if (!showSettings) return;
    void listSnapshots().then(setSnapDays);
  }, [showSettings, listSnapshots]);


  /* Strong claims light the badge; the button itself only exists when the
     scan found anything at all. Medium ones sit behind "Show more" inside
     the screen, so the header stays quiet on a clean board. */
  const highOrganize = (organize ?? []).filter((p) => p.confidence === "high");
  /* Before Tidy has been opened there is no reading to count, so the badge
     falls back to what the free local scan already knows. */
  const tidyCount = organize ? highOrganize.length : tidyHint;

  /* The grouped lens over live actions — plain-text matching, no model call,
     recomputed only when the list itself changes. This is what shows the
     instant the toggle flips, and what stays if the model never answers. */
  const localGrouped = useMemo(
    () => (groupView ? groupActions(live) : null),
    [groupView, live]
  );

  /* The model's reading of the same list, once it arrives.
     Keyed by the exact set of actions it was asked about, so a board that
     changes underneath can never show groups drawn over rows that moved. */
  const [aiGroups, setAiGroups] = useState<{
    key: string;
    groups: RawAiGroup[];
  } | null>(null);
  const groupAsked = useRef<string>("");
  const liveKey = useMemo(() => live.map((a) => a.id).join(","), [live]);
  /* The effect below keys on the SET of actions, not the array identity:
     every commit rebuilds the array, and cancelling the request on each
     one threw the groups away whenever a background write landed. */
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    if (!groupView) return;
    /* Word grouping already answers a short list, and a model call on two
       rows is waste. */
    if (liveRef.current.length < 3) return;
    if (groupAsked.current === liveKey) return;
    groupAsked.current = liveKey;
    let cancelled = false;
    (async () => {
      /* Marked as asked before the call so two renders cannot both fire it,
         and un-marked if it fails: a rate-limited model call used to burn
         the key for that exact set of actions, and since the key only moves
         when the actions do, grouping stayed dead until something was
         captured or closed. Toggling the lens off and on could not revive
         it. */
      let ok = false;
      try {
        const res = await fetch("/api/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: liveRef.current.map((a) => ({ id: a.id, text: a.text })),
          }),
        });
        if (!res.ok) return;
        const out = (await res.json()) as { groups?: RawAiGroup[] };
        ok = true;
        if (cancelled) return;
        setAiGroups({ key: liveKey, groups: out.groups ?? [] });
      } catch {
        /* The lens is a bonus layer: word grouping is already on screen. */
      } finally {
        if (!ok && groupAsked.current === liveKey) groupAsked.current = "";
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupView, liveKey]);

  /* The model's groups when they belong to this exact list and it found
     something; the word lens otherwise. Never a blend of the two — a pile
     assembled by meaning and a pile assembled by spelling would sit under
     the same heading style and mean different things. */
  const grouped = useMemo(() => {
    if (!groupView) return null;
    if (aiGroups && aiGroups.key === liveKey && aiGroups.groups.length)
      return mapAiGroups(live, aiGroups.groups);
    return localGrouped;
  }, [groupView, aiGroups, liveKey, live, localGrouped]);

  /* Input device plumbing: the hidden file picker, and the recorded-dictation
     mic (shared with Distill — the mic routes to whichever surface is open).
     Read through the ref by useRecordedDictation, so the destination is always
     the one that is current when a result lands. The ref remembers that the
     words in the box came from the microphone, so the capture can be
     recorded as dictated in the ledger. */
  const dictatedRef = useRef(false);
  const { canDictate, listening, transcribing, toggleMic } =
    useRecordedDictation((t, raw) => {
    if (distillOpen) {
      setDistillInput((x) => (x ? x + " " : "") + t.trim());
    } else {
      dictatedRef.current = true;
      /* Keep what the recogniser actually heard, so the capture that lands
         carries its own evidence and the cleanup pass is never the only
         record of what was said. */
      if (raw) setTranscript((x) => (x ? x + " " : "") + raw.trim());
      setText((x) => (x ? x + " " : "") + t.trim());
    }
  });

  /* Every picked photo is shrunk before it reaches the box — a phone photo
     comes in at ~15MB as a data URL, and shrinking it at capture time is what
     keeps IndexedDB (and backups, which now carry images) light. An unreadable
     file is skipped rather than shown broken. */
  const addFiles = (files: FileList | null) => {
    [...(files || [])].slice(0, 4).forEach((f) => {
      void shrinkFile(f)
        .then((src) => setPics((p) => [...p, { id: uid(), src }]))
        .catch(() => {
          /* unreadable image — drop it silently */
        });
    });
  };

  const row = (a: Action, faded?: boolean) => (
    <Row
      key={a.id}
      a={a}
      faded={faded}
      landed={landedIds.includes(a.id)}
      now={now}
      shelfOpen={shelfFor === a.id}
      onToggle={() => toggleAction(a.id)}
      onShelfClick={() => setShelfFor(shelfFor === a.id ? null : a.id)}
      onSetShelf={(span, label) => {
        setShelf(a.id, span, label);
        setShelfFor(null);
      }}
      onRestore={() => restore(a.id)}
      onRemove={() => removeNow(a)}
      onMakeThread={() => moveToThread(a)}
      onEditText={(t) => editActionText(a.id, t)}
      onResort={() => resort(a)}
      onMakeIntention={() =>
        makeIntention(a.src || a.text, a.id)
      }
      onCopy={() => copyWhole(shareAction(a))}
      onOpenShot={
        a.shot &&
        data.threads
          .find((t) => t.id === a.shot!.threadId)
          ?.frags.some((f) => f.id === a.shot!.fragId)
          ? () => {
              setTab("threads");
              setOpen(a.shot!.threadId);
              setOpenFrag(a.shot!.fragId);
            }
          : undefined
      }
      busy={!!busy}
    />
  );

  return (
    <div className="capture-root">
      <div className="capture-wrap">
        {PLAYGROUND && <PlaygroundNotice />}
      {/* Only once the board has loaded: the first-sight check must see
          the real capture count, not the empty board of a loading one. */}
        <div className="capture-head">
          <button
            className="capture-mark"
            onClick={() => setShowRecord(true)}
            title="The record — everything said, and what became of it"
          >
            capture<span>.</span>
          </button>
          <div className="capture-head-right">
            <button
              className="capture-count"
              onClick={() => setShowRecord(true)}
              title="The record — everything said, and what became of it"
            >
              {live.length} open · {data.threads.length} threads
              {/* The single mark anywhere on the board that yesterday has
                  been read. No line, no card, no banner: the record is
                  where days live, and this says one is waiting. */}
              {wrap && !wrap.seen && <span className="wrap-dot" />}
            </button>
            {/* Which model is doing the work — shown only while it is not
                the usual one. There is nothing a person can do about a rate
                limit, so this asks for nothing and blocks nothing. It exists
                because the alternative was weeks of the app quietly getting
                worse with no way to know why. It names the consequence, not
                the plumbing. */}
            {degraded && (
              <span className="model-note" title={degradedNote(degraded)}>
                backup model · sorting will be rougher
              </span>
            )}
            {!PLAYGROUND && (
              <button
                className={
                  "icon-btn sync-btn" +
                  (sync ? (sync.ok ? " synced" : " sync-bad") : "")
                }
                onClick={() => void syncNow()}
                aria-label="Sync now"
                title={
                  sync
                    ? sync.ok
                      ? "Synced " + fmt(sync.at) + " — tap to sync now"
                      : (sync.note || "Hub unreachable") + " — tap to retry"
                    : "Sync this device with the hub"
                }
              >
                <RefreshCw
                  key={sync?.ok ? sync.at : 0}
                  size={18}
                  strokeWidth={1.7}
                />
              </button>
            )}
            {!showSettings && !draft && (
              <button
                className="icon-btn"
                onClick={doShare}
                /* On the record the button stays live even with nothing
                   new: tapping it is how you find out. */
                disabled={!shareable && !showRecord}
                aria-label={
                  shareable ? "Share " + shareable.title : "Nothing to share"
                }
                title={shareable ? "Share " + shareable.title : "Nothing to share"}
              >
                <Share2 size={18} strokeWidth={1.7} />
              </button>
            )}
            {/* Always visible — the tidy button is a tool, not a
                notification. It runs a fresh scan on every tap (the AI
                pass spends real quota, so it only ever runs when asked),
                and the badge shows the strong claims from the last scan
                until you scan again — it never flickers in and out as the
                board changes underneath you. */}
            <button
              className="icon-btn organize-btn"
              onClick={() => {
                /* A Distill session owns the whole surface — close it so the
                   review screen is the only thing on screen. */
                if (distillOpen) closeDistill();
                void runOrganize();
                setShowOrganize(true);
              }}
              aria-label={
                tidyCount > 0
                  ? `Tidy — ${tidyCount} ${tidyCount === 1 ? "suggestion" : "suggestions"} to review`
                  : "Tidy — scan the board for things worth changing"
              }
              title={
                (organize ?? []).length > 0
                  ? highOrganize.length > 0
                    ? `Tidy — ${highOrganize.length} ${highOrganize.length === 1 ? "strong suggestion" : "strong suggestions"} to review`
                    : `Tidy — ${organize!.length} ${organize!.length === 1 ? "suggestion" : "suggestions"} to review`
                  : "Scan the board for things to tidy"
              }
            >
              <BrushCleaning size={18} strokeWidth={1.7} />
              {tidyCount > 0 && (
                <span className="organize-badge">{tidyCount}</span>
              )}
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                setShowSettings(true);
                setIoNote(null);
              }}
              aria-label="Settings and backup"
              title="Settings and backup"
            >
              <Settings size={18} strokeWidth={1.7} />
            </button>
          </div>
        </div>

        {distillOpen && (
          <DistillView
            session={distillSession}
            input={distillInput}
            onInput={setDistillInput}
            busy={distillBusy}
            err={distillErr}
            canDictate={canDictate}
            listening={listening}
            onToggleMic={toggleMic}
            onSend={() => sendDistill()}
            onSendText={(t) => sendDistill(t)}
            onSettle={settleDistill}
            onBack={closeDistill}
            ready={distillReady}
            settled={settled}
            onSave={(clean, actions, shelfLife) =>
              saveSettled(clean, actions, shelfLife)
            }
            onDiscard={discardSettled}
            onExit={exitDistill}
            onDiscardConversation={discardDistill}
          />
        )}

        {!distillOpen && (
        <div className="cap">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            /* Short on purpose. This used to carry the aiming instructions too,
               which overflowed the box and cut off mid-word — the guidance now
               lives in the empty state, where there is room for it and where
               someone with an empty board is actually looking. */
            placeholder="Say it however it comes out."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                submit(dictatedRef.current);
                dictatedRef.current = false;
              }
            }}
          />
          {!!pics.length && (
            <div className="thumbs">
              {pics.map((p) => (
                <div className="thumb" key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt="" />
                  <button className="edit" onClick={() => setEditing(p)}>
                    edit
                  </button>
                  <button
                    onClick={() =>
                      setPics((x) => x.filter((y) => y.id !== p.id))
                    }
                    aria-label="Remove picture"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="cap-bar">
            <button
              className="icon-btn"
              onClick={() => fileRef.current?.click()}
              aria-label="Add a picture"
              title="Add a picture"
            >
              <ImageIcon size={18} strokeWidth={1.7} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            {canDictate && !PLAYGROUND && (
              <button
                className={"icon-btn" + (listening ? " live" : "")}
                onClick={toggleMic}
                disabled={transcribing}
                aria-label="Dictate"
              >
                <Mic size={18} strokeWidth={1.7} />
              </button>
            )}
            <div className="cap-hint">
              {PLAYGROUND
                ? "say it messy — it gets sorted"
                : transcribing
                  ? "transcribing…"
                  : listening
                    ? "listening — tap the mic again when you're done"
                    : canDictate
                      ? "tap the mic to dictate"
                      : "tap the mic key on your keyboard to dictate"}
            </div>
            <button
              className="icon-btn"
              onClick={openDistill}
              aria-label="Distill instead of capture"
              title="Distill instead of capture"
            >
              <MessagesSquare size={18} strokeWidth={1.7} />
            </button>
            <button
              className="capture-btn"
              onClick={() => {
                submit(dictatedRef.current);
                dictatedRef.current = false;
              }}
              disabled={!!busy || (!text.trim() && !pics.length)}
            >
              {busy ? "…" : "Capture"}
            </button>
          </div>
        </div>
        )}

        {busy && (
          <div className="status">
            <span className="pulse" />
            <BusyLine key={busy} label={busy} />
          </div>
        )}
        {/* The same note, but for work that is not in anyone's way. It says
            what is happening without the capture box going dead, because
            the capture it follows has already landed. */}
        {!busy && summarising && (
          <div className="status status-quiet">
            <span className="pulse" />
            {summarising}…
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {landed && (
          <div className="landed">
            {/* Wrapped in a span so the flex row keeps the sentence whole
                and only the button sits on its own. */}
            <span>
              Landed in <em>{landed}</em>.
            </span>
            {canUndo && (
              <button className="undo-btn" onClick={() => void undo()}>
                Undo
              </button>
            )}
          </div>
        )}
        {/* The undo asked a question. One tap answers it: the capture is
            sorted again with that destination pinned, and the pair — wrong
            kind, right kind — becomes something the engine reads next time.
            No typing, and no obligation: dismissing is a tap too. */}
        {misfiled && (
          <div className="misfiled">
            {pickingThread ? (
              <>
                <span className="misfiled-q">Which thread?</span>
                <div className="picker misfiled-picker">
                  {data.threads
                    .filter((t) => t.id !== misfiled.thread?.id)
                    .map((t) => (
                      <button
                        key={t.id}
                        className="picker-row"
                        onClick={() => {
                          setPickingThread(false);
                          void sortAgainIntoThread(t.id);
                        }}
                      >
                        <span className="picker-name">{t.name}</span>
                        <span className="picker-meta">
                          {t.frags.length} layer{t.frags.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    ))}
                  <button
                    className="ghost"
                    onClick={() => setPickingThread(false)}
                  >
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="misfiled-q">Then what was it?</span>
                <div className="misfiled-opts">
                  {(["action", "thread", "intention"] as const)
                    .filter((k) => k !== misfiled.wrong)
                    .map((k) => (
                      <button
                        key={k}
                        className="misfiled-btn"
                        onClick={() => void sortAgainAs(k)}
                      >
                        {k === "action"
                          ? "An action"
                          : k === "thread"
                            ? "A thread"
                            : "An intention"}
                      </button>
                    ))}
                  {/* Right kind, wrong home. Only offered when it landed in
                      a thread and there is another one to move it to —
                      otherwise the answer is one of the kinds above. */}
                  {!!misfiled.thread && data.threads.length > 1 && (
                    <button
                      className="misfiled-btn"
                      onClick={() => setPickingThread(true)}
                    >
                      Another thread
                    </button>
                  )}
                  <button
                    className="misfiled-btn misfiled-skip"
                    onClick={dismissMisfiled}
                    aria-label="Never mind"
                  >
                    ×
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {suggestion && (
          <div className="suggest">
            <span className="suggest-text">
              {suggestion.kind === "duplicate" ? (
                <>
                  This duplicates <em>{suggestion.targetName}</em>?
                </>
              ) : (
                <>
                  Belongs with <em>{suggestion.targetName}</em>?
                </>
              )}
            </span>
            <span className="suggest-actions">
              <button
                className="suggest-btn suggest-ok"
                onClick={() => void acceptSuggestion()}
              >
                {suggestion.kind === "duplicate"
                  ? "Remove duplicate"
                  : suggestion.verb}
              </button>
              <button className="suggest-btn" onClick={dismissSuggestion}>
                {suggestion.kind === "duplicate" ? "Keep both" : "Keep separate"}
              </button>
            </span>
            <span className="suggest-why">{suggestion.reason}</span>
          </div>
        )}
        {notice && <div className="landed">{notice}</div>}
        {swept && !busy && (
          <div className="sweep">
            Cleanup ran on open.
            {swept.faded
              ? " " +
                swept.faded +
                " action" +
                (swept.faded > 1 ? "s" : "") +
                " went stale and moved to Faded — recoverable for two weeks."
              : ""}
            {swept.cleared ? " " + swept.cleared + " cleared for good." : ""}
            {" Threads were left alone."}
          </div>
        )}

        {corrupt && (
          <div className="sweep">
            Your saved board couldn&apos;t be read and has been set aside.
            Capturing now would overwrite the unreadable copy — restore a
            backup from Settings to bring it back.
          </div>
        )}

        {!distillOpen && (showOrganize ? (
          <OrganizeScreen
            proposals={organize ?? []}
            aiStatus={organizeAiStatus}
            onBack={() => {
              setShowOrganize(false);
              closeOrganize();
            }}
            onAccept={(id) => void acceptOrganize(id)}
            onDismiss={(id) => dismissOrganize(id)}
            onApproveAll={() => void acceptOrganizeAll()}
          />
        ) : showRecord ? (
          <RecordScreen
            ledger={data.ledger ?? []}
            now={now}
            wrap={wrap}
            onWrapSeen={() => void dismissWrap()}
            onBack={() => setShowRecord(false)}
            rules={learnedRules}
            onToggleRule={(key, enabled) => void toggleLearnedRule(key, enabled)}
            threads={data.threads}
            onRestore={(said) => {
              setText((x) => (x ? x + " " : "") + said);
              setShowRecord(false);
            }}
            onOpenThread={(id) => {
              setShowRecord(false);
              setTab("threads");
              setOpen(id);
            }}
          />
        ) : showSettings ? (
          <SettingsScreen
            principles={data.principles}
            counts={{
              actions: data.actions.length,
              threads: data.threads.length,
              intentions: data.intentions.length,
            }}
            onBack={() => {
              setShowSettings(false);
              setIoNote(null);
            }}
            onToggle={togglePrinciple}
            onAdd={addPrinciple}
            onDelete={deletePrinciple}
            onExport={exportBoard}
            onRestore={restoreFromFile}
            onCopyBoard={() => {
              copyWhole(shareRecord(data));
              stampRecordCopy();
            }}
            snapshotDaysList={snapDays}
            onRestoreSnapshot={(day) => void restoreSnapshot(day)}
            onImportIntent={importBackup}
            onLogout={logout}
            ioNote={ioNote}
            sync={sync}
            onSyncNow={syncNow}
            onOpenRecord={() => {
              setShowSettings(false);
              setShowRecord(true);
            }}
            ledgerCount={(data.ledger ?? []).length}
          />
        ) : draft ? (
          <IntentionDraft
            draft={draft}
            busy={!!busy}
            onChange={setDraft}
            onSave={saveDraft}
            onDiscard={discardDraft}
            onThreadInstead={() => void draftToThread()}
          />
        ) : intention ? (
          <IntentionDetail
            intention={intention}
            onBack={() => setOpenIntention(null)}
            onChange={updateIntention}
            onCopy={() => copyWhole(shareIntention(intention))}
            onDelete={() => deleteIntention(intention.id)}
          />
        ) : thread ? (
          <ThreadView
            thread={thread}
            focusFragId={openFrag}
            onBack={() => {
              setOpen(null);
              setOpenFrag(null);
            }}
            onRename={(name) => renameThread(thread.id, name)}
            onDelete={() => deleteThread(thread.id)}
            onRefreshSummary={() => refreshSummary(thread.id)}
            onEditFrag={(fragId, text) => editFrag(thread.id, fragId, text)}
            onDeleteFrag={(fragId) => deleteFrag(thread.id, fragId)}
            others={data.threads.filter((t) => t.id !== thread.id)}
            onMerge={(fromId) => mergeThreads(thread.id, fromId)}
            onSetCover={(cover) => setThreadCover(thread.id, cover)}
            onMoveFrag={(fragId, toId) => moveFrag(thread.id, fragId, toId)}
            onMoveFragToNew={(fragId) => moveFragToNew(thread.id, fragId)}
            onCopyThread={() =>
              copyWhole(shareThread(thread, actionsForThread(data, thread)))
            }
            fromActions={actionsForThread(data, thread)}
            onCopyFrag={(fragId) => copyFragment(thread.id, fragId)}
            onExtractAction={(fragId) => extractAction(thread.id, fragId)}
            onResolveFrag={(fragId, on) =>
              on
                ? void resolveFrag(thread.id, fragId)
                : void unresolveFrag(thread.id, fragId)
            }
            onAddFragImages={(fragId, files) => {
              /* Shrunk first, exactly like a photo picked at capture: a
                 phone shot is ~15MB as a data URL, and IndexedDB and the
                 backups both carry these. Unreadable files are skipped
                 rather than saved broken. */
              void Promise.all(
                [...(files || [])].slice(0, 4).map((file) =>
                  shrinkFile(file).catch(() => null)
                )
              ).then((out) =>
                addFragImages(
                  thread.id,
                  fragId,
                  out.filter((v): v is string => !!v)
                )
              );
            }}
            onTakeNext={() => takeNext(thread.id)}
            onDismissNext={() => dismissNext(thread.id)}
            busy={!!busy}
          />
        ) : (
          <>
            <div className="searchbar">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search everything"
                aria-label="Search everything"
              />
              {searching && (
                <button className="ghost" onClick={() => setQuery("")}>
                  Clear
                </button>
              )}
            </div>

            {searching ? (
              <SearchResults
                hits={hits}
                now={now}
                onOpenThread={(id, fragId) => {
                  setOpen(id);
                  setOpenFrag(fragId || null);
                }}
                onOpenIntention={(id) => setOpenIntention(id)}
              />
            ) : showTangle && tangle ? (
              <TangleReview
                tangle={tangle}
                fragText={(id) =>
                  data.threads
                    .flatMap((t) => t.frags)
                    .find((f) => f.id === id)?.text ?? ""
                }
                onAccept={(ids, rename) => {
                  setShowTangle(false);
                  void acceptTangle(ids, rename);
                }}
                onBack={() => setShowTangle(false)}
              />
            ) : (
              <>
            {tangle && !showTangle && (
              <TangleCallout
                tangle={tangle}
                onOpen={() => setShowTangle(true)}
                onDismiss={dismissTangle}
              />
            )}

            <div className="tabs">
              <button
                className={"tab" + (tab === "actions" ? " on" : "")}
                onClick={() => setTab("actions")}
              >
                Actions <b>{live.length}</b>
              </button>
              <button
                className={"tab" + (tab === "threads" ? " on" : "")}
                onClick={() => setTab("threads")}
              >
                Threads <b>{data.threads.length}</b>
              </button>
              <button
                className={"tab" + (tab === "intentions" ? " on" : "")}
                onClick={() => setTab("intentions")}
              >
                Intentions <b>{data.intentions.length}</b>
              </button>
              {tab === "actions" && live.length >= 2 && (
                <button
                  className={"icon-btn gtoggle" + (groupView ? " on" : "")}
                  role="switch"
                  aria-checked={groupView}
                  onClick={toggleGroupView}
                  aria-label="Group similar actions"
                  title={
                    groupView
                      ? "Back to the flat list"
                      : "Fold similar actions together"
                  }
                >
                  <Layers size={16} strokeWidth={1.7} />
                </button>
              )}
            </div>

            {tab === "actions" && (
              <div>
                {!data.actions.length && loaded && (
                  <div className="empty">
                    {/* An app about clearing clutter cannot open with a wall
                        of prose. What is actually needed here is three
                        things: nothing is wrong, one thing to try, and what
                        will happen. Everything else was cut — including the
                        note that you can aim a capture yourself, which is
                        both advanced and off-message: the whole pitch is
                        that you do not have to. */}
                    <p className="big">No open loops.</p>
                    {/* One messy sentence explains this app faster than any
                        amount of description. Tapping it fills the box but
                        does not send — the capture is still yours to make.
                        The two lines under it are pinned to what the engine
                        reliably does: run eight times, this sentence gave
                        one action and one thread every time. They claim the
                        shape, never the wording or the thread's name. */}
                    <button
                      className="try-line"
                      onClick={() => setText(TRY.actions)}
                      disabled={!!busy}
                    >
                      “{TRY.actions}”
                    </button>
                    <ul className="try-list">
                      <li>the bug becomes an action, with a shelf life</li>
                      <li>the pricing question becomes a thread that grows</li>
                    </ul>
                  </div>
                )}
                {grouped ? (
                  <>
                    {!grouped.groups.length && !!live.length && (
                      <p className="group-note">
                        Nothing groups yet — no two actions share a subject.
                      </p>
                    )}
                    {grouped.groups.map((g) => (
                      <div key={g.actions[0].id}>
                        <div className="group-label">
                          {g.label} · {g.actions.length}
                        </div>
                        {g.actions.map((a) => row(a))}
                      </div>
                    ))}
                    {!!grouped.groups.length && !!grouped.rest.length && (
                      <div className="group-label rest">
                        everything else · {grouped.rest.length}
                      </div>
                    )}
                    {grouped.rest.map((a) => row(a))}
                  </>
                ) : (
                  live.map((a) => row(a))
                )}

                {!!fadedList.length && (
                  <>
                    <button
                      className="section-label"
                      onClick={() => setShowFaded((v) => !v)}
                    >
                      {showFaded ? "▾" : "▸"} Faded · {fadedList.length}
                    </button>
                    {showFaded && fadedList.map((a) => row(a, true))}
                  </>
                )}
              </div>
            )}

            {tab === "threads" && (
              <div>
                {!data.threads.length && loaded && (
                  <div className="empty">
                    <p className="big">Nothing accumulating yet.</p>
                    <p>Threads never expire. They just get deeper.</p>
                    <button
                      className="try-line"
                      onClick={() => setText(TRY.threads)}
                      disabled={!!busy}
                    >
                      “{TRY.threads}”
                    </button>
                    <ul className="try-list">
                      <li>nothing to close, so it keeps — as a thread</li>
                      <li>“where this stands” gets written underneath it</li>
                    </ul>
                  </div>
                )}
                {active.map((t) => (
                  <TCard
                    key={t.id}
                    t={t}
                    landed={landedIds.includes(t.id)}
                    onOpen={() => setOpen(t.id)}
                  />
                ))}

                {!!resting.length && (
                  <>
                    <button
                      className="section-label"
                      onClick={() => setShowResting((v) => !v)}
                    >
                      {showResting ? "▾" : "▸"} Resting · {resting.length} ·
                      nothing new in two months
                    </button>
                    {showResting &&
                      resting.map((t) => (
                        <TCard
                          key={t.id}
                          t={t}
                          resting
                          onOpen={() => setOpen(t.id)}
                        />
                      ))}
                  </>
                )}
              </div>
            )}

            {tab === "intentions" && (
              <div>
                {!data.intentions.length && loaded && (
                  <div className="empty">
                    <p className="big">Nothing declared yet.</p>
                    <p>Not a goal. The state you are choosing to inhabit.</p>
                    <button
                      className="try-line"
                      onClick={() => setText(TRY.intentions)}
                      disabled={!!busy}
                    >
                      “{TRY.intentions}”
                    </button>
                    <ul className="try-list">
                      <li>written as already true, with what pulls against it named</li>
                      <li>you read it before it lands — nothing is saved unread</li>
                    </ul>
                  </div>
                )}
                {data.intentions.map((i) => (
                  <IntentionCard
                    key={i.id}
                    intention={i}
                    onOpen={() => setOpenIntention(i.id)}
                  />
                ))}
                <button
                  className="section-label"
                  onClick={() => {
                    setShowSettings(true);
                    setIoNote(null);
                  }}
                >
                  Principles ·{" "}
                  {data.principles.filter((p) => p.enabled).length} active ·
                  backup
                </button>
              </div>
            )}
              </>
            )}
          </>
        ))}
      </div>

      {/* Last thing on the page, under every note — where you end up when
          something has already gone wrong and you want to tell someone. */}
      <ReportBug />

      {editing && (
        <Markup
          src={editing.src}
          onClose={() => setEditing(null)}
          onSave={(url) => {
            setPics((p) =>
              p.map((x) => (x.id === editing.id ? { ...x, src: url } : x))
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

