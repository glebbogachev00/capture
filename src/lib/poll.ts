/**
 * The poll loop, as a thing on its own.
 *
 * One chain at a time. The timer id is null while a pull is in flight, so
 * it cannot say whether a chain exists; `alive` can. A chain that was
 * stopped mid-pull ends when the pull returns. Start while a chain exists
 * does nothing — which is the whole point: a hide/show or an online event
 * arriving during a pull used to open a second chain, and each one polled
 * the hub forever. Timers are injectable so the loop can be tested without
 * a clock.
 */
export type Poller = { start: () => void; stop: () => void };

export function createPoller(opts: {
  pull: () => Promise<boolean>;
  /** Whether a chain may go on after a pull: visible and online. */
  active: () => boolean;
  intervalMs?: number;
  maxMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}): Poller {
  const interval = opts.intervalMs ?? 30_000;
  const max = opts.maxMs ?? 5 * 60_000;
  const set = opts.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clear =
    opts.clearTimeout ??
    ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
  let id: unknown = null;
  let alive = false;
  let wait = interval;
  const tick = async () => {
    id = null;
    const ok = await opts.pull();
    if (!alive) return;
    /* A failed pull doubles the wait, up to the cap: a hub that is down
       does not need to be asked again in thirty seconds. */
    wait = ok ? interval : Math.min(wait * 2, max);
    if (opts.active()) id = set(() => void tick(), wait);
    else alive = false;
  };
  return {
    start() {
      if (alive) return;
      alive = true;
      wait = interval;
      id = set(() => void tick(), wait);
    },
    stop() {
      alive = false;
      if (id === null) return;
      clear(id);
      id = null;
    },
  };
}
