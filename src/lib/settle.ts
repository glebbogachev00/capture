import { withLedger, sourceOf, type CaptureSource } from "./ledger";
import type { Action, Board, Frag } from "./model";

/**
 * Settling a capture the sorter could not sort — one computation, one
 * result, every fact derived from the same decision.
 *
 * Before this module, the board update and the history entry were written
 * by different lines with different opinions. The board (correctly) parked
 * the words as an unsorted action; the history entry derived its kind from
 * WHICH TAB WAS VISIBLE — stand on Threads when a sort failed and the
 * record said "thread" about an event that created an action. Two records
 * of one event, telling different stories; the wrap's counts inherited the
 * lie. The audit radar found it, and its rule is now this module's rule:
 *
 *   The visible tab is not valid input to a transaction. An explicitly
 *   open thread is, because the person chose it.
 *
 * So the signature simply HAS no tab parameter — the defect is not fixed
 * here so much as made unwritable. Everything downstream (ledger kind,
 * receipt text, undo facts) derives from what the board actually did.
 *
 * The shape follows the settlement pattern (one action returns one typed
 * result; the caller applies it) adapted from Excalidraw's ActionResult
 * and tldraw's atomic history entries — pattern only, no dependency.
 */

export type Settlement = {
  board: Board;
  /** Where the capture landed, as facts the UI and tests can check. */
  target: { kind: "action" | "thread"; id: string; fragId?: string };
  /** What the receipt banner should say. */
  receipt: string;
  /** The id of the ledger entry this settlement wrote. */
  ledgerId: string;
};

export function settleUnsortedCapture(
  board: Board,
  input: {
    raw: string;
    imgIds: string[];
    at: number;
    dictated: boolean;
    /** The thread the person has OPEN — their choice, so valid input.
        Undefined means no destination was chosen by anyone. */
    openThreadId?: string;
  },
  ids: { itemId: string; ledgerId: string }
): Settlement {
  const body = input.raw || "(image only)";
  const openThread = input.openThreadId
    ? board.threads.find((t) => t.id === input.openThreadId)
    : undefined;
  const source: CaptureSource = sourceOf(
    input.raw,
    input.dictated,
    input.imgIds.length > 0
  );

  if (openThread) {
    /* An open thread IS a stated destination: the words join it as an
       unsorted fragment, and the record calls it what it is — a thread
       capture. */
    const frag: Frag = {
      id: ids.itemId,
      at: input.at,
      text: body,
      imgs: input.imgIds,
      unsorted: true,
    };
    const next = withLedger(
      {
        ...board,
        threads: board.threads.map((t) =>
          t.id === openThread.id ? { ...t, frags: [...t.frags, frag] } : t
        ),
      },
      {
        id: ids.ledgerId,
        at: input.at,
        raw: input.raw,
        clean: body,
        kind: "thread",
        source,
        targetId: openThread.id,
        targetFragId: frag.id,
        imgs: input.imgIds.length ? input.imgIds : undefined,
      }
    );
    return {
      board: next,
      target: { kind: "thread", id: openThread.id, fragId: frag.id },
      receipt: openThread.name + " — saved unsorted",
      ledgerId: ids.ledgerId,
    };
  }

  /* No chosen destination: the words park as an unsorted ACTION — flat,
     reversible, visibly marked, resortable later. A failed sort never
     invents a thread (an error path must not make structural decisions),
     and the record says "action" because an action is what exists. */
  const action: Action = {
    id: ids.itemId,
    text: body,
    done: false,
    at: input.at,
    src: body,
    imgs: input.imgIds,
    shelf: "keep",
    expires: null,
    unsorted: true,
  };
  const next = withLedger(
    { ...board, actions: [action, ...board.actions] },
    {
      id: ids.ledgerId,
      at: input.at,
      raw: input.raw,
      clean: body,
      kind: "action",
      source,
      targetId: action.id,
      imgs: input.imgIds.length ? input.imgIds : undefined,
    }
  );
  return {
    board: next,
    target: { kind: "action", id: action.id },
    /* The banner frames every receipt as "Landed in <receipt>." — this
       string must complete that sentence. The first version began "Kept
       in Actions…" and the screen read "Landed in Kept in Actions". */
    receipt: "Actions, unsorted — sort it when the model is back",
    ledgerId: ids.ledgerId,
  };
}

/**
 * Recording a SUCCESSFUL capture — the history entries for everywhere it
 * landed, and the list of threads whose descriptions are now stale.
 *
 * The board mutation itself is applySorted (boardOps); this writes the
 * account of it, and the two must describe the same event — same rule as
 * the failed-sort settlement above. The subtleties this owns:
 *
 *   - One captureId across every entry one utterance writes, so counting
 *     entries never counts destinations (a split once met the wrap's
 *     three-capture threshold by itself).
 *   - On a split, the primary entry holds only the PRIMARY'S SHARE of the
 *     words; the other shares have entries of their own. Keeping the whole
 *     sentence on the primary counted the same words in two places.
 *   - Every thread the capture reached needs its summary refreshed — not
 *     just the first. A split used to leave the secondary thread holding a
 *     fragment its own description knew nothing about.
 */

export type SortedFacts = {
  raw: string;
  payload: string;
  at: number;
  dictated: boolean;
  imgIds: string[];
  transcript?: string;
  captureId: string;
  kind: "action" | "thread" | "intention" | "both";
  clean: string;
  primaryText?: string | null;
  via?: string;
  /** Where the primary landed. */
  primary: { targetId: string; fragId?: string };
  /** Where each further split share landed. */
  also: { text: string; threadId: string; fragId?: string }[];
};

export function recordSortedCapture(
  board: Board,
  f: SortedFacts,
  mkId: () => string
): { board: Board; summaryTargets: string[] } {
  const split = f.also.length > 0 && !!f.primaryText?.trim();
  const source = sourceOf(f.payload, f.dictated, f.imgIds.length > 0);
  let next = withLedger(board, {
    id: mkId(),
    captureId: f.captureId,
    at: f.at,
    raw: f.raw,
    clean: (split ? f.primaryText!.trim() : f.clean) || f.payload,
    kind: f.kind,
    source,
    targetId: f.primary.targetId,
    targetFragId: f.primary.fragId,
    modelVia: f.via,
    transcript: f.transcript?.trim() || undefined,
    imgs: f.imgIds.length ? f.imgIds : undefined,
  });
  for (const piece of f.also) {
    next = withLedger(next, {
      id: mkId(),
      captureId: f.captureId,
      at: f.at,
      raw: f.raw,
      clean: piece.text,
      kind: "thread",
      source,
      targetId: piece.threadId,
      targetFragId: piece.fragId,
      modelVia: f.via,
    });
  }
  const summaryTargets = [
    ...new Set(
      [f.primary.targetId, ...f.also.map((p) => p.threadId)].filter(Boolean)
    ),
  ];
  return { board: next, summaryTargets };
}
