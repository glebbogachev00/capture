import { receiptLines } from "@/lib/receiptCopy";

export function CaptureReceipt({
  receipt,
  lines,
  canUndo,
  onUndo,
}: {
  receipt: string;
  lines?: string[];
  canUndo: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="landed">
      <div className="landed-copy">
        <span className="landed-label">Capture sorted this into:</span>
        <ul className="landed-list">
          {(lines ?? receiptLines(receipt)).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
      {canUndo && (
        <button className="undo-btn" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}
