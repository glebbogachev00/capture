/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCaptureLimit } from "@/hooks/useCaptureLimit";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("Capture allowance", () => {
  it("fails closed to the trial allowance while subscription status is loading", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useCaptureLimit());
    expect(result.current).toBe(true);
  });

  it("gives a signed-out visitor the fifteen-a-day local allowance", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ error: "unauthorized", captureLimit: 15 }, { status: 401 }),
    );
    const { result } = renderHook(() => useCaptureLimit());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("removes the local trial cap for an active Cloud subscriber", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({ tier: "cloud", captureLimit: null }),
    );
    globalThis.fetch = fetcher;
    const { result } = renderHook(() => useCaptureLimit());
    await waitFor(() => expect(result.current).toBe(false));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not impose Capture's public limit on a self-hosted board", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({ error: "not found" }, { status: 404 }),
    );
    globalThis.fetch = fetcher;
    const { result } = renderHook(() => useCaptureLimit());
    await waitFor(() => expect(result.current).toBe(false));
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
