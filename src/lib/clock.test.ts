import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

async function clockAt(date: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(date);
  return import("./clock");
}

describe("wall clock", () => {
  it("ticks at the next minute boundary so a daily allowance resets at midnight", async () => {
    const start = new Date(2026, 8, 4, 23, 59, 45);
    const { clockSnapshot, subscribeToClock } = await clockAt(start);
    const changed = vi.fn();
    const unsubscribe = subscribeToClock(changed);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(changed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(changed).toHaveBeenCalledTimes(1);
    const ticked = new Date(clockSnapshot());
    expect(ticked.getDate()).toBe(start.getDate() + 1);
    expect(ticked.getHours()).toBe(0);
    expect(ticked.getMinutes()).toBe(0);
    expect(ticked.getSeconds()).toBe(0);

    unsubscribe();
  });

  it("does not leave an orphan timer when the final listener unsubscribes during a tick", async () => {
    const { subscribeToClock } = await clockAt(new Date(2026, 8, 4, 12, 0, 45));
    let unsubscribe = () => {};
    unsubscribe = subscribeToClock(() => unsubscribe());

    await vi.advanceTimersByTimeAsync(15_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates a throwing listener and keeps notifying on later ticks", async () => {
    const { subscribeToClock } = await clockAt(new Date(2026, 8, 4, 12, 0, 45));
    const good = vi.fn();
    const stopBad = subscribeToClock(() => {
      throw new Error("listener failed");
    });
    const stopGood = subscribeToClock(good);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(good).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(good).toHaveBeenCalledTimes(2);

    stopBad();
    stopGood();
  });

  it("cleans up fully and restarts on a later subscription", async () => {
    const { subscribeToClock } = await clockAt(new Date(2026, 8, 4, 12, 0, 45));
    const stop = subscribeToClock(() => {});
    stop();
    expect(vi.getTimerCount()).toBe(0);

    const changed = vi.fn();
    const stopAgain = subscribeToClock(changed);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(changed).toHaveBeenCalledTimes(1);
    stopAgain();
    expect(vi.getTimerCount()).toBe(0);
  });
});
