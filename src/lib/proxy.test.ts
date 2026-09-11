import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/playground", () => ({ PLAYGROUND: false, isClosedInPlayground: () => false }));
vi.mock("@/lib/auth", () => ({ AUTH_COOKIE: "capture-session", isValidSession: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/seo", () => ({ isPublicHome: () => false }));
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: vi.fn(() => null) }));
vi.mock("@/lib/supabase/proxy", () => ({ refreshCloudSession: vi.fn() }));

import { getCloudConfig } from "@/lib/supabase/config";
import { refreshCloudSession } from "@/lib/supabase/proxy";
import { proxy } from "../proxy";

const mockedGetCloudConfig = vi.mocked(getCloudConfig);
const mockedRefreshCloudSession = vi.mocked(refreshCloudSession);

describe("legacy proxy and Cloud boundary", () => {
  beforeEach(() => {
    mockedGetCloudConfig.mockReturnValue(null);
    mockedRefreshCloudSession.mockReset();
  });

  it("returns Supabase's refreshed session response when Cloud is configured", async () => {
    const config = {
      status: "ready" as const,
      url: "https://capture.supabase.co",
      publishableKey: "sb_publishable_test",
    };
    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-capture-auth-token", "refreshed", {
      path: "/",
      httpOnly: true,
    });
    mockedGetCloudConfig.mockReturnValue(config);
    mockedRefreshCloudSession.mockResolvedValue(refreshed);

    const request = new NextRequest("https://capture.test/api/cloud/board");
    const response = await proxy(request);

    expect(mockedRefreshCloudSession).toHaveBeenCalledWith(request, config);
    expect(response.headers.get("set-cookie")).toContain("sb-capture-auth-token=refreshed");
  });

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

  it.each([
    ["API rejection", "/api/sync", 401],
    ["login redirect", "/app", 307],
  ])("preserves refreshed Cloud cookies on %s", async (_label, path, expectedStatus) => {
    const config = {
      status: "ready" as const,
      url: "https://capture.supabase.co",
      publishableKey: "sb_publishable_test",
    };
    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-capture-auth-token", "refreshed", {
      path: "/",
      httpOnly: true,
    });
    mockedGetCloudConfig.mockReturnValue(config);
    mockedRefreshCloudSession.mockResolvedValue(refreshed);
    vi.stubEnv("APP_PASSWORD", "configured");

    try {
      const response = await proxy(new NextRequest(`https://capture.test${path}`));
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("set-cookie")).toContain("sb-capture-auth-token=refreshed");
    } finally { vi.unstubAllEnvs(); }
  });
});
