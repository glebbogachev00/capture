import "server-only";

import { randomUUID } from "node:crypto";

import {
  authorizeCloudRequest,
  cloudAuthorizationUnavailable,
  consumeQuotaWithRpc,
  type CloudAuthorization,
  type CloudRequestGuardDependencies,
} from "@/lib/cloudRequestGuard";
import { isSubscriptionRequired } from "@/lib/cloudSubscription";
import { opsEvent } from "@/lib/opsEvent.server";
import { getCloudConfig } from "@/lib/supabase/config";
import { identityFromClaims } from "@/lib/supabase/identity";
import { createCloudServerClient } from "@/lib/supabase/server";
import { hasCurrentCloudAccess } from "@/lib/cloudAccess.server";
import { withOwnAi, type OwnAi, type OwnTier } from "@/lib/ownTier.server";
import { cloudKeysAvailable, loadAiSettings, tiersFor } from "@/lib/aiSettings.server";
import { PUBLIC_SITE } from "@/lib/publicSite";

export type CloudServerClient = Awaited<ReturnType<typeof createCloudServerClient>>;

export type CloudGuardServerContext = {
  client: CloudServerClient | null;
  guard: CloudRequestGuardDependencies;
};

export const MANAGED_AI_RELEASE_DEADLINE_MS = 1_000;

async function releaseManagedAiAdmission(
  release: (signal?: AbortSignal) => Promise<void>,
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
      }, MANAGED_AI_RELEASE_DEADLINE_MS);
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
export async function createCloudGuardServerContext(): Promise<CloudGuardServerContext> {
  const config = getCloudConfig();
  if (!config || config.status !== "ready") {
    return {
      client: null,
      guard: {
        isCloudHost: () => process.env.CAPTURE_CLOUD === "1",
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

  const client = await createCloudServerClient(config);
  return {
    client,
    guard: {
      isCloudHost: () => process.env.CAPTURE_CLOUD === "1",
      isConfigured: () => true,
      requiresEntitlement: () => isSubscriptionRequired(),
      verifyIdentity: async () => identityFromClaims(client),
      isAccountErasing: async ({ userId }) => {
        const { data, error } = await client.rpc("capture_account_deleting", { p_user_id: userId });
        if (error || typeof data !== "boolean") throw new Error("Cloud account lifecycle unavailable");
        return data;
      },
      hasEntitlement: async ({ userId }) => {
        return hasCurrentCloudAccess(client, userId);
      },
      consumeQuota: (ownerId, policy) => consumeQuotaWithRpc(client, ownerId, policy),
      acquireExternalWork: async (ownerId, kind) => {
        const admissionId = randomUUID();
        const now = new Date();
        const { data, error } = await client.rpc("acquire_capture_external_work", {
          p_admission_id: admissionId,
          p_owner_id: ownerId,
          p_kind: kind,
          p_now: now.toISOString(),
          p_lease_expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
          p_capability_id: null,
          p_capability_expires_at: null,
        });
        if (error || data !== true) return null;
        return { admissionId };
      },
      releaseExternalWork: async (ownerId, admissionId) => {
        const { data, error } = await client.rpc("release_capture_external_work", {
          p_owner_id: ownerId,
          p_admission_id: admissionId,
        });
        if (error || data !== true) throw new Error("Cloud external-work release unavailable");
      },
    },
  };
}

/** The AI a person connected that this route can use, or null. */
async function ownAiFor(ownerId: string | null, accepts: (tier: OwnTier) => boolean, fallback: boolean): Promise<OwnAi | null> {
  const tiers = tiersFor(await loadAiSettings(ownerId)).filter(accepts);
  return tiers.length ? { tiers, fallback } : null;
}

export async function authorizeManagedAiRequest(
  request: Request,
  /** Which connected AI this route can use; voice needs a Groq key. */
  accepts: (tier: OwnTier) => boolean = () => true,
): Promise<CloudAuthorization | Response> {
  // Avoid initializing Cloud adapters on self-hosted/playground deployments.
  if (process.env.CAPTURE_CLOUD !== "1") {
    /* A self-hosted Capture uses the AI its owner connected, with its own
       providers behind them. The public trial never has any. */
    if (PUBLIC_SITE) return { mode: "non-cloud" };
    const ownAi = await ownAiFor(null, accepts, true).catch(() => null);
    return ownAi ? { mode: "non-cloud", ownAi } : { mode: "non-cloud" };
  }
  try {
    const { guard } = await createCloudGuardServerContext();
    return authorizeCloudRequest(request, "managed_ai", guard, (owner) => ownAiFor(owner, accepts, false));
  } catch {
    return cloudAuthorizationUnavailable();
  }
}

export async function withManagedAiAdmission<T>(
  authorization: CloudAuthorization,
  work: () => Promise<T>,
): Promise<T> {
  if (authorization.ownAi) return withOwnAi(authorization.ownAi, work);
  if (authorization.mode === "non-cloud") return work();
  if (!authorization.admissionId || !authorization.releaseExternalWork) {
    throw new Error("Cloud external-work admission unavailable");
  }
  try {
    return await work();
  } finally {
    // The durable lease expires without an acknowledgement. Bound cleanup so
    // a stuck RPC cannot suppress an already-computed route result/error.
    if (await releaseManagedAiAdmission(authorization.releaseExternalWork)) {
      recordManagedAiReleaseFailure();
    }
  }
}

type DeferredScheduler = (callback: () => void | Promise<void>) => void;

/**
 * Transfer managed-AI ownership from a request admission to durable deferred
 * work. The secondary lease is acquired while the request's primary lease is
 * still held, then released once by the scheduled task (or here if handoff
 * fails). Disabled shadows do not acquire a lease or schedule any work.
 */
export async function scheduleManagedAiDeferredWork(input: {
  authorization: CloudAuthorization;
  enabled: boolean;
  schedule: DeferredScheduler;
  work: () => void | Promise<void>;
  onError: (error: unknown) => void;
}): Promise<boolean> {
  if (!input.enabled) return false;

  let lease: { release: () => Promise<void> };
  try {
    if (input.authorization.mode === "non-cloud" || input.authorization.ownAi) {
      lease = { release: async () => {} };
    } else {
      const acquire = input.authorization.acquireDeferredManagedAiAdmission;
      if (!acquire) throw new Error("Cloud deferred admission unavailable");
      const acquired = await acquire();
      if (!acquired) throw new Error("Cloud deferred admission unavailable");
      lease = acquired;
    }
  } catch (error) {
    try { input.onError(error); } catch {}
    return false;
  }

  let releaseStarted = false;
  const releaseOnce = async () => {
    if (releaseStarted) return;
    releaseStarted = true;
    try {
      if (await releaseManagedAiAdmission(lease.release)) {
        try { input.onError(new Error("Cloud deferred admission release unavailable")); } catch {}
      }
    } catch (error) {
      try { input.onError(error); } catch {}
    }
  };
  let handedOff = false;
  const task = async () => {
    // A scheduler may invoke the callback before returning. Defer one turn so
    // work starts only after registration has completed without throwing.
    await Promise.resolve();
    if (!handedOff) return;
    try {
      /* Work that finishes after the response still uses the member's own
         key; it never falls back to managed AI. */
      const own = input.authorization.ownAi;
      await (own ? withOwnAi(own, input.work) : input.work());
    } catch (error) {
      try { input.onError(error); } catch {}
    } finally {
      await releaseOnce();
    }
  };

  try {
    input.schedule(task);
    handedOff = true;
    return true;
  } catch (error) {
    await releaseOnce();
    try { input.onError(error); } catch {}
    return false;
  }
}

/** Who a request to change connected AI is for: the Cloud member, or the
 * self-hosted owner (null). The public trial has no connected AI. */
export async function authorizeAiSettingsRequest(request: Request): Promise<{ ownerId: string | null } | Response> {
  if (process.env.CAPTURE_CLOUD !== "1") {
    return PUBLIC_SITE ? Response.json({ error: "not available" }, { status: 404 }) : { ownerId: null };
  }
  try {
    const { guard } = await createCloudGuardServerContext();
    const authorization = await authorizeCloudRequest(request, "board_write", guard);
    if (authorization instanceof Response) return authorization;
    if (authorization.mode !== "cloud") return cloudAuthorizationUnavailable();
    if (!cloudKeysAvailable()) return Response.json({ error: "ai settings not configured" }, { status: 503 });
    return { ownerId: authorization.ownerId };
  } catch {
    return cloudAuthorizationUnavailable();
  }
}
