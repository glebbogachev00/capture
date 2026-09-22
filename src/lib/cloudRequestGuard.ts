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
      acquireDeferredManagedAiAdmission?: () => Promise<DeferredManagedAiAdmission | null>;
    };


export interface CloudRequestGuardDependencies {
  isCloudHost: () => boolean;
  isConfigured: () => boolean;
  requiresEntitlement: () => boolean;
  verifyIdentity: (request: Request) => Promise<{ userId: string } | null>;
  hasEntitlement: (identity: { userId: string }) => Promise<boolean>;
  isAccountErasing: (identity: { userId: string }) => Promise<boolean>;
  consumeQuota: (ownerId: string, policy: CloudQuotaPolicy) => Promise<CloudQuotaResult>;
  acquireExternalWork?: (
    ownerId: string,
    kind: "managed_ai",
  ) => Promise<{ admissionId: string } | null>;
  releaseExternalWork?: (ownerId: string, admissionId: string) => Promise<void>;
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
): Promise<CloudAuthorization | Response> {
  if (!deps.isCloudHost()) return { mode: "non-cloud" };
  if (!deps.isConfigured()) return cloudAuthorizationUnavailable();

  try {
    const identity = await deps.verifyIdentity(request);
    if (!identity?.userId.trim()) return json({ error: "unauthorized" }, 401);

    const precondition = ownerPrecondition(request, identity.userId);
    if (precondition) return precondition;

    if (await deps.isAccountErasing(identity)) {
      return json({ error: "account unavailable" }, 403);
    }

    // A complete explicit owner backup is an account-recovery read, not paid
    // product access. It still requires exact identity, lifecycle availability,
    // and its own durable quota; writes and managed AI retain billing checks.
    if (scope !== "backup_read" && deps.requiresEntitlement() && !await deps.hasEntitlement(identity)) {
      return json({ error: "capture cloud access required" }, 402);
    }

    const quota = await deps.consumeQuota(identity.userId, cloudQuotaPolicy(scope));
    if (!quota.allowed) {
      const retryAfterSec = Number.isSafeInteger(quota.retryAfterSec) && quota.retryAfterSec > 0
        ? quota.retryAfterSec
        : 1;
      return json({ error: "quota exceeded" }, 429, { "Retry-After": String(retryAfterSec) });
    }
    if (scope === "managed_ai") {
      if (!deps.acquireExternalWork || !deps.releaseExternalWork) return cloudAuthorizationUnavailable();
      const admission = await deps.acquireExternalWork(identity.userId, "managed_ai");
      if (!admission?.admissionId) return cloudAuthorizationUnavailable();
      return {
        mode: "cloud",
        ownerId: identity.userId,
        admissionId: admission.admissionId,
        releaseExternalWork: () => deps.releaseExternalWork!(identity.userId, admission.admissionId),
        acquireDeferredManagedAiAdmission: async () => {
          const deferred = await deps.acquireExternalWork!(identity.userId, "managed_ai");
          if (!deferred?.admissionId) return null;
          return {
            release: () => deps.releaseExternalWork!(identity.userId, deferred.admissionId),
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
): Promise<CloudQuotaResult> {
  if (!ownerId.trim()) throw new Error("Cloud quota operation failed");
  const { data, error } = await client.rpc("consume_capture_cloud_quota", {
    p_scope: policy.scope,
  });
  const result = data as { allowed?: unknown; retryAfterSec?: unknown } | null;
  if (error || typeof result?.allowed !== "boolean" || !Number.isSafeInteger(result.retryAfterSec)
      || (result.retryAfterSec as number) < 0) {
    throw new Error("Cloud quota operation failed");
  }
  return { allowed: result.allowed, retryAfterSec: result.retryAfterSec as number };
}
