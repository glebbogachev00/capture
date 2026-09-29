import { receiptLines } from "@/lib/receiptCopy";
import type { Action } from "@/lib/model";

export function CaptureReceipt({
  receipt,
  lines,
  canUndo,
  onUndo,
  error = "",
  pending,
  pendingReceipt = false,
  canUndoManual = false,
  onChoosePlace,
  onUndoManual,
}: {
  receipt: string | null;
  lines?: string[];
  canUndo: boolean;
  onUndo: () => unknown;
  error?: string;
  pending?: Action;
  pendingReceipt?: boolean;
  canUndoManual?: boolean;
  onChoosePlace?: (action: Action, trigger: HTMLButtonElement) => void;
  onUndoManual?: () => unknown;
}) {
  if (error) return <div className="err capture-receipt" role="alert">
    <span>{error}</span>
    {canUndoManual && error === "Couldn't save Undo. Nothing was changed." &&
      <button className="ghost" onClick={() => void onUndoManual?.()}>Retry Undo</button>}
  </div>;
  if (!receipt) return null;
  return (
    <div className={`landed capture-receipt${pendingReceipt ? " pending-receipt" : ""}`} role="status">
      {pendingReceipt || receipt === "Split filed" ? <span>{receipt}</span> : canUndoManual ? <span>Landed in <em>{receipt}</em>.</span> : <div className="landed-copy">
        <span className="landed-label">Capture sorted this into:</span>
        <ul className="landed-list">
          {(lines ?? receiptLines(receipt)).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>}
      {pending && <button className="receipt-place-btn" onClick={(event) =>
        onChoosePlace?.(pending, event.currentTarget)}>Choose a place</button>}
      {(canUndoManual || canUndo) && (
        <button className="undo-btn" onClick={() => void (canUndoManual ? onUndoManual?.() : onUndo())}>
          Undo
        </button>
      )}
    </div>
  );
}
