import { describe, expect, it, vi } from "vitest";
import { createPushGovernor } from "./pushGovernor";

/** Manual timers, so the race can be staged deterministically. */
function clock() {
  let queue: { fn: () => void; at: number }[] = [];
  let now = 0;
  return {
    set: (fn: () => void, ms: number) => {
      const t = { fn, at: now + ms };
      queue.push(t);
      return t;
    },
    clear: (id: unknown) => {
      queue = queue.filter((t) => t !== id);
    },
    async advance(ms: number) {
      now += ms;
      const due = queue.filter((t) => t.at <= now);
      queue = queue.filter((t) => t.at > now);
      for (const t of due) t.fn();
      /* let promise chains settle */
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("the push governor never drops an edit", () => {
  it("gate 5: an edit made during an in-flight push still drains to the hub", async () => {
    /* The exact shipped race: push A in flight, edit B schedules, the
       timer fires into the busy guard. Before the governor, B's push was
       silently dropped; now it runs the moment A finishes. */
    const c = clock();
    let finishA!: () => void;
    const pushes: number[] = [];
    let n = 0;
    const g = createPushGovernor(
      () => {
        const id = ++n;
        pushes.push(id);
        return id === 1
          ? new Promise<void>((r) => (finishA = r))
          : Promise.resolve();
      },
      1200,
      c.set,
      c.clear
    );

    g.schedule();
    await c.advance(1200); // push A departs and hangs
    expect(pushes).toEqual([1]);

    g.schedule(); // the edit made while A is in flight
    await c.advance(1200); // its timer fires into the busy run
    expect(pushes).toEqual([1]); // not dropped — held as pending

    finishA();
    await Promise.resolve();
    await c.advance(1200); // the re-scheduled push fires
    expect(pushes).toEqual([1, 2]); // B drained
  });

  it("bursts still coalesce into one push", async () => {
    const c = clock();
    const pushes: number[] = [];
    const g = createPushGovernor(async () => void pushes.push(1), 1200, c.set, c.clear);
    g.schedule();
    g.schedule();
    g.schedule();
    await c.advance(1200);
    expect(pushes).toHaveLength(1);
  });

  it("flush pushes immediately and cancels the timer", async () => {
    const c = clock();
    const pushes: number[] = [];
    const g = createPushGovernor(async () => void pushes.push(1), 1200, c.set, c.clear);
    g.schedule();
    await g.flush();
    expect(pushes).toHaveLength(1);
    await c.advance(1200);
    expect(pushes).toHaveLength(1); // the cancelled timer never double-fires
  });

  it("a failing push does not wedge the governor", async () => {
    const c = clock();
    let calls = 0;
    const g = createPushGovernor(
      async () => {
        calls++;
        if (calls === 1) throw new Error("hub unreachable");
      },
      1200,
      c.set,
      c.clear
    );
    g.schedule();
    await c.advance(1200);
    g.schedule();
    await c.advance(1200);
    expect(calls).toBe(2);
  });
});
