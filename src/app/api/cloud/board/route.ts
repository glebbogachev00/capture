import {
  handleCloudBoardGet,
  handleCloudBoardPut,
  isCloudEnabled,
  type CloudBoardDependencies,
} from "@/lib/cloudBoard";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServerClient } from "@/lib/supabase/server";
import { identityFromClaims } from "@/lib/supabase/identity";
import { CloudBoardRepository, type SupabaseQueryClient } from "@/lib/supabase/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function dependencies(): Promise<CloudBoardDependencies> {
  const config = getCloudConfig();
  if (!config || config.status !== "ready") {
    return {
      isEnabled: () => isCloudEnabled(),
      isConfigured: () => false,
      verifyIdentity: async () => null,
      repository: {} as never,
    };
  }
  const client = await createCloudServerClient(config);
  return {
    isEnabled: () => isCloudEnabled(),
    isConfigured: () => true,
    verifyIdentity: async () => identityFromClaims(client),
    repository: new CloudBoardRepository(client as unknown as SupabaseQueryClient),
  };
}

export async function GET(request: Request) {
  return handleCloudBoardGet(request, await dependencies());
}

export async function PUT(request: Request) {
  return handleCloudBoardPut(request, await dependencies());
}
