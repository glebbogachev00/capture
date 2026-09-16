// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Capture } from "@/app/Capture";
import { EMPTY, KEY } from "@/lib/model";
import { get, set } from "@/lib/storage";
import { DISTILL_KEY, EMPTY_DISTILL } from "@/lib/distill";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
const text = "Capture pricing: I decided to keep thinking features free. Cloud pays for hosting.";
const question = "What did I decide about Capture pricing?";
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
    if (String(input) !== "/api/recall") return new Response(null, { status: 503 });
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    return Response.json({ status: "answered", claims: [{
      text: "You decided to keep thinking features free and charge for Cloud hosting.",
      citations: [{ sourceId: body.sources[0].id, quote: text }],
    }] });
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("answers a natural question from saved notes without changing the board, then opens its exact source", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  expect(screen.getByRole("button", { name: "Threads 2" })).toBeTruthy();
  const baseline = await get(KEY);
  const input = screen.getByRole("searchbox", { name: "Search everything" });
  fireEvent.change(input, { target: { value: question } });
  expect(requests).toHaveLength(0);
  fireEvent.click(await screen.findByRole("button", { name: "Answer from my captures" }));
  await screen.findByText("You decided to keep thinking features free and charge for Cloud hosting.");
  expect(requests).toHaveLength(1);
  expect(requests[0].question).toBe(question);
  expect(requests[0].sources).toEqual([expect.objectContaining({ text, targetId: "pricing", fragId: "decision" })]);
  expect(JSON.stringify(requests[0])).not.toMatch(/rosemary|private-image-reference|Unrelated private material/);
  expect(await get(KEY)).toBe(baseline);
  const citationButton = screen.getAllByRole("button", { name: /Open.*Capture pricing/i }).find((button) => !button.closest("details"));
  expect(citationButton).toBeTruthy();
  fireEvent.click(citationButton!);
  await waitFor(() => expect(document.querySelector('.frag[aria-current="true"]')?.textContent).toContain(text));
  expect(requests).toHaveLength(1);
});

it("keeps an edited search query and ignores an old answer even when transport ignores cancellation", async () => {
  let finish: (response: Response) => void = () => {};
  let submitted: { id: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== "/api/recall") return new Response(null, { status: 503 });
    submitted = JSON.parse(String(init?.body)).sources;
    return new Promise<Response>((resolve) => { finish = resolve; });
  }));
  render(<Capture />);
  await screen.findByText("No open loops.");
  expect(screen.getByRole("button", { name: "Threads 2" })).toBeTruthy();
  const baseline = await get(KEY);
  const input = screen.getByRole("searchbox", { name: "Search everything" });
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(await screen.findByRole("button", { name: "Answer from my captures" }));
  await waitFor(() => expect(submitted).toHaveLength(1));
  fireEvent.change(input, { target: { value: "rosemary" } });
  await act(async () => finish(Response.json({ status: "answered", claims: [{
    text: "Stale pricing answer", citations: [{ sourceId: submitted[0].id, quote: text }],
  }] })));
  expect(screen.queryByText("Stale pricing answer")).toBeNull();
  expect((input as HTMLInputElement).value).toBe("rosemary");
  expect(await get(KEY)).toBe(baseline);
});
