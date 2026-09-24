import {
  handleCloudBoardGet,
  handleCloudBoardPut,
  type CloudBoardDependencies,
} from "@/lib/cloudBoard";
import { createCloudGuardServerContext } from "@/lib/cloudRequestGuard.server";
import { CloudBoardRepository, type SupabaseQueryClient } from "@/lib/supabase/repository";
import { isCloudEnabled } from "@/lib/cloudMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function dependencies(): Promise<CloudBoardDependencies> {
  try {
    const { client, guard } = await createCloudGuardServerContext();
    return {
      isEnabled: guard.isCloudHost,
      isConfigured: guard.isConfigured,
      verifyIdentity: guard.verifyIdentity,
      requiresEntitlement: guard.requiresEntitlement,
      hasEntitlement: guard.hasEntitlement,
      ...(guard.isAccountErasing ? { isAccountErasing: guard.isAccountErasing } : {}),
      consumeQuota: guard.consumeQuota,
      repository: client
        ? new CloudBoardRepository(client as unknown as SupabaseQueryClient)
        : {} as never,
    };
  } catch {
    return {
      isEnabled: () => isCloudEnabled(),
      isConfigured: () => false,
      verifyIdentity: async () => null,
      repository: {} as never,
    };
  }
}

export async function GET(request: Request) {
  return handleCloudBoardGet(request, await dependencies());
}

export async function PUT(request: Request) {
  return handleCloudBoardPut(request, await dependencies());
}
