/** @vitest-environment jsdom */
import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  vi.useFakeTimers();
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
const startAnswer = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};

it("keeps insufficient evidence out of the visual answer surface", async () => {
  const board = fixture();
  board.threads[0].frags[0].text = "Orchard " + "long source passage ".repeat(150);
  await setup(board);
  await startAnswer();
  expect(screen.getByRole("status").textContent).toBe("Not enough evidence in these matching notes to answer.");
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Open thread/ })).toBeNull();
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

it("automatically answers a stable question only after the debounce", async () => {
  vi.useFakeTimers();
  await setup();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(599); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("stays visually quiet while answering, then shows only the answer and connected items", async () => {
  const response = deferred<Response>();
  vi.mocked(fetch).mockReset().mockReturnValueOnce(response.promise);
  const board = fixture();
  await setup(board);

  await startAnswer();
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  expect(screen.getByRole("status").className).toMatch(/visuallyHidden/);
  expect(screen.queryByText(/Sends up to/i)).toBeNull();

  await act(async () => { response.resolve(Response.json(await answered(board, "CURRENT ANSWER"))); });

  const answer = screen.getByRole("region", { name: "Answer" });
  expect(answer.textContent).toContain("CURRENT ANSWER");
  expect(screen.getByRole("heading", { name: "Answer" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Open thread: Orchard plan" })).toHaveLength(1);
  expect(answer.textContent).not.toMatch(/matching subset|submitted evidence|configured AI|unchanged/i);
  expect(answer.querySelector("blockquote, details, time")).toBeNull();
});

it("commits a quiet accessibility status before transmitting excerpts", async () => {
  vi.mocked(fetch).mockImplementationOnce(async () => {
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/answering/i);
    expect(status.className).toMatch(/visuallyHidden/);
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
    return Response.json({ status: "insufficient", claims: [] });
  });
  await setup();
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("status").className).toMatch(/visuallyHidden/);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps one quiet polite status node and announces completion", async () => {
  const response = deferred<Response>();
  vi.mocked(fetch).mockReset().mockReturnValueOnce(response.promise);
  const board = fixture();
  await setup(board);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.getAttribute("aria-atomic")).toBe("true");
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { response.resolve(Response.json(await answered(board, "CURRENT ANSWER"))); });
  expect(screen.getByRole("status")).toBe(status);
  expect(status.textContent).toBe("Answer from your captures");
  expect(status.getAttribute("aria-busy")).toBe("false");
  expect(screen.getByRole("region", { name: "Answer" })).toBeTruthy();
});

it("does not resend when board identity or unrelated board data changes", async () => {
  const board = fixture();
  vi.mocked(fetch).mockResolvedValue(Response.json(await answered(board, "STABLE ANSWER")));
  const view = await setup(board);
  await startAnswer();
  expect(screen.getByText("STABLE ANSWER")).toBeTruthy();
  const replacement = structuredClone(board);
  replacement.profile = { name: "Different presentation identity" };
  view.rerender(<view.QuestionAnswer {...view.props} board={replacement} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText("STABLE ANSWER")).toBeTruthy();
});

it("retires a request only when its exact bounded source snapshot changes", async () => {
  const first = deferred<Response>();
  vi.mocked(fetch).mockReset().mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(Response.json({ status: "insufficient", claims: [] }));
  const board = fixture();
  const view = await setup(board);
  await startAnswer();
  const firstSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  const changed = structuredClone(board);
  changed.threads[0].frags[0].text = "Orchard planting moved to late spring.";
  view.rerender(<view.QuestionAnswer {...view.props} board={changed} />);
  expect(firstSignal?.aborted).toBe(true);
  expect(screen.queryByRole("region", { name: "Answer from captures" })).toBeNull();
  await startAnswer();
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => { first.resolve(Response.json(await answered(board, "STALE ANSWER"))); });
  expect(screen.queryByText("STALE ANSWER")).toBeNull();
});

it("retries a settled question once same-owner readiness becomes subscribed-ready", async () => {
  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
  const verify = deferred<{ owner: string; expiresAt: number }>();
  stopWatches.push(lifetime.watch(() => verify.promise));
  await setup();
  act(() => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toMatch(/answering/i);
  await act(async () => { verify.resolve({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not resend a completed fingerprint after offline reconnect or same-owner remount", async () => {
  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
  lifetime.keepOffline(true);
  const verifies: ReturnType<typeof deferred<{ owner: string; expiresAt: number }>>[] = [];
  stopWatches.push(lifetime.watch(() => {
    const verify = deferred<{ owner: string; expiresAt: number }>();
    verifies.push(verify);
    return verify.promise;
  }));
  await setup();
  await startAnswer();
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
  });
  expect(screen.queryByRole("region", { name: "Answer from captures" })).toBeNull();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event("online")); });
  await act(async () => { verifies.at(-1)!.resolve({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not resend a completed fingerprint after the answer component fully unmounts and remounts", async () => {
  const board = fixture();
  vi.mocked(fetch).mockResolvedValue(Response.json(await answered(board, "STABLE ANSWER")));
  const { QuestionAnswer, createQuestionAnswerSession } = await import("./QuestionAnswer");
  const props = { board, question: "What about orchard?", onOpenThread: vi.fn(), onOpenIntention: vi.fn(),
    session: createQuestionAnswerSession() };
  const first = render(<QuestionAnswer {...props} />);
  await startAnswer();
  expect(screen.getByText("STABLE ANSWER")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);

  first.unmount();
  render(<QuestionAnswer {...props} />);
  await startAnswer();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText("STABLE ANSWER")).toBeTruthy();
});

it("does not call recall for an ordinary search phrase", async () => {
  vi.useFakeTimers();
  await setup(fixture(), "orchard planting");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(fetch).not.toHaveBeenCalled();
});

it("aborts a changed question and ignores its late response", async () => {
  vi.useFakeTimers();
  const first = deferred<Response>();
  const second = deferred<Response>();
  vi.mocked(fetch).mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const board = fixture();
  const view = await setup(board);
  await startAnswer();
  const firstSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  view.rerender(<view.QuestionAnswer {...view.props} question="Did I write about orchard planting?" />);
  expect(firstSignal?.aborted).toBe(true);
  await startAnswer();
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => { second.resolve(Response.json(await answered(board, "CURRENT ANSWER"))); });
  expect(screen.getByText("CURRENT ANSWER")).toBeTruthy();
  await act(async () => { first.resolve(Response.json(await answered(board, "STALE ANSWER"))); });
  expect(screen.queryByText("STALE ANSWER")).toBeNull();
  expect(screen.getByText("CURRENT ANSWER")).toBeTruthy();
});

it("rechecks disclosure authority when a connected item is opened during silent revalidation", async () => {
  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
  const verify = deferred<{ owner: string; expiresAt: number }>();
  stopWatches.push(lifetime.watch(() => verify.promise));
  const board = fixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(await answered(board, "CITED ANSWER")));
  const view = await setup(board, "What about orchard?");
  await startAnswer();
  screen.getByText("CITED ANSWER");
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(lifetime.snapshot()).toBe("active");
  fireEvent.click(screen.getAllByRole("button", { name: "Open thread: Orchard plan" })[0]);
  expect(view.props.onOpenThread).not.toHaveBeenCalled();
});

it.each(["revoked", "offline", "checking"])("removes sensitive output and rejects late bodies while %s", async mode => {
  const { installDocumentLifetime } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
  lifetime.keepOffline(true);
  const verify = deferred<{ owner: string; expiresAt: number }>();
  stopWatches.push(lifetime.watch(() => verify.promise));
  const late = deferred<unknown>();
  const board = fixture();
  vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true, json: () => late.promise } as Response);
  const view = await setup(board, "What about orchard?");
  await startAnswer();
  expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("X-Capture-Owner")).toBe("synthetic-owner");
  expect(screen.getByRole("status").textContent).toMatch(/answering/i);
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
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => { late.resolve(await answered(board, "LATE PRIVATE ANSWER")); });
  expect(screen.queryByText("LATE PRIVATE ANSWER")).toBeNull();
  if (mode !== "revoked") {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      verify.resolve({ owner: "synthetic-owner", expiresAt: Date.now() + 60000 });
    });
    expect(screen.queryByText(/Show submitted evidence/)).toBeNull();
    expect(screen.queryByText("LATE PRIVATE ANSWER")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
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
    const view = await setup(board, "What about orchard?");
    const stale = await answered(board, "RETIRED ANSWER");
    await startAnswer();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    if (change === "unmount") view.unmount();
    else {
      const changedBoard = fixture();
      changedBoard.threads[0].frags[0].text = "Orchard planting moved to late spring.";
      view.rerender(<view.QuestionAnswer {...view.props} question={change === "question" ? "What about planting?" : view.props.question} board={change === "board" ? changedBoard : board} />);
    }
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText(/Show submitted evidence/)).toBeNull();
    await act(async () => { late.resolve(Response.json(stale)); body.resolve(stale); });
    expect(screen.queryByText("RETIRED ANSWER")).toBeNull();
    if (change !== "unmount") {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "insufficient", claims: [] }));
      await startAnswer();
      expect(screen.getByRole("status").textContent).toBe("Not enough evidence in these matching notes to answer.");
      expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
      view.unmount();
    }
  }
});

it.each(["question", "board"])("clears completed sensitive output on %s change and does not resurrect it on return", async change => {
  const board = fixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(await answered(board, "PREVIOUS ANSWER")));
  const view = await setup(board, "What about orchard?");
  await startAnswer();
  screen.getByText("PREVIOUS ANSWER");
  const changedBoard = fixture();
  changedBoard.threads[0].frags[0].text = "Orchard planting moved to late spring.";
  view.rerender(<view.QuestionAnswer {...view.props} question={change === "question" ? "What about planting?" : view.props.question} board={change === "board" ? changedBoard : board} />);
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
  await setup(board, "What about orchard?");
  const stale = await answered(board, "TOO LATE");
  await startAnswer();
  expect(screen.getByRole("status").textContent).toMatch(/answering/i);
  await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
  expect(screen.getByRole("status").textContent).toMatch(/timed out/i);
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  await act(async () => { late.resolve(Response.json(stale)); body.resolve(stale); });
  expect(screen.queryByText("TOO LATE")).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(/timed out/i);
});

it("answers without stealing search focus", async () => {
  const response = deferred<Response>();
  vi.mocked(fetch).mockReset().mockReturnValueOnce(response.promise);
  const board = fixture();
  await setup(board, "What about orchard?");
  const searchView = render(<input aria-label="Search captures" />);
  const search = screen.getByRole("textbox", { name: "Search captures" }) as HTMLInputElement;
  search.focus();
  fireEvent.change(search, { target: { value: "Still typing" } });
  await startAnswer();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toMatch(/answering/i);
  expect(search.disabled).toBe(false);
  expect(document.activeElement).toBe(search);
  await act(async () => { response.resolve(Response.json(await answered(board, "CURRENT ANSWER"))); });
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
  expect(view.container.textContent).toBe("");
  await startAnswer();
  expect(fetch).not.toHaveBeenCalled();
});

it("does not even retrieve matching notes during render or query edits", async () => {
  const board = fixture();
  Object.defineProperty(board, "threads", { get() { throw new Error("No implicit retrieval"); } });
  const view = await setup(board, "What about orchard?");
  view.rerender(<view.QuestionAnswer {...view.props} question="orchard planting" />);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["", "ab", " ".repeat(10), "x".repeat(501)])("blocks invalid question length without retrieving or sending (%s)", async question => {
  const board = fixture();
  Object.defineProperty(board, "threads", { get() { throw new Error("Retrieval must not run"); } });
  const view = await setup(board, question);
  await startAnswer();
  expect(view.container.textContent).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

it("reports no matching evidence locally without sending an empty or unrelated board", async () => {
  await setup(fixture(), "What about volcanoes?");
  await startAnswer();
  expect(screen.getByRole("status").textContent).toMatch(/No matching evidence.*Try more specific words/i);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
});

it.each(["javascript:alert(1)", "__proto__", "quote-mismatch"])("rejects unverified server citations: %s", async kind => {
  const board = fixture();
  const { recallSources } = await import("@/lib/recall");
  const source = recallSources(board, "orchard")[0];
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "answered", claims: [{ text: "UNTRUSTED CLAIM",
    citations: [{ sourceId: kind === "quote-mismatch" ? source.id : kind,
      quote: kind === "quote-mismatch" ? "This quote never existed." : source.text }],
  }] }));
  const view = await setup(board, "What about orchard?");
  await startAnswer();
  expect(screen.getByRole("status").textContent).toMatch(/could not verify/i);
  expect(screen.queryByText("UNTRUSTED CLAIM")).toBeNull();
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  expect(view.container.querySelector("a, script, img")).toBeNull();
  expect(view.props.onOpenThread).not.toHaveBeenCalled();
});

it.each([503, 429])("reports HTTP %s as a failed request, not insufficient evidence", async status => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "insufficient", claims: [] }, { status }));
  await setup();
  await startAnswer();
  expect(screen.getByRole("status").textContent).toMatch(/could not get an answer/i);
  expect(screen.queryByText("Not enough evidence in these matching notes to answer.")).toBeNull();
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
});

it.each(["HTTP", "transport", "timeout", "invalid answer"])(
  "does not automatically loop after a %s failure and retries after the query changes away and returns",
  async failure => {
    const never = deferred<Response>();
    vi.mocked(fetch).mockReset();
    if (failure === "HTTP") vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    else if (failure === "transport") vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network unavailable"));
    else if (failure === "timeout") vi.mocked(fetch).mockReturnValueOnce(never.promise);
    else vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "answered", claims: [] }));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "insufficient", claims: [] }));

    const board = fixture();
    const question = "What about orchard planting?";
    const view = await setup(board, question);
    await startAnswer();
    if (failure === "timeout") {
      await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    }
    expect(screen.getByRole("status").textContent).toMatch(/could not|timed out/i);
    expect(fetch).toHaveBeenCalledTimes(1);

    view.rerender(<view.QuestionAnswer {...view.props} board={structuredClone(board)} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetch).toHaveBeenCalledTimes(1);

    view.rerender(<view.QuestionAnswer {...view.props} question="orchard planting" />);
    view.rerender(<view.QuestionAnswer {...view.props} question={question} />);
    await startAnswer();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toBe("Not enough evidence in these matching notes to answer.");
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  },
);

it("retries a failed question when its bounded source snapshot changes", async () => {
  vi.mocked(fetch).mockReset()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "insufficient", claims: [] }));
  const board = fixture();
  const view = await setup(board);
  await startAnswer();
  expect(screen.getByRole("status").textContent).toMatch(/could not get an answer/i);

  const changed = structuredClone(board);
  changed.threads[0].frags[0].text = "Orchard planting moved to late spring.";
  view.rerender(<view.QuestionAnswer {...view.props} board={changed} />);
  await startAnswer();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toBe("Not enough evidence in these matching notes to answer.");
  expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
});

it("sends only matching original evidence for a stable question", async () => {
  const { recallSources } = await import("@/lib/recall");
  const board = fixture();
  const before = JSON.stringify(board);
  const view = await setup(board, "orchard planting");
  await startAnswer();
  expect(fetch).not.toHaveBeenCalled();
  const question = "What about orchard?";
  view.rerender(<view.QuestionAnswer {...view.props} question={question} />);
  expect(fetch).not.toHaveBeenCalled();
  await startAnswer();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("/api/recall");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(init?.body as string)).toEqual({ question, sources: recallSources(board, question) });
  expect(init?.body).not.toContain("PRIVATE");
  expect(JSON.stringify(board)).toBe(before);
});

it("shows escaped cited claims with one minimal control per connected item", async () => {
  const board = fixture();
  const { recallSources } = await import("@/lib/recall");
  const sources = recallSources(board, "orchard");
  const text = '<img src=x onerror="alert(1)"> Orchard notes disagree.';
  vi.mocked(fetch).mockResolvedValue(Response.json({ status: "answered", claims: [{ text,
    citations: sources.map(source => ({ sourceId: source.id, quote: source.text })),
  }] }));
  const view = await setup(board, "What about orchard?");
  await startAnswer();
  expect(screen.getByRole("heading", { name: "Answer" })).toBeTruthy();
  expect(screen.getByText(text)).toBeTruthy();
  expect(view.container.querySelector("img, a, script")).toBeNull();
  expect(view.container.querySelector("blockquote, details, time")).toBeNull();
  expect(view.container.textContent).not.toMatch(/resolved|done|matching subset|submitted evidence/i);
  const threadButtons = screen.getAllByRole("button", { name: "Open thread: Orchard plan" });
  expect(threadButtons).toHaveLength(1);
  fireEvent.click(threadButtons[0]);
  expect(view.props.onOpenThread).toHaveBeenLastCalledWith("thread-1", "frag-2");
  fireEvent.click(screen.getAllByRole("button", { name: "Open intention: I tend my orchard patiently." })[0]);
  expect(view.props.onOpenIntention).toHaveBeenCalledWith("intent-1");
  expect(screen.queryByText("Orchard seedlings ordered")).toBeNull();
});
