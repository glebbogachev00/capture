/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CaptureEntry } from "@/lib/ledger";
import type { Thread } from "@/lib/model";
import { VoiceSection } from "./VoiceSection";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const threads: Thread[] = [{ id: "capture", name: "Capture.", summary: "", frags: [{ id: "f1", at: 1, text: "first" }] }];
const spoken = (count: number): CaptureEntry[] => Array.from({ length: count }, (_, index) => ({
  id: `e${index}`, captureId: `c${index}`, at: index, kind: "thread" as const, source: "dictated" as const, targetId: "capture", clean: "",
  raw: `okay so I think number ${index} is basically about reducing friction, right? ${"and then I keep going on about it ".repeat(4)}`,
}));
const voice = {
  patterns: ["You open with Okay or So.", "You check yourself with right?", "You land on So yeah."],
  phrases: ["reducing friction"],
  samples: [{ about: "Capture.", text: "Okay so the thing with Capture is I just talk and it lands." }],
  words: 6_000, at: 1,
};
const open = () => fireEvent.click(screen.getByRole("button", { name: "Show your voice" }));

it("is there from the first day, saying how far off it is and what it will do", () => {
  render(<VoiceSection threads={threads} ledger={spoken(10)} />);
  expect(screen.getByText("Your voice")).toBeTruthy();
  expect(screen.getByText(/^\d[\d,]* of 5,000 words$/)).toBeTruthy();
  open();
  expect(screen.getByText(/Capture shows how you talk here/)).toBeTruthy();
});

it("opens to how you talk once there is a reading", () => {
  render(<VoiceSection threads={threads} ledger={spoken(10)} voice={voice} />);
  expect(screen.getByText("ready")).toBeTruthy();
  expect(screen.queryByText("You open with Okay or So.")).toBeNull();
  open();
  expect(screen.getByText("You open with Okay or So.")).toBeTruthy();
  expect(screen.getByText("“reducing friction”")).toBeTruthy();
  expect(screen.getByText(/the thing with Capture is I just talk/)).toBeTruthy();
});

it("reads your voice when there is enough, says so while it reads, and keeps it on the profile", async () => {
  let answer: (response: Response) => void = () => {};
  const fetchMock = vi.fn<typeof fetch>(() => new Promise((resolve) => { answer = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const onProfileChange = vi.fn().mockResolvedValue(undefined);
  render(<VoiceSection threads={threads} ledger={spoken(200)} onProfileChange={onProfileChange} />);
  await waitFor(() => expect(screen.getByText("reading…")).toBeTruthy());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/voice");
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(body.words).toBeGreaterThanOrEqual(5_000);
  expect(body.recurring).toEqual(["Capture."]);
  answer(Response.json({ voice }));
  await waitFor(() => expect(onProfileChange).toHaveBeenCalled());
  expect(onProfileChange.mock.calls[0][0]({ name: "Gleb" })).toEqual({ name: "Gleb", voice });
  await waitFor(() => expect(localStorage.getItem("capture:voice:next")).toBe("0"));
});

it("asks again on the next visit when a reading was cut off, but waits hours after one that failed", async () => {
  const next = () => Number(localStorage.getItem("capture:voice:next"));
  const view = (fetchMock: typeof fetch) => {
    vi.stubGlobal("fetch", fetchMock);
    return render(<VoiceSection threads={threads} ledger={spoken(200)} onProfileChange={vi.fn().mockResolvedValue(undefined)} />);
  };
  const cutOff = vi.fn<typeof fetch>(async () => { throw new TypeError("network connection was lost"); });
  view(cutOff).unmount();
  await waitFor(() => expect(cutOff).toHaveBeenCalledTimes(1));
  expect(next() - Date.now()).toBeLessThanOrEqual(3 * 60_000);
  /* While that reading could still be running, another visit does not start a second. */
  const meanwhile = vi.fn<typeof fetch>();
  view(meanwhile).unmount();
  expect(meanwhile).not.toHaveBeenCalled();
  /* Once its time is up, the next visit asks again. */
  localStorage.setItem("capture:voice:next", String(Date.now() - 1));
  const failed = vi.fn<typeof fetch>(async () => Response.json({ error: "no" }, { status: 502 }));
  view(failed);
  await waitFor(() => expect(next() - Date.now()).toBeGreaterThan(5 * 60 * 60_000));
  expect(failed).toHaveBeenCalledTimes(1);
  expect(screen.getByText("soon")).toBeTruthy();
});

it("does not ask before there is enough to hear", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<VoiceSection threads={threads} ledger={spoken(10)} onProfileChange={vi.fn()} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetchMock).not.toHaveBeenCalled();
});
