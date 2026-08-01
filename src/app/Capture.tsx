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
import { Copy, Image as ImageIcon, Mic, MoreHorizontal, Share2, Settings } from "lucide-react";
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
  type Intention,
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
  hydrate,
  left,
  nextNumber,
  pad,
  sweep,
  uid,
} from "@/lib/model";
import {
  type Draft,
  type IoNote,
  IntentionCard,
  IntentionDetail,
  IntentionDraft,
  SettingsScreen,
} from "./Intentions";
import { importIntentBackup } from "@/lib/importIntent";
import {
  backupFilename,
  buildBackup,
  downloadJSON,
  readJsonFile,
  restoreBackup,
} from "@/lib/backup";
import {
  copyToClipboard,
  shareIntention,
  shareText,
  shareThread,
  shareableFor,
} from "@/lib/share";
import { type Hits, search } from "@/lib/search";

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

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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
  /* Reads as a whole sentence, unlike `landed` which is "Landed in <x>". */
  const [notice, setNotice] = useState<string | null>(null);
  const [swept, setSwept] = useState<{ faded: number; cleared: number } | null>(
    null
  );
  const [tab, setTab] = useState<"actions" | "threads" | "intentions">(
    "actions"
  );
  const [open, setOpen] = useState<string | null>(null);
  const [openIntention, setOpenIntention] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [ioNote, setIoNote] = useState<IoNote>(null);
  const [editing, setEditing] = useState<{ id: string; src: string } | null>(
    null
  );
  const [shelfFor, setShelfFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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
        // hydrate fills in intentions/principles for boards written before
        // they existed, so an older save still opens.
        if (raw) d = hydrate(JSON.parse(raw));
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

  /**
   * Ask the server to sort a capture. Throws SortError with the reason.
   *
   * `force` is for when the destination is already decided and only the
   * wording needs working out — pulling an action out of a fragment, say.
   */
  const requestSort = async (raw: string, force?: "action") => {
    const known = data.threads.map((t) => ({
      id: t.id,
      name: t.name,
      about: t.summary?.slice(0, 160) || "",
    }));
    const res = await fetch("/api/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw, threads: known, force }),
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

      // An intention is declared rather than filed, so it takes a second
      // pass through its own engine and stops at a review step instead of
      // landing on the board.
      if (out.kind === "intention") {
        setText("");
        setPics([]);
        await expandIntention(raw);
        setTimeout(() => setLanded(null), 4500);
        return;
      }

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
      ...data,
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
    async (board: Board, threadId: string): Promise<Board> => {
      const target = board.threads.find((t) => t.id === threadId);
      if (!target?.frags.length) return board;
      setBusy("Updating what this thread says now");
      // Returns the board it persisted so two of these can be chained without
      // the second undoing the first — moving a fragment re-summarises both
      // threads, and each needs to build on the other's result.
      let result = board;
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
          result = {
            ...board,
            threads: board.threads.map((t) =>
              t.id === threadId ? { ...t, summary } : t
            ),
          };
          await persist(result);
        }
      } catch {
        /* the fragments are saved; the summary can lag */
      }
      setBusy(null);
      return result;
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

  /**
   * Move one fragment to another thread.
   *
   * The sorter puts a fragment on the wrong thread often enough that the only
   * remedy being "delete it and say it again" was a real loss. Both threads
   * are re-summarised afterwards, because the sentence describing each of them
   * is now describing a set of fragments that changed.
   */
  const moveFrag = async (fromId: string, fragId: string, toId: string) => {
    const from = data.threads.find((t) => t.id === fromId);
    const frag = from?.frags.find((f) => f.id === fragId);
    if (!from || !frag) return;

    const remaining = from.frags.filter((f) => f.id !== fragId);
    const to = data.threads.find((t) => t.id === toId);
    if (!to) return;

    let threads = data.threads.map((t) =>
      t.id === toId
        ? { ...t, frags: [...t.frags, frag].sort((a, b) => a.at - b.at) }
        : t
    );

    // Taking the last fragment out leaves a thread that is only a name.
    const emptied = remaining.length === 0;
    threads = emptied
      ? threads.filter((t) => t.id !== fromId)
      : threads.map((t) => (t.id === fromId ? { ...t, frags: remaining } : t));

    const next = { ...data, threads };
    await persist(next);
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
    const from = data.threads.find((t) => t.id === fromId);
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
        ? data.threads.filter((t) => t.id !== fromId)
        : data.threads.map((t) =>
            t.id === fromId ? { ...t, frags: remaining } : t
          )),
    ];
    const next = { ...data, threads };
    await persist(next);
    setOpen(fresh.id);
    setNotice(`Split into a new thread. Rename it if the name is wrong.`);
    setTimeout(() => setNotice(null), 5000);

    const afterNew = await regenerate(next, fresh.id);
    if (!emptied) await regenerate(afterNew, fromId);
  };

  const copyFragment = async (threadId: string, fragId: string) => {
    const frag = data.threads
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
   * would leave a hole in it — you thought it, the thread should still say so.
   * The sort route does the extracting, so what arrives is a clean imperative
   * with a shelf life rather than a paragraph with a checkbox.
   */
  const extractAction = async (threadId: string, fragId: string) => {
    const frag = data.threads
      .find((t) => t.id === threadId)
      ?.frags.find((f) => f.id === fragId);
    if (!frag) return;

    setErr("");
    setBusy("Finding the action");
    try {
      const out = await requestSort(frag.text, "action");
      const items: Action[] = (
        out.actions?.length ? out.actions : [out.title]
      ).map((t: string) => {
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
      });
      await persist({ ...data, actions: [...items, ...data.actions] });
      setNotice(
        `${count(items.length, "action")} taken from this note. The note stays here.`
      );
      setTimeout(() => setNotice(null), 5000);
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was added.");
    }
    setBusy(null);
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
    setNotice(from.name + " folded into " + into.name + ".");
    setTimeout(() => setNotice(null), 4500);
    await regenerate(next, intoId);
  };

  /* ---------------- intentions ---------------- */

  /** Run raw words through the intention engine and open the review step. */
  const expandIntention = async (rawInput: string) => {
    setErr("");
    setBusy("Finding the intention");
    try {
      const res = await fetch("/api/intention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "expand",
          rawInput,
          principles: data.principles,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new SortError(body.error);
      }
      const out = await res.json();
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

  /** Rewrite a draft or a saved intention from a spoken direction. */
  const saveDraft = async () => {
    if (!draft) return;
    const at = stamp();
    const intention: Intention = {
      id: uid(),
      number: nextNumber(data.intentions),
      rawInput: draft.rawInput,
      expandedIntention: draft.expandedIntention,
      recommendedActions: draft.recommendedActions,
      counterIntentions: draft.counterIntentions,
      at,
      updatedAt: at,
    };
    await persist({ ...data, intentions: [intention, ...data.intentions] });
    setDraft(null);
    setTab("intentions");
    setNotice("Intention " + pad(intention.number) + " set.");
    setTimeout(() => setNotice(null), 4500);
  };

  const updateIntention = (next: Intention) =>
    persist({
      ...data,
      intentions: data.intentions.map((i) =>
        i.id === next.id ? { ...next, updatedAt: stamp() } : i
      ),
    });

  const deleteIntention = async (id: string) => {
    await persist({
      ...data,
      intentions: data.intentions.filter((i) => i.id !== id),
    });
    setOpenIntention(null);
  };

  /** Turn an action or a thread into an intention when the sort missed it. */
  const makeIntention = async (rawInput: string, remove: () => Board) => {
    try {
      await expandIntention(rawInput);
      await persist(remove());
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was moved.");
    }
  };

  /* ---------------- principles ---------------- */

  const togglePrinciple = (id: string) =>
    persist({
      ...data,
      principles: data.principles.map((p) =>
        p.id === id ? { ...p, enabled: !p.enabled } : p
      ),
    });

  const addPrinciple = (name: string, description: string) =>
    persist({
      ...data,
      principles: [
        ...data.principles,
        { id: uid(), name, description, enabled: true },
      ],
    });

  const deletePrinciple = (id: string) =>
    persist({
      ...data,
      principles: data.principles.filter((p) => p.id !== id),
    });

  /* ---------------- sharing ---------------- */

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

  /* ---------------- getting data in and out ---------------- */

  const exportBoard = () => {
    try {
      downloadJSON(buildBackup(data), backupFilename());
      setIoNote({
        text: `Saved ${count(data.actions.length, "action")}, ${count(data.threads.length, "thread")} and ${count(data.intentions.length, "intention")} to a file. Keep it somewhere that isn't this phone.`,
        ok: true,
      });
    } catch {
      setIoNote({ text: "The download didn't start.", ok: false });
    }
  };

  const restoreFromFile = async (file: File) => {
    setIoNote(null);
    try {
      const result = restoreBackup(await readJsonFile(file), data);
      await persist(result.board);
      const added =
        result.actions + result.threads + result.intentions + result.principles;
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
      const result = importIntentBackup(await readJsonFile(file), data);
      await persist(result.board);

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
      // Nothing arriving is a failure worth shouting about, not a tidy result.
      setIoNote({ text: parts.join(" · ") + ".", ok: result.added > 0 });
    } catch (error) {
      setIoNote({
        text:
          error instanceof Error ? error.message : "Could not read that file.",
        ok: false,
      });
    }
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
  const intention = data.intentions.find((i) => i.id === openIntention);
  /* A query replaces the tabs entirely — what you want is the thing, not the
     tab it happens to live on. */
  const hits = search(data, query);
  const searching = query.trim().length > 0;

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
      onMakeIntention={() =>
        makeIntention(a.src || a.text, () => ({
          ...data,
          actions: data.actions.filter((x) => x.id !== a.id),
        }))
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
            ioNote={ioNote}
          />
        ) : draft ? (
          <IntentionDraft
            draft={draft}
            busy={!!busy}
            onChange={setDraft}
            onSave={saveDraft}
            onDiscard={() => setDraft(null)}
          />
        ) : intention ? (
          <IntentionDetail
            intention={intention}
            busy={!!busy}
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
