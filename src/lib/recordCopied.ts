/**
 * When the record was last handed to an agent, per device.
 *
 * What this browser's person already copied out is a fact about this
 * browser, so it lives in localStorage and never syncs.
 *
 * It is read through a store rather than copied into state by an effect.
 * The effect version set state on every open of the record, which React
 * flags because it can cascade renders — and it also only re-read on open,
 * so a second tab that copied the record left this one showing a stale
 * time until it was reopened. Subscribing to `storage` fixes both: the
 * value is read where it is used, and another tab's copy arrives here.
 */

export const RECORD_COPIED_KEY = "capture:record-copied:v1";

/* getSnapshot must return the same value until something actually changes,
   or React re-renders forever. The parsed number is cached against the raw
   string it came from. */
let cachedRaw: string | null = null;
let cachedAt: number | null = null;

function read(): number | null {
  try {
    const raw = localStorage.getItem(RECORD_COPIED_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedAt = raw ? Number(raw) : null;
    }
    return cachedAt;
  } catch {
    /* Private mode, or storage disabled: never copied, as far as we know. */
    return null;
  }
}

const listeners = new Set<() => void>();

function announce() {
  for (const l of listeners) l();
}

export function subscribeRecordCopied(onChange: () => void): () => void {
  listeners.add(onChange);
  /* Another tab stamping it fires `storage` here; our own writes do not, so
     `stampRecordCopied` announces them itself. */
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function recordCopiedAt(): number | null {
  return read();
}

/** The server has no localStorage, and nothing has been copied there. */
export function recordCopiedAtOnServer(): number | null {
  return null;
}

/** Stamp it now, and tell this tab — `storage` only reaches the others. */
export function stampRecordCopied(at: number): void {
  try {
    localStorage.setItem(RECORD_COPIED_KEY, String(at));
  } catch {
    /* Nothing to do: the stamp is a convenience, not a record. */
  }
  announce();
}
