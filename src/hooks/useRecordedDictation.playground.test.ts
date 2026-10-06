// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("@/lib/playground", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/playground")>()),
  PLAYGROUND: true,
}));
vi.mock("@/lib/ownership", () => ({ ownedFetch: vi.fn(async () => new Response(JSON.stringify({ text: "" }))) }));

import { spendVoice, voiceSecondsLeft } from "@/lib/voiceAllowance";
import { useRecordedDictation } from "./useRecordedDictation";

let methods: string[];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  methods = [];
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    nativePromise: async (_plugin: string, method: string) => {
      methods.push(method);
      return method === "stopRecording" ? { data: btoa("x".repeat(2_000)), mime: "audio/mp4" } : {};
    },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

it("stops a recording by itself when today's voice runs out, and counts it", async () => {
  spendVoice(600 - 5);
  const hook = renderHook(() => useRecordedDictation(() => {}));
  await act(async () => { hook.result.current.toggleMic(); });
  expect(hook.result.current.listening).toBe(true);

  await act(async () => { vi.advanceTimersByTime(5_000); });
  expect(hook.result.current.listening).toBe(false);
  expect(methods).toEqual(["startRecording", "stopRecording"]);
  expect(voiceSecondsLeft()).toBe(0);
  expect(hook.result.current.voiceHint).toBe("today's 10 minutes of voice are used");
});

it("won't start once the ten minutes are used", async () => {
  spendVoice(600);
  const hook = renderHook(() => useRecordedDictation(() => {}));
  expect(hook.result.current.voiceHint).toBe("today's 10 minutes of voice are used");
  await act(async () => { hook.result.current.toggleMic(); });
  expect(methods).toEqual([]);
  expect(hook.result.current.listening).toBe(false);
});
