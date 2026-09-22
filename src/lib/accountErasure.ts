import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ownerPrecondition } from "@/lib/ownerPrecondition";

export const APPROVED_ERASURE_BUCKETS = [
  "capture-images",
  "capture-image-candidates",
  "capture-image-candidates-fresh-20260914",
] as const;

export const ERASURE_STAGES = ["polar", "sessions", "storage", "app_rows", "auth"] as const;
export type ErasureStage = "prepared" | typeof ERASURE_STAGES[number] | "complete";
type DestructiveStage = typeof ERASURE_STAGES[number];

export type DestructiveIdentity = {
  userId: string;
  sessionId: string;
  otpAuthenticatedAt: Date | null;
};

export type AccountErasureOperation = {
  operationId: string;
  ownerId: string | null;
  stage: ErasureStage;
  version: number;
  attemptCount: number;
  retryCount: number;
  retryAfter: string | null;
  lastErrorCode: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  receiptExpiresAt: string;
};

export type ClaimedAccountErasureOperation = AccountErasureOperation & {
  ownerId: string;
  stage: DestructiveStage;
  leaseId: string;
};

export interface AccountErasureRepository {
  prepare(input: {
    operationId: string;
    ownerId: string;
    sessionHash: string;
    receiptHash: string;
    now: Date;
    receiptExpiresAt: Date;
  }): Promise<AccountErasureOperation | null>;
  status(input: {
    operationId: string;
    receiptHash: string;
    now: Date;
    ownerId?: string;
    sessionHash?: string;
  }): Promise<AccountErasureOperation | null>;
  confirm(input: {
    operationId: string;
    ownerId: string;
    sessionHash: string;
    receiptHash: string;
    now: Date;
  }): Promise<AccountErasureOperation | null>;
  claim(input: {
    leaseId: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<ClaimedAccountErasureOperation | null>;
  advance(input: {
    operationId: string;
    ownerId: string;
    leaseId: string;
    version: number;
    stage: DestructiveStage;
    nextStage: Exclude<ErasureStage, "prepared">;
    now: Date;
    completedReceiptExpiresAt?: Date;
  }): Promise<boolean>;
  authorizeAuthDeletion(input: {
    operationId: string;
    ownerId: string;
    leaseId: string;
    version: number;
  }): Promise<boolean>;
  fail(input: {
    operationId: string;
    ownerId: string;
    leaseId: string;
    version: number;
    stage: DestructiveStage;
    errorCode: string;
    retryAfter: Date;
  }): Promise<boolean>;
}

export interface AccountErasureDependencies {
  isEnabled: () => boolean;
  isConfigured: () => boolean;
  isWorkerConfigured: () => boolean;
  now?: () => Date;
  authWindowMs?: number;
  verifyIdentity: (request: Request) => Promise<DestructiveIdentity | null>;
  repository: AccountErasureRepository;
  polar: {
    deleteOrAnonymizeByExternalId(ownerId: string): Promise<"deleted" | "already-absent">;
    readbackByExternalId(ownerId: string): Promise<"absent" | "present">;
  };
  sessions: {
    revokeAllForOwner(ownerId: string): Promise<void>;
    hasActiveSessions(ownerId: string): Promise<boolean>;
  };
  storage: {
    listOwnerObjects(bucket: typeof APPROVED_ERASURE_BUCKETS[number], ownerId: string, limit: number): Promise<string[]>;
    removeOwnerObjects(bucket: typeof APPROVED_ERASURE_BUCKETS[number], ownerId: string, paths: string[]): Promise<{ failed: string[] }>;
    providerInventoryIsAuthoritative(): Promise<boolean>;
    listAdmittedCandidates(ownerId: string, limit: number): Promise<Array<{
      operationId: string;
      bucket: typeof APPROVED_ERASURE_BUCKETS[number];
      path: string;
    }>>;
    ownerObjectExists(bucket: typeof APPROVED_ERASURE_BUCKETS[number], ownerId: string, path: string): Promise<boolean>;
    markAdmittedCandidateDeleted(ownerId: string, operationId: string): Promise<void>;
    hasAdmittedCandidates(ownerId: string): Promise<boolean>;
  };
  appData: {
    deleteOwnerRows(ownerId: string): Promise<void>;
    hasOwnerRows(ownerId: string): Promise<boolean>;
  };
  auth: {
    hardDeleteUser(ownerId: string): Promise<"deleted" | "already-absent">;
    userExists(ownerId: string): Promise<boolean>;
  };
}

const DEFAULT_AUTH_WINDOW_MS = 10 * 60 * 1000;
const PREPARED_RECEIPT_MS = 60 * 60 * 1000;
const COMPLETED_RECEIPT_MS = 30 * 24 * 60 * 60 * 1000;
const LEASE_MS = 30 * 1000;
const STORAGE_PAGE_SIZE = 100;
const STORAGE_MAX_PAGES_PER_ATTEMPT = 100;
const REMOVE_ATTEMPTS = 3;
const MAX_ROUTE_BODY_BYTES = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT = /^[A-Za-z0-9_-]{43}$/;

export function destructiveAuthWindowMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CAPTURE_ERASURE_AUTH_WINDOW_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_AUTH_WINDOW_MS;
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 600) {
    throw new Error("Invalid account erasure authentication window");
  }
  return seconds * 1000;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const nowFor = (deps: AccountErasureDependencies) => deps.now?.() ?? new Date();

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}

function unavailable(): Response {
  return json({ error: "account erasure unavailable" }, 503);
}

function rejectsReceiptQuery(request: Request): boolean {
  return new URL(request.url).search.length > 0;
}

async function boundedJson(request: Request): Promise<Record<string, unknown> | null> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_ROUTE_BODY_BYTES) return null;
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ROUTE_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function receiptInput(body: Record<string, unknown> | null): { operationId: string; receiptToken: string } | null {
  if (!body || typeof body.operationId !== "string" || !UUID.test(body.operationId)
      || typeof body.receiptToken !== "string" || !RECEIPT.test(body.receiptToken)) return null;
  return { operationId: body.operationId, receiptToken: body.receiptToken };
}

function publicStatus(operation: AccountErasureOperation) {
  return {
    operationId: operation.operationId,
    stage: operation.stage,
    complete: operation.stage === "complete",
    confirmedAt: operation.confirmedAt,
    completedAt: operation.completedAt,
    retryAfter: operation.retryAfter,
  };
}

function isRecentIdentity(identity: DestructiveIdentity, at: Date, windowMs: number): boolean {
  const authenticatedAt = identity.otpAuthenticatedAt?.getTime();
  const age = authenticatedAt === undefined ? Number.POSITIVE_INFINITY : at.getTime() - authenticatedAt;
  return !!identity.userId.trim() && !!identity.sessionId.trim() && Number.isFinite(age) && age >= 0 && age <= windowMs;
}

async function destructiveIdentity(
  request: Request,
  deps: AccountErasureDependencies,
): Promise<DestructiveIdentity | Response> {
  let identity: DestructiveIdentity | null;
  try {
    identity = await deps.verifyIdentity(request);
  } catch {
    return unavailable();
  }
  if (!identity?.userId.trim()) return json({ error: "unauthorized" }, 401);
  const precondition = ownerPrecondition(request, identity.userId);
  if (precondition) return precondition;
  let windowMs: number;
  try {
    windowMs = deps.authWindowMs ?? destructiveAuthWindowMs();
  } catch {
    return unavailable();
  }
  if (!isRecentIdentity(identity, nowFor(deps), windowMs)) {
    return identity.sessionId.trim()
      ? json({ error: "recent one-time-password authentication required" }, 403)
      : unavailable();
  }
  return identity;
}

export async function handleAccountErasurePrepare(
  request: Request,
  deps: AccountErasureDependencies,
): Promise<Response> {
  if (!deps.isEnabled()) return json({ error: "not found" }, 404);
  if (!deps.isConfigured() || rejectsReceiptQuery(request)) return rejectsReceiptQuery(request)
    ? json({ error: "bad request" }, 400) : unavailable();
  if (!await boundedJson(request)) return json({ error: "bad request" }, 400);
  const identity = await destructiveIdentity(request, deps);
  if (identity instanceof Response) return identity;
  const at = nowFor(deps);
  const receiptToken = randomBytes(32).toString("base64url");
  try {
    const operation = await deps.repository.prepare({
      operationId: randomUUID(),
      ownerId: identity.userId,
      sessionHash: digest(identity.sessionId),
      receiptHash: digest(receiptToken),
      now: at,
      receiptExpiresAt: new Date(at.getTime() + PREPARED_RECEIPT_MS),
    });
    if (!operation) return json({ error: "account erasure already confirmed" }, 409);
    return json({
      operationId: operation.operationId,
      receiptToken,
      stage: operation.stage,
      expiresAt: operation.receiptExpiresAt,
    }, 201);
  } catch {
    return unavailable();
  }
}

export async function handleAccountErasureConfirm(
  request: Request,
  deps: AccountErasureDependencies,
): Promise<Response> {
  if (!deps.isEnabled()) return json({ error: "not found" }, 404);
  if (!deps.isConfigured() || !deps.isWorkerConfigured()) return unavailable();
  if (rejectsReceiptQuery(request)) return json({ error: "bad request" }, 400);
  const body = receiptInput(await boundedJson(request));
  if (!body) return json({ error: "bad request" }, 400);
  const identity = await destructiveIdentity(request, deps);
  if (identity instanceof Response) return identity;
  try {
    const operation = await deps.repository.confirm({
      operationId: body.operationId,
      ownerId: identity.userId,
      sessionHash: digest(identity.sessionId),
      receiptHash: digest(body.receiptToken),
      now: nowFor(deps),
    });
    return operation ? json(publicStatus(operation), 202) : json({ error: "not found" }, 404);
  } catch {
    return unavailable();
  }
}

export async function handleAccountErasureStatus(
  request: Request,
  deps: AccountErasureDependencies,
): Promise<Response> {
  if (!deps.isEnabled()) return json({ error: "not found" }, 404);
  if (!deps.isConfigured()) return unavailable();
  if (rejectsReceiptQuery(request)) return json({ error: "bad request" }, 400);
  const body = receiptInput(await boundedJson(request));
  if (!body) return json({ error: "bad request" }, 400);
  try {
    const identity = await deps.verifyIdentity(request);
    let ownerId: string | undefined;
    let sessionHash: string | undefined;
    if (identity) {
      const precondition = ownerPrecondition(request, identity.userId);
      if (precondition) return precondition;
      const windowMs = deps.authWindowMs ?? destructiveAuthWindowMs();
      if (!isRecentIdentity(identity, nowFor(deps), windowMs)) {
        return identity.sessionId.trim()
          ? json({ error: "recent one-time-password authentication required" }, 403)
          : unavailable();
      }
      ownerId = identity.userId;
      sessionHash = digest(identity.sessionId);
    }
    const operation = await deps.repository.status({
      operationId: body.operationId,
      receiptHash: digest(body.receiptToken),
      now: deps.now?.() ?? new Date(),
      ...(ownerId && sessionHash ? { ownerId, sessionHash } : {}),
    });
    return operation ? json(publicStatus(operation), 200) : json({ error: "not found" }, 404);
  } catch {
    return unavailable();
  }
}

class StageFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

async function removeWithRetry(
  deps: AccountErasureDependencies,
  bucket: typeof APPROVED_ERASURE_BUCKETS[number],
  ownerId: string,
  paths: string[],
): Promise<void> {
  let pending = paths;
  for (let attempt = 0; attempt < REMOVE_ATTEMPTS && pending.length; attempt++) {
    const result = await deps.storage.removeOwnerObjects(bucket, ownerId, pending);
    const attempted = new Set(pending);
    if (!Array.isArray(result.failed) || result.failed.some(path => !attempted.has(path))) {
      throw new StageFailure("storage_remove_invalid");
    }
    pending = [...new Set(result.failed)];
  }
  if (pending.length) throw new StageFailure("storage_remove_failed");
}

async function drainStorage(deps: AccountErasureDependencies, ownerId: string): Promise<void> {
  if (!await deps.storage.providerInventoryIsAuthoritative()) {
    throw new StageFailure("storage_inventory_unproven");
  }

  let ledgerDrained = false;
  for (let page = 0; page < STORAGE_MAX_PAGES_PER_ATTEMPT; page++) {
    const candidates = await deps.storage.listAdmittedCandidates(ownerId, STORAGE_PAGE_SIZE);
    if (!Array.isArray(candidates) || candidates.length > STORAGE_PAGE_SIZE) {
      throw new StageFailure("storage_ledger_invalid");
    }
    if (!candidates.length) {
      ledgerDrained = true;
      break;
    }
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate || !UUID.test(candidate.operationId)
          || !APPROVED_ERASURE_BUCKETS.includes(candidate.bucket)
          || !candidate.path.startsWith(`${ownerId}/`)
          || !candidate.path.slice(ownerId.length + 1)
          || candidate.path.slice(ownerId.length + 1).includes("/")
          || seen.has(candidate.operationId)) {
        throw new StageFailure("storage_ledger_invalid");
      }
      seen.add(candidate.operationId);
      await removeWithRetry(deps, candidate.bucket, ownerId, [candidate.path]);
      if (await deps.storage.ownerObjectExists(candidate.bucket, ownerId, candidate.path)) {
        throw new StageFailure("storage_exact_readback_present");
      }
      await deps.storage.markAdmittedCandidateDeleted(ownerId, candidate.operationId);
    }
  }
  if (!ledgerDrained || await deps.storage.hasAdmittedCandidates(ownerId)) {
    throw new StageFailure("storage_ledger_remaining");
  }

  for (const bucket of APPROVED_ERASURE_BUCKETS) {
    let drained = false;
    for (let page = 0; page < STORAGE_MAX_PAGES_PER_ATTEMPT; page++) {
      const paths = await deps.storage.listOwnerObjects(bucket, ownerId, STORAGE_PAGE_SIZE);
      if (!Array.isArray(paths) || paths.length > STORAGE_PAGE_SIZE
          || paths.some(path => typeof path !== "string" || !path.startsWith(`${ownerId}/`))) {
        throw new StageFailure("storage_list_invalid");
      }
      if (!paths.length) {
        drained = true;
        break;
      }
      await removeWithRetry(deps, bucket, ownerId, [...new Set(paths)]);
      for (const path of new Set(paths)) {
        if (await deps.storage.ownerObjectExists(bucket, ownerId, path)) {
          throw new StageFailure("storage_exact_readback_present");
        }
      }
    }
    if (!drained) throw new StageFailure("storage_page_limit");
  }
  if (!await deps.storage.providerInventoryIsAuthoritative()) {
    throw new StageFailure("storage_inventory_unproven");
  }
}

async function executeStage(operation: ClaimedAccountErasureOperation, deps: AccountErasureDependencies): Promise<void> {
  const ownerId = operation.ownerId;
  switch (operation.stage) {
    case "polar":
      await deps.polar.deleteOrAnonymizeByExternalId(ownerId);
      if (await deps.polar.readbackByExternalId(ownerId) !== "absent") throw new StageFailure("polar_readback_present");
      return;
    case "sessions":
      await deps.sessions.revokeAllForOwner(ownerId);
      if (await deps.sessions.hasActiveSessions(ownerId)) throw new StageFailure("sessions_readback_present");
      return;
    case "storage":
      await drainStorage(deps, ownerId);
      return;
    case "app_rows":
      await deps.appData.deleteOwnerRows(ownerId);
      if (await deps.appData.hasOwnerRows(ownerId)) throw new StageFailure("app_rows_readback_present");
      return;
    case "auth":
      // A capability can be redeemed or a webhook can land after the first
      // Polar sweep. Sweep/read back again immediately before Auth deletion;
      // SQL then verifies this lease was not atomically rewound by a webhook.
      await deps.polar.deleteOrAnonymizeByExternalId(ownerId);
      if (await deps.polar.readbackByExternalId(ownerId) !== "absent") throw new StageFailure("polar_final_readback_present");
      if (!await deps.repository.authorizeAuthDeletion({
        operationId: operation.operationId,
        ownerId,
        leaseId: operation.leaseId,
        version: operation.version,
      })) throw new StageFailure("auth_superseded");
      await deps.auth.hardDeleteUser(ownerId);
      if (await deps.auth.userExists(ownerId)) throw new StageFailure("auth_readback_present");
      return;
  }
}

function nextStage(stage: DestructiveStage): Exclude<ErasureStage, "prepared"> {
  const index = ERASURE_STAGES.indexOf(stage);
  return index === ERASURE_STAGES.length - 1 ? "complete" : ERASURE_STAGES[index + 1];
}

function errorCode(error: unknown, stage: DestructiveStage): string {
  if (error instanceof StageFailure) return error.code;
  return `${stage}_provider_unavailable`;
}

export type AccountErasureWorkerResult =
  | { status: "idle" }
  | { status: "advanced"; stage: DestructiveStage }
  | { status: "retry"; stage: DestructiveStage }
  | { status: "superseded"; stage: DestructiveStage };

export async function runAccountErasureWorker(
  deps: AccountErasureDependencies,
): Promise<AccountErasureWorkerResult> {
  if (!deps.isEnabled() || !deps.isConfigured() || !deps.isWorkerConfigured()) return { status: "idle" };
  const at = nowFor(deps);
  const leaseId = randomUUID();
  const operation = await deps.repository.claim({
    leaseId,
    now: at,
    leaseExpiresAt: new Date(at.getTime() + LEASE_MS),
  });
  if (!operation) return { status: "idle" };
  const stage = operation.stage;
  try {
    await executeStage(operation, deps);
    const completedAt = nowFor(deps);
    const following = nextStage(stage);
    const advanced = await deps.repository.advance({
      operationId: operation.operationId,
      ownerId: operation.ownerId,
      leaseId,
      version: operation.version,
      stage,
      nextStage: following,
      now: completedAt,
      ...(following === "complete" ? { completedReceiptExpiresAt: new Date(completedAt.getTime() + COMPLETED_RECEIPT_MS) } : {}),
    });
    return { status: advanced ? "advanced" : "superseded", stage };
  } catch (error) {
    const failedAt = nowFor(deps);
    const exponent = Math.min(operation.retryCount, 8);
    const retryAfter = new Date(failedAt.getTime() + Math.min(60 * 60 * 1000, 5_000 * (2 ** exponent)));
    const failed = await deps.repository.fail({
      operationId: operation.operationId,
      ownerId: operation.ownerId,
      leaseId,
      version: operation.version,
      stage,
      errorCode: errorCode(error, stage).slice(0, 64),
      retryAfter,
    });
    return { status: failed ? "retry" : "superseded", stage };
  }
}
