import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_ERASURE_BUCKETS,
  ERASURE_STAGES,
  destructiveAuthWindowMs,
  handleAccountErasureConfirm,
  handleAccountErasurePrepare,
  handleAccountErasureStatus,
  runAccountErasureWorker,
  type AccountErasureDependencies,
  type AccountErasureOperation,
  type AccountErasureRepository,
  type ClaimedAccountErasureOperation,
  type ErasureStage,
} from "./accountErasure";
import { accountErasureWorkerSecret } from "./accountErasureRoutes.server";

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const now = new Date("2026-09-22T10:00:00.000Z");

type Stored = AccountErasureOperation & { sessionHash: string; receiptHash: string };

class MemoryRepository implements AccountErasureRepository {
  operations = new Map<string, Stored>();
  fence = new Set<string>();
  private sequence = 0;

  async prepare(input: {
    operationId: string; ownerId: string; sessionHash: string; receiptHash: string;
    now: Date; receiptExpiresAt: Date;
  }): Promise<AccountErasureOperation | null> {
    const active = [...this.operations.values()].find(operation => operation.ownerId === input.ownerId && operation.stage !== "complete");
    if (active && active.stage !== "prepared") return null;
    const operation: Stored = active
      ? { ...active, sessionHash: input.sessionHash, receiptHash: input.receiptHash, receiptExpiresAt: input.receiptExpiresAt.toISOString(), version: active.version + 1 }
      : {
          operationId: input.operationId, ownerId: input.ownerId, stage: "prepared", version: 1,
          attemptCount: 0, retryCount: 0, retryAfter: null, lastErrorCode: null,
          leaseId: null, leaseExpiresAt: null, confirmedAt: null, completedAt: null,
          receiptExpiresAt: input.receiptExpiresAt.toISOString(), sessionHash: input.sessionHash,
          receiptHash: input.receiptHash,
        };
    this.operations.set(operation.operationId, operation);
    return operation;
  }

  async status(input: { operationId: string; receiptHash: string; now: Date; ownerId?: string; sessionHash?: string }): Promise<AccountErasureOperation | null> {
    const operation = this.operations.get(input.operationId);
    const identityMatches = !operation ? false : operation.ownerId === null
      ? operation.stage === "complete"
      : operation.ownerId === input.ownerId && operation.sessionHash === input.sessionHash;
    return operation && identityMatches && operation.receiptHash === input.receiptHash && Date.parse(operation.receiptExpiresAt) > input.now.getTime()
      ? operation : null;
  }

  async confirm(input: {
    operationId: string; ownerId: string; sessionHash: string; receiptHash: string; now: Date;
  }): Promise<AccountErasureOperation | null> {
    const operation = this.operations.get(input.operationId);
    if (!operation || operation.ownerId !== input.ownerId || operation.sessionHash !== input.sessionHash || operation.receiptHash !== input.receiptHash) return null;
    if (operation.stage === "prepared") {
      operation.stage = "polar";
      operation.confirmedAt = input.now.toISOString();
      operation.version += 1;
      this.fence.add(input.ownerId);
    }
    return operation;
  }

  async claim(input: { leaseId: string; now: Date; leaseExpiresAt: Date }): Promise<ClaimedAccountErasureOperation | null> {
    const operation = [...this.operations.values()].find(candidate =>
      candidate.stage !== "prepared" && candidate.stage !== "complete" &&
      (!candidate.retryAfter || Date.parse(candidate.retryAfter) <= input.now.getTime()) &&
      (!candidate.leaseExpiresAt || Date.parse(candidate.leaseExpiresAt) <= input.now.getTime()));
    if (!operation?.ownerId) return null;
    operation.leaseId = input.leaseId;
    operation.leaseExpiresAt = input.leaseExpiresAt.toISOString();
    operation.attemptCount += 1;
    operation.version += 1;
    return operation as ClaimedAccountErasureOperation;
  }

  async advance(input: {
    operationId: string; ownerId: string; leaseId: string; version: number;
    stage: Exclude<ErasureStage, "prepared" | "complete">; nextStage: Exclude<ErasureStage, "prepared">;
    now: Date; completedReceiptExpiresAt?: Date;
  }): Promise<boolean> {
    const operation = this.operations.get(input.operationId);
    if (!operation || operation.ownerId !== input.ownerId || operation.leaseId !== input.leaseId || operation.version !== input.version || operation.stage !== input.stage) return false;
    operation.stage = input.nextStage;
    operation.version += 1;
    operation.leaseId = null;
    operation.leaseExpiresAt = null;
    operation.lastErrorCode = null;
    operation.retryAfter = null;
    if (input.nextStage === "complete") {
      operation.ownerId = null;
      operation.sessionHash = "";
      operation.completedAt = input.now.toISOString();
      operation.receiptExpiresAt = input.completedReceiptExpiresAt!.toISOString();
    }
    return true;
  }

  async authorizeAuthDeletion(input: {
    operationId: string; ownerId: string; leaseId: string; version: number;
  }): Promise<boolean> {
    const operation = this.operations.get(input.operationId);
    return !!operation && operation.ownerId === input.ownerId && operation.stage === "auth"
      && operation.leaseId === input.leaseId && operation.version === input.version;
  }

  async fail(input: {
    operationId: string; ownerId: string; leaseId: string; version: number;
    stage: Exclude<ErasureStage, "prepared" | "complete">; errorCode: string; retryAfter: Date;
  }): Promise<boolean> {
    const operation = this.operations.get(input.operationId);
    if (!operation || operation.ownerId !== input.ownerId || operation.leaseId !== input.leaseId || operation.version !== input.version || operation.stage !== input.stage) return false;
    operation.retryCount += 1;
    operation.lastErrorCode = input.errorCode;
    operation.retryAfter = input.retryAfter.toISOString();
    operation.leaseId = null;
    operation.leaseExpiresAt = null;
    operation.version += 1;
    return true;
  }
}

function dependencies(repository = new MemoryRepository()): AccountErasureDependencies & { repository: MemoryRepository } {
  const identity = vi.fn().mockResolvedValue({
    userId: ownerA,
    sessionId: "session-a",
    otpAuthenticatedAt: new Date(now.getTime() - 60_000),
  });
  return {
    isEnabled: () => true,
    isConfigured: () => true,
    isWorkerConfigured: () => true,
    now: () => new Date(now),
    verifyIdentity: identity,
    repository,
    polar: {
      deleteOrAnonymizeByExternalId: vi.fn().mockResolvedValue("deleted"),
      readbackByExternalId: vi.fn().mockResolvedValue("absent"),
    },
    sessions: {
      revokeAllForOwner: vi.fn().mockResolvedValue(undefined),
      hasActiveSessions: vi.fn().mockResolvedValue(false),
    },
    storage: {
      listOwnerObjects: vi.fn().mockResolvedValue([]),
      removeOwnerObjects: vi.fn().mockResolvedValue({ failed: [] }),
      providerInventoryIsAuthoritative: vi.fn().mockResolvedValue(true),
      listAdmittedCandidates: vi.fn().mockResolvedValue([]),
      ownerObjectExists: vi.fn().mockResolvedValue(false),
      markAdmittedCandidateDeleted: vi.fn().mockResolvedValue(undefined),
      hasAdmittedCandidates: vi.fn().mockResolvedValue(false),
    },
    appData: {
      deleteOwnerRows: vi.fn().mockResolvedValue(undefined),
      hasOwnerRows: vi.fn().mockResolvedValue(false),
    },
    auth: {
      hardDeleteUser: vi.fn().mockResolvedValue("deleted"),
      userExists: vi.fn().mockResolvedValue(false),
    },
  };
}

async function prepareAndConfirm(deps: AccountErasureDependencies, owner = ownerA) {
  const headers = { "X-Capture-Owner": owner };
  const prepared = await handleAccountErasurePrepare(new Request("https://capture.test/api/cloud/account-erasure/prepare", {
    method: "POST", headers, body: "{}",
  }), deps);
  const receipt = await prepared.json() as { operationId: string; receiptToken: string };
  const confirmed = await handleAccountErasureConfirm(new Request("https://capture.test/api/cloud/account-erasure/confirm", {
    method: "POST", headers, body: JSON.stringify(receipt),
  }), deps);
  return { prepared, confirmed, receipt };
}

describe("account erasure route contracts", () => {
  it("uses a configurable window bounded at ten minutes", () => {
    expect(destructiveAuthWindowMs({})).toBe(600_000);
    expect(destructiveAuthWindowMs({ CAPTURE_ERASURE_AUTH_WINDOW_SECONDS: "300" })).toBe(300_000);
    expect(() => destructiveAuthWindowMs({ CAPTURE_ERASURE_AUTH_WINDOW_SECONDS: "601" })).toThrow();
    expect(() => destructiveAuthWindowMs({ CAPTURE_ERASURE_AUTH_WINDOW_SECONDS: "invalid" })).toThrow();
  });

  it("requires exact live owner and recent OTP evidence before preparing", async () => {
    const deps = dependencies();
    for (const [identity, expected] of [
      [null, 401],
      [{ userId: ownerA, sessionId: "session-a", otpAuthenticatedAt: null }, 403],
      [{ userId: ownerA, sessionId: "session-a", otpAuthenticatedAt: new Date(now.getTime() - 600_001) }, 403],
      [{ userId: ownerA, sessionId: "", otpAuthenticatedAt: now }, 503],
    ] as const) {
      vi.mocked(deps.verifyIdentity).mockResolvedValueOnce(identity);
      const response = await handleAccountErasurePrepare(new Request("https://capture.test/api/cloud/account-erasure/prepare", {
        method: "POST", headers: { "X-Capture-Owner": ownerA }, body: "{}",
      }), deps);
      expect(response.status).toBe(expected);
    }
    vi.mocked(deps.verifyIdentity).mockResolvedValueOnce({ userId: ownerA, sessionId: "session-a", otpAuthenticatedAt: now });
    const mismatch = await handleAccountErasurePrepare(new Request("https://capture.test/api/cloud/account-erasure/prepare", {
      method: "POST", headers: { "X-Capture-Owner": ownerB }, body: "{}",
    }), deps);
    expect(mismatch.status).toBe(412);
  });

  it.each([
    ["missing", {}],
    ["short", { CAPTURE_ACCOUNT_ERASURE_WORKER_SECRET: "s".repeat(31) }],
  ])("allows prepare/status but refuses fencing with a %s worker bearer", async (_label, env) => {
    const deps = dependencies();
    deps.isWorkerConfigured = () => accountErasureWorkerSecret(env) !== null;
    const prepared = await handleAccountErasurePrepare(new Request("https://capture.test/api/cloud/account-erasure/prepare", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: "{}",
    }), deps);
    expect(prepared.status).toBe(201);
    const receipt = await prepared.json() as { operationId: string; receiptToken: string };
    const denied = await handleAccountErasureConfirm(new Request("https://capture.test/api/cloud/account-erasure/confirm", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(receipt),
    }), deps);
    expect(denied.status).toBe(503);
    expect(deps.repository.operations.get(receipt.operationId)?.stage).toBe("prepared");
    expect(deps.repository.fence.has(ownerA)).toBe(false);
    const status = await handleAccountErasureStatus(new Request("https://capture.test/api/cloud/account-erasure/status", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(receipt),
    }), deps);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ stage: "prepared", complete: false });
    await expect(runAccountErasureWorker(deps)).resolves.toEqual({ status: "idle" });
  });

  it("returns a random receipt once, stores only hashes, and never accepts receipt material in a URL", async () => {
    const deps = dependencies();
    const prepared = await handleAccountErasurePrepare(new Request("https://capture.test/api/cloud/account-erasure/prepare", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: "{}",
    }), deps);
    expect(prepared.status).toBe(201);
    const receipt = await prepared.json() as { operationId: string; receiptToken: string };
    expect(receipt.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(receipt.receiptToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = deps.repository.operations.get(receipt.operationId)!;
    expect(stored.receiptHash).toBe(sha256(receipt.receiptToken));
    expect(JSON.stringify(stored)).not.toContain(receipt.receiptToken);

    const leaked = await handleAccountErasureStatus(new Request(`https://capture.test/api/cloud/account-erasure/status?receiptToken=${receipt.receiptToken}`, {
      method: "POST", body: JSON.stringify(receipt),
    }), deps);
    expect(leaked.status).toBe(400);
  });

  it("binds confirmation to the same owner and session, while duplicate confirmation and lost responses are idempotent", async () => {
    const deps = dependencies();
    const prepared = await handleAccountErasurePrepare(new Request("https://capture.test/api/cloud/account-erasure/prepare", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: "{}",
    }), deps);
    const receipt = await prepared.json() as { operationId: string; receiptToken: string };

    vi.mocked(deps.verifyIdentity).mockResolvedValueOnce({ userId: ownerB, sessionId: "session-a", otpAuthenticatedAt: now });
    expect((await handleAccountErasureConfirm(new Request("https://capture.test/api/cloud/account-erasure/confirm", {
      method: "POST", headers: { "X-Capture-Owner": ownerB }, body: JSON.stringify(receipt),
    }), deps)).status).toBe(404);
    vi.mocked(deps.verifyIdentity).mockResolvedValueOnce({ userId: ownerA, sessionId: "session-b", otpAuthenticatedAt: now });
    expect((await handleAccountErasureConfirm(new Request("https://capture.test/api/cloud/account-erasure/confirm", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(receipt),
    }), deps)).status).toBe(404);

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handleAccountErasureConfirm(new Request("https://capture.test/api/cloud/account-erasure/confirm", {
        method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(receipt),
      }), deps);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ operationId: receipt.operationId, stage: "polar" });
    }
    expect(deps.repository.fence.has(ownerA)).toBe(true);
  });

  it("uses receipt-only POST status after auth deletion and denies cross-tenant or expired receipts uniformly", async () => {
    const deps = dependencies();
    const { receipt } = await prepareAndConfirm(deps);
    const valid = await handleAccountErasureStatus(new Request("https://capture.test/api/cloud/account-erasure/status", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(receipt),
    }), deps);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual(expect.objectContaining({ operationId: receipt.operationId, stage: "polar", complete: false }));

    vi.mocked(deps.verifyIdentity).mockResolvedValueOnce({ userId: ownerB, sessionId: "session-a", otpAuthenticatedAt: now });
    const crossTenant = await handleAccountErasureStatus(new Request("https://capture.test/api/cloud/account-erasure/status", {
      method: "POST", headers: { "X-Capture-Owner": ownerB }, body: JSON.stringify(receipt),
    }), deps);
    expect(crossTenant.status).toBe(404);
    vi.mocked(deps.verifyIdentity).mockResolvedValueOnce({ userId: ownerA, sessionId: "session-b", otpAuthenticatedAt: now });
    const otherSession = await handleAccountErasureStatus(new Request("https://capture.test/api/cloud/account-erasure/status", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(receipt),
    }), deps);
    expect(otherSession.status).toBe(404);

    for (const body of [
      { operationId: receipt.operationId, receiptToken: "x".repeat(43) },
      { operationId: crypto.randomUUID(), receiptToken: receipt.receiptToken },
    ]) {
      const denied = await handleAccountErasureStatus(new Request("https://capture.test/api/cloud/account-erasure/status", {
        method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(body),
      }), deps);
      expect(denied.status).toBe(404);
    }
    deps.repository.operations.get(receipt.operationId)!.receiptExpiresAt = new Date(now.getTime() - 1).toISOString();
    vi.mocked(deps.verifyIdentity).mockResolvedValueOnce({ userId: ownerA, sessionId: "session-a", otpAuthenticatedAt: now });
    const expired = await handleAccountErasureStatus(new Request("https://capture.test/api/cloud/account-erasure/status", {
      method: "POST", headers: { "X-Capture-Owner": ownerA }, body: JSON.stringify(receipt),
    }), deps);
    expect(expired.status).toBe(404);
  });
});

describe("durable account erasure worker", () => {
  it("runs the destructive stages in the fixed order, reads back each stage, and retains a content-free completion receipt", async () => {
    const deps = dependencies();
    const { receipt } = await prepareAndConfirm(deps);
    const calls: string[] = [];
    vi.mocked(deps.polar.deleteOrAnonymizeByExternalId).mockImplementation(async () => { calls.push("polar:delete"); return "deleted"; });
    vi.mocked(deps.polar.readbackByExternalId).mockImplementation(async () => { calls.push("polar:readback"); return "absent"; });
    vi.mocked(deps.sessions.revokeAllForOwner).mockImplementation(async () => { calls.push("sessions:revoke"); });
    vi.mocked(deps.sessions.hasActiveSessions).mockImplementation(async () => { calls.push("sessions:readback"); return false; });
    vi.mocked(deps.storage.listOwnerObjects).mockImplementation(async (bucket) => { calls.push(`storage:list:${bucket}`); return []; });
    vi.mocked(deps.appData.deleteOwnerRows).mockImplementation(async () => { calls.push("app:delete"); });
    vi.mocked(deps.appData.hasOwnerRows).mockImplementation(async () => { calls.push("app:readback"); return false; });
    vi.mocked(deps.auth.hardDeleteUser).mockImplementation(async () => { calls.push("auth:delete"); return "deleted"; });
    vi.mocked(deps.auth.userExists).mockImplementation(async () => { calls.push("auth:readback"); return false; });

    for (let i = 0; i < ERASURE_STAGES.length; i++) await runAccountErasureWorker(deps);
    expect(calls).toEqual([
      "polar:delete", "polar:readback",
      "sessions:revoke", "sessions:readback",
      ...APPROVED_ERASURE_BUCKETS.map(bucket => `storage:list:${bucket}`),
      "app:delete", "app:readback",
      "polar:delete", "polar:readback",
      "auth:delete", "auth:readback",
    ]);
    const completed = deps.repository.operations.get(receipt.operationId)!;
    expect(completed).toMatchObject({ ownerId: null, stage: "complete", lastErrorCode: null });
    expect(completed.completedAt).not.toBeNull();
    expect(Date.parse(completed.receiptExpiresAt) - now.getTime()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
    expect(JSON.stringify(completed)).not.toContain(ownerA);
    vi.mocked(deps.verifyIdentity).mockResolvedValue(null);
    const status = await handleAccountErasureStatus(new Request("https://capture.test/api/cloud/account-erasure/status", {
      method: "POST", body: JSON.stringify(receipt),
    }), deps);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ stage: "complete", complete: true });
  });

  it("replays safely after crashes/lost advances and accepts provider already-done or missing objects", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    vi.mocked(deps.polar.deleteOrAnonymizeByExternalId).mockResolvedValue("already-absent");
    const originalAdvance = deps.repository.advance.bind(deps.repository);
    vi.spyOn(deps.repository, "advance").mockResolvedValueOnce(false).mockImplementation(originalAdvance);
    expect((await runAccountErasureWorker(deps)).status).toBe("superseded");
    [...deps.repository.operations.values()][0].leaseExpiresAt = new Date(now.getTime() - 1).toISOString();
    expect((await runAccountErasureWorker(deps)).status).toBe("advanced");
    expect(deps.polar.deleteOrAnonymizeByExternalId).toHaveBeenCalledTimes(2);
  });

  it("drains more than 1000 objects by bounded pages and tolerates objects already missing", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    await runAccountErasureWorker(deps); // polar
    await runAccountErasureWorker(deps); // sessions
    const objects = new Map(APPROVED_ERASURE_BUCKETS.map((bucket, bucketIndex) => [
      bucket,
      Array.from({ length: bucketIndex === 0 ? 1_205 : 0 }, (_, index) => `${ownerA}/${index}`),
    ]));
    vi.mocked(deps.storage.listOwnerObjects).mockImplementation(async (bucket, _owner, limit) => objects.get(bucket)!.slice(0, limit));
    vi.mocked(deps.storage.removeOwnerObjects).mockImplementation(async (bucket, _owner, paths) => {
      const values = objects.get(bucket)!;
      for (const path of paths) {
        const index = values.indexOf(path);
        if (index >= 0) values.splice(index, 1); // missing is also success
      }
      return { failed: [] };
    });
    expect((await runAccountErasureWorker(deps)).status).toBe("advanced");
    expect(objects.get(APPROVED_ERASURE_BUCKETS[0])).toEqual([]);
    expect(deps.storage.removeOwnerObjects).toHaveBeenCalledTimes(13);
    expect(deps.storage.listOwnerObjects).toHaveBeenCalledTimes(16); // 13 pages + zero readback + two empty buckets
  });

  it("drains durable candidate operations with exact object readback before provider listings", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    await runAccountErasureWorker(deps); // polar
    await runAccountErasureWorker(deps); // sessions
    const operationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const path = `${ownerA}/candidate`;
    let inventoried = true;
    const listAdmittedCandidates = vi.fn().mockImplementation(async () => inventoried
      ? [{ operationId, bucket: "capture-image-candidates" as const, path }]
      : []);
    const ownerObjectExists = vi.fn().mockResolvedValue(false);
    const markAdmittedCandidateDeleted = vi.fn().mockImplementation(async () => { inventoried = false; });
    const hasAdmittedCandidates = vi.fn().mockImplementation(async () => inventoried);
    Object.assign(deps.storage, {
      providerInventoryIsAuthoritative: vi.fn().mockResolvedValue(true),
      listAdmittedCandidates,
      ownerObjectExists,
      markAdmittedCandidateDeleted,
      hasAdmittedCandidates,
    });

    expect((await runAccountErasureWorker(deps)).status).toBe("advanced");
    expect(listAdmittedCandidates).toHaveBeenCalledWith(ownerA, 100);
    expect(deps.storage.removeOwnerObjects).toHaveBeenCalledWith("capture-image-candidates", ownerA, [path]);
    expect(ownerObjectExists).toHaveBeenCalledWith("capture-image-candidates", ownerA, path);
    expect(markAdmittedCandidateDeleted).toHaveBeenCalledWith(ownerA, operationId);
    expect(hasAdmittedCandidates).toHaveBeenCalledWith(ownerA);
    expect(vi.mocked(deps.storage.listOwnerObjects).mock.invocationCallOrder[0])
      .toBeGreaterThan(markAdmittedCandidateDeleted.mock.invocationCallOrder[0]);
  });

  it("does not claim Storage drain completion when provider inventory is not authoritative", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    await runAccountErasureWorker(deps); // polar
    await runAccountErasureWorker(deps); // sessions
    Object.assign(deps.storage, {
      providerInventoryIsAuthoritative: vi.fn().mockResolvedValue(false),
      listAdmittedCandidates: vi.fn().mockResolvedValue([]),
      ownerObjectExists: vi.fn().mockResolvedValue(false),
      markAdmittedCandidateDeleted: vi.fn(),
      hasAdmittedCandidates: vi.fn().mockResolvedValue(false),
    });

    expect(await runAccountErasureWorker(deps)).toEqual({ status: "retry", stage: "storage" });
    expect([...deps.repository.operations.values()][0].lastErrorCode).toBe("storage_inventory_unproven");
    expect(deps.storage.listOwnerObjects).not.toHaveBeenCalled();
  });

  it("uses expiring versioned leases so concurrent workers cannot both claim and an expired lease can resume", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    const [first, concurrent] = await Promise.all([
      deps.repository.claim({ leaseId: "lease-1", now, leaseExpiresAt: new Date(now.getTime() + 30_000) }),
      deps.repository.claim({ leaseId: "lease-2", now, leaseExpiresAt: new Date(now.getTime() + 30_000) }),
    ]);
    expect([first, concurrent].filter(Boolean)).toHaveLength(1);
    const winner = first ?? concurrent!;
    const firstVersion = winner.version;
    expect(["lease-1", "lease-2"]).toContain(winner.leaseId);
    const resumed = await deps.repository.claim({ leaseId: "lease-3", now: new Date(now.getTime() + 30_001), leaseExpiresAt: new Date(now.getTime() + 60_001) });
    expect(resumed?.leaseId).toBe("lease-3");
    expect(resumed?.version).toBeGreaterThan(firstVersion);
  });

  it("records only bounded error codes and releases the lease for retry", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    vi.mocked(deps.polar.readbackByExternalId).mockResolvedValue("present");
    const result = await runAccountErasureWorker(deps);
    expect(result.status).toBe("retry");
    const operation = [...deps.repository.operations.values()][0];
    expect(operation).toMatchObject({ stage: "polar", retryCount: 1, lastErrorCode: "polar_readback_present", leaseId: null });
    expect(JSON.stringify(operation)).not.toContain("private");
  });

  it("computes slow-provider failure backoff from fresh time and durably releases the lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const deps = dependencies();
      deps.now = () => new Date(Date.now());
      await prepareAndConfirm(deps);
      vi.mocked(deps.polar.deleteOrAnonymizeByExternalId).mockImplementation(() =>
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("slow provider")), 6_000)));

      const pending = runAccountErasureWorker(deps);
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(pending).resolves.toEqual({ status: "retry", stage: "polar" });

      const operation = [...deps.repository.operations.values()][0];
      expect(operation).toMatchObject({
        stage: "polar",
        retryCount: 1,
        lastErrorCode: "polar_provider_unavailable",
        leaseId: null,
        leaseExpiresAt: null,
      });
      expect(operation.retryAfter).toBe(new Date(now.getTime() + 11_000).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("records stage completion from fresh time after slow provider success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const deps = dependencies();
      deps.now = () => new Date(Date.now());
      await prepareAndConfirm(deps);
      vi.mocked(deps.polar.deleteOrAnonymizeByExternalId).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve("deleted"), 6_000)));
      const advance = vi.spyOn(deps.repository, "advance");

      const pending = runAccountErasureWorker(deps);
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(pending).resolves.toEqual({ status: "advanced", stage: "polar" });
      expect(advance).toHaveBeenCalledWith(expect.objectContaining({
        now: new Date(now.getTime() + 6_000),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("never completes Auth when readback is unavailable or malformed", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    for (let i = 0; i < 4; i++) await runAccountErasureWorker(deps);
    vi.mocked(deps.auth.userExists).mockRejectedValueOnce(new Error("malformed Auth readback"));
    expect(await runAccountErasureWorker(deps)).toEqual({ status: "retry", stage: "auth" });
    expect([...deps.repository.operations.values()][0]).toMatchObject({
      stage: "auth",
      retryCount: 1,
      lastErrorCode: "auth_provider_unavailable",
      leaseId: null,
    });
  });

  it("recovers when Auth deletion succeeds but a late Polar delivery supersedes the final advance", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    for (let i = 0; i < 4; i++) await runAccountErasureWorker(deps);

    let authPresent = true;
    vi.mocked(deps.auth.hardDeleteUser).mockImplementation(async () => {
      authPresent = false;
      return "deleted";
    });
    vi.mocked(deps.auth.userExists).mockImplementation(async () => authPresent);
    const originalAdvance = deps.repository.advance.bind(deps.repository);
    vi.spyOn(deps.repository, "advance").mockImplementationOnce(async (input) => {
      const operation = deps.repository.operations.get(input.operationId)!;
      deps.repository.operations.set(input.operationId, {
        ...operation,
        stage: "polar",
        leaseId: null,
        leaseExpiresAt: null,
        version: operation.version + 1,
      });
      return false;
    }).mockImplementation(originalAdvance);

    expect(await runAccountErasureWorker(deps)).toEqual({ status: "superseded", stage: "auth" });
    expect(authPresent).toBe(false);
    for (let i = 0; i < ERASURE_STAGES.length; i++) await runAccountErasureWorker(deps);
    expect([...deps.repository.operations.values()][0].stage).toBe("complete");
    expect(deps.auth.hardDeleteUser).toHaveBeenCalledTimes(2);
  });

  it("does not call Auth or complete when a late Polar event rewinds the Auth lease", async () => {
    const deps = dependencies();
    await prepareAndConfirm(deps);
    for (let i = 0; i < 4; i++) await runAccountErasureWorker(deps);
    vi.spyOn(deps.repository, "authorizeAuthDeletion").mockImplementationOnce(async (input) => {
      const operation = deps.repository.operations.get(input.operationId)!;
      deps.repository.operations.set(input.operationId, {
        ...operation,
        stage: "polar",
        leaseId: null,
        leaseExpiresAt: null,
        version: operation.version + 1,
      });
      return false;
    });
    const result = await runAccountErasureWorker(deps);
    expect(result).toEqual({ status: "superseded", stage: "auth" });
    expect(deps.polar.deleteOrAnonymizeByExternalId).toHaveBeenCalledTimes(2);
    expect(deps.polar.readbackByExternalId).toHaveBeenCalledTimes(2);
    expect(deps.auth.hardDeleteUser).not.toHaveBeenCalled();
    expect([...deps.repository.operations.values()][0].stage).toBe("polar");
  });
});
