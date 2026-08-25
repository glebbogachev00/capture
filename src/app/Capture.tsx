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
import { BrushCleaning, Check, Copy, Image as ImageIcon, Layers, MessagesSquare, Mic, MoreHorizontal, RefreshCw, Settings, Share2 } from "lucide-react";
import { Markup } from "./Markup";
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
  type Frag,
  type ShelfLife,
  type Thread,
  DAY,
  GRACE,
  IMG,
  fmt,
  fmtDue,
  left,
  uid,
} from "@/lib/model";
import { type Hits } from "@/lib/search";
import {
  IntentionCard,
  IntentionDetail,
  IntentionDraft,
  RecordScreen,
  SettingsScreen,
} from "./Intentions";
import { OrganizeScreen } from "./Organize";
import { shareAction, shareIntention, shareRecord, shareThread } from "@/lib/share";
import { actionsForThread } from "@/lib/threadActions";
import { useBoard } from "@/hooks/useBoard";
import { ReportBug } from "@/components/ReportBug";
import { PlaygroundNotice } from "@/components/PlaygroundNotice";
import { Tour } from "@/components/Tour";
import { PLAYGROUND } from "@/lib/playground";
import { groupActions } from "@/lib/group";
import { mapAiGroups, type RawAiGroup } from "@/lib/groupAi";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import {
  type Cover,
  TONE_NAMES,
  TONES,
  imgValue,
  parseCover,
  toneColour,
  toneValue,
} from "@/lib/cover";

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
const TICK_MS = 420;

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
  const [showRecord, setShowRecord] = useState(false);

  /* Grouped view of the Actions tab — a lens, not a structure: nothing is
     written to the board, and toggling off restores the flat list untouched.
     Remembered across visits; read in an effect so hydration stays clean. */
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
    suggestion,
    acceptSuggestion,
    dismissSuggestion,
    organize,
    organizeAiStatus,
    runOrganize,
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
    misfiled,
    sortAgainAs,
    sortAgainIntoThread,
    dismissMisfiled,
    undo,
    learnedRules,
    clearRule,
  } = useBoard(now);

  /* Strong claims light the badge; the button itself only exists when the
     scan found anything at all. Medium ones sit behind "Show more" inside
     the screen, so the header stays quiet on a clean board. */
  const highOrganize = (organize ?? []).filter((p) => p.confidence === "high");

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
        if (cancelled) return;
        setAiGroups({ key: liveKey, groups: out.groups ?? [] });
      } catch {
        /* The lens is a bonus layer: word grouping is already on screen. */
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
      {PLAYGROUND && loaded && (
        <Tour
          ctx={{
            captures: (data.ledger ?? []).length,
            answered: (data.corrections ?? []).filter(
              (c) => c.proposalKind === "undone" && c.accepted
            ).length,
            threadOpen: !!thread,
            recordOpen: showRecord,
          }}
          onPrefill={setText}
        />
      )}
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
            </button>
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
                disabled={!shareable}
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
                (organize ?? []).length > 0
                  ? `Tidy — ${organize!.length} ${organize!.length === 1 ? "suggestion" : "suggestions"} to review`
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
              {highOrganize.length > 0 && (
                <span className="organize-badge">{highOrganize.length}</span>
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
            {busy}…
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
            onBack={() => setShowOrganize(false)}
            onAccept={(id) => void acceptOrganize(id)}
            onDismiss={(id) => dismissOrganize(id)}
            onApproveAll={() => void acceptOrganizeAll()}
          />
        ) : showRecord ? (
          <RecordScreen
            ledger={data.ledger ?? []}
            now={now}
            onBack={() => setShowRecord(false)}
            rules={learnedRules}
            onClearRule={(key) => void clearRule(key)}
            threads={data.threads}
            onOpenThread={(id) => {
              setShowRecord(false);
              setTab("threads");
              setOpen(id);
            }}
            onCopy={() =>
              copyWhole(shareRecord(data))
            }
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
            ) : (
              <>
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
                      <div className="group-label">
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

/**
 * What a query turned up, across all three kinds at once.
 *
 * Grouped rather than interleaved, because an action and a thread are not
 * comparable enough to rank against each other — and you usually know which
 * kind of thing you are hunting for.
 */
function SearchResults({
  hits,
  now,
  onOpenThread,
  onOpenIntention,
}: {
  hits: Hits;
  now: number;
  onOpenThread: (id: string, fragId?: string | null) => void;
  onOpenIntention: (id: string) => void;
}) {
  if (!hits.total) {
    return (
      <div className="empty">
        <p className="big">Nothing by that shape.</p>
        <p>Every word has to appear somewhere in the item.</p>
      </div>
    );
  }

  return (
    <div>
      {!!hits.actions.length && (
        <>
          <div className="section-label">Actions · {hits.actions.length}</div>
          {hits.actions.map((a) => {
            const ms = a.expires ? a.expires - now : null;
            return (
              <div className="act" key={a.id}>
                <div className="act-body">
                  <div
                    className={
                      "act-text" + (a.done ? " is-done" : "")
                    }
                  >
                    {a.text}
                  </div>
                  <div className="act-meta">
                    <span>{fmt(a.at)}</span>
                    {a.done && <span>done</span>}
                    {a.faded && <span>faded</span>}
                  </div>
                </div>
                <span className={"chip" + (!ms ? " kept" : "")}>
                  {ms === null ? "kept" : left(ms)}
                </span>
              </div>
            );
          })}
        </>
      )}

      {!!hits.threads.length && (
        <>
          <div className="section-label">Threads · {hits.threads.length}</div>
          {hits.threads.map(({ thread, frags }) => (
            <div className="thread-hit" key={thread.id}>
              <button
                className="tcard"
                onClick={() => onOpenThread(thread.id, frags[0]?.id)}
              >
                <div className="tname">{thread.name}</div>
                <div className="tsum">
                  {thread.summary ||
                    (thread.frags.at(-1)?.text || "").slice(0, 120)}
                </div>
                <div className="act-meta" style={{ marginTop: 9 }}>
                  {frags.length
                    ? `${frags.length} matching note${frags.length === 1 ? "" : "s"}`
                    : "matches the thread itself"}
                </div>
              </button>
              {frags.map((f) => (
                <button
                  className="frag-hit"
                  key={f.id}
                  onClick={() => onOpenThread(thread.id, f.id)}
                  title="Jump to this fragment"
                >
                  <span className="frag-hit-date">{fmt(f.at)}</span>
                  {f.text}
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      {!!hits.intentions.length && (
        <>
          <div className="section-label">
            Intentions · {hits.intentions.length}
          </div>
          {hits.intentions.map((i) => (
            <IntentionCard
              key={i.id}
              intention={i}
              onOpen={() => onOpenIntention(i.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Row({
  a,
  faded,
  landed,
  now,
  shelfOpen,
  onToggle,
  onShelfClick,
  onSetShelf,
  onRestore,
  onRemove,
  onMakeThread,
  onEditText,
  onResort,
  onMakeIntention,
  onCopy,
  onOpenShot,
  busy,
}: {
  a: Action;
  faded?: boolean;
  /** This action is what the last capture created — wash it once. */
  landed?: boolean;
  now: number;
  shelfOpen: boolean;
  onToggle: () => void;
  onShelfClick: () => void;
  onSetShelf: (span: number | null, label: ShelfLife) => void;
  onRestore: () => void;
  onRemove: () => void;
  onMakeThread: () => void;
  onEditText: (text: string) => void;
  onResort: () => void;
  onMakeIntention: () => void;
  onCopy: () => void;
  /** Present only when a picture came in with this capture. */
  onOpenShot?: () => void;
  busy: boolean;
}) {
  const ms = a.expires ? a.expires - now : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.text);
  const [more, setMore] = useState(false);
  /* Ticking used to delete the action mid-tap: the row was gone before your
     finger lifted, so the most-repeated gesture in the app had no payoff.
     The box fills, the text strikes through, and the row folds away — then
     the board commits. Reduced motion still gets the beat, just no slide. */
  const [ticked, setTicked] = useState(false);
  const tick = () => {
    if (ticked) return;
    setTicked(true);
    setTimeout(onToggle, TICK_MS);
  };

  const commit = () => {
    if (draft.trim()) onEditText(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className={
        "act" +
        (faded ? " is-faded" : "") +
        (landed && !ticked ? " focus" : "") +
        (ticked ? " is-done is-ticking" : "")
      }
    >
      <button
        className={"box" + (ticked ? " done" : "")}
        onClick={tick}
        aria-label="Mark done"
      >
        {ticked && <Check size={13} strokeWidth={3} />}
      </button>
      <div className="act-body">
        {editing ? (
          <input
            className="act-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Action text"
            autoFocus
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(a.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="act-text">{a.text}</div>
        )}
        <div className="act-meta">
          <span>{fmt(a.at)}</span>
          {/* A deadline the capture named for itself. Shown because it is
              the reason this action is still here — it holds the row on the
              board until its date, and never leaves the app. */}
          {!!a.due && !faded && (
            <span className={"due" + (a.due - now < DAY ? " soon" : "")}>
              due {fmtDue(a.due)}
            </span>
          )}
          {/* The picture lives on a thread fragment, not here — this is the
              way back to it, so a screenshot is never a thing you captured
              and then could not find. */}
          {!!onOpenShot && (
            <button className="shot-link" onClick={onOpenShot} title="Open the note holding this picture">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.6" />
                <path d="M21 16l-5-5-6 6" />
              </svg>
              picture
            </button>
          )}
          {a.unsorted && <span className="raw">unsorted</span>}
          {faded && (
            <span>
              faded · clears in {left((a.fadedAt || now) + GRACE - now)}
            </span>
          )}
        </div>

        {more && !editing && (
          <div className="row-actions">
            <button className="ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            {/* Tried on the meta line as a one-tap chip and it read as
                clutter on a row that is otherwise just words and a date.
                Back here with the other per-card verbs: a tap further away,
                but the list stays a list. */}
            <button className="ghost" onClick={onCopy}>
              Copy
            </button>
            {a.unsorted && (
              <button className="ghost" onClick={onResort} disabled={busy}>
                Sort now
              </button>
            )}
            {faded ? (
              <button className="ghost" onClick={onRestore}>
                Restore
              </button>
            ) : (
              <>
                <button className="ghost" onClick={onMakeThread}>
                  Make a thread
                </button>
                <button
                  className="ghost"
                  onClick={onMakeIntention}
                  disabled={busy}
                >
                  Make an intention
                </button>
              </>
            )}
          </div>
        )}

        {shelfOpen && (
          <div className="shelf">
            <button onClick={() => onSetShelf(DAY, "hours")}>1 day</button>
            <button onClick={() => onSetShelf(7 * DAY, "days")}>1 week</button>
            <button onClick={() => onSetShelf(30 * DAY, "weeks")}>
              1 month
            </button>
            <button onClick={() => onSetShelf(null, "keep")}>keep</button>
            <button className="warn" onClick={onRemove}>
              delete now
            </button>
          </div>
        )}
      </div>
      <div className="act-tools">
        <button
          className={"chip" + (!ms ? " kept" : ms < DAY ? " soon" : "")}
          onClick={onShelfClick}
          aria-label="Change shelf life"
        >
          {ms === null ? "kept" : left(ms)}
        </button>
        {!editing && (
          <button
            className={"more-btn" + (more ? " open" : "")}
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            aria-label={more ? "Fewer options" : "More options"}
          >
            <MoreHorizontal size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A thread's cover: a colour band, or a photo band when one was chosen.
 * Photos come back from IndexedDB the same way fragment images do, so a
 * cover picked on the phone appears on the Mac once its bytes sync.
 */
function CoverBand({ cover }: { cover: Cover }) {
  const [src, setSrc] = useState<string | null>(null);
  const id = cover.kind === "img" ? cover.id : null;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void get(IMG(id))
      .then((v) => {
        if (alive) setSrc(v);
      })
      .catch(() => {
        /* not here yet — the next sync fetches it */
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (cover.kind === "tone") {
    return (
      <div
        className="tcover"
        style={{ background: toneColour(cover) || undefined }}
      />
    );
  }
  return (
    <div className="tcover">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" />}
    </div>
  );
}

function TCard({
  t,
  resting,
  landed,
  onOpen,
}: {
  t: Thread;
  resting?: boolean;
  /** This thread is where the last capture went — wash it once. */
  landed?: boolean;
  onOpen: () => void;
}) {
  const last = t.frags.at(-1);
  const bars = t.frags.slice(-22);
  const cover = parseCover(t.cover);
  return (
    <button
      className={
        "tcard" +
        (resting ? " resting" : "") +
        (landed ? " focus" : "") +
        (cover ? " has-cover" : "")
      }
      onClick={onOpen}
    >
      {/* A thread being built out gets a little identity — a band across the
          top, colour or photo. Threads without one look exactly as they
          always have, so a quiet board stays quiet. */}
      {cover && <CoverBand cover={cover} />}
      <div className="tname">{t.name}</div>
      <div className="tsum">
        {t.summary || (last?.text || "").slice(0, 120) + "…"}
      </div>
      <div className="sed">
        {bars.map((f, i, arr) => (
          <i
            /* The newest bar settles in rather than appearing — a layer of
               sediment landing. Only when this thread just took the capture,
               so the strip is still still on every other render. */
            className={landed && i === arr.length - 1 ? "settling" : undefined}
            key={f.id}
            style={{
              width: Math.min(100, 22 + f.text.length / 7) + "%",
              opacity: 0.2 + (0.75 * (i + 1)) / arr.length,
            }}
          />
        ))}
      </div>
      <div className="act-meta" style={{ marginTop: 9 }}>
        {/* Layers, not fragments: the sediment bars above already say a
            thread accumulates, and this is the line that should agree with
            them. The data model still calls them frags — this is what the
            thread looks like, not what it is stored as. */}
        {t.frags.length} layer{t.frags.length > 1 ? "s" : ""}
        {last ? " · last " + fmt(last.at) : ""}
      </div>
    </button>
  );
}

function ThreadView({
  thread,
  focusFragId,
  onBack,
  onRename,
  onDelete,
  onRefreshSummary,
  onEditFrag,
  onDeleteFrag,
  others,
  onMerge,
  onSetCover,
  onMoveFrag,
  onMoveFragToNew,
  onCopyThread,
  onCopyFrag,
  onExtractAction,
  onTakeNext,
  onDismissNext,
  fromActions,
  busy,
}: {
  thread: Thread;
  focusFragId?: string | null;
  onBack: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onRefreshSummary: () => void;
  onEditFrag: (fragId: string, text: string) => void;
  onDeleteFrag: (fragId: string) => void;
  others: Thread[];
  onMerge: (fromId: string) => void;
  onSetCover: (cover: string | null) => void;
  onMoveFrag: (fragId: string, toId: string) => void;
  onMoveFragToNew: (fragId: string) => void;
  onCopyThread: () => void;
  onCopyFrag: (fragId: string) => void;
  onExtractAction: (fragId: string) => void;
  onTakeNext: () => void;
  onDismissNext: () => void;
  /** What this thread gave rise to — shown as one quiet line, and only
      when there is something to show. */
  fromActions: { open: Action[]; done: Action[] };
  busy: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(thread.name);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const coverFile = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  /* The Related line stays collapsed until asked — a quiet affordance,
     never a list sitting in the thread. */

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← all threads
      </button>

      {renaming ? (
        <div className="rename">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Thread name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                onRename(name.trim());
                setRenaming(false);
              }
              if (e.key === "Escape") {
                setName(thread.name);
                setRenaming(false);
              }
            }}
          />
          <button
            className="capture-btn"
            disabled={!name.trim()}
            onClick={() => {
              onRename(name.trim());
              setRenaming(false);
            }}
          >
            Save
          </button>
          <button
            className="ghost"
            onClick={() => {
              setName(thread.name);
              setRenaming(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="tname" style={{ fontSize: 26 }}>
          {thread.name}
        </div>
      )}

      {!renaming && (
        <div style={{ marginBottom: 16 }}>
          <div className="act-meta">
            {/* One tap to the clipboard. The header arrow opens the OS sheet,
                which is the right thing for sending to a person and the wrong
                thing when you only want to paste this into a chat. */}
            <div className="frag-tools">
              <button className="copy-btn" onClick={onCopyThread} aria-label="Copy thread">
                <Copy size={16} strokeWidth={1.6} />
              </button>
              <button
                className={"more-btn" + (more ? " open" : "")}
                onClick={() => {
                  setMore((v) => !v);
                  setMerging(false);
                  setConfirming(false);
                }}
                aria-expanded={more}
                aria-label={more ? "Fewer options" : "More options"}
              >
                <MoreHorizontal size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          {more && (
            <div className="row-actions">
              <button className="ghost" onClick={onRefreshSummary} disabled={busy}>
                Refresh summary
              </button>
              <button className="ghost" onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setPickingCover((v) => !v);
                  setMerging(false);
                  setConfirming(false);
                }}
                aria-expanded={pickingCover}
              >
                Cover
              </button>
              {others.length > 0 && (
                <button
                  className="ghost"
                  onClick={() => {
                    setMerging((v) => !v);
                    setConfirming(false);
                  }}
                >
                  Merge in
                </button>
              )}
              <button
                className="ghost warn"
                onClick={() => {
                  setConfirming((v) => !v);
                  setMerging(false);
                }}
              >
                Delete thread
              </button>
            </div>
          )}
        </div>
      )}

      {pickingCover && (
        <div className="shelf cover-picker">
          <span className="cap-hint" style={{ flex: "1 1 100%" }}>
            A little identity for this thread — a colour, or a picture of your
            own.
          </span>
          {TONE_NAMES.map((t) => (
            <button
              key={t}
              className={
                "tone-swatch" +
                (thread.cover === toneValue(t) ? " on" : "")
              }
              style={{ background: TONES[t] }}
              onClick={() => onSetCover(toneValue(t))}
              aria-label={"Cover: " + t}
              title={t}
            />
          ))}
          <button className="ghost" onClick={() => coverFile.current?.click()}>
            Photo…
          </button>
          {thread.cover && (
            <button className="ghost warn" onClick={() => onSetCover(null)}>
              None
            </button>
          )}
          <input
            ref={coverFile}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              /* Shrunk exactly like a capture photo, stored under the usual
                 image key, so it syncs by the same path as any other picture. */
              void shrinkFile(f)
                .then(async (src) => {
                  const id = uid();
                  await set(IMG(id), src);
                  onSetCover(imgValue(id));
                })
                .catch(() => {
                  /* unreadable image — leave the cover as it was */
                });
            }}
          />
        </div>
      )}

      {merging && (
        <div className="picker">
          <p className="picker-hint">
            Pick a thread to fold into <b>{thread.name}</b>. Its fragments join
            this one in date order and the thread itself goes.
          </p>
          {others.map((t) => (
            <button
              key={t.id}
              className="picker-row"
              onClick={() => {
                onMerge(t.id);
                setMerging(false);
              }}
            >
              <span className="picker-name">{t.name}</span>
              <span className="picker-meta">
                {t.frags.length} fragment{t.frags.length > 1 ? "s" : ""}
              </span>
            </button>
          ))}
          <button className="ghost" onClick={() => setMerging(false)}>
            Cancel
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDelete
          title="Delete this thread?"
          hint={
            thread.frags.length
              ? `All ${thread.frags.length} fragment${
                  thread.frags.length > 1 ? "s go" : " goes"
                } with it. This cannot be undone.`
              : "This cannot be undone."
          }
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
        />
      )}

      {thread.summary && (
        <div className="state">
          <h4>Where this stands</h4>
          <p>{thread.summary}</p>
          {/* The move, if the thread has one. One line, one tap: it
              becomes an action through the usual sorter. Waved away, it
              stays away until the summary names a different step. */}
          {thread.next && thread.next !== thread.nextDismissed && (
            <div className="next-step">
              <span className="next-label">Next</span>
              <button
                className="next-take"
                onClick={onTakeNext}
                disabled={busy}
                title="Add this to your actions"
              >
                {thread.next}
              </button>
              <button
                className="next-dismiss"
                onClick={onDismissNext}
                aria-label="Not now"
                title="Not now"
              >
                ×
              </button>
            </div>
          )}
          {/* The actions that belong with this thread — born from it, or
              plainly about it. Same room as the summary and the next step,
              because they are the same kind of fact: where this stands,
              and what is on the list because of it. */}
          {fromActions.open.length > 0 && (
            <div className="state-actions">
              <h4>
                Actions
                {fromActions.done.length > 0 &&
                  ` · ${fromActions.done.length} done`}
              </h4>
              <ul>
                {fromActions.open.map((a) => (
                  <li key={a.id}>
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect
                        x="1.5"
                        y="1.5"
                        width="13"
                        height="13"
                        rx="3.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}


      {[...thread.frags].reverse().map((f) => (
        <FragView
          key={f.id}
          f={f}
          focus={f.id === focusFragId}
          others={others}
          busy={busy}
          onSave={(text) => onEditFrag(f.id, text)}
          onDelete={() => onDeleteFrag(f.id)}
          onMove={(toId) => onMoveFrag(f.id, toId)}
          onMoveToNew={() => onMoveFragToNew(f.id)}
          onCopy={() => onCopyFrag(f.id)}
          onExtract={() => onExtractAction(f.id)}
        />
      ))}
    </div>
  );
}

function FragView({
  f,
  others,
  focus,
  onSave,
  onDelete,
  onMove,
  onMoveToNew,
  onCopy,
  onExtract,
  busy,
}: {
  f: Frag;
  others: Thread[];
  focus?: boolean;
  onSave: (text: string) => void;
  onDelete: () => void;
  onMove: (toId: string) => void;
  onMoveToNew: () => void;
  onCopy: () => void;
  onExtract: () => void;
  busy: boolean;
}) {
  const [srcs, setSrcs] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(f.text);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [more, setMore] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /* The image-correction scroll must fire once per focus, not on every edit
     save (which hands FragView a fresh `f` and would yank the view). */
  const corrected = useRef(false);

  /* Landed here from a search result: bring the note into view. Respects
     the reduced-motion preference instead of forcing a smooth glide. */
  useEffect(() => {
    if (focus) {
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      root.current?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "center",
      });
    } else {
      corrected.current = false;
    }
  }, [focus]);

  /* Keyed on the image ids, not the frag object: every sync merge rebuilds
     the thread's frag objects, and keying on `f` re-read every image in the
     open thread from IndexedDB on each 10s poll. */
  const imgKey = (f.imgs || []).join(",");
  useEffect(() => {
    (async () => {
      const ids = imgKey ? imgKey.split(",") : [];
      const out = (
        await Promise.all(
          ids.map((id) => get(IMG(id)).catch(() => null))
        )
      ).filter((v): v is string => !!v);
      setSrcs(out);
      /* An image above the focused note can land after the first scroll and
         nudge the layout; bring the note back into view once images settle.
         Once per focus only — edits after that must not re-scroll. */
      if (focus && out.length && !corrected.current) {
        corrected.current = true;
        root.current?.scrollIntoView({ behavior: "auto", block: "center" });
      }
    })();
  }, [imgKey, focus]);

  return (
    <div
      className={"frag" + (focus ? " focus" : "")}
      ref={root}
      aria-current={focus ? "true" : undefined}
    >
      <div className="frag-date">
        {fmt(f.at)}
        {f.unsorted && <span className="raw">unsorted</span>}
        {!editing && (
          <div className="frag-tools">
            <button className="copy-btn" onClick={onCopy} aria-label="Copy">
              <Copy size={16} strokeWidth={1.6} />
            </button>
            <button
              className={"more-btn" + (more ? " open" : "")}
              onClick={() => {
                setMore((v) => !v);
                setMoving(false);
                setConfirming(false);
              }}
              aria-expanded={more}
              aria-label={more ? "Fewer options" : "More options"}
            >
              <MoreHorizontal size={16} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {more && !editing && (
        <div className="row-actions">
          <button className="ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="ghost" onClick={onExtract} disabled={busy}>
            Make an action
          </button>
          <button
            className="ghost"
            onClick={() => {
              setMoving((v) => !v);
              setConfirming(false);
            }}
          >
            Move
          </button>
          <button
            className="ghost warn"
            onClick={() => {
              setConfirming((v) => !v);
              setMoving(false);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {moving && !editing && (
        <div className="picker">
          <p className="picker-hint">Move this fragment to:</p>
          {/*
            Always offered, not just when there is nowhere else to put it —
            splitting a thread that has drifted into two topics is the common
            case, and it needs a destination that does not exist yet.
          */}
          <button
            className="picker-row picker-new"
            onClick={() => {
              onMoveToNew();
              setMoving(false);
            }}
          >
            <span className="picker-name">＋ A new thread</span>
            <span className="picker-meta">
              named from this fragment, rename it after
            </span>
          </button>
          {others.map((t) => (
            <button
              key={t.id}
              className="picker-row"
              onClick={() => {
                onMove(t.id);
                setMoving(false);
              }}
            >
              <span className="picker-name">{t.name}</span>
              <span className="picker-meta">
                {t.frags.length} fragment{t.frags.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          <button className="ghost" onClick={() => setMoving(false)}>
            Cancel
          </button>
        </div>
      )}

      {editing ? (
        <div className="frag-edit">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Fragment text"
            autoFocus
          />
          <div className="act-meta">
            <button
              className="capture-btn"
              disabled={!draft.trim()}
              onClick={() => {
                onSave(draft.trim());
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              className="ghost"
              onClick={() => {
                setDraft(f.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p>{f.text}</p>
      )}

      {confirming && !editing && (
        <ConfirmDelete
          title="Delete this fragment?"
          confirmLabel="Delete fragment"
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
        />
      )}

      {srcs.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={s} alt="" />
      ))}
    </div>
  );
}
