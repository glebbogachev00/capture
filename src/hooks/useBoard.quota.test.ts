// @vitest-environment jsdom
import "fake-indexeddb/auto";
import * as React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.doMock("react", () => React);

const NOW = new Date(2026, 8, 4, 12).getTime();

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "1");
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("The playground must not check Cloud subscription status");
  }));
  vi.resetModules();
  const { keys, del } = await import("@/lib/storage");
  for (const key of await keys()) await del(key);
});

it("waits for hydration, presents the actual playground ledger, and keeps the guard", async () => {
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
  expect(hook.result.current.trial).toBeNull();

  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  expect(hook.result.current.trial).toEqual({
    exhausted: true,
    remaining: 0,
    hint: "today's 15 captures are used",
  });

  act(() => hook.result.current.setText("the sixteenth capture"));
  await act(async () => {
    await hook.result.current.submit();
  });
  expect(hook.result.current.err).toContain("used today's 15 captures");
  expect(hook.result.current.data.actions).toHaveLength(0);
});
