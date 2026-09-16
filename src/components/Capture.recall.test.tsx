// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Capture } from "@/app/Capture";
import { EMPTY, KEY } from "@/lib/model";
import { get, set } from "@/lib/storage";
import { DISTILL_KEY, EMPTY_DISTILL } from "@/lib/distill";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
const text = "Capture pricing: I decided to keep thinking features free. Cloud pays for hosting.";
const question = "What did I decide about Capture pricing?";
const requests: string[] = [];
beforeEach(async () => {
  requests.length = 0;
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [], threads: [
    { id: "pricing", name: "Capture pricing", summary: "Pricing decision", frags: [
      { id: "decision", text, at: Date.now() - 1000 },
    ] },
    { id: "other", name: "Kitchen", summary: "Unrelated private material", frags: [
      { id: "other-note", text: "Buy rosemary for the kitchen.", at: Date.now() - 1000, imgs: ["private-image-reference"] },
    ] },
  ] }));
  await set(DISTILL_KEY, JSON.stringify(EMPTY_DISTILL));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (/^\/api\/(?:recall|sort|distill|group|intention|judge|organize|summarize|transcribe|tts|untangle|wrap)(?:\/|$)/.test(path)) requests.push(path);
    return new Response(null, { status: 503 });
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("restores keyword results without a separate answer surface or board changes", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  expect(screen.getByRole("button", { name: "Threads 2" })).toBeTruthy();
  const baseline = await get(KEY);
  const input = screen.getByRole("searchbox", { name: "Search everything" });
  fireEvent.change(input, { target: { value: "Capture pricing" } });
  await screen.findByText("Threads · 1");
  expect(requests).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Answer from my captures" })).toBeNull();
  expect(screen.queryByText("Keyword matches")).toBeNull();
  expect(screen.getByText("Threads · 1")).toBeTruthy();
  expect(screen.queryByText("Buy rosemary for the kitchen.")).toBeNull();
  expect(await get(KEY)).toBe(baseline);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(text.replace(/\./g, "\\.")) }));
  await waitFor(() => expect(document.querySelector('.frag[aria-current="true"]')?.textContent).toContain(text));
  expect(requests).toHaveLength(0);
  expect(await get(KEY)).toBe(baseline);
});

it("keeps the original empty state for questions and allows editing and clearing without recall", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  expect(screen.getByRole("button", { name: "Threads 2" })).toBeTruthy();
  const baseline = await get(KEY);
  const input = screen.getByRole("searchbox", { name: "Search everything" });
  fireEvent.change(input, { target: { value: question } });
  await screen.findByText("Nothing by that shape.");
  expect(screen.queryByRole("button", { name: "Answer from my captures" })).toBeNull();
  expect(screen.queryByText("Keyword matches")).toBeNull();
  fireEvent.change(input, { target: { value: "rosemary" } });
  await screen.findByRole("button", { name: /Buy rosemary for the kitchen/ });
  expect((input as HTMLInputElement).value).toBe("rosemary");
  expect(await get(KEY)).toBe(baseline);
  fireEvent.change(input, { target: { value: "" } });
  await screen.findByText("No open loops.");
  expect(screen.getByRole("button", { name: "Threads 2" })).toBeTruthy();
  expect(screen.queryByText("Nothing by that shape.")).toBeNull();
  expect(requests).toHaveLength(0);
  expect(await get(KEY)).toBe(baseline);
});
