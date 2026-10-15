// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { carriesOwnKey, clearOwnKey, ownKeyProvider, readOwnKey, saveOwnKey } from "./ownAiKey";
import { authorizeCloudRequest, type CloudRequestGuardDependencies } from "./cloudRequestGuard";
import { scheduleManagedAiDeferredWork, withManagedAiAdmission } from "./cloudRequestGuard.server";
import { chain } from "./providers";
import { currentOwnTier, ownTierFrom, withOwnTier } from "./ownTier.server";

const OPENROUTER = "sk-or-v1-" + "a".repeat(40);
const GROQ = "gsk_" + "b".repeat(40);

afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); });

describe("a member's own AI key", () => {
  it("is recognised by its prefix, and nothing else is", () => {
    expect(ownKeyProvider(OPENROUTER)).toBe("openrouter");
    expect(ownKeyProvider(GROQ)).toBe("groq");
    expect(ownKeyProvider("csk-" + "c".repeat(40))).toBe("cerebras");
    expect(ownKeyProvider("sk-ant-" + "d".repeat(40))).toBeNull();
    expect(ownKeyProvider("gsk_short")).toBeNull();
    expect(ownKeyProvider("gsk_ with spaces and more characters")).toBeNull();
  });

  it("goes only with AI routes", () => {
    expect(carriesOwnKey("/api/sort")).toBe(true);
    expect(carriesOwnKey("/api/transcribe")).toBe(true);
    expect(carriesOwnKey("/api/sync")).toBe(false);
    expect(carriesOwnKey("/api/cloud/board")).toBe(false);
    expect(carriesOwnKey("/api/img/abc")).toBe(false);
  });

  it("is kept per account on this device", () => {
    expect(saveOwnKey("owner-a", ` ${OPENROUTER} `)).toBe("openrouter");
    expect(readOwnKey("owner-a")).toBe(OPENROUTER);
    expect(readOwnKey("owner-b")).toBeNull();
    expect(readOwnKey(null)).toBeNull();
    expect(saveOwnKey("owner-a", "not a key")).toBeNull();
    clearOwnKey("owner-a");
    expect(readOwnKey("owner-a")).toBeNull();
  });
});

describe("on the server", () => {
  const withKey = (key: string) => new Request("https://capture.test/api/sort", { method: "POST", headers: { "x-capture-ai-key": key } });

  it("replaces the whole provider chain for that request only", () => {
    vi.stubEnv("GROQ_API_KEY", "managed-key");
    const own = ownTierFrom(withKey(OPENROUTER))!;
    expect(own.provider).toBe("openrouter");
    expect(withOwnTier(own, () => chain().map((tier) => tier.name))).toEqual(["own-openrouter"]);
    expect(chain().map((tier) => tier.name)).toContain("groq");
    expect(currentOwnTier()).toBeNull();
    expect(ownTierFrom(withKey("sk-ant-" + "x".repeat(40)))).toBeNull();
  });

  function dependencies(overrides: Partial<CloudRequestGuardDependencies> = {}): CloudRequestGuardDependencies {
    return {
      isCloudHost: () => true,
      isConfigured: () => true,
      requiresEntitlement: () => true,
      verifyIdentity: vi.fn().mockResolvedValue({ userId: "owner-a" }),
      hasEntitlement: vi.fn().mockResolvedValue(true),
      isAccountErasing: vi.fn().mockResolvedValue(false),
      consumeQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterSec: 0 }),
      acquireExternalWork: vi.fn().mockResolvedValue({ admissionId: "admission-a" }),
      releaseExternalWork: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }
  const owned = () => new Request("https://capture.test/api/sort", { method: "POST", headers: { "X-Capture-Owner": "owner-a" } });

  it("skips the managed allowance but still needs a signed-in Cloud member", async () => {
    const own = ownTierFrom(withKey(GROQ))!;
    const deps = dependencies();
    const result = await authorizeCloudRequest(owned(), "managed_ai", deps, own);
    expect(result).toMatchObject({ mode: "cloud", ownerId: "owner-a", ownTier: own });
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.acquireExternalWork).not.toHaveBeenCalled();

    const lapsed = dependencies({ hasEntitlement: vi.fn().mockResolvedValue(false) });
    expect((await authorizeCloudRequest(owned(), "managed_ai", lapsed, own) as Response).status).toBe(402);
    const stranger = dependencies({ verifyIdentity: vi.fn().mockResolvedValue(null) });
    expect((await authorizeCloudRequest(owned(), "managed_ai", stranger, own) as Response).status).toBe(401);
  });

  it("runs the work, and work after the response, on the member's key", async () => {
    const own = ownTierFrom(withKey(GROQ))!;
    const authorization = { mode: "cloud" as const, ownerId: "owner-a", ownTier: own };
    expect(await withManagedAiAdmission(authorization, async () => currentOwnTier()?.name)).toBe("own-groq");

    let later: (() => void | Promise<void>) | undefined;
    let seen: string | undefined;
    const scheduled = await scheduleManagedAiDeferredWork({
      authorization, enabled: true,
      schedule: (task) => { later = task; },
      work: () => { seen = currentOwnTier()?.name; },
      onError: () => {},
    });
    expect(scheduled).toBe(true);
    await later!();
    expect(seen).toBe("own-groq");
  });
});

describe("in the browser", () => {
  it("sends the key with AI requests only, for the account that saved it", async () => {
    const { OwnershipLifetime } = await import("./ownership");
    saveOwnKey("A", OPENROUTER);
    const network = vi.fn(async () => Response.json({}));
    const a = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
    await a.request("/api/sort", { method: "POST" }, network);
    await a.request("/api/sync", { method: "POST" }, network);
    const b = new OwnershipLifetime({ owner: "B", expiresAt: Date.now() + 60000 });
    await b.request("/api/sort", { method: "POST" }, network);
    const sent = network.mock.calls.map((call) => new Headers((call as unknown as [unknown, RequestInit])[1]?.headers).get("x-capture-ai-key"));
    expect(sent).toEqual([OPENROUTER, null, null]);
  });
});
