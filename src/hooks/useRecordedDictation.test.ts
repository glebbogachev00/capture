// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRecordedDictation } from "./useRecordedDictation";

class FakeRecorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4_000)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const stream = { getTracks: () => [{ stop: () => {} }] };
let getUserMedia: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn(async () => stream);
  fetchMock = vi.fn();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

async function record(result: { current: ReturnType<typeof useRecordedDictation> }) {
  await act(async () => { result.current.toggleMic(); });
  await flush();
  await act(async () => { result.current.toggleMic(); });
  await flush();
}

it("says so when the microphone is blocked, instead of doing nothing", async () => {
  getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  const { result } = renderHook(() => useRecordedDictation(() => {}));
  await act(async () => { result.current.toggleMic(); });
  await flush();
  expect(result.current.problem).toMatch(/microphone is blocked/);
  expect(result.current.listening).toBe(false);
});

it("keeps a recording that failed to transcribe and sends the same one on the next tap", async () => {
  const onResult = vi.fn();
  fetchMock.mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(Response.json({ text: "call the bank", raw: "call the bank" }));
  const { result } = renderHook(() => useRecordedDictation(onResult));

  await record(result);
  expect(onResult).not.toHaveBeenCalled();
  expect(result.current.problem).toMatch(/recording is kept/);
  expect(result.current.canDiscard).toBe(true);
  const firstBody = fetchMock.mock.calls[0][1].body;

  await act(async () => { result.current.toggleMic(); });
  await flush();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[1][1].body).toBe(firstBody);
  expect(onResult).toHaveBeenCalledWith("call the bank", "call the bank");
  expect(result.current.problem).toBeNull();
});

it("lets go of a failed recording so the mic records again", async () => {
  fetchMock.mockResolvedValue(new Response("busy", { status: 503 }));
  const { result } = renderHook(() => useRecordedDictation(() => {}));
  await record(result);
  expect(result.current.canDiscard).toBe(true);

  act(() => result.current.discard());
  expect(result.current.problem).toBeNull();
  await act(async () => { result.current.toggleMic(); });
  await flush();
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(result.current.listening).toBe(true);
});
