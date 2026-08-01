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
  backupFilename,
  buildBackup,
  downloadJSON,
  readJsonFile,
  restoreBackup,
} from "@/lib/backup";
import { copyToClipboard, shareText, shareableFor } from "@/lib/share";
import { search } from "@/lib/search";
import type { Draft, IoNote } from "@/app/Intentions";

/* Carries the server's explanation so the board can show it verbatim. */
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
  /* Reads as a whole sentence, unlike `landed` which is "Landed in <x>". */
  const [notice, setNotice] = useState<string | null>(null);
  const [swept, setSwept] = useState<{ faded: number; cleared: number } | null>(null);
  const [tab, setTab] = useState<"actions" | "threads" | "intentions">("actions");
  const [open, setOpen] = useState<string | null>(null);
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

  /* The latest board, read by handlers so async work never builds on stale
     state. `commit` (and the loader) are the only writers. */
  const latest = useRef<Board>(data);

  const commit = useCallback(async (next: Board) => {
    setData(next);
    latest.current = next;
    try {
      await set(KEY, JSON.stringify(next));
    } catch {
      setErr("Couldn't save that. Your last capture is still on screen — try again.");
    }
  }, []);

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
      setLoaded(true);
    })();
  }, []);

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
   * wording needs working out — pulling an action out of a fragment, say.
   */
  const requestSort = async (raw: string, force?: "action") => {
    const known = latest.current.threads.map((t) => ({
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

  /** Rewrite a thread's "Where this stands" from its current fragments. */
  const regenerate = async (board: Board, threadId: string): Promise<Board> => {
    const target = board.threads.find((t) => t.id === threadId);
    if (!target?.frags.length) return board;
    setBusy("Updating what this thread says now");
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
        await commit(result);
      }
    } catch {
      /* the fragments are saved; the summary can lag */
    }
    setBusy(null);
    return result;
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
    reason: string
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
    if (openThread) {
      next = {
        ...b,
        threads: b.threads.map((t) =>
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
      next = { ...b, threads: [fresh, ...b.threads] };
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
      setLanded("Kept unsorted");
    }

    setText("");
    setPics([]);
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
      const { next, targetId, landed } = applySorted(out, a.imgs || [], a.at, board);
      setLanded(landed);
      setTab(out.kind === "action" ? "actions" : "threads");
      await commit(next);
      if (targetId) await regenerate(next, targetId);
    } catch (error) {
      setErr(reasonOf(error) + " It is still here, untouched.");
    }
    setBusy(null);
    setTimeout(() => setLanded(null), 4500);
  };

  /** Praise be. The main capture, sorted and filed. */
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

      const { next, targetId, landed } = applySorted(
        out,
        imgIds,
        at,
        latest.current
      );
      setLanded(landed);
      setTab(out.kind === "action" ? "actions" : "threads");
      setText("");
      setPics([]);
      await commit(next);
      if (targetId) await regenerate(next, targetId);
    } catch (error) {
      await saveUnsorted(raw, imgIds, at, reasonOf(error));
    }

    setBusy(null);
    setTimeout(() => setLanded(null), 4500);
  };

  /* ---------------------------- actions ----------------------------- */

  const toggleAction = (id: string) =>
    commit({
      ...latest.current,
      actions: latest.current.actions.map((a) =>
        a.id === id
          ? { ...a, done: !a.done, doneAt: a.done ? null : stamp() }
          : a
      ),
    });

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

  /* ---------------------------- threads ----------------------------- */

  const editActionText = (id: string, text: string) =>
    commit({
      ...latest.current,
      actions: latest.current.actions.map((a) => (a.id === id ? { ...a, text } : a)),
    });

  const renameThread = (id: string, name: string) =>
    commit({
      ...latest.current,
      threads: latest.current.threads.map((t) => (t.id === id ? { ...t, name } : t)),
    });

  const editFrag = async (threadId: string, fragId: string, text: string) => {
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
    await regenerate(next, threadId);
  };

  const deleteFrag = async (threadId: string, fragId: string) => {
    const target = latest.current.threads.find((t) => t.id === threadId);
    const frag = target?.frags.find((f) => f.id === fragId);
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
      await commit({
        ...latest.current,
        actions: [...items, ...latest.current.actions],
      });
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
          principles: latest.current.principles,
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
    await commit({
      ...latest.current,
      intentions: [intention, ...latest.current.intentions],
    });
    setDraft(null);
    setTab("intentions");
    setNotice("Intention " + pad(intention.number) + " set.");
    setTimeout(() => setNotice(null), 4500);
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

  /** Turn an action or a thread into an intention when the sort missed it. */
  const makeIntention = async (rawInput: string, remove: () => Board) => {
    try {
      await expandIntention(rawInput);
      await commit(remove());
    } catch (error) {
      setErr(reasonOf(error) + " Nothing was moved.");
    }
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
      await commit(result.board);
      const added =
        result.actions +
        result.threads +
        result.intentions +
        result.principles;
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
      await commit(result.board);

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

  /* --------------------------- derivations -------------------------- */

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
  const hits = search(data, debouncedQuery);
  const searching = debouncedQuery.trim().length > 0;

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
    notice,
    swept,
    tab,
    setTab,
    open,
    setOpen,
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
    expandIntention,
    saveDraft,
    updateIntention,
    deleteIntention,
    makeIntention,
    togglePrinciple,
    addPrinciple,
    deletePrinciple,
    exportBoard,
    restoreFromFile,
    importBackup,
    doShare,
  };
}
