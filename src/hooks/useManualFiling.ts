"use client";

import { useRef, useState } from "react";
import type { Action, Board } from "@/lib/model";
import type { Tombstone } from "@/lib/sync";
import { createManualRoutingOperations } from "@/lib/manualRoutingOperations";
import {
  MANUAL_ROUTING_UNDO_KEY, parseManualRoutingUndo, undoManualRouting,
  type ManualRoutingUndo, type ManualRoutingUndoResult,
} from "@/lib/manualRoutingUndo";

type Operations = Parameters<typeof createManualRoutingOperations>[0];
type Options = Pick<Operations, "read" | "authority" | "transact" | "now"> & {
  clearPending: (action: Action) => void;
  fail: (message: string) => void;
  notice: (message: string) => void;
  receipt: (label: string) => void;
  retire: () => void;
  highlight: (ids: string[]) => void;
  tab: (tab: "actions" | "threads" | "intentions") => void;
  open: (id: string) => void;
  summarize: (id: string) => void;
};

/** The manual receipt and its inverse share one transaction identity. No model
 * correction or whole-board rollback is involved, even across a reload. */
export function useManualFiling(options: Options) {
  const [manualUndo, setRecord] = useState<ManualRoutingUndo | null>(null);
  const recordRef = useRef<ManualRoutingUndo | null>(null);
  const undoing = useRef(false);
  const setManualUndo = (record: ManualRoutingUndo | null) => {
    recordRef.current = record;
    setRecord(record);
  };
  const restoreManualReceipt = (raw: string | null, board: Board, tombstones: Tombstone[]) => {
    const record = parseManualRoutingUndo(raw);
    if (record && undoManualRouting(board, tombstones, record, options.now()).status === "applied") {
      setManualUndo(record);
      options.receipt(record.destinationLabel);
    }
  };
  const operations = () => createManualRoutingOperations({
    ...options,
    fail: (message) => { options.retire(); options.fail(message); },
    staleDestination: () => { options.retire(); options.notice("That thread is no longer here. Choose another."); },
    routingApplied: (shown, _captureId, settled, _board, record) => {
      options.clearPending(shown);
      options.fail("");
      setManualUndo(record);
      options.highlight([settled.target.id]);
      options.receipt(record.destinationLabel);
      if (settled.target.kind === "action") options.tab("actions");
      else if (settled.target.kind === "intention") options.tab("intentions");
      else {
        options.tab("threads");
        if (settled.target.created) options.open(settled.target.id);
        else options.summarize(settled.target.id);
      }
    },
    splitApplied: (shown, _captureId, settled) => {
      options.clearPending(shown);
      setManualUndo(null);
      options.highlight(settled.targetIds);
      options.receipt("Split filed");
      for (const id of settled.summaryThreadIds) options.summarize(id);
    },
  });
  const undoManual = async () => {
    const record = recordRef.current;
    if (!record || undoing.current) return false;
    undoing.current = true;
    try {
      const durable = await options.transact<ManualRoutingUndoResult>((current, tombstones) => {
        const reversed = undoManualRouting(current, tombstones, record, options.now());
        return reversed.status === "applied" ? {
          next: reversed.board, replaceTombstones: reversed.tombstones,
          entries: [[MANUAL_ROUTING_UNDO_KEY, "null"]], value: reversed,
        } : { skip: reversed };
      });
      if (recordRef.current !== record) return durable.status === "committed";
      options.retire();
      if (durable.status === "failed") {
        options.fail("Couldn't save Undo. Nothing was changed.");
        return false;
      }
      setManualUndo(null);
      if (durable.status === "skipped") {
        options.fail("That filing changed since it was filed, so Undo left it alone.");
        return false;
      }
      options.fail("");
      options.notice("Undone — back in Unsorted.");
      return true;
    } finally { undoing.current = false; }
  };
  return {
    manualSort: (...args: Parameters<ReturnType<typeof createManualRoutingOperations>["manualSort"]>) => operations().manualSort(...args),
    manualSplit: (...args: Parameters<ReturnType<typeof createManualRoutingOperations>["manualSplit"]>) => operations().manualSplit(...args),
    manualUndo, setManualUndo, restoreManualReceipt, undoManual,
  };
}
