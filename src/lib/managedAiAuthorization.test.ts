import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  withAdmission: vi.fn(async (_authorization, work: () => Promise<Response>) => work()),
  limiter: vi.fn(),
  provider: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("@/lib/cloudRequestGuard.server", () => ({
  authorizeManagedAiRequest: mocks.authorize,
  withManagedAiAdmission: mocks.withAdmission,
}));
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic-ip" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: mocks.limiter }));
vi.mock("@/lib/providers", () => ({ withFallback: mocks.provider }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));

import { POST as group } from "@/app/api/group/route";

const apiRoot = resolve(process.cwd(), "src/app/api");
const managedRoutes: Record<string, string[]> = {
  sort: ["POST"],
  distill: ["POST"],
  group: ["POST"],
  intention: ["POST"],
  judge: ["POST"],
  organize: ["POST"],
  recall: ["POST"],
  "recall/select": ["POST"],
  summarize: ["POST"],
  untangle: ["POST"],
  wrap: ["POST"],
  transcribe: ["POST"],
  tts: ["GET", "POST"],
};

function handlerBody(source: string, method: string): string {
  const start = source.indexOf(`export async function ${method}`);
  if (start < 0) throw new Error(`missing ${method}`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

describe("managed AI route authorization coverage", () => {
  it("keeps the discovered provider-route inventory pinned", () => {
    const providerRoutePattern = /from ["'](?:ai|@\/lib\/providers|msedge-tts)["']|api\.groq\.com|LOCAL_TRANSCRIBE_URL|TTS_URL/;
    const discovered = routeFiles(apiRoot)
      .filter((path) => providerRoutePattern.test(readFileSync(path, "utf8")))
      .map((path) => relative(apiRoot, path).replace(/\/route\.ts$/, ""))
      .sort();
    expect(discovered).toEqual(Object.keys(managedRoutes).sort());
  });

  for (const [route, methods] of Object.entries(managedRoutes)) {
    const source = readFileSync(resolve(apiRoot, route, "route.ts"), "utf8");
    const exportedMethods = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
      .map((match) => match[1])
      .sort();
    it(`pins every exported handler in /api/${route}`, () => {
      expect(exportedMethods).toEqual([...methods].sort());
    });
    for (const method of methods) {
      it(`${method} /api/${route} calls the shared guard before body, limiter, or provider work`, () => {
        expect(source).toContain('from "@/lib/cloudRequestGuard.server"');
        const body = handlerBody(source, method);
        const guard = body.indexOf("authorizeManagedAiRequest(request");
        const admission = body.search(/withManagedAiAdmission\(\w+/);
        expect(guard).toBeGreaterThan(0);
        expect(admission).toBeGreaterThan(guard);
        for (const marker of [
          "request.json(", "request.arrayBuffer(", "readBody(request", "modelRateLimit(",
          "transcribeRateLimit(", "ttsRateLimit(", "withFallback(", "generateObject(",
          "generateText(", "streamText(", "fetch(", "edgeSpeak(",
        ]) {
          const index = body.indexOf(marker);
          if (index >= 0) {
            expect(guard, `${route} ${method}: guard must precede ${marker}`).toBeLessThan(index);
            expect(admission, `${route} ${method}: admission must enclose ${marker}`).toBeLessThan(index);
          }
        }
      });
    }
  }

  it("does not read a denied request body or invoke the secondary IP limiter/provider", async () => {
    mocks.authorize.mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    const json = vi.fn().mockResolvedValue({ actions: ["private"] });
    const response = await group({ json } as unknown as Request);
    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.limiter).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("executes admitted work through the release-safe wrapper", async () => {
    mocks.authorize.mockResolvedValueOnce({ mode: "cloud", ownerId: "owner-a", admissionId: "admission-a" });
    mocks.limiter.mockReturnValue({ allowed: true, retryAfterSec: 0 });
    mocks.provider.mockResolvedValue({ value: { groups: [] }, via: "synthetic" });
    mocks.generate.mockResolvedValue({ object: { groups: [] } });
    const response = await group(new Request("https://capture.test/api/group", {
      method: "POST",
      headers: { "X-Capture-Owner": "owner-a" },
      body: JSON.stringify({ actions: [] }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.withAdmission).toHaveBeenCalledOnce();
  });
});
