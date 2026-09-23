import "server-only";

import { ownerPrecondition } from "@/lib/ownerPrecondition";

export type CloudQuotaScope = "managed_ai" | "board_read" | "board_write" | "backup_read";
export type CloudQuotaPolicy = {
  scope: CloudQuotaScope;
};
export type CloudQuotaResult = { allowed: boolean; retryAfterSec: number };
export type DeferredManagedAiAdmission = { release: (signal?: AbortSignal) => Promise<void> };
export type CloudAuthorization =
  | { mode: "non-cloud" }
  | {
      mode: "cloud";
      ownerId: string;
      admissionId?: string;
      releaseExternalWork?: (signal?: AbortSignal) => Promise<void>;
      acquireDeferredManagedAiAdmission?: (signal?: AbortSignal) => Promise<DeferredManagedAiAdmission | null>;
    };


export interface CloudRequestGuardDependencies {
  isCloudHost: () => boolean;
  isConfigured: () => boolean;
  requiresEntitlement: () => boolean;
  verifyIdentity: (request: Request, signal?: AbortSignal) => Promise<{ userId: string } | null>;
  hasEntitlement: (identity: { userId: string }, signal?: AbortSignal) => Promise<boolean>;
  isAccountErasing: (identity: { userId: string }, signal?: AbortSignal) => Promise<boolean>;
  consumeQuota: (ownerId: string, policy: CloudQuotaPolicy, signal?: AbortSignal) => Promise<CloudQuotaResult>;
  acquireExternalWork?: (
    ownerId: string,
    kind: "managed_ai",
    signal?: AbortSignal,
  ) => Promise<{ admissionId: string } | null>;
  releaseExternalWork?: (ownerId: string, admissionId: string, signal?: AbortSignal) => Promise<void>;
}

export type CloudRequestGuardOptions = { signal?: AbortSignal };
export const CLOUD_LATE_ADMISSION_RELEASE_MS = 1_000;

/** Settle at the caller's boundary even when a dependency ignores abort. */
export function abortableCloudDependency<T>(
  run: () => PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return Promise.resolve().then(run);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }).then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

async function releaseLateAdmission(
  release: (signal?: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_LATE_ADMISSION_RELEASE_MS);
  try {
    await abortableCloudDependency(() => release(controller.signal), controller.signal);
  } catch {
    // Its durable lease expires. Late cleanup is best effort and content-free.
  } finally {
    clearTimeout(timer);
  }
}

export function cloudQuotaPolicy(
  scope: CloudQuotaScope,
): CloudQuotaPolicy {
  return { scope };
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  return Response.json(body, { status, headers: responseHeaders });
}

export function cloudAuthorizationUnavailable(): Response {
  return json({ error: "cloud authorization unavailable" }, 503);
}

/**
 * Shared fail-closed boundary for public Cloud AI and board requests.
 * Non-Cloud installs (including the separately deployed playground) preserve
 * their existing anonymous/local behavior. Public Cloud always requires the
 * verified cookie identity, exact owner precondition, current access, and a
 * durable owner quota before callers may inspect a body or touch a provider.
 */
export async function authorizeCloudRequest(
  request: Request,
  scope: CloudQuotaScope,
  deps: CloudRequestGuardDependencies,
  options: CloudRequestGuardOptions = {},
): Promise<CloudAuthorization | Response> {
  if (!deps.isCloudHost()) return { mode: "non-cloud" };
  if (!deps.isConfigured()) return cloudAuthorizationUnavailable();

  try {
    const signal = options.signal;
    const identity = await abortableCloudDependency(
      () => signal ? deps.verifyIdentity(request, signal) : deps.verifyIdentity(request), signal,
    );
    if (!identity?.userId.trim()) return json({ error: "unauthorized" }, 401);

    const precondition = ownerPrecondition(request, identity.userId);
    if (precondition) return precondition;

    if (await abortableCloudDependency(
      () => signal ? deps.isAccountErasing(identity, signal) : deps.isAccountErasing(identity), signal,
    )) {
      return json({ error: "account unavailable" }, 403);
    }

    // A complete explicit owner backup is an account-recovery read, not paid
    // product access. It still requires exact identity, lifecycle availability,
    // and its own durable quota; writes and managed AI retain billing checks.
    if (scope !== "backup_read" && deps.requiresEntitlement() &&
        !await abortableCloudDependency(
          () => signal ? deps.hasEntitlement(identity, signal) : deps.hasEntitlement(identity), signal,
        )) {
      return json({ error: "capture cloud access required" }, 402);
    }

    const quota = await abortableCloudDependency(
      () => signal
        ? deps.consumeQuota(identity.userId, cloudQuotaPolicy(scope), signal)
        : deps.consumeQuota(identity.userId, cloudQuotaPolicy(scope)),
      signal,
    );
    if (!quota.allowed) {
      const retryAfterSec = Number.isSafeInteger(quota.retryAfterSec) && quota.retryAfterSec > 0
        ? quota.retryAfterSec
        : 1;
      return json({ error: "quota exceeded" }, 429, { "Retry-After": String(retryAfterSec) });
    }
    if (scope === "managed_ai") {
      if (!deps.acquireExternalWork || !deps.releaseExternalWork) return cloudAuthorizationUnavailable();
      const pendingAdmission = Promise.resolve().then(() => signal
        ? deps.acquireExternalWork!(identity.userId, "managed_ai", signal)
        : deps.acquireExternalWork!(identity.userId, "managed_ai"));
      void pendingAdmission.catch(() => undefined);
      let admission: { admissionId: string } | null;
      try {
        admission = await abortableCloudDependency(() => pendingAdmission, signal);
      } catch (error) {
        if (signal?.aborted) {
          void pendingAdmission.then((late) => {
            if (late?.admissionId) {
              void releaseLateAdmission((cleanupSignal) =>
                deps.releaseExternalWork!(identity.userId, late.admissionId, cleanupSignal));
            }
          }, () => undefined);
        }
        throw error;
      }
      if (!admission?.admissionId) return cloudAuthorizationUnavailable();
      return {
        mode: "cloud",
        ownerId: identity.userId,
        admissionId: admission.admissionId,
        releaseExternalWork: (releaseSignal) => releaseSignal
          ? deps.releaseExternalWork!(identity.userId, admission.admissionId, releaseSignal)
          : deps.releaseExternalWork!(identity.userId, admission.admissionId),
        acquireDeferredManagedAiAdmission: async (deferredSignal) => {
          const deferred = await abortableCloudDependency(
            () => deferredSignal
              ? deps.acquireExternalWork!(identity.userId, "managed_ai", deferredSignal)
              : deps.acquireExternalWork!(identity.userId, "managed_ai"),
            deferredSignal,
          );
          if (!deferred?.admissionId) return null;
          return {
            release: (releaseSignal) => releaseSignal
              ? deps.releaseExternalWork!(identity.userId, deferred.admissionId, releaseSignal)
              : deps.releaseExternalWork!(identity.userId, deferred.admissionId),
          };
        },
      };
    }
    return { mode: "cloud", ownerId: identity.userId };
  } catch {
    return cloudAuthorizationUnavailable();
  }
}

export type CloudQuotaRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function consumeQuotaWithRpc(
  client: CloudQuotaRpcClient,
  ownerId: string,
  policy: CloudQuotaPolicy,
  signal?: AbortSignal,
): Promise<CloudQuotaResult> {
  if (!ownerId.trim()) throw new Error("Cloud quota operation failed");
  const request = client.rpc("consume_capture_cloud_quota", { p_scope: policy.scope }) as
    PromiseLike<{ data: unknown; error: unknown }> & { abortSignal?: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
  const operation = signal && typeof request.abortSignal === "function" ? request.abortSignal(signal) : request;
  const { data, error } = await abortableCloudDependency(() => operation, signal);
  const result = data as { allowed?: unknown; retryAfterSec?: unknown } | null;
  if (error || typeof result?.allowed !== "boolean" || !Number.isSafeInteger(result.retryAfterSec)
      || (result.retryAfterSec as number) < 0) {
    throw new Error("Cloud quota operation failed");
  }
  return { allowed: result.allowed, retryAfterSec: result.retryAfterSec as number };
}
