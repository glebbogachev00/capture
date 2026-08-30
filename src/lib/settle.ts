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
    receipt: "Kept in Actions, unsorted — sort it when the model is back",
    ledgerId: ids.ledgerId,
  };
}
