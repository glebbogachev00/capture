import { afterEach, describe, expect, it, vi } from "vitest";
import { ASK_AFTER_MS, Reachability } from "./reachability";

afterEach(() => vi.useRealTimers());

describe("can this device reach the server that sorts", () => {
  it("counts any answer, even an error, as reachable, and no answer as unreachable", async () => {
    const answering = new Reachability(async () => new Response(null, { status: 503 }));
    expect(await answering.check()).toBe(true);
    expect(answering.isDown()).toBe(false);
    const silent = new Reachability(async () => { throw new TypeError("The network connection was lost."); });
    expect(await silent.check()).toBe(false);
    expect(silent.isDown()).toBe(true);
  });

  it("asks the tiny, never-cached version route", async () => {
    const request = vi.fn(async () => new Response("{}"));
    await new Reachability(request).check();
    expect(request).toHaveBeenCalledWith("/api/version", expect.objectContaining({ cache: "no-store" }));
  });

  it("while a sort runs, says unreachable only when the server is silent after a few seconds", async () => {
    vi.useFakeTimers();
    const silent = new Reachability(async () => { throw new TypeError("lost"); });
    const unreachable = vi.fn();
    silent.watch(unreachable);
    await vi.advanceTimersByTimeAsync(ASK_AFTER_MS - 1);
    expect(unreachable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(unreachable).toHaveBeenCalledTimes(1);

    const alive = new Reachability(async () => new Response("{}"));
    const slowButThere = vi.fn();
    alive.watch(slowButThere);
    await vi.advanceTimersByTimeAsync(ASK_AFTER_MS + 10);
    expect(slowButThere).not.toHaveBeenCalled();
  });

  it("does nothing once the sort has answered", async () => {
    vi.useFakeTimers();
    const silent = new Reachability(async () => { throw new TypeError("lost"); });
    const unreachable = vi.fn();
    silent.watch(unreachable)();
    await vi.advanceTimersByTimeAsync(ASK_AFTER_MS * 2);
    expect(unreachable).not.toHaveBeenCalled();
  });
});
