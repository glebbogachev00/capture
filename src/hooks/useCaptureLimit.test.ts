/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudIdentity } from "@/lib/ownership";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "0");
  // No test may reach a real billing endpoint.
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => undefined)));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

async function loadHook(identity?: CloudIdentity, playground = false) {
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", playground ? "1" : "0");
  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime(identity);
  const { useCaptureLimit } = await import("@/hooks/useCaptureLimit");
  return { useCaptureLimit, lifetime };
}

const account = () => ({ owner: "synthetic-account", expiresAt: Date.now() + 60_000 });

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Capture allowance", () => {
  it.each(["pending", "network error", "503", "404"])(
    "is unlimited from the first self-hosted render even with billing %s",
    async (scenario) => {
      const fetcher = vi.mocked(globalThis.fetch);
      if (scenario === "network error") fetcher.mockRejectedValue(new TypeError("offline"));
      if (scenario === "503" || scenario === "404") {
        fetcher.mockResolvedValue(Response.json({ error: "unavailable" }, { status: Number(scenario) }));
      }
      const { useCaptureLimit } = await loadHook();
      const renders: ReturnType<typeof useCaptureLimit>[] = [];
      const { result, rerender } = renderHook(() => {
        const allowance = useCaptureLimit();
        renders.push(allowance);
        return allowance;
      });
      expect(renders[0]).toEqual({ applies: false, ready: true });
      await act(async () => { await Promise.resolve(); });
      rerender();
      expect(result.current).toEqual({ applies: false, ready: true });
      expect(renders.every((value) => !value.applies && value.ready)).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("fails closed for Cloud enforcement but withholds trial presentation while billing is loading", async () => {
    const { useCaptureLimit } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toEqual({ applies: true, ready: false });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/cloud/subscription", expect.objectContaining({
      cache: "no-store",
      credentials: "same-origin",
      headers: expect.any(Headers),
    }));
    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(new Headers(request?.headers).get("X-Capture-Owner")).toBe("synthetic-account");
  });

  it.each([
    { tier: "cloud", captureLimit: null, applies: false, accessExpiresAt: new Date(Date.now() + 60_000).toISOString() },
    { tier: "free", captureLimit: 15, applies: true, accessExpiresAt: undefined },
  ])("settles delayed $tier billing without granting an early exemption", async ({ tier, captureLimit, applies, accessExpiresAt }) => {
    const pending = deferredResponse();
    vi.mocked(globalThis.fetch).mockReturnValue(pending.promise);
    const { useCaptureLimit } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toEqual({ applies: true, ready: false });
    await act(async () => { pending.resolve(Response.json({ tier, captureLimit, accessExpiresAt })); });
    await waitFor(() => expect(result.current).toEqual({ applies, ready: true }));
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("honors subscription-disabled Cloud as unlimited online without caching offline access", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({
      tier: "free",
      captureLimit: null,
      accessExpiresAt: null,
    }));
    const { useCaptureLimit } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());

    await waitFor(() => expect(result.current).toEqual({ applies: false, ready: true }));
    const { hasCloudEntitlement } = await import("@/lib/cloudEntitlement");
    expect(hasCloudEntitlement("synthetic-account", Date.now(), localStorage)).toBe(false);
  });

  it("uses the same owner's unexpired, server-verified Cloud access while offline", async () => {
    const { OFFLINE_PERMISSION_KEY } = await import("@/lib/ownership");
    const { cacheCloudEntitlement } = await import("@/lib/cloudEntitlement");
    localStorage.setItem(OFFLINE_PERMISSION_KEY, JSON.stringify({
      owner: "synthetic-account",
      policy: "until-revoked",
    }));
    cacheCloudEntitlement("synthetic-account", Date.now() + 60_000, localStorage);

    const { useCaptureLimit } = await loadHook({
      owner: "synthetic-account",
      expiresAt: 0,
      offline: true,
    });
    const { result } = renderHook(() => useCaptureLimit());

    expect(result.current).toEqual({ applies: false, ready: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("re-enables the offline allowance exactly when cached paid access expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    const { OFFLINE_PERMISSION_KEY } = await import("@/lib/ownership");
    const { cacheCloudEntitlement } = await import("@/lib/cloudEntitlement");
    localStorage.setItem(OFFLINE_PERMISSION_KEY, JSON.stringify({
      owner: "synthetic-account",
      policy: "until-revoked",
    }));
    cacheCloudEntitlement("synthetic-account", Date.now() + 1_000, localStorage);

    const { useCaptureLimit } = await loadHook({
      owner: "synthetic-account",
      expiresAt: 0,
      offline: true,
    });
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toEqual({ applies: false, ready: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
    });
    expect(result.current).toEqual({ applies: true, ready: true });
  });

  it("re-arms an entitlement timer beyond the browser maximum timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    const MAX_TIMEOUT = 2_147_483_647;
    const { OFFLINE_PERMISSION_KEY } = await import("@/lib/ownership");
    const { cacheCloudEntitlement, hasCloudEntitlement } = await import("@/lib/cloudEntitlement");
    localStorage.setItem(OFFLINE_PERMISSION_KEY, JSON.stringify({
      owner: "synthetic-account",
      policy: "until-revoked",
    }));
    cacheCloudEntitlement("synthetic-account", Date.now() + MAX_TIMEOUT + 10_000, localStorage);

    const { useCaptureLimit } = await loadHook({
      owner: "synthetic-account",
      expiresAt: 0,
      offline: true,
    });
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toEqual({ applies: false, ready: true });

    await act(async () => { await vi.advanceTimersByTimeAsync(MAX_TIMEOUT); });
    expect(result.current).toEqual({ applies: false, ready: true });
    expect(hasCloudEntitlement("synthetic-account", Date.now(), localStorage)).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(result.current).toEqual({ applies: true, ready: true });
  });

  it("does not trust a cached paid entitlement while online verification is pending", async () => {
    const { cacheCloudEntitlement } = await import("@/lib/cloudEntitlement");
    cacheCloudEntitlement("synthetic-account", Date.now() + 60_000, localStorage);
    const { useCaptureLimit } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toEqual({ applies: true, ready: false });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("caches only a verified paid response with a future access boundary", async () => {
    const accessExpiresAt = new Date(Date.now() + 60_000).toISOString();
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({
      tier: "cloud",
      captureLimit: null,
      accessExpiresAt,
    }));
    const { useCaptureLimit } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    await waitFor(() => expect(result.current).toEqual({ applies: false, ready: true }));
    const { hasCloudEntitlement } = await import("@/lib/cloudEntitlement");
    expect(hasCloudEntitlement("synthetic-account", Date.now(), localStorage)).toBe(true);
  });

  it("rechecks an active paid account when its verified access boundary expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    const fetcher = vi.mocked(globalThis.fetch);
    fetcher
      .mockResolvedValueOnce(Response.json({
        tier: "cloud",
        captureLimit: null,
        accessExpiresAt: new Date(Date.now() + 1_000).toISOString(),
      }))
      .mockResolvedValueOnce(Response.json({ tier: "free", captureLimit: 15 }));
    const { useCaptureLimit } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual({ applies: false, ready: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ applies: true, ready: true });
  });

  it("does not retain an expired paid exemption after the document goes offline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(Response.json({
        tier: "cloud",
        captureLimit: null,
        accessExpiresAt: new Date(Date.now() + 1_000).toISOString(),
      }))
      .mockRejectedValueOnce(new TypeError("offline"));
    const { useCaptureLimit, lifetime } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual({ applies: false, ready: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
      await Promise.resolve();
      lifetime.expiresAt = 0;
      try { lifetime.assert(); } catch { /* revoked or offline is fail-closed */ }
    });
    expect(result.current.applies).toBe(true);
  });

  it.each(["network error", "503", "404", "malformed JSON", "missing limit"])(
    "keeps verified Cloud capped after billing %s",
    async (scenario) => {
      const fetcher = vi.mocked(globalThis.fetch);
      if (scenario === "network error") fetcher.mockRejectedValue(new TypeError("offline"));
      else if (scenario === "503" || scenario === "404") {
        fetcher.mockResolvedValue(Response.json({ error: "unavailable" }, { status: Number(scenario) }));
      } else if (scenario === "malformed JSON") fetcher.mockResolvedValue(new Response("not json"));
      else fetcher.mockResolvedValue(Response.json({ tier: "cloud" }));
      const { useCaptureLimit } = await loadHook(account());
      const { result } = renderHook(() => useCaptureLimit());
      await waitFor(() => expect(result.current).toEqual({ applies: true, ready: true }));
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("does not trust an unlimited payload on a failed Cloud billing response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ captureLimit: null }, { status: 503 }));
    const { useCaptureLimit } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    await waitFor(() => expect(result.current).toEqual({ applies: true, ready: true }));
  });

  it("keeps an unauthorized Cloud account capped and revokes its lifetime", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ error: "unauthorized", captureLimit: 15 }, { status: 401 }),
    );
    const { useCaptureLimit, lifetime } = await loadHook(account());
    const { result } = renderHook(() => useCaptureLimit());
    await waitFor(() => expect(result.current).toEqual({ applies: true, ready: true }));
    expect(lifetime.snapshot()).toBe("revoked");
  });

  it("gives an anonymous Cloud visitor the local allowance without billing fetches", async () => {
    const { useCaptureLimit } = await loadHook({ owner: null, expiresAt: Date.now() + 60_000 });
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toEqual({ applies: true, ready: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps playground capped without billing even with Cloud identity %s", async (cloud) => {
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ tier: "cloud", captureLimit: null }));
    const { useCaptureLimit } = await loadHook(cloud ? account() : undefined, true);
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toEqual({ applies: true, ready: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
