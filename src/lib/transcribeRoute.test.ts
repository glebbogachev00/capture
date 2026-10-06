import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls: string[] = [];

function request(bytes: number) {
  return new Request("https://capture.test/api/transcribe", {
    method: "POST",
    headers: { "content-type": "audio/mp4", "x-forwarded-for": `203.0.113.${calls.length + Math.floor(Math.random() * 200)}` },
    body: new Uint8Array(bytes),
  });
}

async function route(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ CAPTURE_DICTATION_CLEANUP: "0", ...env })) vi.stubEnv(key, value);
  return import("@/app/api/transcribe/route");
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).startsWith("http://127.0.0.1")) throw new Error("no local server in tests");
    return new Response(JSON.stringify({ text: "Call the bank" }));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("the free version transcribes with Groq only, never the owner's Mac", async () => {
  const { POST } = await route({ NEXT_PUBLIC_PLAYGROUND: "1", GROQ_API_KEY: "test-key" });
  const response = await POST(request(4_000));
  expect(await response.json()).toEqual({ text: "Call the bank" });
  expect(calls).toEqual(["https://api.groq.com/openai/v1/audio/transcriptions"]);
});

it("Cloud transcribes with Groq only too", async () => {
  const { POST } = await route({ NEXT_PUBLIC_PUBLIC_SITE: "1", GROQ_API_KEY: "test-key" });
  expect((await POST(request(4_000))).status).toBe(200);
  expect(calls.some((url) => url.startsWith("http://127.0.0.1"))).toBe(false);
});

it("a public deployment refuses a recording longer than a few minutes", async () => {
  const { POST } = await route({ NEXT_PUBLIC_PLAYGROUND: "1", GROQ_API_KEY: "test-key" });
  const response = await POST(request(4_000_001));
  expect(response.status).toBe(413);
  expect(calls).toEqual([]);
});

it("without a Groq key a public deployment says voice is unavailable, without waiting on a Mac", async () => {
  const { POST } = await route({ NEXT_PUBLIC_PLAYGROUND: "1" });
  const response = await POST(request(4_000));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "voice isn't available right now" });
  expect(calls).toEqual([]);
});

it("a self-hosted Capture still tries the local transcriber first", async () => {
  const { POST } = await route({ GROQ_API_KEY: "test-key" });
  expect((await POST(request(4_000))).status).toBe(200);
  expect(calls[0]).toMatch(/^http:\/\/127\.0\.0\.1/);
});
