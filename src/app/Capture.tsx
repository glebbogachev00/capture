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

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Copy, Image as ImageIcon, MessagesSquare, Mic, MoreHorizontal, Share2, Settings } from "lucide-react";
import { Markup } from "./Markup";
import { DistillView } from "./Distill";
import {
  clockServerSnapshot,
  clockSnapshot,
  subscribeToClock,
} from "@/lib/clock";
import { useDictation } from "@/hooks/useDictation";
import { get } from "@/lib/storage";
import {
  type Action,
  type Frag,
  type ShelfLife,
  type Thread,
  DAY,
  GRACE,
  IMG,
  fmt,
  left,
  uid,
} from "@/lib/model";
import { type Hits } from "@/lib/search";
import {
  IntentionCard,
  IntentionDetail,
  IntentionDraft,
  SettingsScreen,
} from "./Intentions";
import { shareIntention, shareThread } from "@/lib/share";
import { useBoard } from "@/hooks/useBoard";

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
    busy,
    err,
    landed,
    notice,
    swept,
    tab,
    setTab,
    setOpen,
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
    done,
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
  } = useBoard(now);

  /* Input device plumbing: the hidden file picker, and the speech recogniser
     (shared with Distill — the mic routes to whichever surface is open).
     Read through the ref by useDictation, so the destination is always the
     one that is current when a result lands. */
  const { canDictate, listening, toggleMic } = useDictation((t) => {
    if (distillOpen) {
      setDistillInput((x) => (x ? x + " " : "") + t.trim());
    } else {
      setText((x) => (x ? x + " " : "") + t.trim());
    }
  });

  const addFiles = (files: FileList | null) => {
    [...(files || [])].slice(0, 4).forEach((f) => {
      const rd = new FileReader();
      rd.onload = () =>
        setPics((p) => [...p, { id: uid(), src: rd.result as string }]);
      rd.readAsDataURL(f);
    });
  };

  const row = (a: Action, faded?: boolean) => (
    <Row
      key={a.id}
      a={a}
      faded={faded}
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
      busy={!!busy}
    />
  );

  return (
    <div className="capture-root">
      <div className="capture-wrap">
        <div className="capture-head">
          <div className="capture-mark">
            capture<span>.</span>
          </div>
          <div className="capture-head-right">
            <div className="capture-count">
              {live.length} open · {data.threads.length} threads
            </div>
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
            placeholder="Say it however it comes out. Half a thought is fine."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
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
            {canDictate && (
              <button
                className={"icon-btn" + (listening ? " live" : "")}
                onClick={toggleMic}
                aria-label="Dictate"
              >
                <Mic size={18} strokeWidth={1.7} />
              </button>
            )}
            <div className="cap-hint">
              {canDictate
                ? "or tap the mic key on your keyboard"
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
              onClick={submit}
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
            Landed in <em>{landed}</em>.
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

        {showSettings ? (
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
            onBack={() => setOpen(null)}
            onRename={(name) => renameThread(thread.id, name)}
            onDelete={() => deleteThread(thread.id)}
            onRefreshSummary={() => refreshSummary(thread.id)}
            onEditFrag={(fragId, text) => editFrag(thread.id, fragId, text)}
            onDeleteFrag={(fragId) => deleteFrag(thread.id, fragId)}
            others={data.threads.filter((t) => t.id !== thread.id)}
            onMerge={(fromId) => mergeThreads(thread.id, fromId)}
            onMoveFrag={(fragId, toId) => moveFrag(thread.id, fragId, toId)}
            onMoveFragToNew={(fragId) => moveFragToNew(thread.id, fragId)}
            onCopyThread={() => copyWhole(shareThread(thread))}
            onCopyFrag={(fragId) => copyFragment(thread.id, fragId)}
            onExtractAction={(fragId) => extractAction(thread.id, fragId)}
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
                onOpenThread={(id) => setOpen(id)}
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
            </div>

            {tab === "actions" && (
              <div>
                {!data.actions.length && loaded && (
                  <div className="empty">
                    <p className="big">Nothing to close yet.</p>
                    <p>
                      Anything you capture that&apos;s a task lands here, with a
                      shelf life.
                    </p>
                  </div>
                )}
                {live.map((a) => row(a))}

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

                {!!done.length && (
                  <>
                    <div className="section-label">
                      Closed · clears itself in a week
                    </div>
                    {done.map((a) => (
                      <div className="act is-done" key={a.id}>
                        <button
                          className="box done"
                          onClick={() => toggleAction(a.id)}
                          aria-label="Mark not done"
                        >
                          <span
                            style={{
                              color: "#fff",
                              fontSize: 11,
                              lineHeight: 1,
                            }}
                          >
                            ✓
                          </span>
                        </button>
                        <div className="act-body">
                          <div className="act-text">{a.text}</div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === "threads" && (
              <div>
                {!data.threads.length && loaded && (
                  <div className="empty">
                    <p className="big">No threads running.</p>
                    <p>
                      Talk something through. It&apos;ll start one and keep it —
                      threads never expire.
                    </p>
                  </div>
                )}
                {active.map((t) => (
                  <TCard key={t.id} t={t} onOpen={() => setOpen(t.id)} />
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
                    <p className="big">No intentions set.</p>
                    <p>
                      Say what you are calling into being and it gets written
                      as already true, with what pulls against it named.
                    </p>
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
        )}
      </div>

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
  onOpenThread: (id: string) => void;
  onOpenIntention: (id: string) => void;
}) {
  if (!hits.total) {
    return (
      <div className="empty">
        <p className="big">Nothing matches.</p>
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
          {hits.threads.map(({ thread, matchingFrags }) => (
            <button
              className="tcard"
              key={thread.id}
              onClick={() => onOpenThread(thread.id)}
            >
              <div className="tname">{thread.name}</div>
              <div className="tsum">
                {thread.summary ||
                  (thread.frags.at(-1)?.text || "").slice(0, 120)}
              </div>
              <div className="act-meta" style={{ marginTop: 9 }}>
                {matchingFrags
                  ? `${matchingFrags} matching note${matchingFrags === 1 ? "" : "s"}`
                  : "matches the thread itself"}
              </div>
            </button>
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
  busy,
}: {
  a: Action;
  faded?: boolean;
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
  busy: boolean;
}) {
  const ms = a.expires ? a.expires - now : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.text);
  const [more, setMore] = useState(false);

  const commit = () => {
    if (draft.trim()) onEditText(draft.trim());
    setEditing(false);
  };

  return (
    <div className={"act" + (faded ? " is-faded" : "")}>
      <button className="box" onClick={onToggle} aria-label="Mark done" />
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

function TCard({
  t,
  resting,
  onOpen,
}: {
  t: Thread;
  resting?: boolean;
  onOpen: () => void;
}) {
  const last = t.frags.at(-1);
  return (
    <button className={"tcard" + (resting ? " resting" : "")} onClick={onOpen}>
      <div className="tname">{t.name}</div>
      <div className="tsum">
        {t.summary || (last?.text || "").slice(0, 120) + "…"}
      </div>
      <div className="sed">
        {t.frags.slice(-22).map((f, i, arr) => (
          <i
            key={f.id}
            style={{
              width: Math.min(100, 22 + f.text.length / 7) + "%",
              opacity: 0.2 + (0.75 * (i + 1)) / arr.length,
            }}
          />
        ))}
      </div>
      <div className="act-meta" style={{ marginTop: 9 }}>
        {t.frags.length} fragment{t.frags.length > 1 ? "s" : ""}
        {last ? " · last " + fmt(last.at) : ""}
      </div>
    </button>
  );
}

function ThreadView({
  thread,
  onBack,
  onRename,
  onDelete,
  onRefreshSummary,
  onEditFrag,
  onDeleteFrag,
  others,
  onMerge,
  onMoveFrag,
  onMoveFragToNew,
  onCopyThread,
  onCopyFrag,
  onExtractAction,
  busy,
}: {
  thread: Thread;
  onBack: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onRefreshSummary: () => void;
  onEditFrag: (fragId: string, text: string) => void;
  onDeleteFrag: (fragId: string) => void;
  others: Thread[];
  onMerge: (fromId: string) => void;
  onMoveFrag: (fragId: string, toId: string) => void;
  onMoveFragToNew: (fragId: string) => void;
  onCopyThread: () => void;
  onCopyFrag: (fragId: string) => void;
  onExtractAction: (fragId: string) => void;
  busy: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(thread.name);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [more, setMore] = useState(false);

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
        <div className="shelf" style={{ marginBottom: 16 }}>
          <span className="cap-hint" style={{ flex: "1 1 100%" }}>
            Delete this thread and all {thread.frags.length} fragment
            {thread.frags.length > 1 ? "s" : ""}? This cannot be undone.
          </span>
          <button className="warn" onClick={onDelete}>
            Delete for good
          </button>
          <button onClick={() => setConfirming(false)}>Keep it</button>
        </div>
      )}

      {thread.summary && (
        <div className="state">
          <h4>Where this stands</h4>
          <p>{thread.summary}</p>
        </div>
      )}

      {[...thread.frags].reverse().map((f) => (
        <FragView
          key={f.id}
          f={f}
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

  useEffect(() => {
    (async () => {
      const out: string[] = [];
      for (const id of f.imgs || []) {
        try {
          const v = await get(IMG(id));
          if (v) out.push(v);
        } catch {
          /* gone */
        }
      }
      setSrcs(out);
    })();
  }, [f]);

  return (
    <div className="frag">
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
        <div className="shelf">
          <button className="warn" onClick={onDelete}>
            Delete fragment
          </button>
          <button onClick={() => setConfirming(false)}>Keep it</button>
        </div>
      )}

      {srcs.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={s} alt="" />
      ))}
    </div>
  );
}
