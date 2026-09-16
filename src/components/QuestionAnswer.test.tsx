/** @vitest-environment jsdom */
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Board } from "@/lib/model";

const at = Date.parse("2026-01-03T12:00:00.000Z");
function fixture(): Board {
  return {
    actions: [{ id: "task-1", text: "Orchard seedlings ordered", at, done: true, shelf: "keep", expires: null, src: "PRIVATE ACTION PROVENANCE" }],
    threads: [{ id: "thread-1", name: "Orchard plan", summary: "PRIVATE GENERATED SUMMARY", frags: [
      { id: "frag-1", text: "Orchard planting will wait until spring.", at, imgs: ["PRIVATE IMAGE"] },
      { id: "frag-2", text: "Orchard planting was completed in winter.", at: at + 86400000, resolvedAt: at + 86400000 },
    ] }, { id: "unrelated", name: "Other", summary: "", frags: [{ id: "other", text: "PRIVATE unrelated text", at }] }],
    intentions: [{ id: "intent-1", number: 1, rawInput: "I tend my orchard patiently.", expandedIntention: "PRIVATE EXPANSION", recommendedActions: [], counterIntentions: [], at, updatedAt: at }],
    principles: [{ id: "p", name: "PRIVATE PRINCIPLE", description: "private", enabled: true }],
    ledger: [{ id: "ledger", at, raw: "PRIVATE LEDGER" } as Board["ledger"][number]],
    corrections: [], profile: { name: "PRIVATE PROFILE", imageId: "PRIVATE AVATAR" },
  };
}

const stopWatches: (() => void)[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("React", React);
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "0");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "insufficient", claims: [] })));
});
afterEach(() => {
  for (const stop of stopWatches.splice(0)) stop();
  cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

async function setup(board = fixture(), question = "What about orchard planting?") {
  const { QuestionAnswer } = await import("./QuestionAnswer");
  const props = { board, question, onOpenThread: vi.fn(), onOpenIntention: vi.fn() };
  return { ...render(<QuestionAnswer {...props} />), props, QuestionAnswer };
}
const ask = () => fireEvent.click(screen.getByRole("button", { name: "Answer from my captures" }));

it("distinguishes insufficient evidence and keeps the submitted, bounded excerpts available", async () => {
  const board = fixture();
  board.threads[0].frags[0].text = "Orchard " + "long source passage ".repeat(150);
  await setup(board);
  ask();
  expect(await screen.findByText("Not enough evidence in these matching notes to answer.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  const evidence = screen.getByText(/Show submitted evidence/).closest("details")!;
  expect(evidence.open).toBe(false);
  fireEvent.click(screen.getByText(/Show submitted evidence/));
  expect(evidence.open).toBe(true);
  expect(evidence.textContent).toContain("Orchard planting was completed in winter.");
  expect(evidence.textContent).toContain("resolved");
  expect(evidence.textContent).toContain("Excerpt truncated");
  expect(evidence.textContent).toContain("2026");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function answered(board: Board, text: string) {
  const { recallSources } = await import("@/lib/recall");
  const source = recallSources(board, "orchard")[0];
  return { status: "answered", claims: [{ text, citations: [{ sourceId: source.id, quote: source.text }] }] };
}

it("rechecks disclosure authority when a citation or evidence is opened during silent revalidation", async () => {
  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
  const verify = deferred<{ owner: string; expiresAt: number }>();
  stopWatches.push(lifetime.watch(() => verify.promise));
  const board = fixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(await answered(board, "CITED ANSWER")));
  const view = await setup(board, "orchard");
  ask();
  await screen.findByText("CITED ANSWER");
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(lifetime.snapshot()).toBe("active");
  fireEvent.click(screen.getAllByRole("button", { name: "Open thread: Orchard plan" })[0]);
  expect(view.props.onOpenThread).not.toHaveBeenCalled();
  const summary = screen.getByText(/Show submitted evidence/);
  fireEvent.click(summary);
  expect(summary.closest("details")?.open).toBe(false);
});

it.each(["revoked", "offline", "checking"])("removes sensitive output and rejects late bodies while %s", async mode => {
  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
  lifetime.keepOffline(true);
  const verify = deferred<{ owner: string; expiresAt: number }>();
  stopWatches.push(lifetime.watch(() => verify.promise));
  const late = deferred<unknown>();
  const board = fixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(await answered(board, "PRIVATE ANSWER")))
    .mockResolvedValueOnce({ status: 200, ok: true, json: () => late.promise } as Response);
  const view = await setup(board, "orchard");
  ask();
  await screen.findByText("PRIVATE ANSWER");
  expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("X-Capture-Owner")).toBe("synthetic-owner");
  await act(async () => { ask(); });
  expect(screen.getByText(/Show submitted evidence/)).toBeTruthy();
  act(() => {
    if (mode === "revoked") lifetime.revoke();
    else if (mode === "offline") {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    } else {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  expect(lifetime.snapshot()).toBe(mode);
  expect(view.container.textContent).not.toContain("Orchard");
  expect(screen.queryByText(/Show submitted evidence/)).toBeNull();
  expect(vi.mocked(fetch).mock.calls[1][1]?.signal?.aborted).toBe(true);
  await act(async () => { late.resolve(await answered(board, "LATE PRIVATE ANSWER")); });
  expect(screen.queryByText("LATE PRIVATE ANSWER")).toBeNull();
  if (mode !== "revoked") {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      verify.resolve({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
    });
    expect(screen.getByRole("button", { name: "Answer from my captures" })).toBeTruthy();
    expect(screen.queryByText(/Show submitted evidence/)).toBeNull();
    expect(screen.queryByText("LATE PRIVATE ANSWER")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  }
});

it.each(["question", "board", "unmount"])("retires delayed headers and body on %s change", async change => {
  for (const phase of ["headers", "body"]) {
    const late = deferred<Response>();
    const body = deferred<unknown>();
    vi.mocked(fetch).mockReset();
    if (phase === "headers") vi.mocked(fetch).mockReturnValueOnce(late.promise);
    else vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: () => body.promise } as Response);
    const board = fixture();
    const view = await setup(board, "orchard");
    const stale = await answered(board, "RETIRED ANSWER");
    await act(async () => { ask(); });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    if (change === "unmount") view.unmount();
    else view.rerender(<view.QuestionAnswer {...view.props} question={change === "question" ? "planting" : "orchard"} board={change === "board" ? fixture() : board} />);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText(/Show submitted evidence/)).toBeNull();
    await act(async () => { late.resolve(Response.json(stale)); body.resolve(stale); });
    expect(screen.queryByText("RETIRED ANSWER")).toBeNull();
    if (change !== "unmount") {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "insufficient", claims: [] }));
      ask();
      expect(await screen.findByText("Not enough evidence in these matching notes to answer.")).toBeTruthy();
      view.unmount();
    }
  }
});

it.each(["question", "board"])("clears completed sensitive output on %s change and does not resurrect it on return", async change => {
  const board = fixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(await answered(board, "PREVIOUS ANSWER")));
  const view = await setup(board, "orchard");
  ask();
  await screen.findByText("PREVIOUS ANSWER");
  view.rerender(<view.QuestionAnswer {...view.props} question={change === "question" ? "planting" : "orchard"} board={change === "board" ? fixture() : board} />);
  expect(screen.queryByText("PREVIOUS ANSWER")).toBeNull();
  view.rerender(<view.QuestionAnswer {...view.props} />);
  expect(screen.queryByText("PREVIOUS ANSWER")).toBeNull();
  expect(screen.queryByText(/Show submitted evidence/)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["headers", "body"])("bounds the entire %s wait at 45s even when transport ignores abort", async phase => {
  const late = deferred<Response>();
  const body = deferred<unknown>();
  vi.mocked(fetch).mockReset();
  if (phase === "headers") vi.mocked(fetch).mockReturnValue(late.promise);
  else vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => body.promise } as Response);
  const board = fixture();
  await setup(board, "orchard");
  const stale = await answered(board, "TOO LATE");
  vi.useFakeTimers();
  await act(async () => { ask(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(44999); });
  expect(screen.getByRole("status").textContent).toMatch(/answering/i);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("alert").textContent).toMatch(/timed out/i);
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect((screen.getByRole("button", { name: "Answer from my captures" }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { late.resolve(Response.json(stale)); body.resolve(stale); });
  expect(screen.queryByText("TOO LATE")).toBeNull();
  expect(screen.getByRole("alert").textContent).toMatch(/timed out/i);
});

it("cancels and retries without accepting an abort-ignoring older response or stealing search focus", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  vi.mocked(fetch).mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const board = fixture();
  await setup(board, "orchard");
  const searchView = render(<input aria-label="Search captures" />);
  ask();
  const search = screen.getByRole("textbox", { name: "Search captures" }) as HTMLInputElement;
  search.focus();
  fireEvent.change(search, { target: { value: "Still typing" } });
  expect(search.disabled).toBe(false);
  expect(document.activeElement).toBe(search);
  ask();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toMatch(/answering/i);
  fireEvent.click(screen.getByRole("button", { name: "Cancel answer" }));
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(screen.getByText(/Answer cancelled/)).toBeTruthy();
  ask();
  const latest = await answered(board, "CURRENT ANSWER");
  await act(async () => { second.resolve(Response.json(latest)); });
  expect(screen.getByText("CURRENT ANSWER")).toBeTruthy();
  await act(async () => { first.resolve(Response.json(await answered(board, "STALE ANSWER"))); });
  expect(screen.queryByText("STALE ANSWER")).toBeNull();
  expect(screen.getByText("CURRENT ANSWER")).toBeTruthy();
  expect(document.activeElement).toBe(search);
  searchView.unmount();
});

it.each(["anonymous", "offline", "playground"])("guards %s before retrieval or network", async mode => {
  if (mode === "playground") vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "1");
  if (mode === "offline") vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  if (mode === "anonymous") {
    const { installDocumentLifetime } = await import("@/lib/ownership");
    installDocumentLifetime({ owner: null, expiresAt: Date.now() + 60000 });
  }
  const board = fixture();
  Object.defineProperty(board, "threads", { get() { throw new Error("Private board was accessed"); } });
  const view = await setup(board);
  if (mode === "playground") expect(view.container.textContent).toBe("");
  else expect(screen.getByText(mode === "anonymous" ? /Sign in.*answer/i : /online.*answer/i)).toBeTruthy();
  const button = screen.queryByRole("button", { name: "Answer from my captures" });
  if (button) fireEvent.click(button);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not even retrieve matching notes during render or query edits", async () => {
  const board = fixture();
  Object.defineProperty(board, "threads", { get() { throw new Error("No implicit retrieval"); } });
  const view = await setup(board, "orchard");
  view.rerender(<view.QuestionAnswer {...view.props} question="orchard planting" />);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["", "ab", " ".repeat(10), "x".repeat(501)])("blocks invalid question length without retrieving or sending (%s)", async question => {
  const board = fixture();
  Object.defineProperty(board, "threads", { get() { throw new Error("Retrieval must not run"); } });
  await setup(board, question);
  const button = screen.getByRole("button", { name: "Answer from my captures" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.getByText(/3.*500 characters/)).toBeTruthy();
  fireEvent.click(button);
  expect(fetch).not.toHaveBeenCalled();
});

it("reports no matching evidence locally without sending an empty or unrelated board", async () => {
  await setup(fixture(), "volcanoes");
  ask();
  expect(await screen.findByText(/No matching evidence.*Try more specific words/i)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByText(/Show submitted evidence/)).toBeNull();
});

it.each(["javascript:alert(1)", "__proto__", "quote-mismatch"])("rejects unverified server citations: %s", async kind => {
  const board = fixture();
  const { recallSources } = await import("@/lib/recall");
  const source = recallSources(board, "orchard")[0];
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "answered", claims: [{ text: "UNTRUSTED CLAIM",
    citations: [{ sourceId: kind === "quote-mismatch" ? source.id : kind,
      quote: kind === "quote-mismatch" ? "This quote never existed." : source.text }],
  }] }));
  const view = await setup(board, "orchard");
  ask();
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not verify/i);
  expect(screen.queryByText("UNTRUSTED CLAIM")).toBeNull();
  expect(view.container.querySelector("a, script, img")).toBeNull();
  expect(view.props.onOpenThread).not.toHaveBeenCalled();
});

it.each([503, 429])("reports HTTP %s as a failed request, not insufficient evidence", async status => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "insufficient", claims: [] }, { status }));
  await setup();
  ask();
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not get an answer/i);
  expect(screen.queryByText("Not enough evidence in these matching notes to answer.")).toBeNull();
  expect(screen.getByText(/Show submitted evidence/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Answer from my captures" }) as HTMLButtonElement).disabled).toBe(false);
});

it("sends only matching original evidence after an explicit click, never while typing", async () => {
  const { recallSources } = await import("@/lib/recall");
  const board = fixture();
  const before = JSON.stringify(board);
  const view = await setup(board);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText("Sends up to 12 matching notes to your configured AI. Your notes stay unchanged.")).toBeTruthy();
  view.rerender(<view.QuestionAnswer {...view.props} question="orchard" />);
  expect(fetch).not.toHaveBeenCalled();
  ask();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("/api/recall");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(init?.body as string)).toEqual({ question: "orchard", sources: recallSources(board, "orchard") });
  expect(init?.body).not.toContain("PRIVATE");
  expect(JSON.stringify(board)).toBe(before);
});

it("shows escaped cited claims with trusted titles, dated states, and exact source navigation", async () => {
  const board = fixture();
  const { recallSources } = await import("@/lib/recall");
  const sources = recallSources(board, "orchard");
  const text = '<img src=x onerror="alert(1)"> Orchard notes disagree.';
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "answered", claims: [{ text,
    citations: sources.map(source => ({ sourceId: source.id, quote: source.text })),
  }] }));
  const view = await setup(board, "orchard");
  ask();
  expect(await screen.findByRole("heading", { name: "Answer from your captures" })).toBeTruthy();
  expect(screen.getByText(text)).toBeTruthy();
  expect(view.container.querySelector("img, a, script")).toBeNull();
  expect(screen.getAllByText("resolved").length).toBeGreaterThan(0);
  expect(screen.getAllByText("done").length).toBeGreaterThan(0);
  for (const time of view.container.querySelectorAll("time")) {
    expect(time.getAttribute("datetime")).toMatch(/^2026-01-0[34]T12:00:00.000Z$/);
    expect(time.textContent).toContain("2026");
  }
  const threadButtons = screen.getAllByRole("button", { name: "Open thread: Orchard plan" });
  fireEvent.click(threadButtons[0]);
  expect(view.props.onOpenThread).toHaveBeenLastCalledWith("thread-1", "frag-2");
  fireEvent.click(threadButtons[1]);
  expect(view.props.onOpenThread).toHaveBeenLastCalledWith("thread-1", "frag-1");
  fireEvent.click(screen.getAllByRole("button", { name: "Open intention: I tend my orchard patiently." })[0]);
  expect(view.props.onOpenIntention).toHaveBeenCalledWith("intent-1");
  const action = screen.getByText("Show action source").closest("details")!;
  expect(action.open).toBe(false);
  fireEvent.click(screen.getByText("Show action source"));
  expect(action.open).toBe(true);
  expect(action.textContent).toContain("Orchard seedlings ordered");
  expect(screen.getByText(/matching subset.*not your entire board/i)).toBeTruthy();
});
