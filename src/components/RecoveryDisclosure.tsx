import { Minus, Plus } from "lucide-react";

/** One quiet disclosure language; the caller retains collection behavior. */
export function RecoveryDisclosure({ label, count, expanded, controls, onToggle }: {
  label: string;
  count: number;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const Indicator = expanded ? Minus : Plus;
  return <button className="unsorted-summary" type="button" aria-label={`${label} ${count}`}
    aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
    <span className="unsorted-title-label">{label}</span>
    <b className="unsorted-count">{count}</b>
    <Indicator className="unsorted-indicator" size={13} strokeWidth={1.8} aria-hidden="true" />
  </button>;
}
