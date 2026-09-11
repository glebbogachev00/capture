import { describe, expect, it, vi } from "vitest";
import { getCloudConfig } from "./config";
import { identityFromClaims } from "./identity";
import { CloudBoardRepository, type SupabaseQueryClient } from "./repository";
import { handleCloudBoardGet } from "@/lib/cloudBoard";
import { hydrate } from "@/lib/model";
import type { SyncState } from "@/lib/sync";

const state = (id = "a"): SyncState => ({
  board: hydrate({ actions: [{ id, text: id, at: 1 } as never] }),
  tombstones: [],
});

const row = (user_id: string, rev = 3) => ({ user_id, board: state().board, tombstones: [], rev });

function chain(result: { data: unknown; error: unknown; count?: number }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  return q;
}

describe("Supabase Cloud configuration", () => {
  it("is off unless enabled and both usable public values exist", () => {
    expect(getCloudConfig({ CAPTURE_CLOUD: "0", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" })).toBeNull();
    expect(getCloudConfig({ CAPTURE_CLOUD: "1", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" })).toMatchObject({ status: "missing" });
    expect(getCloudConfig({ CAPTURE_CLOUD: "1", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" })).toMatchObject({ status: "ready" });
  });

  it("rejects malformed URLs and legacy secret-shaped keys", () => {
    expect(getCloudConfig({ CAPTURE_CLOUD: "1", NEXT_PUBLIC_SUPABASE_URL: "not-url", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "service_role" })).toMatchObject({ status: "missing" });
  });

  it("accepts a legacy anon JWT but rejects privileged keys", () => {
    const jwt = (role: string) => {
      const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
      return `header.${payload}.signature`;
    };
    const env = {
      CAPTURE_CLOUD: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    };
    expect(getCloudConfig({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") })).toMatchObject({ status: "ready" });
    expect(getCloudConfig({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") })).toMatchObject({ status: "missing" });
    expect(getCloudConfig({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_x" })).toMatchObject({ status: "missing" });
  });
});

describe("verified Supabase identity", () => {
  it("uses claims.sub and never session user data", async () => {
    const auth = { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "user-1" }, user: { id: "wrong" } }, error: null }), getSession: vi.fn() };
    const client = { auth };
    await expect(identityFromClaims(client)).resolves.toEqual({ userId: "user-1" });
    expect(auth.getSession).not.toHaveBeenCalled();
  });
  it.each([null, { data: { claims: {} }, error: null }, { data: { claims: { sub: " " } }, error: null }, { data: null, error: new Error("bad") }])("rejects absent or invalid claims", async (result) => {
    const client = { auth: { getClaims: vi.fn().mockResolvedValue(result), getSession: vi.fn() } } as never;
    await expect(identityFromClaims(client)).resolves.toBeNull();
  });
});

describe("Supabase board repository", () => {
  it("scopes reads to user_id and hydrates validated rows", async () => {
    const q = chain({ data: row("alice"), error: null });
    const client = { from: vi.fn().mockReturnValue(q) } as unknown as SupabaseQueryClient;
    const result = await new CloudBoardRepository(client).get("alice");
    expect(q.eq).toHaveBeenCalledWith("user_id", "alice");
    expect(result?.rev).toBe(3);
    expect(result?.state.board.actions[0]?.id).toBe("a");
  });

  it("maps duplicate create to contention and keeps provider errors distinct", async () => {
    const duplicate = chain({ data: null, error: { code: "23505", message: "duplicate" } });
    const client = { from: vi.fn().mockReturnValue(duplicate) } as unknown as SupabaseQueryClient;
    await expect(new CloudBoardRepository(client).create("alice", state())).resolves.toBeNull();
    const failed = chain({ data: null, error: { code: "XX000", message: "down" } });
    await expect(new CloudBoardRepository({ from: vi.fn().mockReturnValue(failed) } as unknown as SupabaseQueryClient).create("alice", state())).rejects.toThrow("Cloud provider operation failed");
  });

  it("rejects malformed provider rows instead of accepting bad revisions", async () => {
    const q = chain({ data: { ...row("alice"), rev: -1 }, error: null });
    const client = { from: vi.fn().mockReturnValue(q) } as unknown as SupabaseQueryClient;
    await expect(new CloudBoardRepository(client).get("alice")).rejects.toThrow("Cloud provider operation failed");
  });

  it("rejects a provider row belonging to a different tenant", async () => {
    const q = chain({ data: row("bob"), error: null });
    const client = { from: vi.fn().mockReturnValue(q) } as unknown as SupabaseQueryClient;
    await expect(new CloudBoardRepository(client).get("alice")).rejects.toThrow("Cloud provider operation failed");
  });

  it("updates only the expected revision and maps zero rows to contention", async () => {
    const q = chain({ data: null, error: null });
    const client = { from: vi.fn().mockReturnValue(q) } as unknown as SupabaseQueryClient;
    await expect(new CloudBoardRepository(client).update("alice", 4, state("next"))).resolves.toBeNull();
    expect(q.eq).toHaveBeenCalledWith("user_id", "alice");
    expect(q.eq).toHaveBeenCalledWith("rev", 4);
  });
});

describe("configured route boundary", () => {
  it("returns bounded 503 when enabled but configuration is incomplete", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    try {
      const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), { isEnabled: () => true, isConfigured: () => false, verifyIdentity: async () => null, repository: {} as never });
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    } finally { vi.unstubAllEnvs(); }
  });
});
