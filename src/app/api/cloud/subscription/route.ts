import {
  handleCloudSubscriptionStatus,
  isSubscriptionRequired,
  type CloudSubscriptionDependencies,
  type CloudSubscriptionRow,
} from "@/lib/cloudSubscription";
import { isCloudEnabled } from "@/lib/cloudBoard";
import { getCloudConfig } from "@/lib/supabase/config";
import { identityFromClaims } from "@/lib/supabase/identity";
import { createCloudServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function dependencies(): Promise<CloudSubscriptionDependencies> {
  const config = getCloudConfig();
  if (!config || config.status !== "ready") {
    return {
      isEnabled: () => isCloudEnabled(),
      isConfigured: () => false,
      requiresSubscription: () => isSubscriptionRequired(),
      verifyIdentity: async () => null,
      getSubscriptions: async () => [],
    };
  }

  const client = await createCloudServerClient(config);
  return {
    isEnabled: () => isCloudEnabled(),
    isConfigured: () => true,
    requiresSubscription: () => isSubscriptionRequired(),
    verifyIdentity: async () => identityFromClaims(client),
    getSubscriptions: async (userId) => {
      const { data, error } = await client
        .from("capture_cloud_subscriptions")
        .select("status, plan, is_entitled, current_period_end, access_expires_at, cancel_at_period_end, last_event_at")
        .eq("user_id", userId)
        .order("last_event_at", { ascending: false })
        .limit(20);
      if (error) throw new Error("subscription status is unavailable");
      return (Array.isArray(data) ? data : []) as CloudSubscriptionRow[];
    },
  };
}

export async function GET(request: Request) {
  return handleCloudSubscriptionStatus(request, await dependencies());
}
