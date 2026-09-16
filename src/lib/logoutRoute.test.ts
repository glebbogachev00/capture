// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AUTH_COOKIE } from "./auth";

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  signOut: vi.fn(),
  createClient: vi.fn(),
}));
// Exercise the real config parser without consulting environment/credential files.
vi.mock("@/lib/supabase/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./supabase/config")>();
  return { ...actual, getCloudConfig: () => actual.getCloudConfig(state.env) };
});
vi.mock("@/lib/supabase/server", () => ({ createCloudServerClient: state.createClient }));

const ready = {
  CAPTURE_CLOUD: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://logout-test.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test",
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  state.env = { ...ready };
  state.signOut.mockReset().mockResolvedValue({ error: null });
  state.createClient.mockReset().mockResolvedValue({ auth: { signOut: state.signOut } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  { CAPTURE_CLOUD: "1" },
  { ...ready, NEXT_PUBLIC_SUPABASE_URL: "invalid-url" },
  { ...ready, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
])("enabled Cloud with incomplete config fails logout instead of confirming success: %j", async (env) => {
  state.env = env;
  const { POST } = await import("@/app/api/logout/route");
  const response = await POST();
  expect(response.ok).toBe(false);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "logout could not be completed" });
  expect(state.createClient).not.toHaveBeenCalled();
  expect(response.cookies.get(AUTH_COOKIE)).toMatchObject({ value: "", maxAge: 0, path: "/", httpOnly: true });
});

it.each(["self-hosted", "ready", "sign-out error", "sign-out throws", "client throws"])("preserves %s logout behavior", async (mode) => {
  if (mode === "self-hosted") state.env = {};
  if (mode === "sign-out error") state.signOut.mockResolvedValue({ error: new Error("provider failure") });
  if (mode === "sign-out throws") state.signOut.mockRejectedValue(new Error("provider failure"));
  if (mode === "client throws") state.createClient.mockRejectedValue(new Error("client failure"));
  const success = mode === "self-hosted" || mode === "ready";
  const { POST } = await import("@/app/api/logout/route");
  const response = await POST();
  expect(response.status).toBe(success ? 200 : 502);
  expect(await response.json()).toEqual(success ? { ok: true } : { error: "logout could not be completed" });
  expect(response.cookies.get(AUTH_COOKIE)).toMatchObject({ value: "", maxAge: 0, path: "/", httpOnly: true });
  expect(state.createClient).toHaveBeenCalledTimes(mode === "self-hosted" ? 0 : 1);
  if (mode !== "self-hosted" && mode !== "client throws") expect(state.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  else expect(state.signOut).not.toHaveBeenCalled();
});

it("actual missing-config response keeps the durable client interlock through reload until a successful retry", async () => {
  const location = { href: "/app" };
  vi.stubGlobal("location", location);
  const ownership = await import("./ownership");
  const identity = { owner: "logout-owner", expiresAt: Date.now() + 60000 };
  const lifetime = ownership.installDocumentLifetime(identity);
  lifetime.keepOffline(true);
  expect(ownership.resumeOfflineIdentity()?.owner).toBe(identity.owner);
  state.env = { CAPTURE_CLOUD: "1" };
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(input).toBe("/api/logout");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(localStorage.getItem(ownership.LOGOUT_PENDING_KEY)).toBeTruthy();
    expect(localStorage.getItem(ownership.OFFLINE_PERMISSION_KEY)).toBeNull();
    expect(lifetime.snapshot()).toBe("revoked");
    const { POST } = await import("@/app/api/logout/route");
    return POST();
  });
  vi.stubGlobal("fetch", network);
  await ownership.logoutAndNavigate();
  expect(ownership.logoutSnapshot()).toBe("pending");
  const pending = localStorage.getItem(ownership.LOGOUT_PENDING_KEY);
  expect(pending).toBeTruthy();
  expect(location.href).toBe("/app");
  expect(lifetime.controller.signal.aborted).toBe(true);
  expect(state.signOut).not.toHaveBeenCalled();

  // New module graph models document reload, retaining only durable browser storage.
  vi.resetModules();
  const fresh = await import("./ownership");
  expect(fresh.logoutSnapshot()).toBe("pending");
  expect(localStorage.getItem(fresh.LOGOUT_PENDING_KEY)).toBe(pending);
  expect(fresh.resumeOfflineIdentity()).toBeNull();
  await expect(fresh.openCloudIdentity()).rejects.toThrow(/Logout has not completed/);
  expect(() => fresh.installDocumentLifetime(identity)).toThrow(/Logout has not completed/);
  expect(network).toHaveBeenCalledTimes(1);

  state.env = { ...ready };
  await fresh.logoutAndNavigate();
  expect(state.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  expect(network).toHaveBeenCalledTimes(2);
  expect(fresh.logoutSnapshot()).toBe("");
  expect(localStorage.getItem(fresh.LOGOUT_PENDING_KEY)).toBeNull();
  expect(localStorage.getItem(fresh.OFFLINE_PERMISSION_KEY)).toBeNull();
  expect(location.href).toBe("/login");
  expect(lifetime.snapshot()).toBe("revoked");
});