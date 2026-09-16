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

const landingAssets = [
  "/brands/notion.png",
  "/brands/obsidian.svg",
  "/screenshots/distill-mode.png",
  "/screenshots/record-heatmap.png",
  "/og-clarity.png",
];

const deployments = [
  ["public Cloud", "0", "1", "1"],
  ["public without Cloud", "0", "1", "0"],
  ["private Cloud", "0", "0", "1"],
  ["private self-hosted", "0", "0", "0"],
  ["legacy playground", "1", "0", "1"],
] as const;

describe.each(deployments)("%s landing assets with a legacy password", (_label, playground, publicSite, cloud) => {
  it.each(["GET", "HEAD"])("passes anonymous %s requests for the exact landing assets", async (method) => {
    const proxy = await proxyFor(playground, publicSite, cloud, "private-password");
    for (const path of landingAssets) {
      const response = await proxy(request(path, method));
      expect.soft(response.status, `${method} ${path}`).toBe(200);
      expect.soft(response.headers.get("x-middleware-next"), `${method} ${path}`).toBe("1");
      expect.soft(response.headers.get("location"), `${method} ${path}`).toBeNull();
    }
  });

  it.each(["GET", "HEAD"])("keeps directories, sibling names, and suffix paths gated for %s", async (method) => {
    const proxy = await proxyFor(playground, publicSite, cloud, "private-password");
    const deniedPaths = [
      "/brands", "/brands/", "/brands/private.png",
      "/screenshots", "/screenshots/", "/screenshots/private.png",
      "/og-private.png",
      ...landingAssets.flatMap((path) => [`${path}.bak`, `${path}/`, `${path}/private`]),
    ];
    for (const path of deniedPaths) {
      const response = await proxy(request(path, method));
      expect(response.status, `${method} ${path}`).toBe(307);
      expect(response.headers.get("x-middleware-next"), `${method} ${path}`).toBeNull();
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toMatch(/^\/login\/?$/);
      expect(location.searchParams.get("next")).toBe(path);
    }
  });

  it.each(["POST", "PUT", "DELETE"])("does not exempt %s requests to asset names", async (method) => {
    const proxy = await proxyFor(playground, publicSite, cloud, "private-password");
    for (const path of landingAssets) {
      expect((await proxy(request(path, method))).status, `${method} ${path}`).toBe(307);
    }
  });

  it.each(["GET", "HEAD"])("keeps unrelated private routes and APIs gated for %s", async (method) => {
    const proxy = await proxyFor(playground, publicSite, cloud, "private-password");
    for (const path of ["/private", "/app/private", ...(publicSite === "0" && playground === "0" ? ["/app", "/writing"] : [])]) {
      expect((await proxy(request(path, method))).status, `${method} ${path}`).toBe(307);
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const path of ["/api/private", "/api/brands/notion.png", "/api/screenshots/distill-mode.png", "/api/og-clarity.png"]) {
        const response = await proxy(request(path, method));
        expect(response.status, `${method} ${path}`).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
      }
    } finally {
      warn.mockRestore();
    }
  });
});

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
