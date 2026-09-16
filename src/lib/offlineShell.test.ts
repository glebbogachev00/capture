import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
function worker() {
  const handlers: Record<string, (event: object) => void> = {};
  const saved = new Map<string, Response>();
  const cache = { put: vi.fn(async (request, response) => { saved.set(typeof request === "string" ? request : request.url, response); }), keys: async () => [], addAll: async () => {} };
  const fetch = vi.fn(async () => new Response("shell"));
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self: { location: { origin: "https://capture.test" }, addEventListener: (name: string, callback: (event: object) => void) => { handlers[name] = callback; }, skipWaiting() {} }, URL, Response, AbortController, setTimeout, clearTimeout, fetch, caches: { open: async () => cache, match: async (key: string) => saved.get(key) } });
  const request = (path: string, mode = "navigate", headers: Record<string, string> = {}) => {
    const respondWith = vi.fn();
    handlers.fetch({ request: { url: `https://capture.test${path}`, method: "GET", mode, headers: new Headers(headers) }, respondWith, waitUntil: vi.fn() });
    return respondWith;
  };
  return { request, fetch, cache, saved };
}
it("never caches API, auth pages, private documents or RSC responses", () => {
  const sw = worker();
  for (const path of ["/api/cloud/identity", "/api/img/private", "/login", "/auth/callback?code=secret", "/private"]) expect(sw.request(path)).not.toHaveBeenCalled();
  expect(sw.request("/app?_rsc=private", "cors", { RSC: "1" })).not.toHaveBeenCalled();
});
it("keeps a successful generic app shell for exact-path offline cold navigation, not redirects or errors", async () => {
  const sw = worker();
  const response = sw.request("/app");
  await response.mock.calls[0][0];
  await Promise.resolve();
  expect(sw.cache.put).toHaveBeenCalled();
  sw.fetch.mockRejectedValueOnce(new TypeError("offline"));
  const offline = await sw.request("/app?from=home").mock.calls[0][0];
  expect(await offline.text()).toBe("shell");
  sw.cache.put.mockClear();
  sw.fetch.mockResolvedValueOnce(new Response("bad", { status: 503 }));
  await sw.request("/app").mock.calls[0][0];
  expect(sw.cache.put).not.toHaveBeenCalled();
});

it.each(["/", "/app"])("bounds a stalled installed shell navigation at %s without mixing paths", async path => {
  vi.useFakeTimers();
  try {
    const sw = worker();
    sw.saved.set(path, new Response(`saved ${path}`));
    sw.fetch.mockImplementationOnce(() => new Promise(() => {}));
    const result = vi.fn();
    const pending = sw.request(path).mock.calls[0][0].then(result);
    await vi.advanceTimersByTimeAsync(5000);
    expect(result).toHaveBeenCalled();
    expect(await result.mock.calls[0][0].text()).toBe(`saved ${path}`);
    await pending;
    expect(sw.cache.put).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
