import { describe, expect, it } from "vitest";
import { createPoller } from "./poll";

/** A clock by hand: timers fire only when the test says so. */
function fakeTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    pending,
    setTimeout: (fn: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id: unknown) => {
      pending.delete(id as number);
    },
    /** Fire every timer that is due, once. */
    fire() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, t] of due) t.fn();
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the poll loop", () => {
  it("polls on one chain, however often start() is called mid-pull", async () => {
    const t = fakeTimers();
    let resolvePull: ((ok: boolean) => void) | null = null;
    let pulls = 0;
    const p = createPoller({
      pull: () =>
        new Promise<boolean>((r) => {
          pulls++;
          resolvePull = r;
        }),
      active: () => true,
      intervalMs: 30,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    });
    p.start();
    expect(t.pending.size).toBe(1);
    t.fire(); // the tick runs: the pull is in flight, no timer is set
    expect(pulls).toBe(1);
    expect(t.pending.size).toBe(0);
    /* The tab is hidden and shown three times while the pull is slow. */
    p.start();
    p.start();
    p.start();
    expect(t.pending.size).toBe(0);
    resolvePull!(true);
    await settle();
    /* Exactly one timer waits — one chain, not four. */
    expect(t.pending.size).toBe(1);
  });

  it("a chain stopped mid-pull ends when the pull returns", async () => {
    const t = fakeTimers();
    let resolvePull: ((ok: boolean) => void) | null = null;
    const p = createPoller({
      pull: () => new Promise<boolean>((r) => (resolvePull = r)),
      active: () => true,
      intervalMs: 30,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    });
    p.start();
    t.fire();
    p.stop();
    resolvePull!(true);
    await settle();
    expect(t.pending.size).toBe(0);
  });

  it("backs off on failure, up to the cap, and resets on success", async () => {
    const t = fakeTimers();
    let ok = false;
    const p = createPoller({
      pull: async () => ok,
      active: () => true,
      intervalMs: 30,
      maxMs: 100,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    });
    p.start();
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      t.fire();
      await settle();
      waits.push([...t.pending.values()][0].ms);
    }
    expect(waits).toEqual([60, 100, 100, 100]);
    ok = true;
    t.fire();
    await settle();
    expect([...t.pending.values()][0].ms).toBe(30);
  });

  it("lets the chain lapse when the tab is hidden, and start() revives it", async () => {
    const t = fakeTimers();
    let visible = true;
    const p = createPoller({
      pull: async () => true,
      active: () => visible,
      intervalMs: 30,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    });
    p.start();
    visible = false;
    t.fire();
    await settle();
    expect(t.pending.size).toBe(0);
    visible = true;
    p.start();
    expect(t.pending.size).toBe(1);
  });
});
