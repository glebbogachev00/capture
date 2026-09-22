import { afterEach, beforeEach, expect, it, vi } from "vitest";
beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const state = vi.hoisted(() => ({ configured: true, claims: vi.fn(), client: vi.fn() }));
beforeEach(() => {
  state.configured = true;
  state.claims.mockReset();
  state.client.mockReset().mockResolvedValue({ auth: { getClaims: state.claims } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
});
afterEach(() => { vi.unstubAllGlobals(); });
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: () => state.configured ? { status: "ready" } : null }));
vi.mock("@/lib/supabase/server", () => ({ createCloudServerClient: state.client }));
import { GET } from "@/app/api/cloud/identity/route";

it("logs one fixed diagnostic for unavailable config without changing the response", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.configured = false;
  try {
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud is not configured" });
    expect(console.info).toHaveBeenCalledExactlyOnceWith("[capture-ops]", {
      version: 1,
      event: "cloud_identity",
      outcome: "failure",
      reason: "not_configured",
      latency: "not_measured",
      count: "not_measured",
    });
  } finally { state.configured = true; }
});

// Deliberately hostile provider payload: none of these fields may reach logs.
const sensitive = {
  name: "PRIVATE_ERROR_NAME", message: "PRIVATE_MESSAGE", code: "PRIVATE_PROVIDER_CODE", status: 429,
  headers: { authorization: "PRIVATE_TOKEN", cookie: "PRIVATE_COOKIE" },
  claims: { sub: "PRIVATE_USER_ID", email: "PRIVATE_EMAIL" },
};
it.each([
  "client rejection",
  "claims rejection",
  "returned error",
  "malformed claims",
  "expired claims",
] as const)("classifies %s with one bounded safe log, still fail-closed", async (scenario) => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  if (scenario === "client rejection") state.client.mockRejectedValue(sensitive);
  else if (scenario === "claims rejection") state.claims.mockRejectedValue(sensitive);
  else if (scenario === "returned error") state.claims.mockResolvedValue({ data: { claims: sensitive.claims }, error: sensitive });
  else state.claims.mockResolvedValue({ data: { claims: { ...sensitive.claims, exp: scenario === "expired claims" ? 1 : "PRIVATE_EXP" }, token: "PRIVATE_TOKEN" }, error: null });
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "account verification unavailable" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(console.info).toHaveBeenCalledExactlyOnceWith("[capture-ops]", {
    version: 1,
    event: "cloud_identity",
    outcome: "failure",
    reason: "dependency_unavailable",
    latency: "not_measured",
    count: "not_measured",
  });
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("PRIVATE_");
  expect(console.error).not.toHaveBeenCalled();
  expect(console.log).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps disabled and anonymous paths unchanged and silent", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "0");
  const disabled = await GET();
  expect(disabled.status).toBe(404);
  expect(await disabled.json()).toEqual({ error: "not found" });
  expect(state.client).not.toHaveBeenCalled();
  vi.stubEnv("CAPTURE_CLOUD", "1");
  for (const error of [null, { ...sensitive, name: "AuthSessionMissingError" }]) {
    state.claims.mockResolvedValue({ data: null, error });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).owner).toBeNull();
  }
  expect(console.info).not.toHaveBeenCalled();
});

it("returns only verified owner and bounded expiry, never session material", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.claims.mockResolvedValue({ data: { claims: { sub: "alice", exp: Math.floor(Date.now() / 1000) + 3600 }, token: "not-public" }, error: null });
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.owner).toBe("alice");
  expect(body.expiresAt).toBeGreaterThan(Date.now());
  expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 3600000);
  expect(Object.keys(body).sort()).toEqual(["expiresAt", "owner"]);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(console.info).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

it("allows explicit missing session, but locks on errors, malformed and expired claims", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.claims.mockResolvedValue({ data: null, error: { name: "AuthSessionMissingError" } });
  expect((await (await GET()).json()).owner).toBeNull();
  for (const result of [
    { data: null, error: new Error("offline") },
    { data: { claims: { sub: "alice" } }, error: null },
    { data: { claims: { sub: "alice", exp: 1 } }, error: null },
  ]) {
    state.claims.mockResolvedValue(result);
    expect((await GET()).status).toBe(503);
  }
  state.configured = false;
  expect((await GET()).status).toBe(503);
  state.configured = true;
  vi.unstubAllEnvs();
});
