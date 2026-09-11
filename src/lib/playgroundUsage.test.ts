import { describe, expect, it, vi } from "vitest";
import { createPlaygroundUsage } from "./playgroundUsage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("playground usage", () => {
  it("counts a first activation once, only after a capture lands", () => {
    const emit = vi.fn();
    const usage = createPlaygroundUsage({ enabled: true, emit, storage: memoryStorage() });

    usage.captureSorted("cerebras");
    usage.captureSorted("groq");

    expect(emit.mock.calls).toEqual([
      ["capture_sorted", { provider: "cerebras" }],
      ["first_capture_sorted", { provider: "cerebras" }],
      ["capture_sorted", { provider: "groq" }],
    ]);
  });

  it("sends only bounded categories and never a raw failure message", () => {
    const emit = vi.fn();
    const usage = createPlaygroundUsage({ enabled: true, emit, storage: memoryStorage() });

    usage.captureFailed("Too many requests. Try again in 40s.");
    usage.captureFailed("fetch failed");
    usage.captureFailed("secret provider detail");
    usage.trialLimitReached();

    expect(emit.mock.calls).toEqual([
      ["capture_sort_failed", { reason: "busy" }],
      ["capture_sort_failed", { reason: "offline" }],
      ["capture_sort_failed", { reason: "other" }],
      ["trial_limit_reached"],
    ]);
  });

  it("does nothing outside the public playground", () => {
    const emit = vi.fn();
    const usage = createPlaygroundUsage({ enabled: false, emit, storage: memoryStorage() });

    usage.captureSorted("cerebras");
    usage.captureFailed("fetch failed");
    usage.trialLimitReached();

    expect(emit).not.toHaveBeenCalled();
  });

  it("normalizes unknown providers instead of leaking arbitrary values", () => {
    const emit = vi.fn();
    const usage = createPlaygroundUsage({ enabled: true, emit, storage: memoryStorage() });

    usage.captureSorted("provider-token-123");

    expect(emit).toHaveBeenCalledWith("capture_sorted", { provider: "unknown" });
  });
});
