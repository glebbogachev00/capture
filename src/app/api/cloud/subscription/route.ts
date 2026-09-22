import {
  handleCloudSubscriptionStatus,
  isSubscriptionRequired,
  type CloudSubscriptionDependencies,
  type CloudSubscriptionRow,
} from "@/lib/cloudSubscription";
import { retryPolarSubscriptionsForUser } from "@/lib/polarServer";
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
      isAccountErasing: async () => { throw new Error("account lifecycle unavailable"); },
      getSubscriptions: async () => [],
    };
  }

  const client = await createCloudServerClient(config);
  return {
    isEnabled: () => isCloudEnabled(),
    isConfigured: () => true,
    requiresSubscription: () => isSubscriptionRequired(),
    verifyIdentity: async () => identityFromClaims(client),
    isAccountErasing: async ({ userId }) => {
      const { data, error } = await client.rpc("capture_account_deleting", { p_user_id: userId });
      if (error || typeof data !== "boolean") throw new Error("account lifecycle unavailable");
      return data;
    },
    getSubscriptions: async (userId) => {
      // Recovery after Polar's finite delivery retries, on authenticated demand.
      // A failed fetch leaves the durable pending row denied; other subscriptions
      // can still supply legitimate access. No polling job/new infrastructure.
      await retryPolarSubscriptionsForUser(userId).catch(() => undefined);
      const select = () => client
        .from("capture_cloud_subscriptions")
        .select("status, plan, is_entitled, reconciliation_required, current_period_end, access_expires_at, cancel_at_period_end, last_event_at")
        .eq("user_id", userId);
      // Filter before limiting: newer inactive subscriptions must not hide access.
      const current = await select()
        .eq("is_entitled", true)
        .gt("access_expires_at", new Date().toISOString())
        .order("last_event_at", { ascending: false })
        .limit(1);
      if (current.error) throw new Error("subscription status is unavailable");
      if (Array.isArray(current.data) && current.data.length) return current.data as CloudSubscriptionRow[];
      // A newer terminal row must not hide unresolved billing management.
      const pending = await select().eq("reconciliation_required", true).order("last_event_at", { ascending: false }).limit(1);
      if (pending.error) throw new Error("subscription status is unavailable");
      if (Array.isArray(pending.data) && pending.data.length) return pending.data as CloudSubscriptionRow[];
      const latest = await select().order("last_event_at", { ascending: false }).limit(1);
      if (latest.error) throw new Error("subscription status is unavailable");
      return (Array.isArray(latest.data) ? latest.data : []) as CloudSubscriptionRow[];
    },
  };
}

export async function GET(request: Request) {
  return handleCloudSubscriptionStatus(request, await dependencies());
}
