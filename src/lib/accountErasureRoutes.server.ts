import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { createPolar } from "@polar-sh/sdk/2026-04";
import { createClient } from "@supabase/supabase-js";
import type { AccountErasureDependencies } from "@/lib/accountErasure";
import {
  SupabaseAccountErasureRepository,
  createAppDataErasureAdapter,
  createAuthErasureAdapter,
  createDeadlineFetch,
  createPolarErasureAdapter,
  createSessionFenceAdapter,
  createStorageErasureAdapter,
  destructiveIdentityFromSupabase,
  type ErasureRpcClient,
} from "@/lib/accountErasure.server";
import { destructiveAuthWindowMs } from "@/lib/accountErasure";
import { getPolarConfig } from "@/lib/polar";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServerClient } from "@/lib/supabase/server";

type Env = Record<string, string | undefined>;

function serviceSecret(env: Env): string | null {
  const secret = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  return secret.startsWith("sb_secret_") ? secret : null;
}

export function accountErasureWorkerSecret(env: Env = process.env): string | null {
  const secret = env.CAPTURE_ACCOUNT_ERASURE_WORKER_SECRET?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

function unavailableMutationAdapters(): Pick<AccountErasureDependencies, "polar" | "sessions" | "storage" | "appData" | "auth"> {
  const fail = async (): Promise<never> => { throw new Error("Account erasure provider adapter unavailable"); };
  return {
    polar: {
      deleteOrAnonymizeByExternalId: fail,
      readbackByExternalId: fail,
    },
    sessions: {
      revokeAllForOwner: fail,
      hasActiveSessions: fail,
    },
    storage: {
      listOwnerObjects: fail,
      removeOwnerObjects: fail,
      providerInventoryIsAuthoritative: fail,
      listAdmittedCandidates: fail,
      ownerObjectExists: fail,
      markAdmittedCandidateDeleted: fail,
      hasAdmittedCandidates: fail,
    },
    appData: {
      deleteOwnerRows: fail,
      hasOwnerRows: fail,
    },
    auth: {
      hardDeleteUser: fail,
      userExists: fail,
    },
  };
}

export async function createAccountErasureRouteDependencies(
  env: Env = process.env,
): Promise<AccountErasureDependencies> {
  // Separate route exposure from Capture Cloud itself. The feature flag keeps
  // every endpoint undiscoverable by default; destructive confirmation and
  // provider mutation additionally require the hosted readiness attestations.
  const isEnabled = () => env.CAPTURE_CLOUD === "1"
    && env.CAPTURE_ACCOUNT_ERASURE_ENABLED === "1";
  const config = getCloudConfig(env);
  const polarConfig = getPolarConfig(env);
  const secret = serviceSecret(env);
  const hostedReady = env.CAPTURE_ACCOUNT_ERASURE_HOSTED_READY === "1";
  const inventoryAttested = env.CAPTURE_ERASURE_STORAGE_INVENTORY_ATTESTED === "1";
  const workerSecret = accountErasureWorkerSecret(env);
  const workerConfigured = !!polarConfig && hostedReady && inventoryAttested && !!workerSecret;
  if (!isEnabled() || config?.status !== "ready" || !secret) {
    return {
      isEnabled,
      isConfigured: () => false,
      isWorkerConfigured: () => false,
      verifyIdentity: async () => null,
      repository: {} as never,
      ...unavailableMutationAdapters(),
    };
  }

  const authenticated = await createCloudServerClient(config);
  const service = createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createDeadlineFetch(fetch, 10_000) },
  });
  let authWindowMs: number;
  try {
    authWindowMs = destructiveAuthWindowMs(env);
  } catch {
    return {
      isEnabled,
      isConfigured: () => false,
      isWorkerConfigured: () => false,
      verifyIdentity: async () => null,
      repository: {} as never,
      ...unavailableMutationAdapters(),
    };
  }
  const core = {
    isEnabled,
    isConfigured: () => true,
    isWorkerConfigured: () => workerConfigured,
    authWindowMs,
    verifyIdentity: async () => destructiveIdentityFromSupabase(authenticated),
    repository: new SupabaseAccountErasureRepository(service as unknown as ErasureRpcClient),
  };
  if (!workerConfigured || !polarConfig) {
    return { ...core, ...unavailableMutationAdapters() };
  }
  const polar = createPolar({
    accessToken: polarConfig.accessToken,
    environment: polarConfig.environment,
  });
  return {
    ...core,
    polar: createPolarErasureAdapter(polar),
    sessions: createSessionFenceAdapter(service as unknown as ErasureRpcClient),
    storage: createStorageErasureAdapter(service, { inventoryAttested }),
    appData: createAppDataErasureAdapter(service as unknown as ErasureRpcClient),
    auth: createAuthErasureAdapter(service),
  };
}

export type WorkerAuthorization = "authorized" | "unauthorized" | "unavailable";

export function authorizeAccountErasureWorker(request: Request, env: Env = process.env): WorkerAuthorization {
  const configured = accountErasureWorkerSecret(env);
  if (!configured) return "unavailable";
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedHash = createHash("sha256").update(configured).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash) ? "authorized" : "unauthorized";
}
