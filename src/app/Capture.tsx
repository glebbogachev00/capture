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

  const submit = async () => {
    const raw = text.trim();
    if (!raw && !pics.length) return;
    setErr("");
    setSwept(null);
    setBusy("Sorting");

    try {
      const known = data.threads.map((t) => ({
        id: t.id,
        name: t.name,
        about: t.summary?.slice(0, 160) || "",
      }));
      const res = await fetch("/api/sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: raw || "(image only)", threads: known }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new SortError(body.error);
      }
      const out = await res.json();

      const now = Date.now();
      const imgIds: string[] = [];
      for (const p of pics) {
        try {
          await set(IMG(p.id), p.src);
          imgIds.push(p.id);
        } catch {
          /* skip */
        }
      }

      let next: Board;
      let targetId: string | null = null;

      if (out.kind === "action") {
        const span = SHELF[out.shelfLife as ShelfLife] ?? null;
        const items: Action[] = (
          out.actions?.length ? out.actions : [out.title]
        ).map((t: string) => ({
          id: uid(),
          text: t,
          done: false,
          at: now,
          src: out.clean,
          imgs: imgIds,
          shelf: (out.shelfLife || "keep") as ShelfLife,
          expires: span ? now + span : null,
        }));
        next = { ...data, actions: [...items, ...data.actions] };
        setLanded(
          items.length +
            " action" +
            (items.length > 1 ? "s" : "") +
            (span ? " · fades in " + left(span) : " · kept")
        );
        setTab("actions");
      } else {
        const frag: Frag = { id: uid(), at: now, text: out.clean, imgs: imgIds };
        const existing = data.threads.find((x) => x.id === out.threadId);
        let threads: Thread[];
        if (existing) {
          targetId = existing.id;
          threads = data.threads.map((x) =>
            x.id === existing.id ? { ...x, frags: [...x.frags, frag] } : x
          );
        } else {
          const fresh: Thread = {
            id: uid(),
            name: out.threadName || out.title,
            summary: "",
            frags: [frag],
          };
          targetId = fresh.id;
          threads = [fresh, ...data.threads];
        }
        next = { ...data, threads };
        setLanded(
          (existing?.name || out.threadName || out.title) + " — thread updated"
        );
        setTab("threads");
      }

      setText("");
      setPics([]);
      await persist(next);

      if (targetId) {
        setBusy("Updating what this thread says now");
        const target = next.threads.find((x) => x.id === targetId)!;
        const sres = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: target.name,
            frags: target.frags.map((f) => ({ at: f.at, text: f.text })),
          }),
        });
        if (sres.ok) {
          const { summary } = await sres.json();
          await persist({
            ...next,
            threads: next.threads.map((x) =>
              x.id === targetId ? { ...x, summary } : x
            ),
          });
        }
      }
    } catch (error) {
      const reason =
        error instanceof SortError && error.message
          ? error.message
          : "The sort didn't go through.";
      setErr(reason + " Your text is still in the box — hit Capture again.");
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
          <div>
            <button className="back" onClick={() => setOpen(null)}>
              ← all threads
            </button>
            <div className="tname" style={{ fontSize: 26, marginBottom: 14 }}>
              {thread.name}
            </div>
            {thread.summary && (
              <div className="state">
                <h4>Where this stands</h4>
                <p>{thread.summary}</p>
              </div>
            )}
            {[...thread.frags].reverse().map((f) => (
              <FragView key={f.id} f={f} />
            ))}
          </div>
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
}) {
  const ms = a.expires ? a.expires - now : null;
  return (
    <div className={"act" + (faded ? " is-faded" : "")}>
      <button className="box" onClick={onToggle} aria-label="Mark done" />
      <div className="act-body">
        <div className="act-text">{a.text}</div>
        <div className="act-meta">
          <span>{fmt(a.at)}</span>
          {faded ? (
            <>
              <span>
                faded · clears in {left((a.fadedAt || now) + GRACE - now)}
              </span>
              <button className="ghost" onClick={onRestore}>
                restore
              </button>
            </>
          ) : (
            <button className="ghost" onClick={onMakeThread}>
              → make a thread
            </button>
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

function FragView({ f }: { f: Frag }) {
  const [srcs, setSrcs] = useState<string[]>([]);
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
      <div className="frag-date">{fmt(f.at)}</div>
      <p>{f.text}</p>
      {srcs.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={s} alt="" />
      ))}
    </div>
  );
}
