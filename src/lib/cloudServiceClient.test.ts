import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(() => ({ kind: "service" })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { createCloudServiceClient } from "./supabase/service";

const config = {
  status: "ready" as const,
  url: "https://capture.test",
  publishableKey: "sb_publishable_unused",
};

describe("Cloud service client", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, "", "service_role", "sb_publishable_public"])("fails closed for a non-secret server key %s", key => {
    expect(createCloudServiceClient(config, { SUPABASE_SECRET_KEY: key })).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("creates a non-persistent server-only client for an explicit Supabase secret", () => {
    expect(createCloudServiceClient(config, { SUPABASE_SECRET_KEY: "sb_secret_synthetic" })).toEqual({ kind: "service" });
    expect(mocks.createClient).toHaveBeenCalledWith("https://capture.test", "sb_secret_synthetic", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });
});
