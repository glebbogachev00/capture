import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/proxy", () => ({ refreshCloudSession: vi.fn(async () => NextResponse.next()) }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function proxyFor(playground: string, publicSite: string, cloud: string, password = "") {
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", playground);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_SITE", publicSite);
  vi.stubEnv("CAPTURE_CLOUD", cloud);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("APP_PASSWORD", password);
  return (await import("@/proxy")).proxy;
}
const request = (path: string, method = "GET") => new NextRequest(`https://capture.test${path}`, { method });

describe("public-site proxy safety", () => {
  it("keeps public Cloud landing, writing, and local app anonymous with the legacy password set", async () => {
    const proxy = await proxyFor("0", "1", "1", "private-password");
    for (const path of ["/", "/app", "/writing", "/writing/example", "/api/cloud/subscription", "/api/cloud/board", "/api/sync"]) {
      expect((await proxy(request(path))).status, path).toBe(200);
    }
  });

  it.each([["public Cloud", "1", "1"], ["private Cloud", "0", "1"], ["public without Cloud", "1", "0"]])(
    "%s never exposes the shared image hub or private service endpoints",
    async (_label, publicSite, cloud) => {
      const proxy = await proxyFor("0", publicSite, cloud);
      for (const [path, methods, status] of [
        ["/api/img/photo-id", ["GET", "HEAD", "PUT"], cloud === "1" ? 200 : 404],
        ["/api/transcribe", ["POST"], 404],
        ["/api/tts", ["GET", "POST"], 404],
        ["/api/report", ["POST"], 501],
      ] as const) {
        for (const method of methods) expect((await proxy(request(path, method))).status, `${method} ${path}`).toBe(status);
      }
    },
  );

  it("Cloud images bypass only the legacy password and reach their own route guard", async () => {
    const proxy = await proxyFor("0", "1", "1", "private-password");
    for (const method of ["GET", "HEAD", "PUT"]) {
      expect((await proxy(request("/api/img/photo", method))).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("public without Cloud never falls back to the shared board hub", async () => {
    const proxy = await proxyFor("0", "1", "0");
    for (const method of ["GET", "POST"]) expect((await proxy(request("/api/sync", method))).status).toBe(404);
  });

  it("legacy playground still blocks Cloud and sync even when Cloud is enabled", async () => {
    const proxy = await proxyFor("1", "0", "1");
    for (const path of ["/api/cloud/board", "/api/cloud/subscription", "/api/sync", "/api/img/x", "/api/tts", "/api/transcribe", "/api/report"]) {
      expect((await proxy(request(path))).status, path).toBe(404);
    }
  });

  it("self-hosted default retains private services and its password boundary", async () => {
    let proxy = await proxyFor("0", "0", "0");
    for (const path of ["/api/sync", "/api/img/x", "/api/transcribe", "/api/tts", "/api/report"]) {
      expect((await proxy(request(path))).status, path).toBe(200);
    }
    vi.resetModules();
    proxy = await proxyFor("0", "0", "0", "private-password");
    expect((await proxy(request("/app"))).status).toBe(307);
    expect((await proxy(request("/api/sync"))).status).toBe(401);
  });
});
