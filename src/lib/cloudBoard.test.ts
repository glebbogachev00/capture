import { describe, expect, it, vi } from "vitest";
import {
  handleCloudBoardGet,
  handleCloudBoardPut,
  isCloudEnabled,
  type CloudBoardDocument,
  type CloudBoardRepository,
  type VerifiedIdentity,
} from "@/lib/cloudBoard";
import { hydrate, type Board } from "@/lib/model";
import type { SyncState } from "@/lib/sync";
import { GET as defaultCloudRoute } from "@/app/api/cloud/board/route";

const board = (id: string): Board =>
  hydrate({ actions: [{ id, text: id, at: 1 } as never] });
const state = (id: string): SyncState => ({ board: board(id), tombstones: [] });

function repository(): CloudBoardRepository & {
  documents: Map<string, CloudBoardDocument>;
  loseNext: (winner: SyncState | null) => void;
} {
  const documents = new Map<string, CloudBoardDocument>();
  let losses = 0;
  let winner: SyncState | null = null;
  return {
    documents,
    loseNext(remote) {
      losses++;
      winner = remote;
    },
    async get(userId) {
      return documents.get(userId) ?? null;
    },
    async create(userId, value) {
      if (losses > 0) {
        losses--;
        const current = documents.get(userId);
        documents.set(userId, {
          state: winner ?? current?.state ?? value,
          rev: (current?.rev ?? 0) + 1,
        });
        return null;
      }
      if (documents.has(userId)) return null;
      const accepted = { state: value, rev: 1 };
      documents.set(userId, accepted);
      return accepted;
    },
    async update(userId, expectedRev, value) {
      if (losses > 0) {
        losses--;
        const current = documents.get(userId);
        documents.set(userId, {
          state: winner ?? current?.state ?? value,
          rev: (current?.rev ?? 0) + 1,
        });
        return null;
      }
      const current = documents.get(userId);
      if (!current || current.rev !== expectedRev) return null;
      const accepted = { state: value, rev: current.rev + 1 };
      documents.set(userId, accepted);
      return accepted;
    },
  };
}

function deps(identity: VerifiedIdentity | null, repo: CloudBoardRepository) {
  return {
    isEnabled: () => true,
    verifyIdentity: async () => identity,
    requiresEntitlement: () => false,
    hasEntitlement: async () => true,
    repository: repo,
  };
}

const put = (value: SyncState, identity: VerifiedIdentity, repo: CloudBoardRepository) =>
  handleCloudBoardPut(
    new Request("https://capture.test/api/cloud/board", {
      method: "PUT",
      body: JSON.stringify(value),
    }),
    deps(identity, repo)
  );

describe("cloud board boundary", () => {
  it("returns 404 and does not invoke dependencies when Cloud is off", async () => {
    const verifyIdentity = vi.fn();
    const repo = { get: vi.fn(), create: vi.fn(), update: vi.fn() };
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), {
      isEnabled: () => false, verifyIdentity, repository: repo,
    });
    expect(response.status).toBe(404);
    expect(verifyIdentity).not.toHaveBeenCalled();
    expect(repo.get).not.toHaveBeenCalled();
  });

  it("enables Cloud only for the explicit server value", () => {
    expect(isCloudEnabled({ CAPTURE_CLOUD: "1" })).toBe(true);
    expect(isCloudEnabled({ CAPTURE_CLOUD: "true" })).toBe(false);
    expect(isCloudEnabled({ CAPTURE_CLOUD: undefined })).toBe(false);
  });

  it("returns 401 without verified identity and does not read the repository", async () => {
    const repo = repository();
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), deps(null, repo));
    expect(response.status).toBe(401);
    expect(repo.documents).toEqual(new Map());
  });

  it("rejects a blank verified user id instead of sharing an empty tenant", async () => {
    const repo = repository();
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), deps({ userId: "   " }, repo));
    expect(response.status).toBe(401);
    expect(repo.documents).toEqual(new Map());
  });

  it("enforces a paid entitlement on the server when the production switch is on", async () => {
    const repo = repository();
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), {
      ...deps({ userId: "alice" }, repo),
      requiresEntitlement: () => true,
      hasEntitlement: vi.fn().mockResolvedValue(false),
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "capture cloud subscription required" });
    expect(repo.documents).toEqual(new Map());
  });

  it("fails closed when entitlement state cannot be checked", async () => {
    const repo = repository();
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), {
      ...deps({ userId: "alice" }, repo),
      requiresEntitlement: () => true,
      hasEntitlement: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "subscription status is unavailable" });
    expect(repo.documents).toEqual(new Map());
  });

  it("returns hydrated empty state at revision zero without creating a row", async () => {
    const repo = repository();
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), deps({ userId: "alice" }, repo));
    expect(await response.json()).toEqual({ board: hydrate(null), tombstones: [], rev: 0 });
    expect(repo.documents).toEqual(new Map());
  });

  it("returns only the verified user's state and revision", async () => {
    const repo = repository();
    repo.documents.set("alice", { state: state("alice-action"), rev: 4 });
    repo.documents.set("bob", { state: state("bob-action"), rev: 8 });
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), deps({ userId: "alice" }, repo));
    expect(await response.json()).toEqual({ ...state("alice-action"), rev: 4 });
  });

  it("bounds repository read failures without exposing provider details", async () => {
    const repo = repository();
    repo.get = vi.fn().mockRejectedValue(new Error("secret provider detail"));
    const response = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), deps({ userId: "alice" }, repo));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("creates at revision one", async () => {
    const repo = repository();
    const response = await put(state("first"), { userId: "alice" }, repo);
    expect(response.status).toBe(200);
    expect((await response.json()).rev).toBe(1);
  });

  it("increments revision on a normal update", async () => {
    const repo = repository();
    await put(state("first"), { userId: "alice" }, repo);
    const response = await put(state("second"), { userId: "alice" }, repo);
    expect(response.status).toBe(200);
    expect((await response.json()).rev).toBe(2);
  });

  it("bounds repository write failures without accepting the capture", async () => {
    const repo = repository();
    repo.create = vi.fn().mockRejectedValue(new Error("secret provider detail"));
    const response = await put(state("not-accepted"), { userId: "alice" }, repo);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud unavailable" });
    expect(repo.documents).toEqual(new Map());
  });

  it("re-reads and re-merges after losing a race", async () => {
    const repo = repository();
    repo.loseNext(state("remote-addition"));
    const response = await put(state("offline-addition"), { userId: "alice" }, repo);
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.board.actions.map((action: { id: string }) => action.id).sort()).toEqual([
      "offline-addition", "remote-addition",
    ]);
    expect(result.rev).toBe(2);
  });

  it("returns 503 after four race losses and never reports the incoming write", async () => {
    const repo = repository();
    repo.loseNext(state("remote-only"));
    repo.loseNext(state("remote-only"));
    repo.loseNext(state("remote-only"));
    repo.loseNext(state("remote-only"));
    const response = await put(state("never-accepted"), { userId: "alice" }, repo);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud board is busy; retry shortly" });
    expect(repo.documents.get("alice")?.state.board.actions.map((action) => action.id)).toEqual(["remote-only"]);
  });

  it("keeps two users isolated through revisioned writes and reads", async () => {
    const repo = repository();
    await put(state("alice-action"), { userId: "alice" }, repo);
    await put(state("bob-action"), { userId: "bob" }, repo);
    const alice = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), deps({ userId: "alice" }, repo));
    const bob = await handleCloudBoardGet(new Request("https://capture.test/api/cloud/board"), deps({ userId: "bob" }, repo));
    const aliceResult = await alice.json();
    const bobResult = await bob.json();
    expect(aliceResult.rev).toBe(1);
    expect(bobResult.rev).toBe(1);
    expect(aliceResult.board.actions.map((action: { id: string }) => action.id)).toEqual(["alice-action"]);
    expect(bobResult.board.actions.map((action: { id: string }) => action.id)).toEqual(["bob-action"]);
  });

  it("ignores a client-supplied tenant or storage identity on writes", async () => {
    const repo = repository();
    const response = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", {
      method: "PUT", body: JSON.stringify({ ...state("alice-action"), userId: "bob", tenantId: "bob", storageKey: "bob" }),
    }), deps({ userId: "alice" }, repo));
    expect(response.status).toBe(200);
    expect(repo.documents.has("bob")).toBe(false);
    expect(repo.documents.get("alice")?.state.board.actions[0]?.id).toBe("alice-action");
  });

  it("rejects malformed JSON and oversized bodies before repository access", async () => {
    const repo = repository();
    const malformed = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", { method: "PUT", body: "not-json" }), deps({ userId: "alice" }, repo));
    expect(malformed.status).toBe(400);
    const oversized = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", { method: "PUT", body: "x".repeat(2_000_001) }), deps({ userId: "alice" }, repo));
    expect(oversized.status).toBe(413);
    const oversizedUtf8 = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", { method: "PUT", body: "ế".repeat(700_000) }), deps({ userId: "alice" }, repo));
    expect(oversizedUtf8.status).toBe(413);
    const declaredOversized = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", {
      method: "PUT",
      body: "{}",
      headers: { "Content-Length": "2000001" },
    }), deps({ userId: "alice" }, repo));
    expect(declaredOversized.status).toBe(413);
    expect(repo.documents).toEqual(new Map());
  });

  it("rejects a payload without a board", async () => {
    const repo = repository();
    const response = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", { method: "PUT", body: JSON.stringify({ tombstones: [] }) }), deps({ userId: "alice" }, repo));
    expect(response.status).toBe(400);
  });

  it("rejects malformed tombstones instead of silently dropping deletion state", async () => {
    const repo = repository();
    const response = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", {
      method: "PUT",
      body: JSON.stringify({ ...state("kept"), tombstones: [{ id: "deleted", kind: "action" }] }),
    }), deps({ userId: "alice" }, repo));
    expect(response.status).toBe(400);
    expect(repo.documents).toEqual(new Map());
  });

  it("returns 503 when Cloud is enabled without provider configuration", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    try {
      const response = await defaultCloudRoute(new Request("https://capture.test/api/cloud/board"));
      expect(response.status).toBe(503);
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps the default Next route unavailable without real adapters", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "0");
    try {
      const response = await defaultCloudRoute(new Request("https://capture.test/api/cloud/board"));
      expect(response.status).toBe(404);
    } finally { vi.unstubAllEnvs(); }
  });
});
