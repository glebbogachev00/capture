/**
 * When to actually push — the little state machine that must not drop.
 *
 * The hook had a debounce timer and a `syncing` flag, and the gap between
 * them was a real race: an edit made DURING an in-flight push scheduled
 * the timer, the timer fired into `if (syncing) return`, and the edit's
 * push was silently dropped — it reached the hub only when some later
 * activity happened to push again. On a phone that gets pocketed right
 * after a capture, "later" can be hours.
 *
 * The governor closes the gap with one word of state: a request that
 * arrives while a run is in flight becomes PENDING, and a finishing run
 * re-schedules if anything is pending. Nothing waits on nothing, nothing
 * drops, bursts still coalesce.
 */

export type PushGovernor = {
  /** An edit happened: push soon (coalescing bursts). */
  schedule: () => void;
  /** Push NOW if anything is scheduled or in flight — the manual sync. */
  flush: () => Promise<void>;
};

export function createPushGovernor(
  run: () => Promise<void>,
  delayMs = 1200,
  setT: (fn: () => void, ms: number) => unknown = (fn, ms) =>
    setTimeout(fn, ms),
  clearT: (id: unknown) => void = (id) =>
    clearTimeout(id as ReturnType<typeof setTimeout>)
): PushGovernor {
  let timer: unknown = null;
  let running = false;
  let pending = false;

  const fire = async (): Promise<void> => {
    timer = null;
    if (running) {
      /* The race, caught instead of dropped: remember, and the running
         push re-schedules on its way out. */
      pending = true;
      return;
    }
    running = true;
    try {
      await run();
    } finally {
      running = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  };

  const schedule = (): void => {
    if (timer !== null) return;
    timer = setT(() => void fire(), delayMs);
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
    await fire();
  };

  return { schedule, flush };
}
