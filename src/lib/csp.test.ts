import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Content Security Policy", () => {
  it("allows browser connections to the configured Supabase origin", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://capture.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.resetModules();

    const { default: config } = await import("../../next.config");
    const rules = await config.headers?.();
    const csp = rules
      ?.flatMap((rule) => rule.headers)
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(csp).toContain("connect-src 'self' https://capture.supabase.co");
  });

  it("does not allow the Supabase origin while Cloud is disabled", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "0");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://capture.supabase.co");
    vi.resetModules();

    const { default: config } = await import("../../next.config");
    const rules = await config.headers?.();
    const csp = rules
      ?.flatMap((rule) => rule.headers)
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("https://capture.supabase.co");
  });

  it.each([
    ["missing key", ""],
    ["privileged key", "sb_secret_do_not_accept"],
  ])("does not allow the Supabase origin with a %s", async (_label, key) => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://capture.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    vi.resetModules();

    const { default: config } = await import("../../next.config");
    const rules = await config.headers?.();
    const csp = rules
      ?.flatMap((rule) => rule.headers)
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(csp).not.toContain("https://capture.supabase.co");
  });
});
