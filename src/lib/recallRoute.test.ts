import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock external boundaries only; recall schemas, quote validator, owner
// precondition, and verified-claims identity extraction remain real.
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  fallback: vi.fn(),
  limiter: vi.fn(),
  config: vi.fn(),
  server: vi.fn(),
  claims: vi.fn(),
  managedAuthorize: vi.fn(),
  managedAdmission: vi.fn(async (_authorization, work: () => Promise<Response>) => work()),
  scheduleJevRecallShadow: vi.fn(),
}));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), generateText: mocks.generateText }));
vi.mock("@/lib/providers", () => ({ withFallback: mocks.fallback }));
vi.mock("@/lib/jevRecallShadow", () => ({ scheduleJevRecallShadow: mocks.scheduleJevRecallShadow }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: mocks.limiter }));
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({ createCloudServerClient: mocks.server }));
vi.mock("@/lib/cloudRequestGuard.server", () => ({
  authorizeManagedAiRequest: mocks.managedAuthorize,
  withManagedAiAdmission: mocks.managedAdmission,
}));

const source = {
  id: "source-1", kind: "thread", title: "Launch", text: "We decided to launch in October.",
  at: 1_700_000_000_000, targetId: "thread-1", fragId: "frag-1", state: "active", truncated: false,
};
const answer = { status: "answered", claims: [{ text: source.text, citations: [{ sourceId: source.id, quote: source.text }] }] };
const body = () => ({ question: "  When is launch?  ", sources: [source] });
const request = (value: unknown = body(), headers?: HeadersInit) => new Request("http://localhost/api/recall", {
  method: "POST", headers, body: JSON.stringify(value),
});
const post = async (req = request()) => (await import("@/app/api/recall/route")).POST(req);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue(null);
  mocks.managedAuthorize.mockResolvedValue({ mode: "non-cloud" });
  mocks.limiter.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.server.mockResolvedValue({ auth: { getClaims: mocks.claims } });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "owner", exp: Date.now() / 1000 + 3600 } }, error: null });
  mocks.generateText.mockResolvedValue({ output: answer });
  mocks.fallback.mockImplementation(async (attempt) => ({ value: await attempt({ name: "fixture", model: "fixture-model", providerOptions: { fixture: { mode: "fast" } } }), via: "fixture" }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("POST /api/recall", () => {
  it.each([
    ["no sources", { ...body(), sources: [] }],
    ["too many sources", { ...body(), sources: Array.from({ length: 13 }, (_, i) => ({ ...source, id: `s-${i}` })) }],
    ["duplicate IDs", { ...body(), sources: [source, source] }],
    ["short question", { ...body(), question: " x " }],
    ["long question", { ...body(), question: "x".repeat(501) }],
    ["wrong question type", { ...body(), question: 42 }],
    ["extra top-level metadata", { ...body(), board: {} }],
    ["source overflow", { ...body(), sources: [{ ...source, text: "x".repeat(1501) }] }],
    ["extra source metadata", { ...body(), sources: [{ ...source, secret: "ignore this" }] }],
    ["invalid kind", { ...body(), sources: [{ ...source, kind: "board" }] }],
    ["invalid state", { ...body(), sources: [{ ...source, state: "guess" }] }],
    ["invalid timestamp", { ...body(), sources: [{ ...source, at: null }] }],
    ["string timestamp", { ...body(), sources: [{ ...source, at: "1700000000000" }] }],
    ["missing truncation", { ...body(), sources: [{ ...source, truncated: undefined }] }],
    ["blank ID", { ...body(), sources: [{ ...source, id: " " }] }],
    ["blank target", { ...body(), sources: [{ ...source, targetId: " " }] }],
    ["blank text", { ...body(), sources: [{ ...source, text: " " }] }],
  ])("rejects %s before model access", async (_label, payload) => {
    const response = await post(request(payload));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and nonfinite numeric JSON", async () => {
    for (const payload of ["{bad", JSON.stringify(body()).replace(String(source.at), "1e999")]) {
      const response = await post(new Request("http://localhost/api/recall", { method: "POST", body: payload }));
      expect(response.status).toBe(400);
    }
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("counts actual UTF-8 body bytes before JSON parsing, not character or declared lengths", async () => {
    // Valid bounded fields but a JSON whitespace prefix pushes the body over 64 KiB.
    const payload = " ".repeat(64 * 1024) + JSON.stringify(body());
    const response = await post(new Request("http://localhost/api/recall", { method: "POST", headers: { "content-length": "1" }, body: payload }));
    expect(response.status).toBe(413);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects chunked oversized bodies and cancels the reader", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { chunks += 1; if (chunks > 5) controller.close(); else controller.enqueue(new TextEncoder().encode("界".repeat(12_000))); },
      cancel,
    });
    const response = await post(new Request("http://localhost/api/recall", { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(response.status).toBe(413);
    expect(chunks).toBeLessThanOrEqual(4);
    expect(cancel).toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("accepts valid chunked JSON at exactly the byte cap", async () => {
    const json = JSON.stringify(body());
    const bytes = new TextEncoder().encode(" ".repeat(64 * 1024 - new TextEncoder().encode(json).length) + json);
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 1000)); controller.enqueue(bytes.slice(1000)); controller.close();
    } });
    expect((await post(new Request("http://localhost/api/recall", { method: "POST", body: stream, duplex: "half" } as RequestInit))).status).toBe(200);
  });
  it("keeps cited answers available on the non-Cloud local product", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "1");
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.limiter).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it("uses the existing limiter and returns a private retryable rejection", async () => {
    mocks.limiter.mockReturnValue({ allowed: false, retryAfterSec: 17 });
    const response = await post();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  describe("Cloud owner gates", () => {
    beforeEach(() => mocks.config.mockReturnValue({ status: "ready", url: "https://synthetic.invalid", publishableKey: "synthetic" }));

    it("requires independently verified identity before trusting the owner header", async () => {
      mocks.claims.mockResolvedValue({ data: null, error: new Error("private auth detail") });
      const response = await post(request(body(), { "X-Capture-Owner": "owner" }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(mocks.generateText).not.toHaveBeenCalled();
    });

    it.each([
      ["missing owner", undefined, 428],
      ["mismatched owner", "other-owner", 412],
      ["verified owner", "owner", 200],
    ] as const)("checks %s with the real owner precondition", async (_name, owner, status) => {
      const response = await post(request(body(), owner ? { "X-Capture-Owner": owner } : undefined));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.generateText).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
      expect(mocks.claims).toHaveBeenCalledTimes(1);
    });

    it.each([0, -1, NaN, Infinity, "later", null, undefined])("fails closed for invalid or expired exp %s", async (exp) => {
      mocks.claims.mockResolvedValue({ data: { claims: { sub: "owner", exp } }, error: null });
      expect((await post(request(body(), { "X-Capture-Owner": "owner" }))).status).toBe(401);
      expect(mocks.generateText).not.toHaveBeenCalled();
    });

    it("fails closed on unavailable Cloud configuration", async () => {
      mocks.config.mockReturnValue({ status: "missing" });
      expect((await post()).status).toBe(503);
      expect(mocks.server).not.toHaveBeenCalled();
      expect(mocks.generateText).not.toHaveBeenCalled();
    });

    it("fails closed when the auth client is unavailable without exposing its error", async () => {
      mocks.server.mockRejectedValue(new Error("secret unavailable"));
      const response = await post();
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain("secret");
      expect(mocks.generateText).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["forged quote", { status: "answered", claims: [{ text: "It launches soon", citations: [{ sourceId: source.id, quote: "An invented October decision" }] }] }],
    ["forged source ID", { status: "answered", claims: [{ text: "It launches soon", citations: [{ sourceId: "not-selected", quote: source.text }] }] }],
    ["uncited claim", { status: "answered", claims: [{ text: "It launches soon", citations: [] }] }],
    ["extra model fields", { ...answer, leaked: "private model output" }],
    ["empty answered claims", { status: "answered", claims: [] }],
    ["insufficient with claims", { status: "insufficient", claims: answer.claims }],
    ["missing output", undefined],
  ])("rejects %s rather than returning an invented or partly salvaged result", async (_label, output) => {
    mocks.generateText.mockResolvedValue({ output });
    const response = await post();
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("returns honest insufficient evidence without inventing a claim", async () => {
    const insufficient = { status: "insufficient", claims: [] };
    mocks.generateText.mockResolvedValue({ output: insufficient });
    expect(await (await post()).json()).toEqual(insufficient);
  });

  it("keeps dead-provider details and captured text out of errors and fallback logs", async () => {
    const raw = Object.assign(new Error("private question and source text"), { statusCode: 429, requestBodyValues: body() });
    mocks.generateText.mockRejectedValue(raw);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fallback.mockImplementation(async (attempt) => {
      try { return { value: await attempt({ name: "fixture", model: "fixture" }) }; }
      catch (failure) { console.warn(failure); throw failure; }
    });
    const response = await post();
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private question");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
    const logged = warn.mock.calls[0][0];
    expect(logged).not.toBe(raw);
    expect(logged.message).not.toContain("private");
    expect(logged.requestBodyValues).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it("uses structured output with bounded instructions and evidence isolated as data", async () => {
    await post();
    const call = mocks.generateText.mock.calls[0][0];
    expect(call.output).toBeDefined();
    expect(call.instructions).toMatch(/insufficient/);
    expect(call.instructions).toMatch(/disagree/i);
    expect(call.instructions).toMatch(/dates/i);
    expect(call.instructions).toMatch(/state/i);
    expect(call.instructions).toMatch(/speculation/i);
    expect(call.instructions).not.toContain(source.text);
    expect(call.providerOptions).toEqual({ fixture: { mode: "fast" } });
    expect(mocks.fallback.mock.calls[0][1]).toBe("fast");
  });

  describe("bounded lifetime", () => {
    it("starts the one route deadline before a stalled managed Cloud guard", async () => {
      vi.useFakeTimers();
      let guardSignal: AbortSignal | undefined;
      mocks.managedAuthorize.mockImplementation((_request, options) => {
        guardSignal = options?.signal;
        return new Promise(() => {});
      });
      let response: Response | undefined;
      void post().then((value) => { response = value; });

      await vi.advanceTimersByTimeAsync(44_999);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);

      expect(response?.status).toBe(504);
      expect(guardSignal?.aborted).toBe(true);
      expect(mocks.generateText).not.toHaveBeenCalled();
    });

    it("caps a stalled provider attempt at 10 seconds and can use the next configured tier", async () => {
      vi.useFakeTimers();
      mocks.generateText.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ output: answer });
      mocks.fallback.mockImplementation(async (attempt) => {
        try { return { value: await attempt({ name: "first", model: "first" }) }; }
        catch { return { value: await attempt({ name: "second", model: "second" }) }; }
      });
      let response: Response | undefined;
      void post().then((value) => { response = value; });
      await vi.advanceTimersByTimeAsync(9999);
      expect(response).toBeUndefined();
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(response?.status).toBe(200);
      expect(mocks.generateText).toHaveBeenCalledTimes(2);
      expect(mocks.generateText.mock.calls[0][0].abortSignal.aborted).toBe(true);
    });

    it("bounds stalled request reading by the same 45-second wall clock and cancels its stream", async () => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel });
      let response: Response | undefined;
      void post(new Request("http://localhost/api/recall", { method: "POST", body: stream, duplex: "half" } as RequestInit)).then((value) => { response = value; });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(response?.status).toBe(504);
      expect(cancel).toHaveBeenCalled();
      expect(mocks.generateText).not.toHaveBeenCalled();
    });

    it("counts request reading plus fallback waits and never calls a model after the deadline", async () => {
      vi.useFakeTimers();
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        setTimeout(() => { controller.enqueue(new TextEncoder().encode(JSON.stringify(body()))); controller.close(); }, 39_000);
      } });
      mocks.generateText.mockRejectedValue(Object.assign(new Error("limited"), { statusCode: 429 }));
      mocks.fallback.mockImplementation(async (attempt) => {
        try { return { value: await attempt({ name: "fixture", model: "fixture" }) }; }
        catch { await new Promise((resolve) => setTimeout(resolve, 18_000)); return { value: await attempt({ name: "retry", model: "retry" }) }; }
      });
      let response: Response | undefined;
      void post(new Request("http://localhost/api/recall", { method: "POST", body: stream, duplex: "half" } as RequestInit)).then((value) => { response = value; });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(response?.status).toBe(504);
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
    });

    it.each(["reading", "provider", "auth"])("honors request cancellation while %s without a late provider call", async (phase) => {
      vi.useFakeTimers();
      const abort = new AbortController();
      const cancel = vi.fn();
      let req = new Request("http://localhost/api/recall", { method: "POST", body: JSON.stringify(body()), signal: abort.signal });
      if (phase === "reading") {
        req = new Request("http://localhost/api/recall", { method: "POST", body: new ReadableStream({ pull() { return new Promise(() => {}); }, cancel }), signal: abort.signal, duplex: "half" } as RequestInit);
      }
      if (phase === "provider") mocks.generateText.mockImplementation(() => new Promise(() => {}));
      if (phase === "auth") {
        mocks.config.mockReturnValue({ status: "ready" });
        mocks.claims.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: { claims: { sub: "owner", exp: Date.now() / 1000 + 100 } }, error: null }), 20_000)));
      }
      let response: Response | undefined;
      void post(req).then((value) => { response = value; });
      await vi.advanceTimersByTimeAsync(1);
      abort.abort(new Error("private abort detail"));
      await vi.advanceTimersByTimeAsync(0);
      expect(response?.status).toBe(499);
      expect(response?.headers.get("cache-control")).toBe("private, no-store");
      if (phase === "reading") expect(cancel).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.generateText).toHaveBeenCalledTimes(phase === "provider" ? 1 : 0);
    });

    it("does not spend quota when cancellation arrives during a fallback wait", async () => {
      vi.useFakeTimers();
      const abort = new AbortController();
      mocks.generateText.mockRejectedValue(Object.assign(new Error("limited"), { statusCode: 429 }));
      mocks.fallback.mockImplementation(async (attempt) => {
        try { return { value: await attempt({ name: "fixture", model: "fixture" }) }; }
        catch { await new Promise((resolve) => setTimeout(resolve, 18_000)); return { value: await attempt({ name: "retry", model: "retry" }) }; }
      });
      let response: Response | undefined;
      void post(new Request("http://localhost/api/recall", { method: "POST", body: JSON.stringify(body()), signal: abort.signal })).then((value) => { response = value; });
      await vi.advanceTimersByTimeAsync(1);
      abort.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(response?.status).toBe(499);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("caps successive stalled attempts at the overall deadline, not 10 seconds per tier forever", async () => {
      vi.useFakeTimers();
      mocks.generateText.mockImplementation(() => new Promise(() => {}));
      mocks.fallback.mockImplementation(async (attempt) => {
        for (let i = 0; i < 8; i++) {
          try { return { value: await attempt({ name: `fixture-${i}`, model: "fixture" }) }; }
          catch { /* a configured fallback tier is available */ }
        }
        throw new Error("all failed");
      });
      let response: Response | undefined;
      void post().then((value) => { response = value; });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(response?.status).toBe(504);
      expect(mocks.generateText).toHaveBeenCalledTimes(5);
      expect(mocks.generateText.mock.calls.every(([options]) => options.abortSignal.aborted)).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.generateText).toHaveBeenCalledTimes(5);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("clears timeout timers after success and invalid input", async () => {
      vi.useFakeTimers();
      expect((await post()).status).toBe(200);
      expect(vi.getTimerCount()).toBe(0);
      expect((await post(request({ ...body(), sources: [] }))).status).toBe(400);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not begin any work for an already aborted request", async () => {
      const abort = new AbortController(); abort.abort();
      const response = await post(new Request("http://localhost/api/recall", { method: "POST", body: JSON.stringify(body()), signal: abort.signal }));
      expect(response.status).toBe(499);
      expect(mocks.generateText).not.toHaveBeenCalled();
      expect(mocks.server).not.toHaveBeenCalled();
    });

    it("rejects identity that expires while a slow body is being read", async () => {
      vi.useFakeTimers();
      mocks.config.mockReturnValue({ status: "ready" });
      mocks.claims.mockResolvedValue({ data: { claims: { sub: "owner", exp: Date.now() / 1000 + 1 } }, error: null });
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        setTimeout(() => { controller.enqueue(new TextEncoder().encode(JSON.stringify(body()))); controller.close(); }, 1500);
      } });
      let response: Response | undefined;
      void post(new Request("http://localhost/api/recall", { method: "POST", headers: { "X-Capture-Owner": "owner" }, body: stream, duplex: "half" } as RequestInit)).then((value) => { response = value; });
      await vi.advanceTimersByTimeAsync(1500);
      expect(response?.status).toBe(401);
      expect(mocks.generateText).not.toHaveBeenCalled();
    });
  });

  it("schedules an inert Jev Recall shadow only after the authoritative cited result exists", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
    expect(mocks.scheduleJevRecallShadow).toHaveBeenCalledOnce();
    expect(mocks.scheduleJevRecallShadow).toHaveBeenCalledWith({
      ...body(),
      question: "When is launch?",
      authoritativeAnswer: answer,
    }, { authorization: { mode: "non-cloud" } });
  });

  it("does not schedule the shadow when authoritative Recall fails", async () => {
    mocks.generateText.mockRejectedValue(new Error("synthetic provider failure"));

    expect((await post()).status).toBe(502);
    expect(mocks.scheduleJevRecallShadow).not.toHaveBeenCalled();
  });

  it("returns a directly usable cited answer with private no-store headers", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const call = mocks.generateText.mock.calls[0][0];
    expect(call.maxRetries).toBe(0);
    expect(call.maxOutputTokens).toBeGreaterThan(0);
    expect(call.maxOutputTokens).toBeLessThanOrEqual(2000);
    expect(call.instructions).toMatch(/question.*data/i);
    expect(call.tools).toBeUndefined();
    expect(JSON.parse(call.prompt)).toEqual({ ...body(), question: "When is launch?" });
  });
});
