import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultModel, providerOfKey } from "./aiProviders";
import { cleanSettings, loadAiSettings, saveAiSettings, seal, tiersFor, unseal, viewOf } from "./aiSettings.server";
import { authorizeCloudRequest, type CloudRequestGuardDependencies } from "./cloudRequestGuard";
import { authorizeManagedAiRequest, liveAi, scheduleManagedAiDeferredWork, withManagedAiAdmission } from "./cloudRequestGuard.server";
import { currentOwnAi, withOwnAi } from "./ownTier.server";
import { chain } from "./providers";

const OPENAI = "sk-proj-" + "a".repeat(40);
const CLAUDE = "sk-ant-api03-" + "b".repeat(40);
const GROQ = "gsk_" + "c".repeat(40);

afterEach(() => vi.unstubAllEnvs());

describe("keys", () => {
  it("are told apart by their prefix", () => {
    expect(providerOfKey(OPENAI)).toBe("openai");
    expect(providerOfKey("sk-" + "d".repeat(40))).toBe("openai");
    expect(providerOfKey(CLAUDE)).toBe("anthropic");
    expect(providerOfKey("AIza" + "e".repeat(35))).toBe("google");
    expect(providerOfKey("sk-or-v1-" + "f".repeat(40))).toBe("openrouter");
    expect(providerOfKey(GROQ)).toBe("groq");
    expect(providerOfKey("csk-" + "g".repeat(40))).toBe("cerebras");
    expect(providerOfKey("hello there")).toBeNull();
    expect(providerOfKey("sk-short")).toBeNull();
  });

  it("start on the usual quick model when the key can use it", () => {
    expect(defaultModel("anthropic", ["claude-opus-5-5", "claude-haiku-5-5"])).toBe("claude-haiku-5-5");
    expect(defaultModel("openai", ["gpt-6", "gpt-6-mini"])).toBe("gpt-6-mini");
    expect(defaultModel("openai", [])).toBe("gpt-5-mini");
  });
});

describe("stored settings", () => {
  const settings = cleanSettings({ connections: [
    { id: "one", provider: "anthropic", model: "claude-haiku-5-5", key: CLAUDE },
    { id: "two", provider: "groq", model: "openai/gpt-oss-120b", key: GROQ },
    { id: "bad", provider: "openai", model: "gpt-5-mini", key: GROQ },
  ] });

  it("keep only connections whose key matches their provider, and never show a key", () => {
    expect(settings.connections.map((row) => row.id)).toEqual(["one", "two"]);
    const view = JSON.stringify(viewOf(settings));
    expect(view).not.toContain(CLAUDE);
    expect(view).not.toContain(GROQ);
    expect(viewOf(settings).connections[0]).toEqual({ id: "one", provider: "anthropic", model: "claude-haiku-5-5", hint: CLAUDE.slice(-4) });
  });

  it("are sealed for Cloud and refuse a tampered or wrongly keyed row", () => {
    const secret = Buffer.alloc(32, 7);
    const row = seal(settings, secret);
    expect(row.sealed).not.toContain("sk-ant");
    expect(unseal(row, secret)).toEqual(settings);
    const tampered = { ...row, sealed: Buffer.from(Buffer.from(row.sealed, "base64").map((byte, index) => index === 3 ? byte ^ 1 : byte)).toString("base64") };
    expect(() => unseal(tampered, secret)).toThrow();
    expect(() => unseal(row, Buffer.alloc(32, 8))).toThrow();
  });

  it("are one owner-only file on a self-hosted Capture", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capture-ai-"));
    vi.stubEnv("SYNC_DATA_DIR", dir);
    await saveAiSettings(null, settings);
    const file = path.join(dir, "ai-settings.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).connections).toHaveLength(2);
    expect(await loadAiSettings(null)).toEqual(settings);
  });

  it("keep subscriptions only on a self-hosted Capture", () => {
    const row = { connections: [{ id: "sub", provider: "claude-subscription", model: "claude-haiku-5-5" }] };
    expect(cleanSettings(row).connections).toEqual([]);
    expect(cleanSettings(row, true).connections).toEqual([{ id: "sub", provider: "claude-subscription", model: "claude-haiku-5-5", key: "", hint: "" }]);
    expect(tiersFor(cleanSettings(row, true)).map((tier) => tier.name)).toEqual(["own-claude-subscription"]);
  });

  it("become tiers in the person's order", () => {
    expect(tiersFor(settings).map((tier) => [tier.name, tier.provider])).toEqual([["own-anthropic", "anthropic"], ["own-groq", "groq"]]);
  });
});

describe("at request time", () => {
  const settings = cleanSettings({ connections: [{ id: "one", provider: "groq", model: "openai/gpt-oss-120b", key: GROQ }] });

  it("puts a self-hosted owner's AI first and keeps Capture's own behind it; Cloud gets only the member's", () => {
    vi.stubEnv("CEREBRAS_API_KEY", "managed");
    const own = tiersFor(settings);
    expect(withOwnAi({ tiers: own, fallback: true }, () => chain().map((tier) => tier.name))).toEqual(["own-groq", "cerebras"]);
    expect(withOwnAi({ tiers: own, fallback: false }, () => chain().map((tier) => tier.name))).toEqual(["own-groq"]);
    expect(chain().map((tier) => tier.name)).toEqual(["cerebras"]);
  });

  it("loads a self-hosted owner's AI for every AI request", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capture-ai-"));
    vi.stubEnv("SYNC_DATA_DIR", dir);
    expect(await authorizeManagedAiRequest(new Request("https://capture.test/api/sort"))).toEqual({ mode: "non-cloud" });
    await saveAiSettings(null, settings);
    const authorization = await authorizeManagedAiRequest(new Request("https://capture.test/api/sort"));
    expect(authorization).toMatchObject({ mode: "non-cloud", ownAi: { fallback: true } });
    const voice = await authorizeManagedAiRequest(new Request("https://capture.test/api/transcribe"), (tier) => tier.provider === "openai");
    expect(voice).toEqual({ mode: "non-cloud" });
  });

  it("keeps a subscription out of the routes a person waits on", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capture-ai-"));
    vi.stubEnv("SYNC_DATA_DIR", dir);
    await saveAiSettings(null, cleanSettings({ connections: [{ id: "sub", provider: "claude-subscription", model: "claude-haiku-5-5" }] }, true));
    expect(await authorizeManagedAiRequest(new Request("https://capture.test/api/sort"), liveAi)).toEqual({ mode: "non-cloud" });
    expect(await authorizeManagedAiRequest(new Request("https://capture.test/api/summarize"))).toMatchObject({ ownAi: { tiers: [{ name: "own-claude-subscription" }] } });
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

  it("lets a Cloud member's own AI skip the managed allowance, but still needs an active member", async () => {
    const ownAi = { tiers: tiersFor(settings), fallback: false };
    const deps = dependencies();
    expect(await authorizeCloudRequest(owned(), "managed_ai", deps, async () => ownAi)).toMatchObject({ mode: "cloud", ownerId: "owner-a", ownAi });
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.acquireExternalWork).not.toHaveBeenCalled();
    const lapsed = dependencies({ hasEntitlement: vi.fn().mockResolvedValue(false) });
    expect((await authorizeCloudRequest(owned(), "managed_ai", lapsed, async () => ownAi) as Response).status).toBe(402);
    const without = dependencies();
    await authorizeCloudRequest(owned(), "managed_ai", without, async () => null);
    expect(without.consumeQuota).toHaveBeenCalled();
  });

  it("runs the work, and work after the response, on the person's AI", async () => {
    const authorization = { mode: "cloud" as const, ownerId: "owner-a", ownAi: { tiers: tiersFor(settings), fallback: false } };
    expect(await withManagedAiAdmission(authorization, async () => currentOwnAi()?.tiers[0].name)).toBe("own-groq");
    let later: (() => void | Promise<void>) | undefined;
    let seen: string | undefined;
    await scheduleManagedAiDeferredWork({
      authorization, enabled: true,
      schedule: (task) => { later = task; },
      work: () => { seen = currentOwnAi()?.tiers[0].name; },
      onError: () => {},
    });
    await later!();
    expect(seen).toBe("own-groq");
  });
});

describe("the Cloud table", () => {
  const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261015120000_capture_ai_settings.sql"), "utf8").toLowerCase();
  it("is readable by the server only and goes with the account", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.capture_ai_settings from public, anon, authenticated");
    expect(sql).not.toMatch(/create policy/);
    expect(sql).toContain("on delete cascade");
  });
});
