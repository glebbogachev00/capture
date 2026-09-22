import "server-only";

import { errors as polarErrors } from "@polar-sh/sdk/2026-04";
import { isAuthApiError } from "@supabase/supabase-js";

import {
  APPROVED_ERASURE_BUCKETS,
  ERASURE_STAGES,
  type AccountErasureOperation,
  type AccountErasureRepository,
  type ClaimedAccountErasureOperation,
  type DestructiveIdentity,
  type ErasureStage,
} from "@/lib/accountErasure";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const DESTRUCTIVE = new Set<string>(ERASURE_STAGES);
const ALL_STAGES = new Set<string>(["prepared", ...ERASURE_STAGES, "complete"]);
// Polar SDK request timeouts are seconds. Thirty seconds is the documented
// per-call bound used inside the worker route's 60-second execution budget.
const POLAR_ERASURE_TIMEOUT_SECONDS = 30;

export function createDeadlineFetch(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 55_000) {
    throw new Error("Invalid provider deadline");
  }
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const upstreamSignals = [
      input instanceof Request ? input.signal : undefined,
      init?.signal,
    ].filter((value): value is AbortSignal => !!value);
    const abortFromUpstream = (event: Event) => {
      const signal = event.target as AbortSignal;
      controller.abort(signal.reason);
    };
    for (const signal of upstreamSignals) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", abortFromUpstream, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      for (const signal of upstreamSignals) signal.removeEventListener("abort", abortFromUpstream);
    }
  }) as typeof fetch;
}

type DestructiveSupabaseClient = {
  auth: {
    getUser(): Promise<{ data: { user?: {
      id?: unknown;
      email?: unknown;
      email_confirmed_at?: unknown;
    } | null } | null; error: unknown }>;
    getClaims(): Promise<{ data: { claims?: Record<string, unknown> } | null; error: unknown }>;
  };
};

/** Destructive authorization combines a live Auth-server user lookup with
 * signed JWT claims. Neither source is sufficient alone: getUser proves the
 * account/session is still accepted, while claims bind the exact session and
 * timestamped email OTP authentication method. */
export async function destructiveIdentityFromSupabase(client: DestructiveSupabaseClient): Promise<DestructiveIdentity | null> {
  try {
    const live = await client.auth.getUser();
    if (live.error) return null;
    const user = live.data?.user;
    const liveId = user?.id;
    const liveEmail = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    if (typeof liveId !== "string" || !UUID.test(liveId) || !liveEmail
        || typeof user?.email_confirmed_at !== "string" || !Number.isFinite(Date.parse(user.email_confirmed_at))) return null;

    const result = await client.auth.getClaims();
    if (result.error) return null;
    const claims = result.data?.claims;
    const userId = claims?.sub;
    const claimEmail = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
    const sessionId = claims?.session_id;
    const amr = claims?.amr;
    if (userId !== liveId || claimEmail !== liveEmail
        || typeof userId !== "string" || !UUID.test(userId)
        || typeof sessionId !== "string" || !sessionId.trim() || !Array.isArray(amr)) return null;
    let otpTimestamp = -1;
    for (const entry of amr) {
      if (!entry || typeof entry !== "object") continue;
      const method = (entry as Record<string, unknown>).method;
      const timestamp = (entry as Record<string, unknown>).timestamp;
      if (method === "otp" && typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp > otpTimestamp) {
        otpTimestamp = timestamp;
      }
    }
    if (otpTimestamp < 0) return null;
    return { userId, sessionId, otpAuthenticatedAt: new Date(otpTimestamp * 1000) };
  } catch {
    return null;
  }
}

export type ErasureRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function operationFailure(): Error {
  return new Error("Account erasure operation failed");
}

function nullableIso(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function operationFrom(value: unknown): AccountErasureOperation | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw operationFailure();
  const row = value as Record<string, unknown>;
  const operationId = row.operationId;
  const ownerId = row.ownerId;
  const stage = row.stage;
  const version = row.version;
  const attemptCount = row.attemptCount;
  const retryCount = row.retryCount;
  const retryAfter = nullableIso(row.retryAfter);
  const leaseId = row.leaseId;
  const leaseExpiresAt = nullableIso(row.leaseExpiresAt);
  const confirmedAt = nullableIso(row.confirmedAt);
  const completedAt = nullableIso(row.completedAt);
  const receiptExpiresAt = nullableIso(row.receiptExpiresAt);
  const lastErrorCode = row.lastErrorCode;
  if (typeof operationId !== "string" || !UUID.test(operationId)
      || !(ownerId === null || (typeof ownerId === "string" && UUID.test(ownerId)))
      || typeof stage !== "string" || !ALL_STAGES.has(stage)
      || !Number.isSafeInteger(version) || (version as number) < 1
      || !Number.isSafeInteger(attemptCount) || (attemptCount as number) < 0
      || !Number.isSafeInteger(retryCount) || (retryCount as number) < 0
      || retryAfter === undefined || leaseExpiresAt === undefined || confirmedAt === undefined || completedAt === undefined
      || receiptExpiresAt === undefined || receiptExpiresAt === null
      || !(leaseId === null || (typeof leaseId === "string" && UUID.test(leaseId)))
      || !(lastErrorCode === null || (typeof lastErrorCode === "string" && /^[a-z0-9_]{1,64}$/.test(lastErrorCode)))) {
    throw operationFailure();
  }
  return {
    operationId,
    ownerId: ownerId as string | null,
    stage: stage as ErasureStage,
    version: version as number,
    attemptCount: attemptCount as number,
    retryCount: retryCount as number,
    retryAfter,
    lastErrorCode: lastErrorCode as string | null,
    leaseId: leaseId as string | null,
    leaseExpiresAt,
    confirmedAt,
    completedAt,
    receiptExpiresAt,
  };
}

async function rpcOperation(
  client: ErasureRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<AccountErasureOperation | null> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw operationFailure();
  return operationFrom(data);
}

async function rpcBoolean(
  client: ErasureRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await client.rpc(name, args);
  if (error || typeof data !== "boolean") throw operationFailure();
  return data;
}

export class SupabaseAccountErasureRepository implements AccountErasureRepository {
  constructor(private readonly client: ErasureRpcClient) {}

  prepare(input: Parameters<AccountErasureRepository["prepare"]>[0]) {
    if (!UUID.test(input.operationId) || !UUID.test(input.ownerId) || !HASH.test(input.sessionHash) || !HASH.test(input.receiptHash)) {
      throw operationFailure();
    }
    return rpcOperation(this.client, "prepare_capture_account_erasure", {
      p_operation_id: input.operationId,
      p_owner_id: input.ownerId,
      p_session_id_hash: input.sessionHash,
      p_receipt_secret_hash: input.receiptHash,
      p_receipt_expires_at: input.receiptExpiresAt.toISOString(),
    });
  }

  status(input: Parameters<AccountErasureRepository["status"]>[0]) {
    if (!UUID.test(input.operationId) || !HASH.test(input.receiptHash)) throw operationFailure();
    return rpcOperation(this.client, "status_capture_account_erasure", {
      p_operation_id: input.operationId,
      p_receipt_secret_hash: input.receiptHash,
      p_owner_id: input.ownerId ?? null,
      p_session_id_hash: input.sessionHash ?? null,
    });
  }

  confirm(input: Parameters<AccountErasureRepository["confirm"]>[0]) {
    if (!UUID.test(input.operationId) || !UUID.test(input.ownerId) || !HASH.test(input.sessionHash) || !HASH.test(input.receiptHash)) {
      throw operationFailure();
    }
    return rpcOperation(this.client, "confirm_capture_account_erasure", {
      p_operation_id: input.operationId,
      p_owner_id: input.ownerId,
      p_session_id_hash: input.sessionHash,
      p_receipt_secret_hash: input.receiptHash,
    });
  }

  async claim(input: Parameters<AccountErasureRepository["claim"]>[0]): Promise<ClaimedAccountErasureOperation | null> {
    if (!UUID.test(input.leaseId)) throw operationFailure();
    const operation = await rpcOperation(this.client, "claim_capture_account_erasure", {
      p_lease_id: input.leaseId,
      p_now: input.now.toISOString(),
      p_lease_expires_at: input.leaseExpiresAt.toISOString(),
    });
    if (!operation) return null;
    if (!operation.ownerId || !operation.leaseId || !DESTRUCTIVE.has(operation.stage)) throw operationFailure();
    return operation as ClaimedAccountErasureOperation;
  }

  advance(input: Parameters<AccountErasureRepository["advance"]>[0]) {
    return rpcBoolean(this.client, "advance_capture_account_erasure", {
      p_operation_id: input.operationId,
      p_owner_id: input.ownerId,
      p_lease_id: input.leaseId,
      p_version: input.version,
      p_stage: input.stage,
      p_next_stage: input.nextStage,
      p_now: input.now.toISOString(),
    });
  }

  authorizeAuthDeletion(input: Parameters<AccountErasureRepository["authorizeAuthDeletion"]>[0]) {
    return rpcBoolean(this.client, "authorize_capture_account_auth_deletion", {
      p_operation_id: input.operationId,
      p_owner_id: input.ownerId,
      p_lease_id: input.leaseId,
      p_version: input.version,
    });
  }

  fail(input: Parameters<AccountErasureRepository["fail"]>[0]) {
    return rpcBoolean(this.client, "fail_capture_account_erasure", {
      p_operation_id: input.operationId,
      p_owner_id: input.ownerId,
      p_lease_id: input.leaseId,
      p_version: input.version,
      p_stage: input.stage,
      p_error_code: input.errorCode,
      p_retry_after: input.retryAfter.toISOString(),
    });
  }
}

/** Polar 2026-04 documents ResourceNotFound for exact customer lookups.
 * A bare HTTP 404 may be a gateway or routing failure and is unavailable. */
export function polarCustomerNotFound(error: unknown): boolean {
  return error instanceof polarErrors.ResourceNotFound
    && error.statusCode === 404
    && error.error?.error === "ResourceNotFound";
}

/** Supabase Auth exposes a typed AuthApiError plus the stable
 * `user_not_found` code. Status alone is not evidence of user absence. */
export function supabaseAuthUserNotFound(error: unknown): boolean {
  return isAuthApiError(error) && error.status === 404 && error.code === "user_not_found";
}

function supabaseStorageObjectNotFound(error: unknown): boolean {
  return !!error && typeof error === "object"
    && (error as { code?: unknown }).code === "NoSuchKey";
}

type PolarClient = {
  customers: {
    deleteExternal(ownerId: string, query: { anonymize: boolean }, options: { timeout: number }): Promise<void>;
    getExternal(ownerId: string, options: { timeout: number }): Promise<unknown>;
  };
};

export function createPolarErasureAdapter(client: PolarClient) {
  return {
    async deleteOrAnonymizeByExternalId(ownerId: string): Promise<"deleted" | "already-absent"> {
      try {
        await client.customers.deleteExternal(ownerId, { anonymize: true }, { timeout: POLAR_ERASURE_TIMEOUT_SECONDS });
        return "deleted";
      } catch (error) {
        if (polarCustomerNotFound(error)) return "already-absent";
        throw operationFailure();
      }
    },
    async readbackByExternalId(ownerId: string): Promise<"absent" | "present"> {
      try {
        await client.customers.getExternal(ownerId, { timeout: POLAR_ERASURE_TIMEOUT_SECONDS });
        return "present";
      } catch (error) {
        if (polarCustomerNotFound(error)) return "absent";
        throw operationFailure();
      }
    },
  };
}

type StorageBucket = {
  list(prefix: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }): Promise<{ data: unknown; error: unknown }>;
  remove(paths: string[]): Promise<{ data: unknown; error: unknown }>;
  info(path: string): Promise<{ data: unknown; error: unknown }>;
};
type StorageClient = ErasureRpcClient & {
  storage: {
    from(bucket: string): StorageBucket;
    listBuckets(): Promise<{ data: unknown; error: unknown }>;
  };
};

export function createStorageErasureAdapter(
  client: StorageClient,
  options: { inventoryAttested?: boolean } = {},
) {
  return {
    async providerInventoryIsAuthoritative(): Promise<boolean> {
      // Operator attestation is necessary but not sufficient. Read the current
      // provider bucket inventory on every boundary check and reject any
      // Capture-prefixed bucket outside the source allowlist or any missing
      // allowlisted bucket. This never infers provider quiescence from source.
      if (options.inventoryAttested !== true) return false;
      const { data, error } = await client.storage.listBuckets();
      if (error || !Array.isArray(data)) return false;
      const ids = data.map(value => (value as { id?: unknown } | null)?.id);
      if (ids.some(id => typeof id !== "string")) return false;
      const captureBuckets = (ids as string[]).filter(id => id.startsWith("capture-"));
      return captureBuckets.length === APPROVED_ERASURE_BUCKETS.length
        && APPROVED_ERASURE_BUCKETS.every(bucket => captureBuckets.includes(bucket));
    },
    async listAdmittedCandidates(ownerId: string, limit: number) {
      if (!UUID.test(ownerId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw operationFailure();
      const { data, error } = await client.rpc("capture_image_operation_inventory", {
        p_owner_id: ownerId,
        p_limit: limit,
      });
      if (error || !Array.isArray(data)) throw operationFailure();
      return data.map(value => {
        const row = value as { operation_id?: unknown; bucket_id?: unknown; object_path?: unknown } | null;
        if (!row || typeof row.operation_id !== "string" || !UUID.test(row.operation_id)
            || typeof row.bucket_id !== "string"
            || !APPROVED_ERASURE_BUCKETS.includes(row.bucket_id as typeof APPROVED_ERASURE_BUCKETS[number])
            || typeof row.object_path !== "string" || !row.object_path.startsWith(`${ownerId}/`)
            || !row.object_path.slice(ownerId.length + 1)
            || row.object_path.slice(ownerId.length + 1).includes("/")) throw operationFailure();
        return {
          operationId: row.operation_id,
          bucket: row.bucket_id as typeof APPROVED_ERASURE_BUCKETS[number],
          path: row.object_path,
        };
      });
    },
    async ownerObjectExists(bucket: typeof APPROVED_ERASURE_BUCKETS[number], ownerId: string, path: string): Promise<boolean> {
      if (!APPROVED_ERASURE_BUCKETS.includes(bucket) || !UUID.test(ownerId)
          || !path.startsWith(`${ownerId}/`) || !path.slice(ownerId.length + 1)
          || path.slice(ownerId.length + 1).includes("/")) throw operationFailure();
      const { data, error } = await client.storage.from(bucket).info(path);
      if (error) {
        if (supabaseStorageObjectNotFound(error)) return false;
        throw operationFailure();
      }
      if (!data) throw operationFailure();
      return true;
    },
    async markAdmittedCandidateDeleted(ownerId: string, operationId: string): Promise<void> {
      if (!UUID.test(ownerId) || !UUID.test(operationId)) throw operationFailure();
      if (!await rpcBoolean(client, "mark_capture_image_operation_deleted", {
        p_owner_id: ownerId,
        p_operation_id: operationId,
      })) throw operationFailure();
    },
    hasAdmittedCandidates(ownerId: string): Promise<boolean> {
      if (!UUID.test(ownerId)) throw operationFailure();
      return rpcBoolean(client, "capture_image_inventory_remaining", { p_owner_id: ownerId });
    },
    async listOwnerObjects(bucket: typeof APPROVED_ERASURE_BUCKETS[number], ownerId: string, limit: number): Promise<string[]> {
      if (!APPROVED_ERASURE_BUCKETS.includes(bucket) || !UUID.test(ownerId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw operationFailure();
      }
      const { data, error } = await client.storage.from(bucket).list(ownerId, {
        limit,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });
      if (error || !Array.isArray(data)) throw operationFailure();
      return data.map(value => {
        const name = (value as { name?: unknown } | null)?.name;
        if (typeof name !== "string" || !name || name.includes("/")) throw operationFailure();
        return `${ownerId}/${name}`;
      });
    },
    async removeOwnerObjects(bucket: typeof APPROVED_ERASURE_BUCKETS[number], ownerId: string, paths: string[]): Promise<{ failed: string[] }> {
      if (!APPROVED_ERASURE_BUCKETS.includes(bucket) || !UUID.test(ownerId)
          || !paths.length || paths.some(path => !path.startsWith(`${ownerId}/`) || path.slice(ownerId.length + 1).includes("/"))) {
        throw operationFailure();
      }
      const { error } = await client.storage.from(bucket).remove(paths);
      // Missing objects are already drained. Any remaining object will be seen
      // by the mandatory next list/zero-readback pass.
      if (error && !supabaseStorageObjectNotFound(error)) throw operationFailure();
      return { failed: [] };
    },
  };
}

export function createSessionFenceAdapter(client: ErasureRpcClient) {
  return {
    async revokeAllForOwner(ownerId: string): Promise<void> {
      if (!UUID.test(ownerId) || !await rpcBoolean(client, "establish_capture_account_session_fence", {
        p_owner_id: ownerId,
      })) throw operationFailure();
    },
    async hasActiveSessions(ownerId: string): Promise<boolean> {
      if (!UUID.test(ownerId)) throw operationFailure();
      const authoritative = await rpcBoolean(client, "capture_account_session_fence_authoritative", {
        p_owner_id: ownerId,
      });
      // Supabase's installed Admin API can globally sign out only with a user's
      // JWT, not by owner UUID. The durable database fence is therefore the
      // authority during erasure; Auth hard-delete last revokes refresh-token
      // families. A false readback means the session stage remains incomplete.
      return !authoritative;
    },
  };
}

export function createAppDataErasureAdapter(client: ErasureRpcClient) {
  return {
    async deleteOwnerRows(ownerId: string): Promise<void> {
      const result = await rpcBoolean(client, "delete_capture_account_app_rows", { p_owner_id: ownerId });
      if (!result) throw operationFailure();
    },
    hasOwnerRows(ownerId: string): Promise<boolean> {
      return rpcBoolean(client, "capture_account_app_rows_exist", { p_owner_id: ownerId });
    },
  };
}

type AuthAdminClient = {
  auth: { admin: {
    deleteUser(ownerId: string, shouldSoftDelete: boolean): Promise<{ data: unknown; error: unknown }>;
    getUserById(ownerId: string): Promise<{ data: { user?: unknown } | null; error: unknown }>;
  } };
};

export function createAuthErasureAdapter(client: AuthAdminClient) {
  return {
    async hardDeleteUser(ownerId: string): Promise<"deleted" | "already-absent"> {
      const { error } = await client.auth.admin.deleteUser(ownerId, false);
      if (!error) return "deleted";
      if (supabaseAuthUserNotFound(error)) return "already-absent";
      throw operationFailure();
    },
    async userExists(ownerId: string): Promise<boolean> {
      if (!UUID.test(ownerId)) throw operationFailure();
      const { data, error } = await client.auth.admin.getUserById(ownerId);
      if (error) {
        if (supabaseAuthUserNotFound(error)) return false;
        throw operationFailure();
      }
      const user = data?.user;
      if (!user || typeof user !== "object" || Array.isArray(user)
          || (user as { id?: unknown }).id !== ownerId) throw operationFailure();
      return true;
    },
  };
}
