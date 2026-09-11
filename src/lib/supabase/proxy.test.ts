import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CloudConfig } from "./config";
import { refreshCloudSession, type ProxyClientFactory } from "./proxy";

const config: CloudConfig = {
  status: "ready",
  url: "https://capture.supabase.co",
  publishableKey: "sb_publishable_test",
};

describe("refreshCloudSession", () => {
  it("lets Supabase refresh auth cookies on the request and response", async () => {
    const getClaims = vi.fn().mockResolvedValue({ data: { claims: null }, error: null });
    const createClient = vi.fn((url, key, options) => {
      expect(url).toBe(config.url);
      expect(key).toBe(config.publishableKey);
      expect(options.cookies.getAll()).toEqual([]);
      options.cookies.setAll([
        {
          name: "sb-capture-auth-token",
          value: "refreshed-session",
          options: { httpOnly: true, sameSite: "lax", path: "/" },
        },
      ]);
      return { auth: { getClaims } };
    }) as unknown as ProxyClientFactory;

    const request = new NextRequest("https://capture.test/app");
    const response = await refreshCloudSession(request, config, createClient);

    expect(getClaims).toHaveBeenCalledOnce();
    expect(request.cookies.get("sb-capture-auth-token")?.value).toBe("refreshed-session");
    expect(response.cookies.get("sb-capture-auth-token")?.value).toBe("refreshed-session");
  });
});
