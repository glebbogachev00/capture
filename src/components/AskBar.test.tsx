/** @vitest-environment jsdom */
import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY, type Board } from "@/lib/model";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const board = (): Board => ({
  ...EMPTY,
  threads: [{ id: "pricing", name: "Pricing", summary: "Annual it is.", frags: [
    { id: "f1", text: "going annual, $8 a month billed yearly", at: NOW - 864e5 },
  ] }],
  actions: [{ id: "a1", text: "Email Maya the invoice", done: false, at: NOW, shelf: "days", expires: null }],
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("React", React);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function setup(query: string, reply: Response | (() => Promise<Response>)) {
  const fetch = vi.fn(typeof reply === "function" ? reply : async () => reply);
  vi.stubGlobal("fetch", fetch);
  const { AskBar } = await import("./AskBar");
  const props = {
    board: board(), now: NOW, query, onQuery: vi.fn(), onOpenThread: vi.fn(), onOpenIntention: vi.fn(),
    onOpenActions: vi.fn(), onAnswering: vi.fn(),
  };
  const view = render(<AskBar {...props} />);
  return { fetch, props, view, AskBar };
}
const ask = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ask" })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

it("never sends anything while typing — only when asked", async () => {
  const { fetch } = await setup("what did I land on for pricing", Response.json({}));
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy();
});

it("sends the whole board, not a word-matched slice, and renders a formatted answer with its sources", async () => {
  const { fetch, props } = await setup("what did I land on for pricing",
    Response.json({ found: true, answer: "You went **annual** [T1].\n\n- $8 a month\n- billed yearly", refs: ["T1", "A1", "T7"] }));
  await ask();
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/ask");
  const body = JSON.parse(init.body as string);
  expect(body.question).toBe("what did I land on for pricing");
  // "annual" and "$8" share no word with the question; the model still sees them.
  expect(body.board).toContain("going annual, $8 a month billed yearly");
  expect(body.board).toContain("Email Maya the invoice");

  const answer = screen.getByRole("region", { name: "Answer" });
  expect(answer.querySelector("strong")?.textContent).toBe("annual");
  expect(answer.querySelectorAll("li")).toHaveLength(2);
  expect(answer.textContent).not.toContain("[T1]");
  fireEvent.click(screen.getByRole("button", { name: "Open thread: Pricing" }));
  expect(props.onOpenThread).toHaveBeenCalledWith("pricing");
  fireEvent.click(screen.getByRole("button", { name: "Open action: Email Maya the invoice" }));
  expect(props.onOpenActions).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /T7/ })).toBeNull();
  expect(props.onAnswering).toHaveBeenLastCalledWith(true);
});

it("says plainly when the board does not hold the answer", async () => {
  await setup("when is my flight", Response.json({ found: false, answer: "Nothing on your board mentions a flight.", refs: [] }));
  await ask();
  expect(screen.getByRole("heading", { name: "Not on your board" })).toBeTruthy();
});

it("shows the provider's failure, never an invented answer", async () => {
  await setup("what did I decide", Response.json({ error: "Groq is rate-limited right now." }, { status: 429 }));
  await ask();
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  expect(screen.getByText(/Couldn't get an answer\. Groq is rate-limited right now\. Your notes are unchanged/)).toBeTruthy();
});

it("does not reach for the network offline", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const { fetch } = await setup("what did I decide", Response.json({}));
  await ask();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText(/Ask needs the model/)).toBeTruthy();
});

it("hides an answer once the question in the box changes", async () => {
  const { view, props, AskBar } = await setup("what did I decide",
    Response.json({ found: true, answer: "Annual.", refs: [] }));
  await ask();
  expect(screen.getByRole("region", { name: "Answer" })).toBeTruthy();
  view.rerender(<AskBar {...props} query="what did I decide about tiles" />);
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
});
