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
const definition = "Capture is a personal thinking system that organizes rough thoughts into Actions, Threads, and Intentions.";
const requests: { question: string; sources: { id: string; text: string; targetId: string; fragId?: string }[] }[] = [];
const selections: { question: string; topics: { id: string; name: string }[] }[] = [];
beforeEach(async () => {
  requests.length = 0;
  selections.length = 0;
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [], threads: [
    { id: "pricing", name: "Capture pricing", summary: "Pricing decision", frags: [
      { id: "decision", text, at: Date.now() - 1000 },
      { id: "definition", text: definition, at: Date.now() - 2000 },
    ] },
    { id: "other", name: "Kitchen", summary: "Unrelated private material", frags: [
      { id: "other-note", text: "Buy rosemary for the kitchen.", at: Date.now() - 1000, imgs: ["private-image-reference"] },
    ] },
  ] }));
  await set(DISTILL_KEY, JSON.stringify(EMPTY_DISTILL));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/recall/select") {
      const body = JSON.parse(String(init?.body));
      selections.push(body);
      return Response.json({ threadIds: ["pricing"] });
    }
    if (path === "/api/recall") {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (body.question === "What is Capture?") {
        const source = body.sources.find((candidate: { text: string }) => candidate.text === definition);
        return Response.json({ status: "answered", claims: [{
          text: source.text,
          citations: [{ sourceId: source.id, quote: source.text }],
        }] });
      }
      return Response.json({ status: "answered", claims: [{
        text: "I decided to keep thinking features free. Cloud pays for hosting.",
        citations: [{ sourceId: body.sources[0].id, quote: "I decided to keep thinking features free. Cloud pays for hosting." }],
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
  const answer = await screen.findByText("I decided to keep thinking features free. Cloud pays for hosting.", { selector: "p" });
  expect(requests).toHaveLength(1);
  expect(requests[0].question).toBe(question);
  expect(requests[0].sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ text, targetId: "pricing", fragId: "decision" }),
  ]));
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
  expect(screen.getByText("I decided to keep thinking features free. Cloud pays for hosting.", { selector: "p" })).toBeTruthy();
  vi.useRealTimers();
  expect(await get(KEY)).toBe(baseline);
});

it("answers a generic product question through semantic topic selection without disclosing unrelated notes", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  const baseline = await get(KEY);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search or ask a question" }), {
    target: { value: "What is Capture?" },
  });
  expect(await screen.findByText(definition, { selector: "p" })).toBeTruthy();
  expect(selections).toHaveLength(1);
  expect(selections[0]).toEqual(expect.objectContaining({
    question: "What is Capture?",
    topics: expect.arrayContaining([expect.objectContaining({ id: "pricing", name: "Capture pricing" })]),
  }));
  expect(JSON.stringify(selections[0])).not.toMatch(/Buy rosemary|private-image-reference/);
  expect(requests).toHaveLength(1);
  expect(requests[0].sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: definition, targetId: "pricing", fragId: "definition" }),
  ]));
  expect(JSON.stringify(requests[0])).not.toMatch(/rosemary|private-image-reference|Unrelated private material/);
  expect(await get(KEY)).toBe(baseline);
});
