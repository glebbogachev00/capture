import "server-only";

import { randomUUID } from "node:crypto";

import {
  abortableCloudDependency,
  authorizeCloudRequest,
  cloudAuthorizationUnavailable,
  consumeQuotaWithRpc,
  type CloudAuthorization as GuardResult,
  type CloudRequestGuardDependencies,
} from "@/lib/cloudRequestGuard";
import { isSubscriptionRequired } from "@/lib/cloudSubscription";
import { opsEvent } from "@/lib/opsEvent.server";
import { getCloudConfig } from "@/lib/supabase/config";
import { identityFromClaims } from "@/lib/supabase/identity";
import { createCloudServerClient } from "@/lib/supabase/server";
import { hasCurrentCloudAccess } from "@/lib/cloudAccess.server";
import { isCloudEnabled } from "@/lib/cloudMode";

export type CloudServerClient = Awaited<ReturnType<typeof createCloudServerClient>>;

export type CloudGuardServerContext = {
  client: CloudServerClient | null;
  guard: CloudRequestGuardDependencies;
};

export const MANAGED_AI_RELEASE_DEADLINE_MS = 1_000;

async function rpcWithSignal(
  client: CloudServerClient,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: unknown; error: unknown }> {
  const request = client.rpc(name, args) as unknown as PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal?: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  const operation = signal && typeof request.abortSignal === "function" ? request.abortSignal(signal) : request;
  return abortableCloudDependency(() => operation, signal);
}

async function releaseManagedAiAdmission(
  release: (signal?: AbortSignal) => Promise<void>,
  deadlineMs = MANAGED_AI_RELEASE_DEADLINE_MS,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const releasePromise = Promise.resolve().then(() => release(controller.signal));
  // Consume a dependency rejection even when it arrives after the deadline won
  // the race; it must never become an unhandled rejection or replace the route.
  void releasePromise.catch(() => undefined);
  const failed = await Promise.race([
    releasePromise.then(() => false, () => true),
    new Promise<true>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(true);
      }, deadlineMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return failed;
}

function recordManagedAiReleaseFailure(): void {
  try {
    opsEvent({
      event: "managed_ai_route",
      outcome: "failure",
      reason: "dependency_unavailable",
    });
  } catch {}
}

/** Build once per request so identity, entitlement, quota, and board storage
    all use the same cookie-bound Supabase client. */
export async function createCloudGuardServerContext(signal?: AbortSignal): Promise<CloudGuardServerContext> {
  const config = getCloudConfig();
  if (!config || config.status !== "ready") {
    return {
      client: null,
      guard: {
        isCloudHost: () => isCloudEnabled(),
        isConfigured: () => false,
        requiresEntitlement: () => isSubscriptionRequired(),
        verifyIdentity: async () => null,
        hasEntitlement: async () => false,
        isAccountErasing: async () => { throw new Error("Cloud account lifecycle unavailable"); },
        consumeQuota: async () => { throw new Error("Cloud quota unavailable"); },
        acquireExternalWork: async () => { throw new Error("Cloud external-work admission unavailable"); },
        releaseExternalWork: async () => { throw new Error("Cloud external-work admission unavailable"); },
      },
    };
  }

  const client = await abortableCloudDependency(() => createCloudServerClient(config), signal);
  return {
    client,
    guard: {
      isCloudHost: () => isCloudEnabled(),
      isConfigured: () => true,
      requiresEntitlement: () => isSubscriptionRequired(),
      verifyIdentity: async (_request, dependencySignal) => dependencySignal
        ? identityFromClaims(client, dependencySignal)
        : identityFromClaims(client),
      isAccountErasing: async ({ userId }, dependencySignal) => {
        const { data, error } = await rpcWithSignal(
          client, "capture_account_deleting", { p_user_id: userId }, dependencySignal,
        );
        if (error || typeof data !== "boolean") throw new Error("Cloud account lifecycle unavailable");
        return data;
      },
      hasEntitlement: async ({ userId }, dependencySignal) => {
        return dependencySignal
          ? hasCurrentCloudAccess(client, userId, dependencySignal)
          : hasCurrentCloudAccess(client, userId);
      },
      consumeQuota: (ownerId, policy, dependencySignal) =>
        dependencySignal
          ? consumeQuotaWithRpc(client, ownerId, policy, dependencySignal)
          : consumeQuotaWithRpc(client, ownerId, policy),
      acquireExternalWork: async (ownerId, kind, dependencySignal) => {
        const admissionId = randomUUID();
        const now = new Date();
        const { data, error } = await rpcWithSignal(client, "acquire_capture_external_work", {
          p_admission_id: admissionId,
          p_owner_id: ownerId,
          p_kind: kind,
          p_now: now.toISOString(),
          p_lease_expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
          p_capability_id: null,
          p_capability_expires_at: null,
        }, dependencySignal);
        if (error || data !== true) return null;
        return { admissionId };
      },
      releaseExternalWork: async (ownerId, admissionId, dependencySignal) => {
        const { data, error } = await rpcWithSignal(client, "release_capture_external_work", {
          p_owner_id: ownerId,
          p_admission_id: admissionId,
        }, dependencySignal);
        if (error || data !== true) throw new Error("Cloud external-work release unavailable");
      },
    },
  };
}

export async function authorizeManagedAiRequest(
  request: Request,
  options: { signal?: AbortSignal } = {},
): Promise<GuardResult | Response> {
  // Avoid initializing Cloud adapters on self-hosted/playground deployments.
  if (!isCloudEnabled()) return { mode: "non-cloud" };
  try {
    const { guard } = await abortableCloudDependency(
      () => createCloudGuardServerContext(options.signal),
      options.signal,
    );
    return authorizeCloudRequest(request, "managed_ai", guard, options);
  } catch {
    return cloudAuthorizationUnavailable();
  }
}

export async function withManagedAiAdmission<T>(
  authorization: GuardResult,
  work: () => Promise<T>,
  options: { deadlineAt?: number } = {},
): Promise<T> {
  if (authorization.mode === "non-cloud") return work();
  if (!authorization.admissionId || !authorization.releaseExternalWork) {
    throw new Error("Cloud external-work admission unavailable");
  }
  try {
    return await work();
  } finally {
    // The durable lease expires without an acknowledgement. Bound cleanup so
    // a stuck RPC cannot suppress an already-computed route result/error.
    const remaining = options.deadlineAt === undefined
      ? MANAGED_AI_RELEASE_DEADLINE_MS
      : Math.min(MANAGED_AI_RELEASE_DEADLINE_MS, Math.max(0, options.deadlineAt - Date.now()));
    if (remaining === 0) {
      void releaseManagedAiAdmission(authorization.releaseExternalWork);
    } else if (await releaseManagedAiAdmission(authorization.releaseExternalWork, remaining)) {
      recordManagedAiReleaseFailure();
    }
  }
}

type DeferredScheduler = (callback: () => void | Promise<void>) => void;
type DeferredLease = { release: (signal?: AbortSignal) => Promise<void> };
export const MANAGED_AI_DEFERRED_ADMISSION_DEADLINE_MS = 1_000;

async function acquireDeferredLease(
  authorization: GuardResult,
  releaseLate: (lease: DeferredLease) => void,
): Promise<DeferredLease | null> {
  if (authorization.mode === "non-cloud") return { release: async () => {} };
  const acquire = authorization.acquireDeferredManagedAiAdmission;
  if (!acquire) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const pending = Promise.resolve().then(() => acquire(controller.signal));
  void pending.catch(() => undefined);
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve(null);
          controller.abort(new DOMException("Deferred admission deadline exceeded", "TimeoutError"));
        }, MANAGED_AI_DEFERRED_ADMISSION_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) {
      void pending.then((lease) => {
        if (lease) releaseLate(lease);
      }, () => undefined);
    }
  }
}

/**
 * Register the task synchronously and acquire its durable admission inside the
 * post-response callback. A stuck admission or provider can never delay the
 * authoritative route response; late admissions are released without work.
 */
export async function scheduleManagedAiDeferredWork(input: {
  authorization: GuardResult;
  enabled: boolean;
  schedule: DeferredScheduler;
  work: () => void | Promise<void>;
  onError: (error: unknown) => void;
}): Promise<boolean> {
  if (!input.enabled) return false;

  let handedOff = false;
  const report = (error: unknown) => { try { input.onError(error); } catch {} };
  const release = async (lease: DeferredLease) => {
    if (await releaseManagedAiAdmission(lease.release)) {
      report(new Error("Cloud deferred admission release unavailable"));
    }
  };
  const task = async () => {
    await Promise.resolve();
    if (!handedOff) return;
    const lease = await acquireDeferredLease(input.authorization, (late) => { void release(late); });
    if (!lease) {
      report(new Error("Cloud deferred admission unavailable"));
      return;
    }
    try {
      await input.work();
    } catch (error) {
      report(error);
    } finally {
      await release(lease);
    }
  };

  try {
    input.schedule(task);
    handedOff = true;
    return true;
  } catch (error) {
    report(error);
    return false;
  }
}
