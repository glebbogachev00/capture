// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Capture } from "@/app/Capture";
import { EMPTY, KEY } from "@/lib/model";
import { get, set } from "@/lib/storage";
import { DISTILL_KEY, EMPTY_DISTILL } from "@/lib/distill";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
const question = "What did I decide about Capture pricing?";
const text = `${question} I decided to keep thinking features free. Cloud pays for hosting.`;
const requests: { question: string; sources: { id: string; text: string; targetId: string; fragId?: string }[] }[] = [];
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
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/recall") {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return Response.json({ status: "answered", claims: [{
        text: "You decided to keep thinking features free and charge for Cloud hosting.",
        citations: [{ sourceId: body.sources[0].id, quote: body.sources[0].text }],
      }] });
    }
    return new Response(null, { status: 503 });
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("starts the answer debounce from the live query rather than delayed keyword hits", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search or ask a question" }), { target: { value: question } });
  await act(async () => { await vi.advanceTimersByTimeAsync(599); });
  expect(requests).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(requests).toHaveLength(1);
  vi.useRealTimers();
});

it("updates keyword results immediately without calling recall for an ordinary search", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  expect(screen.getByRole("button", { name: "Threads 2" })).toBeTruthy();
  const baseline = await get(KEY);
  const input = screen.getByRole("searchbox", { name: "Search or ask a question" });
  fireEvent.change(input, { target: { value: "Capture pricing" } });
  await screen.findByText("Threads · 1");
  expect(requests).toHaveLength(0);
  expect(screen.getByText("Threads · 1")).toBeTruthy();
  expect(screen.queryByText("Buy rosemary for the kitchen.")).toBeNull();
  expect(await get(KEY)).toBe(baseline);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));
  await waitFor(() => expect(document.querySelector('.frag[aria-current="true"]')?.textContent).toContain(text));
  expect(requests).toHaveLength(0);
  expect(await get(KEY)).toBe(baseline);
});

it("automatically renders a cited answer above local results and opens its native source", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  expect(screen.getByRole("button", { name: "Threads 2" })).toBeTruthy();
  const baseline = await get(KEY);
  const input = screen.getByRole("searchbox", { name: "Search or ask a question" });
  fireEvent.change(input, { target: { value: question } });
  const localResults = await screen.findByText("Threads · 1");
  const answer = await screen.findByText("You decided to keep thinking features free and charge for Cloud hosting.");
  expect(requests).toHaveLength(1);
  expect(requests[0].question).toBe(question);
  expect(requests[0].sources).toEqual([expect.objectContaining({ text, targetId: "pricing", fragId: "decision" })]);
  expect(JSON.stringify(requests[0])).not.toMatch(/rosemary|private-image-reference|Unrelated private material/);
  expect(answer.compareDocumentPosition(localResults) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(await get(KEY)).toBe(baseline);
  fireEvent.click(screen.getAllByRole("button", { name: "Open thread: Capture pricing" })[0]);
  await waitFor(() => expect(document.querySelector('.frag[aria-current="true"]')?.textContent).toContain(text));
  expect(requests).toHaveLength(1);
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: /all threads/i }));
  expect((screen.getByRole("searchbox", { name: "Search or ask a question" }) as HTMLInputElement).value).toBe(question);
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(requests).toHaveLength(1);
  expect(screen.getByText("You decided to keep thinking features free and charge for Cloud hosting.")).toBeTruthy();
  vi.useRealTimers();
  expect(await get(KEY)).toBe(baseline);
});
