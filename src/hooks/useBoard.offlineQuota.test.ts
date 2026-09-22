// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const NOW = new Date(2026, 8, 4, 12).getTime();

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "0");
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Offline entitlement checks must not use the network");
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it("rechecks an offline Cloud entitlement synchronously before accepting a draft", async () => {
  let now = NOW;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const own = await import("@/lib/ownership");
  const online = new own.OwnershipLifetime({ owner: "paid-owner", expiresAt: NOW + 60_000 });
  online.keepOffline(true);
  own.installDocumentLifetime(own.resumeOfflineIdentity()!);
  const { cacheCloudEntitlement } = await import("@/lib/cloudEntitlement");
  cacheCloudEntitlement("paid-owner", NOW + 1_000, localStorage);
  const { EMPTY, KEY } = await import("@/lib/model");
  const { set } = await import("@/lib/storage");
  const ledger = Array.from({ length: 15 }, (_, i) => ({
    id: `capture-${i}`,
    at: NOW,
    raw: `said ${i}`,
    clean: `clean ${i}`,
    kind: "action" as const,
    source: "typed" as const,
    targetId: `action-${i}`,
  }));
  await set(KEY, JSON.stringify({ ...EMPTY, ledger }));

  const { useBoard } = await import("./useBoard");
  const hook = renderHook(() => useBoard(NOW));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  expect(hook.result.current.trial).toBeNull();

  act(() => hook.result.current.setText("draft composed before paid access expired"));
  now = NOW + 1_001;
  await act(async () => { await hook.result.current.submit(); });

  expect(hook.result.current.err).toContain("used today's 15 captures");
  expect(hook.result.current.data.actions).toHaveLength(0);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
