import { describe, expect, it, vi } from "vitest";
import { PlannedSortAuthority } from "./plannedSortAuthority";

describe("planned sort authority", () => {
  it("keeps authority owner-bound so an older operation cannot release a newer claim", () => {
    const authority = new PlannedSortAuthority();
    const owner = authority.claim("capture");
    expect(owner).toBeTruthy();
    expect(authority.claim("capture")).toBeNull();
    expect(authority.release("capture", Symbol("other operation"))).toBe(false);
    expect(authority.claimed("capture")).toBe(true);
    expect(authority.release("capture", owner!)).toBe(true);
    expect(authority.claimed("capture")).toBe(false);
  });

  it("finishing a model attempt cannot clear a manual operation's claim", () => {
    vi.useFakeTimers();
    try {
      const authority = new PlannedSortAuthority();
      const attempt = authority.begin("capture", 55_000);
      const owner = authority.claim("capture");
      expect(owner).toBeTruthy();
      attempt.finish();
      expect(authority.claimed("capture")).toBe(true);
      expect(authority.release("capture", owner!)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a manual claim acquired first permanently defeat automatic finalization", () => {
    const authority = new PlannedSortAuthority();
    const attempt = authority.begin("capture", 55_000);

    const manual = authority.claim("capture");

    expect(manual).toBeTruthy();
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.claimFinalization()).toBeNull();
    expect(authority.release("capture", manual!)).toBe(true);
  });

  it("locks manual controls once automatic finalization starts", () => {
    const phases: string[][] = [];
    const authority = new PlannedSortAuthority((ids) => phases.push(ids));
    const attempt = authority.begin("capture", 55_000);

    const finalization = attempt.claimFinalization();

    expect(finalization).toBeTruthy();
    expect(authority.finalizing("capture")).toBe(true);
    expect(authority.claim("capture")).toBeNull();
    expect(phases.at(-1)).toEqual(["capture"]);
    finalization!.finish(true);
    expect(authority.finalizing("capture")).toBe(false);
    expect(phases.at(-1)).toEqual([]);
  });

  it("does not let the operation timeout revoke a commit phase already claimed", async () => {
    vi.useFakeTimers();
    try {
      const authority = new PlannedSortAuthority();
      const attempt = authority.begin("capture", 55_000);
      const finalization = attempt.claimFinalization();
      expect(finalization).toBeTruthy();

      await vi.advanceTimersByTimeAsync(55_000);

      expect(attempt.signal.aborted).toBe(false);
      expect(finalization!.current()).toBe(true);
      expect(authority.claim("capture")).toBeNull();
      finalization!.finish(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a second automatic attempt steal an active finalization phase", () => {
    const authority = new PlannedSortAuthority();
    const first = authority.begin("capture", 55_000);
    const finalization = first.claimFinalization()!;

    const second = authority.begin("capture", 55_000);

    expect(second.signal.aborted).toBe(true);
    expect(second.authoritative()).toBe(false);
    expect(second.claimFinalization()).toBeNull();
    expect(finalization.current()).toBe(true);
    finalization.finish(true);
  });

  it("claims a capture, cancels its request, and releases only by its owner", () => {
    vi.useFakeTimers();
    try {
      const authority = new PlannedSortAuthority();
      const attempt = authority.begin("capture", 55_000);
      const owner = authority.claim("capture");
      expect(authority.claimed("capture")).toBe(true);
      expect(authority.cancel("capture")).toBe(true);
      expect(attempt.signal.aborted).toBe(true);
      expect(authority.release("capture", owner!)).toBe(true);
      attempt.finish();
      expect(authority.claimed("capture")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hard-bounds work even when the request promise ignores AbortSignal", async () => {
    vi.useFakeTimers();
    try {
      const authority = new PlannedSortAuthority();
      const attempt = authority.begin("capture", 55_000);
      const ignoredAbort = new Promise<string>(() => {});
      const bounded = attempt.run(ignoredAbort);
      const rejected = expect(bounded).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(55_000);
      await rejected;
      expect(attempt.signal.aborted).toBe(true);
      attempt.finish();
      const owner = authority.claim("capture");
      expect(owner).toBeTruthy();
      expect(authority.release("capture", owner!)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases an offline claim explicitly when there is no request to finish", () => {
    const authority = new PlannedSortAuthority();
    const owner = authority.claim("offline");
    expect(authority.cancel("offline")).toBe(false);
    expect(authority.release("offline", owner!)).toBe(true);
    expect(authority.claimed("offline")).toBe(false);
  });
});
