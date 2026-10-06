// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const network = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ownership", () => ({ ownedFetch: network }));

import { SHELL_ACTIVE_EVENT } from "@/lib/nativeShell";
import { useNativeShares } from "./useNativeShares";
import { useRecordedDictation } from "./useRecordedDictation";

type Call = [plugin: string, method: string, options?: object];
let queue: { id: string; text: string }[];
let calls: Call[];

function installBridge(handlers: Record<string, (options?: object) => unknown> = {}) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    nativePromise: async (plugin: string, method: string, options?: object) => {
      calls.push([plugin, method, options]);
      if (method === "peekShares") return { items: [...queue] };
      if (method === "clearShare") {
        queue = queue.filter((item) => item.id !== (options as { id: string }).id);
        return {};
      }
      return handlers[method]?.(options) ?? {};
    },
  };
}

beforeEach(() => {
  queue = [];
  calls = [];
  network.mockReset();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

it("does nothing in a browser", async () => {
  const submit = vi.fn();
  renderHook(() => useNativeShares(submit, true));
  await Promise.resolve();
  expect(submit).not.toHaveBeenCalled();
});

it("files each share as a capture and clears it only once saved", async () => {
  queue = [{ id: "a", text: "https://example.com/post" }, { id: "b", text: "Read this later" }];
  installBridge();
  const submit = vi.fn(async () => undefined);
  renderHook(() => useNativeShares(submit, true));
  await waitFor(() => expect(queue).toHaveLength(0));
  expect(submit.mock.calls).toEqual([
    [false, undefined, "https://example.com/post"],
    [false, undefined, "Read this later"],
  ]);
});

it("keeps a share queued when submit saved nothing", async () => {
  queue = [{ id: "a", text: "first" }, { id: "b", text: "second" }];
  installBridge();
  const submit = vi.fn(async () => false as const);
  renderHook(() => useNativeShares(submit, true));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(queue.map((item) => item.id)).toEqual(["a", "b"]);
  expect(calls.some(([, method]) => method === "clearShare")).toBe(false);
});

it("waits for an empty composer, then drains on every return to the app", async () => {
  installBridge();
  const submit = vi.fn(async () => undefined);
  const hook = renderHook(({ empty }) => useNativeShares(submit, empty), { initialProps: { empty: false } });
  queue = [{ id: "a", text: "shared while drafting" }];
  await Promise.resolve();
  expect(calls).toHaveLength(0);

  hook.rerender({ empty: true });
  await waitFor(() => expect(queue).toHaveLength(0));

  queue = [{ id: "b", text: "shared later" }];
  act(() => { window.dispatchEvent(new Event(SHELL_ACTIVE_EVENT)); });
  await waitFor(() => expect(queue).toHaveLength(0));
  expect(submit).toHaveBeenLastCalledWith(false, undefined, "shared later");
});

it("records natively in the iPhone app and transcribes the returned audio", async () => {
  const audio = "x".repeat(2_000);
  installBridge({ stopRecording: () => ({ data: btoa(audio), mime: "audio/mp4" }) });
  network.mockResolvedValue(new Response(JSON.stringify({ text: "Call the bank", raw: "call the bank" })));
  const onResult = vi.fn();
  const hook = renderHook(() => useRecordedDictation(onResult));

  act(() => hook.result.current.toggleMic());
  await waitFor(() => expect(hook.result.current.listening).toBe(true));
  act(() => hook.result.current.toggleMic());

  await waitFor(() => expect(onResult).toHaveBeenCalledWith("Call the bank", "call the bank"));
  expect(calls.map(([, method]) => method)).toEqual(["startRecording", "stopRecording"]);
  const [url, init] = network.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/transcribe");
  expect((init.body as Blob).type).toBe("audio/mp4");
  expect((init.body as Blob).size).toBe(audio.length);
});
