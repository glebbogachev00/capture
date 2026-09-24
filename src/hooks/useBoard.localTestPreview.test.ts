// @vitest-environment jsdom
import "fake-indexeddb/auto";
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// Dynamic module loading below models the build-time public Preview flag while
// keeping the hook on the same React instance as the test renderer.
vi.doMock("react", () => React);

const NOW = 1_798_000_000_000;
const lifetimes: { revoke: () => void }[] = [];

afterEach(() => {
  cleanup();
  for (const lifetime of lifetimes.splice(0)) lifetime.revoke();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it("keeps a disposable local Preview on this browser without board or image hub traffic", async () => {
  vi.stubEnv("NEXT_PUBLIC_CAPTURE_LOCAL_TEST_PREVIEW", "1");
  vi.resetModules();

  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify({ error: "unexpected network" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", network);

  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime();
  lifetimes.push(lifetime);
  const storage = await import("@/lib/storage");
  const { EMPTY, KEY } = await import("@/lib/model");
  const board = {
    ...EMPTY,
    threads: [{
      id: "synthetic-thread",
      name: "Synthetic local fixture",
      summary: "",
      frags: [{
        id: "synthetic-frag",
        text: "Visible only in this browser",
        at: NOW,
        imgs: ["synthetic-photo"],
      }],
    }],
  };
  await storage.set(KEY, JSON.stringify(board));

  const { useBoard } = await import("./useBoard");
  const hook = renderHook(() => useBoard(NOW));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  expect(JSON.stringify(hook.result.current.data)).toContain("Visible only in this browser");

  await act(async () => {
    await hook.result.current.updateProfile({
      name: "Disposable tester",
      showSignature: false,
    });
    await hook.result.current.syncNow();
  });
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await new Promise((resolve) => setTimeout(resolve, 1_600));

  const forbiddenCalls = network.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes("/api/sync") || url.includes("/api/img/"));
  expect(forbiddenCalls).toEqual([]);
  expect(JSON.parse((await storage.get(KEY)) ?? "{}").profile).toMatchObject({
    name: "Disposable tester",
    showSignature: false,
  });

  hook.unmount();
});
