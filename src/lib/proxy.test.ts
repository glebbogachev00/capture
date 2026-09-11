import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/playground", () => ({ PLAYGROUND: false, isClosedInPlayground: () => false }));
vi.mock("@/lib/auth", () => ({ AUTH_COOKIE: "capture-session", isValidSession: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/seo", () => ({ isPublicHome: () => false }));

import { proxy } from "../proxy";

describe("legacy proxy and Cloud boundary", () => {
  it("does not intercept Cloud routes with the deployment password", async () => {
    vi.stubEnv("APP_PASSWORD", "configured");
    try {
      const response = await proxy(new NextRequest("https://capture.test/api/cloud/board"));
      expect(response.status).toBe(200);
    } finally { vi.unstubAllEnvs(); }
  });

  it("still gates existing private APIs", async () => {
    vi.stubEnv("APP_PASSWORD", "configured");
    try {
      const response = await proxy(new NextRequest("https://capture.test/api/sync"));
      expect(response.status).toBe(401);
    } finally { vi.unstubAllEnvs(); }
  });
});
