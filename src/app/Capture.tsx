"use client";

/* ============================================================
   CAPTURE — one capture surface, two destinations, self-clearing.
   Everything you say goes in one place. The system decides
   whether it's something to close (Action) or something that
   thickens over time (Thread), cleans up the transcription,
   keeps each Thread's "where this stands" block current, and
   quietly sweeps away what has gone stale.
   Threads are never deleted. Only actions fade.
   ============================================================ */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Markup } from "./Markup";
import { get, set } from "@/lib/storage";
import {
  capability,
  clockServerSnapshot,
  clockSnapshot,
  stamp,
  subscribeToClock,
} from "@/lib/clock";
import {
  type Action,
  type Board,
  type Frag,
  type ShelfLife,
  type Thread,
  DAY,
  DORMANT,
  EMPTY,
  GRACE,
  IMG,
  KEY,
  SHELF,
  dropImages,
  fmt,
  left,
  sweep,
  uid,
} from "@/lib/model";

/* Not in lib.dom yet, and only the handful of members used here matter. */
type Recogniser = {
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: {
    resultIndex: number;
    results: {
      [i: number]: { [j: number]: { transcript: string } };
      length: number;
    };
  }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
type RecogniserCtor = new () => Recogniser;

/** Carries the server's explanation so the board can show it verbatim. */
class SortError extends Error {}

const reasonOf = (error: unknown) =>
  error instanceof SortError && error.message
    ? error.message
    : "The sort didn't go through.";

/** What /api/sort returns. Validated server-side against a schema. */
type SortResult = {
  clean: string;
  kind: "action" | "thread";
  title: string;
  actions?: string[];
  shelfLife?: string;
  threadId?: string | null;
  threadName?: string | null;
};

export function Capture() {
  const [data, setData] = useState<Board>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [pics, setPics] = useState<{ id: string; src: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [landed, setLanded] = useState<string | null>(null);
  const [swept, setSwept] = useState<{ faded: number; cleared: number } | null>(
    null
  );
  const [tab, setTab] = useState<"actions" | "threads">("actions");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; src: string } | null>(
    null
  );
  const [shelfFor, setShelfFor] = useState<string | null>(null);
  const [showFaded, setShowFaded] = useState(false);
  const [showResting, setShowResting] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recog = useRef<Recogniser | null>(null);

  /* Ticks once a minute so the shelf-life countdowns move on their own. */
  const now = useSyncExternalStore(
    subscribeToClock,
    clockSnapshot,
    clockServerSnapshot
  );

  const canDictate = useSyncExternalStore(
    capability.subscribe,
    () => Boolean(speechRecogniser()),
    () => false
  );

  const persist = useCallback(async (next: Board) => {
    setData(next);
    try {
      await set(KEY, JSON.stringify(next));
    } catch {
      setErr(
        "Couldn't save that. Your last capture is still on screen — try again."
      );
    }
  }, []);

  /* load, then sweep */
  useEffect(() => {
    (async () => {
      let d: Board = EMPTY;
      try {
        const raw = await get(KEY);
        if (raw) d = JSON.parse(raw);
      } catch {
        /* first run */
      }
      const { next, faded, cleared } = await sweep(d);
      setData(next);
      if (faded || cleared) {
        try {
          await set(KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        setSwept({ faded, cleared });
      }
      setLoaded(true);
    })();
  }, []);

  const toggleMic = () => {
    const SR = speechRecogniser();
    if (!SR) return;
    if (listening) {
      recog.current?.stop();
      setListening(false);
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        s += e.results[i][0].transcript;
      }
      setText((t) => (t ? t + " " : "") + s.trim());
    };
    r.onend = () => setListening(false);
    r.start();
    recog.current = r;
    setListening(true);
  };

  const addFiles = (files: FileList | null) => {
    [...(files || [])].slice(0, 4).forEach((f) => {
      const rd = new FileReader();
      rd.onload = () =>
        setPics((p) => [...p, { id: uid(), src: rd.result as string }]);
      rd.readAsDataURL(f);
    });
  };

  /** Ask the server to sort a capture. Throws SortError with the reason. */
  const requestSort = async (raw: string) => {
    const known = data.threads.map((t) => ({
      id: t.id,
      name: t.name,
      about: t.summary?.slice(0, 160) || "",
    }));
    const res = await fetch("/api/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw, threads: known }),
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
  ): { next: Board; targetId: string | null; landed: string } => {
    if (out.kind === "action") {
      const span = SHELF[out.shelfLife as ShelfLife] ?? null;
      const items: Action[] = (
        out.actions?.length ? out.actions : [out.title]
      ).map((t: string) => ({
        id: uid(),
        text: t,
        done: false,
        at,
        src: out.clean,
        imgs: imgIds,
        shelf: (out.shelfLife || "keep") as ShelfLife,
        expires: span ? Date.now() + span : null,
      }));
      return {
        next: { ...board, actions: [...items, ...board.actions] },
        targetId: null,
        landed:
          items.length +
          " action" +
          (items.length > 1 ? "s" : "") +
          (span ? " · fades in " + left(span) : " · kept"),
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
      landed: fresh.name + " — thread updated",
    };
  };

  /**
   * Keep a capture that no model would sort.
   *
   * Losing what you just said because a free tier ran dry is the worst thing
   * this app could do, so the text is saved verbatim and flagged for sorting
   * later. Where it lands follows what you were looking at: an open thread
   * takes it as a fragment, the Threads tab starts a new one, and otherwise it
   * becomes an action — the destination you can always fix by hand afterwards.
   */
  const saveUnsorted = async (
    raw: string,
    imgIds: string[],
    at: number,
    reason: string
  ) => {
    const body = raw || "(image only)";
    const openThread = data.threads.find((t) => t.id === open);
    const frag: Frag = {
      id: uid(),
      at,
      text: body,
      imgs: imgIds,
      unsorted: true,
    };

    let next: Board;
    if (openThread) {
      next = {
        ...data,
        threads: data.threads.map((t) =>
          t.id === openThread.id ? { ...t, frags: [...t.frags, frag] } : t
        ),
      };
      setLanded(openThread.name + " — saved unsorted");
    } else if (tab === "threads") {
      const fresh: Thread = {
        id: uid(),
        name: body.split(/\s+/).slice(0, 5).join(" "),
        summary: "",
        frags: [frag],
      };
      next = { ...data, threads: [fresh, ...data.threads] };
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
      next = { ...data, actions: [action, ...data.actions] };
      setLanded("Kept unsorted");
    }

    setText("");
    setPics([]);
    await persist(next);
    setErr(reason + " Saved as it is, so nothing is lost — sort it later.");
  };

  const submit = async () => {
    const raw = text.trim();
    if (!raw && !pics.length) return;
    setErr("");
    setSwept(null);
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
      const out = await requestSort(raw || "(image only)");
      const { next, targetId, landed } = applySorted(out, imgIds, at, data);
      setLanded(landed);
      setTab(out.kind === "action" ? "actions" : "threads");
      setText("");
      setPics([]);
      await persist(next);
      if (targetId) await regenerate(next, targetId);
    } catch (error) {
      await saveUnsorted(raw, imgIds, at, reasonOf(error));
    }

    setBusy(null);
    setTimeout(() => setLanded(null), 4500);
  };

  /** Run a capture that was saved raw back through the sorter. */
  const resort = async (a: Action) => {
    setErr("");
    setBusy("Sorting");
    try {
      const out = await requestSort(a.src || a.text);
      const board = {
        ...data,
        actions: data.actions.filter((x) => x.id !== a.id),
      };
      const { next, targetId, landed } = applySorted(
        out,
        a.imgs || [],
        a.at,
        board
      );
      setLanded(landed);
      setTab(out.kind === "action" ? "actions" : "threads");
      await persist(next);
      if (targetId) await regenerate(next, targetId);
    } catch (error) {
      setErr(reasonOf(error) + " It is still here, untouched.");
    }
    setBusy(null);
    setTimeout(() => setLanded(null), 4500);
  };

  const toggleAction = (id: string) =>
    persist({
      ...data,
      actions: data.actions.map((a) =>
        a.id === id
          ? { ...a, done: !a.done, doneAt: a.done ? null : Date.now() }
          : a
      ),
    });

  const setShelf = (id: string, span: number | null, label: ShelfLife) =>
    persist({
      ...data,
      actions: data.actions.map((a) =>
        a.id === id
          ? {
              ...a,
              shelf: label,
              expires: span ? Date.now() + span : null,
              faded: false,
              fadedAt: null,
            }
          : a
      ),
    });

  const restore = (id: string) => setShelf(id, null, "keep");

  const removeNow = async (a: Action) => {
    await dropImages(a.imgs);
    persist({ ...data, actions: data.actions.filter((x) => x.id !== a.id) });
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
    await persist({
      actions: data.actions.filter((x) => x.id !== a.id),
      threads: [t, ...data.threads],
    });
    setTab("threads");
  };

  /**
   * Rewrite a thread's "Where this stands" from its current fragments.
   *
   * Called after a fragment is edited or removed: the summary is derived from
   * them, so leaving it alone would let it describe text that no longer exists.
   * A failure here is survivable — the fragments are already saved, and the
   * stale summary is better than none.
   */
  const regenerate = useCallback(
    async (board: Board, threadId: string) => {
      const target = board.threads.find((t) => t.id === threadId);
      if (!target?.frags.length) return;
      setBusy("Updating what this thread says now");
      try {
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: target.name,
            frags: target.frags.map((f) => ({ at: f.at, text: f.text })),
          }),
        });
        if (res.ok) {
          const { summary } = await res.json();
          await persist({
            ...board,
            threads: board.threads.map((t) =>
              t.id === threadId ? { ...t, summary } : t
            ),
          });
        }
      } catch {
        /* the fragments are saved; the summary can lag */
      }
      setBusy(null);
    },
    [persist]
  );

  const editActionText = (id: string, text: string) =>
    persist({
      ...data,
      actions: data.actions.map((a) => (a.id === id ? { ...a, text } : a)),
    });

  const renameThread = (id: string, name: string) =>
    persist({
      ...data,
      threads: data.threads.map((t) => (t.id === id ? { ...t, name } : t)),
    });

  const editFrag = async (threadId: string, fragId: string, text: string) => {
    const next = {
      ...data,
      threads: data.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              frags: t.frags.map((f) => (f.id === fragId ? { ...f, text } : f)),
            }
          : t
      ),
    };
    await persist(next);
    await regenerate(next, threadId);
  };

  const deleteFrag = async (threadId: string, fragId: string) => {
    const target = data.threads.find((t) => t.id === threadId);
    const frag = target?.frags.find((f) => f.id === fragId);
    await dropImages(frag?.imgs);

    const remaining = (target?.frags || []).filter((f) => f.id !== fragId);

    // A thread with nothing left in it is just a name; drop it and go back.
    if (!remaining.length) {
      await persist({
        ...data,
        threads: data.threads.filter((t) => t.id !== threadId),
      });
      setOpen(null);
      return;
    }

    const next = {
      ...data,
      threads: data.threads.map((t) =>
        t.id === threadId ? { ...t, frags: remaining } : t
      ),
    };
    await persist(next);
    await regenerate(next, threadId);
  };

  const deleteThread = async (id: string) => {
    const target = data.threads.find((t) => t.id === id);
    for (const f of target?.frags || []) await dropImages(f.imgs);
    await persist({
      ...data,
      threads: data.threads.filter((t) => t.id !== id),
    });
    setOpen(null);
  };

  /**
   * Fold `fromId` into `intoId`.
   *
   * The sorter sometimes starts a second thread for something that already had
   * one, and the two halves are no use apart. Fragments are interleaved by
   * date rather than appended, so the merged thread reads as one history, and
   * the summary is rebuilt from the whole of it. The thread you are looking at
   * keeps its name; the other one goes.
   */
  const mergeThreads = async (intoId: string, fromId: string) => {
    const into = data.threads.find((t) => t.id === intoId);
    const from = data.threads.find((t) => t.id === fromId);
    if (!into || !from) return;

    const frags = [...into.frags, ...from.frags].sort((a, b) => a.at - b.at);
    const next: Board = {
      ...data,
      threads: data.threads
        .filter((t) => t.id !== fromId)
        .map((t) => (t.id === intoId ? { ...t, frags } : t)),
    };
    await persist(next);
    setLanded(from.name + " folded into " + into.name);
    setTimeout(() => setLanded(null), 4500);
    await regenerate(next, intoId);
  };

  const live = data.actions.filter((a) => !a.done && !a.faded);
  const fadedList = data.actions.filter((a) => a.faded && !a.done);
  const done = data.actions.filter((a) => a.done);
  const active = data.threads.filter(
    (t) => now - (t.frags.at(-1)?.at || 0) < DORMANT
  );
  const resting = data.threads.filter(
    (t) => now - (t.frags.at(-1)?.at || 0) >= DORMANT
  );
  const thread = data.threads.find((t) => t.id === open);

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
      onEditText={(text) => editActionText(a.id, text)}
      onResort={() => resort(a)}
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
          <div className="capture-count">
            {live.length} open · {data.threads.length} threads
          </div>
        </div>

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
            >
              ▣
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
                ◉
              </button>
            )}
            <div className="cap-hint">
              {canDictate
                ? "or tap the mic key on your keyboard"
                : "tap the mic key on your keyboard to dictate"}
            </div>
            <button
              className="capture-btn"
              onClick={submit}
              disabled={!!busy || (!text.trim() && !pics.length)}
            >
              {busy ? "…" : "Capture"}
            </button>
          </div>
        </div>

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

        {thread ? (
          <ThreadView
            thread={thread}
            onBack={() => setOpen(null)}
            onRename={(name) => renameThread(thread.id, name)}
            onDelete={() => deleteThread(thread.id)}
            onEditFrag={(fragId, text) => editFrag(thread.id, fragId, text)}
            onDeleteFrag={(fragId) => deleteFrag(thread.id, fragId)}
            onRefresh={() => regenerate(data, thread.id)}
            others={data.threads.filter((t) => t.id !== thread.id)}
            onMerge={(fromId) => mergeThreads(thread.id, fromId)}
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

function speechRecogniser(): RecogniserCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecogniserCtor;
    webkitSpeechRecognition?: RecogniserCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
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
  busy: boolean;
}) {
  const ms = a.expires ? a.expires - now : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.text);

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
          {!editing && (
            <button className="ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {a.unsorted && !editing && (
            <button className="ghost" onClick={onResort} disabled={busy}>
              Sort now
            </button>
          )}
          {faded ? (
            <>
              <span>
                faded · clears in {left((a.fadedAt || now) + GRACE - now)}
              </span>
              <button className="ghost" onClick={onRestore}>
                Restore
              </button>
            </>
          ) : (
            !editing && (
              <button className="ghost" onClick={onMakeThread}>
                Make a thread
              </button>
            )
          )}
        </div>
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
      <button
        className={"chip" + (!ms ? " kept" : ms < DAY ? " soon" : "")}
        onClick={onShelfClick}
        aria-label="Change shelf life"
      >
        {ms === null ? "kept" : left(ms)}
      </button>
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
  onEditFrag,
  onDeleteFrag,
  onRefresh,
  others,
  onMerge,
}: {
  thread: Thread;
  onBack: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onEditFrag: (fragId: string, text: string) => void;
  onDeleteFrag: (fragId: string) => void;
  onRefresh: () => void;
  others: Thread[];
  onMerge: (fromId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(thread.name);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);

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
        <div className="act-meta" style={{ marginBottom: 16 }}>
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
          <button className="ghost" onClick={onRefresh}>
            Refresh summary
          </button>
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
          onSave={(text) => onEditFrag(f.id, text)}
          onDelete={() => onDeleteFrag(f.id)}
        />
      ))}
    </div>
  );
}

function FragView({
  f,
  onSave,
  onDelete,
}: {
  f: Frag;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [srcs, setSrcs] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(f.text);
  const [confirming, setConfirming] = useState(false);

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
          <>
            <button className="ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="ghost" onClick={() => setConfirming((v) => !v)}>
              Delete
            </button>
          </>
        )}
      </div>

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
