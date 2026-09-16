// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnershipLifetime, openCloudIdentity, verifyCloudIdentity, resumeOfflineIdentity, OFFLINE_PERMISSION_KEY, AUTH_TRANSITION_KEY, LOGOUT_PENDING_KEY } from "./ownership";
const grant = () => new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }).keepOffline(true);
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([true, false])("cold start preserves explicit A consent on transport failure with navigator online=%s", async online => {
  grant();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  const life = new OwnershipLifetime(await openCloudIdentity());
  expect(life.owner).toBe("A");
  expect(life.database).toBe("capture-cloud-v1-account-A");
  expect(life.snapshot()).toBe("offline");
  expect(() => life.assertDisclosure()).not.toThrow();
  expect(() => life.assertOnline()).toThrow();
  expect(resumeOfflineIdentity()?.owner).toBe("A");
});


it.each(["fetch", "body"])("bounds hung identity %s and aborts before local-only fallback", async stage => {
  grant(); vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const response = Response.json({});
  response.json = () => new Promise(() => {});
  vi.stubGlobal("fetch", vi.fn((_url, init) => {
    signal = init.signal;
    return stage === "fetch" ? new Promise(() => {}) : Promise.resolve(response);
  }));
  const result = vi.fn();
  const pending = openCloudIdentity().then(result);
  await vi.advanceTimersByTimeAsync(5000);
  expect(result).toHaveBeenCalledWith({ owner: "A", expiresAt: 0, offline: true });
  expect(signal?.aborted).toBe(true);
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});
it("preserves consent on interrupted response body but rejects malformed JSON", async () => {
  grant();
  const response = Response.json({});
  response.json = async () => { throw new TypeError("connection lost"); };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  expect(await openCloudIdentity()).toMatchObject({ owner: "A", offline: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json")));
  await expect(openCloudIdentity()).rejects.toThrow();
  expect(resumeOfflineIdentity()).toBeNull();
});
it.each(["revoked", "pending", "transition", "replacement"])("does not adopt consent after superseded bootstrap: %s", async scenario => {
  grant();
  let reject!: (error: Error) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((_resolve, r) => { reject = r; })));
  const pending = openCloudIdentity();
  if (scenario === "revoked") localStorage.removeItem(OFFLINE_PERMISSION_KEY);
  if (scenario === "pending") localStorage.setItem(LOGOUT_PENDING_KEY, "pending");
  if (scenario === "transition") localStorage.setItem(AUTH_TRANSITION_KEY, "successor");
  if (scenario === "replacement") new OwnershipLifetime({ owner: "B", expiresAt: Date.now() + 60000 }).keepOffline(true);
  reject(new TypeError("Failed to fetch"));
  await expect(pending).rejects.toThrow();
  if (scenario === "replacement") expect(resumeOfflineIdentity()?.owner).toBe("B");
});
it.each([401, 412, 428, 500])("never falls back for HTTP %s", async status => {
  grant(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(openCloudIdentity()).rejects.toThrow();
  expect(resumeOfflineIdentity()).toBeNull();
});
it.each([null, { owner: "A", expiresAt: 0 }, { owner: "../A", expiresAt: Date.now() + 60000 }])("rejects malformed identity %j", async value => {
  grant(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
  await expect(openCloudIdentity()).rejects.toThrow();
  expect(resumeOfflineIdentity()).toBeNull();
});
it("valid different owner never receives A fallback", async () => {
  grant(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ owner: "B", expiresAt: Date.now() + 60000 })));
  expect(await openCloudIdentity()).toMatchObject({ owner: "B" });
  expect(resumeOfflineIdentity()).toBeNull();
});
it.each(["none", "legacy"])("no board permission for %s consent", async kind => {
  if (kind === "legacy") localStorage.setItem(OFFLINE_PERMISSION_KEY, JSON.stringify({ owner: "A", expiresAt: Date.now() + 60000 }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(openCloudIdentity()).rejects.toThrow();
});

it.each(["same", "different", "revoked"])("resume transport outage stays local and cannot revive %s context", async mode => {
  grant(); vi.useFakeTimers();
  const life = new OwnershipLifetime(resumeOfflineIdentity()!);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));
  const stop = life.watch(verifyCloudIdentity);
  try {
    window.dispatchEvent(new Event("focus"));
    if (mode === "revoked") life.revoke();
    await vi.advanceTimersByTimeAsync(1);
    expect(life.snapshot()).toBe(mode === "revoked" ? "revoked" : "offline");
    expect(() => life.assertOnline()).toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ owner: mode === "different" ? "B" : "A", expiresAt: Date.now() + 60000 })));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1);
    expect(life.snapshot()).toBe(mode === "same" ? "active" : "revoked");
  } finally { stop(); }
});
it("a late auth rejection cannot delete a replacement owner's consent", async () => {
  grant();
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const pending = openCloudIdentity();
  new OwnershipLifetime({ owner: "B", expiresAt: Date.now() + 60000 }).keepOffline(true);
  finish(new Response(null, { status: 401 }));
  await expect(pending).rejects.toThrow();
  expect(resumeOfflineIdentity()?.owner).toBe("B");
});
