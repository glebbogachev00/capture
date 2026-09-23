import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  admission: vi.fn(async (_authorization, work: () => Promise<Response>) => work()),
  generateText: vi.fn(),
  fallback: vi.fn(),
  limiter: vi.fn(),
}));
vi.mock("@/lib/cloudRequestGuard.server", () => ({
  authorizeManagedAiRequest: mocks.authorize,
  withManagedAiAdmission: mocks.admission,
}));
vi.mock("@/lib/providers", () => ({ withFallback: mocks.fallback }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: mocks.limiter }));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), generateText: mocks.generateText }));

const topics = [
  { id: "capture", name: "Capture", about: "A thinking system for Actions, Threads, and Intentions.", at: 10 },
  { id: "kitchen", name: "Kitchen", about: "Recipes and groceries.", at: 20 },
];
const body = { question: "What is Capture?", topics };
const request = (value: unknown = body) => new Request("http://localhost/api/recall/select", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
const post = async (req = request()) => (await import("@/app/api/recall/select/route")).POST(req);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ mode: "non-cloud" });
  mocks.limiter.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.generateText.mockResolvedValue({ output: { threadIds: ["capture"] } });
  mocks.fallback.mockImplementation(async (attempt) => ({
    value: await attempt({ model: "fixture", providerOptions: {}, name: "fixture" }),
    via: "fixture",
  }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("POST /api/recall/select", () => {
  it("selects semantically relevant topic IDs through the guarded provider path", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ threadIds: ["capture"] });
    expect(mocks.authorize).toHaveBeenCalledOnce();
    expect(mocks.admission).toHaveBeenCalledOnce();
    const call = mocks.generateText.mock.calls[0][0];
    expect(call.prompt).toBe(JSON.stringify(body));
    expect(call.instructions).toMatch(/meaning, not exact word overlap/i);
    expect(call.instructions).toMatch(/not evidence/i);
  });

  it.each([
    ["malformed JSON", "{bad"],
    ["short question", { ...body, question: "x" }],
    ["unknown field", { ...body, board: {} }],
    ["duplicate topic IDs", { ...body, topics: [topics[0], topics[0]] }],
    ["oversized topic", { ...body, topics: [{ ...topics[0], about: "x".repeat(701) }] }],
  ])("rejects %s without provider access", async (_label, value) => {
    const req = typeof value === "string"
      ? new Request("http://localhost/api/recall/select", { method: "POST", body: value })
      : request(value);
    const response = await post(req);
    expect(response.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects a provider-selected ID outside the submitted snapshot", async () => {
    mocks.generateText.mockResolvedValue({ output: { threadIds: ["missing"] } });
    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("bounds chunked request bodies at 64 KiB before provider access", async () => {
    const chunk = new TextEncoder().encode("x".repeat(40 * 1024));
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads > 2) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = await post(new Request("http://localhost/api/recall/select", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(reads).toBeLessThanOrEqual(3);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("returns an empty selection without provider work when no topics exist", async () => {
    const response = await post(request({ question: body.question, topics: [] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ threadIds: [] });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("does not read a request body after the shared Cloud guard denies it", async () => {
    mocks.authorize.mockResolvedValue(Response.json({ error: "denied" }, { status: 401 }));
    const arrayBuffer = vi.fn();
    const response = await post({ headers: new Headers(), arrayBuffer } as unknown as Request);
    expect(response.status).toBe(401);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mocks.limiter).not.toHaveBeenCalled();
  });

  it("hard-stops a provider attempt after ten seconds even when it ignores AbortSignal", async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    mocks.generateText.mockImplementation(({ abortSignal }) => {
      providerSignal = abortSignal;
      return new Promise(() => {});
    });
    let settled = false;
    const pending = post().then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(true);
    expect(providerSignal?.aborted).toBe(true);
    expect((await pending).status).toBe(502);
  });

  it("hard-stops the whole fallback when its provider adapter never settles", async () => {
    vi.useFakeTimers();
    mocks.fallback.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const pending = post().then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(55_000);
    expect(settled).toBe(true);
    expect((await pending).status).toBe(504);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("starts the one route deadline before a stalled managed Cloud guard", async () => {
    vi.useFakeTimers();
    let guardSignal: AbortSignal | undefined;
    mocks.authorize.mockImplementation((_request, options) => {
      guardSignal = options?.signal;
      return new Promise(() => {});
    });
    let response: Response | undefined;
    void post().then((value) => { response = value; });
    await vi.advanceTimersByTimeAsync(54_999);
    expect(response).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(response?.status).toBe(504);
    expect(guardSignal?.aborted).toBe(true);
    expect(mocks.admission).not.toHaveBeenCalled();
  });

  it("propagates request cancellation into an active provider and settles without its cooperation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    mocks.generateText.mockImplementation(({ abortSignal }) => {
      providerSignal = abortSignal;
      return new Promise(() => {});
    });
    const req = new Request("http://localhost/api/recall/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let settled = false;
    const pending = post(req).then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("client left"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(providerSignal?.aborted).toBe(true);
    expect((await pending).status).toBe(499);
  });

  it("keeps the route's deployment duration at sixty seconds", async () => {
    expect((await import("@/app/api/recall/select/route")).maxDuration).toBe(60);
  });
});
