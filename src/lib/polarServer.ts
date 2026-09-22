import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createPolar, webhooks } from "@polar-sh/sdk/2026-04";
import { createCloudServerClient } from "@/lib/supabase/server";
import { getCloudConfig } from "@/lib/supabase/config";
import {
  getPolarConfig,
  normalizeSubscription,
  type AppliedSubscription,
  type CheckoutInput,
  type PolarDependencies,
  type PortalInput,
} from "@/lib/polar";
import { hasCurrentCloudAccess } from "@/lib/cloudAccess.server";

type Env = Record<string, string | undefined>;

function secretKey(env: Env = process.env): string | null {
  const value = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  return value.startsWith("sb_secret_") ? value : null;
}

export async function retryPolarSubscriptionsForUser(userId: string, env: Env = process.env): Promise<void> {
  await (await createPolarDependencies(env)).retryPending(userId);
}

export async function createPolarDependencies(env: Env = process.env): Promise<PolarDependencies & { retryPending: (userId: string) => Promise<void> }> {
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
      retryPending: async () => { throw new Error("billing is not configured"); },
      isCloudEnabled,
      identity,
      isAccountErasing: async () => { throw new Error("billing is not configured"); },
      hasCloudAccess: async () => { throw new Error("billing is not configured"); },
      hasBlockingSubscription: async () => { throw new Error("billing is not configured"); },
      hasBillingSubscription: async () => { throw new Error("billing is not configured"); },
      acquireExternalWork: async () => { throw new Error("billing is not configured"); },
      releaseExternalWork: async () => { throw new Error("billing is not configured"); },
      createCheckout: async () => { throw new Error("billing is not configured"); },
      createCustomerSession: async () => { throw new Error("billing is not configured"); },
      validateWebhook: async () => { throw new Error("billing is not configured"); },
      queueInvalidSubscriptionEvent: async () => { throw new Error("billing is not configured"); },
      applySubscriptionEvent: async () => { throw new Error("billing is not configured"); },
    };
  }

  const polar = createPolar({ accessToken: config.accessToken, environment: config.environment });
  const admin = createClient(cloud.url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const reconcile = async (subscriptionId: string) => {
    const claim = await admin.rpc("claim_polar_reconciliation", { p_subscription_id: subscriptionId });
    if (claim.error || !claim.data || typeof claim.data.pending !== "boolean") throw new Error("reconciliation claim failed");
    if (!claim.data.pending) return;
    const ticket = claim.data;
    if (typeof ticket.version !== "string") throw new Error("reconciliation retry pending");
    const admissionId = randomUUID();
    const now = new Date();
    const admitted = await admin.rpc("acquire_capture_external_work", {
      p_admission_id: admissionId,
      p_owner_id: ticket.userId,
      p_kind: "polar_reconcile",
      p_now: now.toISOString(),
      p_lease_expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
      p_capability_id: null,
      p_capability_expires_at: null,
    });
    if (admitted.error || admitted.data !== true) throw new Error("reconciliation admission failed");
    try {
      // Installed alpha.21 SDK: exact subscription GET, timeout in SECONDS.
      // No customer-state shortcut: it would discard Capture's custom grace.
      const snapshot = await polar.subscriptions.get(subscriptionId, { timeout: 2 });
      const normalized = normalizeSubscription("subscription.updated", new Date().toISOString(), snapshot, config);
      if (!normalized || (snapshot.status === "past_due" && !normalized.isEntitled)
        || normalized.polarSubscriptionId !== subscriptionId
        || normalized.userId !== ticket.userId || normalized.polarCustomerId !== ticket.customerId) throw new Error("reconciliation binding mismatch");
      // normalizeSubscription binds product/plan to the configured Capture catalog;
      // the authoritative subscription may legitimately have switched monthly/yearly.
      const result = await admin.rpc("finish_polar_reconciliation", {
        p_subscription_id: subscriptionId, p_version: ticket.version, p_snapshot: normalized,
      });
      if (result.error || result.data !== true) throw new Error("reconciliation superseded or failed");
    } finally {
      const released = await admin.rpc("release_capture_external_work", {
        p_owner_id: ticket.userId,
        p_admission_id: admissionId,
      });
      if (released.error || released.data !== true) throw new Error("reconciliation admission release failed");
    }
  };

  return {
    config,
    retryPending: async (userId) => {
      const next = await admin.rpc("next_polar_reconciliation", { p_user_id: userId });
      if (next.error) throw new Error("reconciliation queue unavailable");
      if (typeof next.data === "string") await reconcile(next.data);
    },
    isCloudEnabled,
    identity,
    isAccountErasing: async (userId) => {
      const { data, error } = await admin.rpc("capture_account_deleting", { p_user_id: userId });
      if (error || typeof data !== "boolean") throw new Error("account lifecycle unavailable");
      return data;
    },
    hasCloudAccess: (userId) => hasCurrentCloudAccess(admin, userId),
    hasBlockingSubscription: async (userId) => {
      const { data, error } = await admin
        .from("capture_cloud_subscriptions")
        .select("polar_subscription_id")
        .eq("user_id", userId)
        // Purchase eligibility is NOT effective resource access. A pending
        // source can still be charging even though access is temporarily denied.
        .or(`reconciliation_required.eq.true,and(is_entitled.eq.true,access_expires_at.gt.${new Date().toISOString()})`)
        .limit(1);
      if (error) throw new Error("subscription status could not be read");
      return Array.isArray(data) && data.length > 0;
    },
    hasBillingSubscription: async (userId) => {
      const { data, error } = await admin
        .from("capture_cloud_subscriptions")
        .select("polar_subscription_id")
        .eq("user_id", userId)
        .limit(1);
      if (error) throw new Error("subscription status could not be read");
      return Array.isArray(data) && data.length > 0;
    },
    acquireExternalWork: async ({ ownerId, kind, capabilityExpiresAt }) => {
      const admissionId = randomUUID();
      const now = new Date();
      const { data, error } = await admin.rpc("acquire_capture_external_work", {
        p_admission_id: admissionId,
        p_owner_id: ownerId,
        p_kind: kind,
        p_now: now.toISOString(),
        p_lease_expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
        p_capability_id: randomUUID(),
        p_capability_expires_at: capabilityExpiresAt.toISOString(),
      });
      return !error && data === true ? { admissionId } : null;
    },
    releaseExternalWork: async (ownerId, admissionId) => {
      const { data, error } = await admin.rpc("release_capture_external_work", {
        p_owner_id: ownerId,
        p_admission_id: admissionId,
      });
      if (error || data !== true) throw new Error("billing admission release failed");
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
      }, { timeout: 30 });
      return { url: result.url };
    },
    createCustomerSession: async (input: PortalInput) => {
      const result = await polar.customerSessions.create({
        external_customer_id: input.externalCustomerId,
        return_url: input.returnUrl,
      }, { timeout: 30 });
      return { customerPortalUrl: result.customer_portal_url };
    },
    validateWebhook: (body, headers, webhookSecret) => webhooks.validateEvent(body, headers, webhookSecret),
    queueInvalidSubscriptionEvent: async (event) => {
      const { data, error } = await admin.rpc("queue_invalid_polar_event", {
        p_subscription_id: event.subscriptionId, p_event_id: event.eventId,
        p_event_type: event.eventType, p_event_created_at: event.eventCreatedAt,
      });
      if (error) throw new Error("invalid subscription state could not be queued");
      if (data === true) await reconcile(event.subscriptionId);
    },
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
      // Always check, including a duplicate delivery after a failed/crashed fetch.
      // The SQL transaction already durably queued ambiguity and denied access.
      await reconcile(event.polarSubscriptionId);
      return data === true;
    },
  };
}
