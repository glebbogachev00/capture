import { createClient } from "@supabase/supabase-js";
import { createPolar, webhooks } from "@polar-sh/sdk/2026-04";
import { createCloudServerClient } from "@/lib/supabase/server";
import { getCloudConfig } from "@/lib/supabase/config";
import {
  getPolarConfig,
  type AppliedSubscription,
  type CheckoutInput,
  type PolarDependencies,
  type PortalInput,
} from "@/lib/polar";

type Env = Record<string, string | undefined>;

function secretKey(env: Env = process.env): string | null {
  const value = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  return value.startsWith("sb_secret_") ? value : null;
}

export async function createPolarDependencies(env: Env = process.env): Promise<PolarDependencies> {
  const config = getPolarConfig(env);
  const cloud = getCloudConfig(env);
  const secret = secretKey(env);
  const isCloudEnabled = () => env.CAPTURE_CLOUD === "1";

  const identity = async () => {
    if (!cloud || cloud.status !== "ready") return null;
    try {
      const client = await createCloudServerClient(cloud);
      const { data, error } = await client.auth.getUser();
      const user = data.user;
      return !error && user?.id && user.email ? { userId: user.id, email: user.email } : null;
    } catch {
      return null;
    }
  };

  if (!config || !cloud || cloud.status !== "ready" || !secret) {
    return {
      config: null,
      isCloudEnabled,
      identity,
      hasActiveSubscription: async () => { throw new Error("billing is not configured"); },
      createCheckout: async () => { throw new Error("billing is not configured"); },
      createCustomerSession: async () => { throw new Error("billing is not configured"); },
      validateWebhook: async () => { throw new Error("billing is not configured"); },
      applySubscriptionEvent: async () => { throw new Error("billing is not configured"); },
    };
  }

  const polar = createPolar({ accessToken: config.accessToken, environment: config.environment });
  const admin = createClient(cloud.url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    config,
    isCloudEnabled,
    identity,
    hasActiveSubscription: async (userId) => {
      const { data, error } = await admin
        .from("capture_cloud_subscriptions")
        .select("polar_subscription_id")
        .eq("user_id", userId)
        .eq("is_entitled", true)
        .gt("access_expires_at", new Date().toISOString())
        .limit(1);
      if (error) throw new Error("subscription status could not be read");
      return Array.isArray(data) && data.length > 0;
    },
    createCheckout: async (input: CheckoutInput) => {
      const result = await polar.checkouts.create({
        products: input.products,
        external_customer_id: input.externalCustomerId,
        customer_email: input.customerEmail,
        customer_ip_address: input.customerIpAddress,
        success_url: input.successUrl,
        return_url: input.returnUrl,
        allow_discount_codes: input.allowDiscountCodes,
        allow_trial: input.allowTrial,
        metadata: input.metadata,
      });
      return { url: result.url };
    },
    createCustomerSession: async (input: PortalInput) => {
      const result = await polar.customerSessions.create({
        external_customer_id: input.externalCustomerId,
        return_url: input.returnUrl,
      });
      return { customerPortalUrl: result.customer_portal_url };
    },
    validateWebhook: (body, headers, webhookSecret) => webhooks.validateEvent(body, headers, webhookSecret),
    applySubscriptionEvent: async (event: AppliedSubscription) => {
      const { data, error } = await admin.rpc("apply_polar_subscription_event", {
        p_event_id: event.eventId,
        p_event_type: event.eventType,
        p_event_created_at: event.eventCreatedAt,
        p_user_id: event.userId,
        p_status: event.status,
        p_plan: event.plan,
        p_is_entitled: event.isEntitled,
        p_polar_customer_id: event.polarCustomerId,
        p_polar_subscription_id: event.polarSubscriptionId,
        p_polar_product_id: event.polarProductId,
        p_current_period_start: event.currentPeriodStart,
        p_current_period_end: event.currentPeriodEnd,
        p_access_expires_at: event.accessExpiresAt,
        p_cancel_at_period_end: event.cancelAtPeriodEnd,
      });
      if (error) throw new Error("subscription state could not be stored");
      return data === true;
    },
  };
}
