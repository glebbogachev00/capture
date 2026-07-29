/**
 * The wall clock, as an external store.
 *
 * Shelf-life countdowns are derived from "now", so reading Date.now() during
 * render would make the render impure — and would only ever refresh when
 * something unrelated re-rendered. Ticking once a minute through
 * useSyncExternalStore keeps render pure and makes the countdowns move on
 * their own.
 */

let value = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const TICK = 60_000;

export function subscribeToClock(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    timer = setInterval(() => {
      value = Date.now();
      listeners.forEach((l) => l());
    }, TICK);
  }
  return () => {
    listeners.delete(onChange);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Stable between ticks, so React doesn't see a new value every render. */
export const clockSnapshot = () => value;

/** Prerender has no meaningful clock; the client re-renders with the real one. */
export const clockServerSnapshot = () => 0;

/**
 * Feature detection that survives SSR. The value never actually changes, so
 * the subscribe is a no-op — this exists to keep the read out of render.
 */
const noopSubscribe = () => () => {};

export const capability = {
  subscribe: noopSubscribe,
};
