import { isIP } from "node:net";

export type PolarPlan = "monthly" | "yearly";
export type PolarEnvironment = "sandbox" | "production";

export type PolarConfig = {
  environment: PolarEnvironment;
  accessToken: string;
  webhookSecret: string | null;
  monthlyProductId: string;
  yearlyProductId: string;
  siteUrl: string;
};

export type CaptureIdentity = { userId: string; email: string };
export type CheckoutInput = {
  products: string[];
  externalCustomerId: string;
  customerEmail: string;
  customerIpAddress?: string;
  successUrl: string;
  returnUrl: string;
  allowDiscountCodes: boolean;
  allowTrial: boolean;
  metadata: { capturePlan: PolarPlan };
};
export type PortalInput = { externalCustomerId: string; returnUrl: string };

export type SubscriptionShape = {
  id: string;
  status: string;
  customer_id: string;
  customer?: { external_id?: unknown } | null;
  product_id: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
};

export type AppliedSubscription = {
  eventId: string;
  eventType: string;
  eventCreatedAt: string;
  userId: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "revoked" | "paused" | "inactive";
  plan: PolarPlan;
  isEntitled: boolean;
  polarCustomerId: string;
  polarSubscriptionId: string;
  polarProductId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  accessExpiresAt: string;
  cancelAtPeriodEnd: boolean;
};

export type PolarDependencies = {
  config: PolarConfig | null;
  isCloudEnabled: () => boolean;
  identity: () => Promise<CaptureIdentity | null>;
  hasActiveSubscription: (userId: string) => Promise<boolean>;
  createCheckout: (input: CheckoutInput) => Promise<{ url: string }>;
  createCustomerSession: (input: PortalInput) => Promise<{ customerPortalUrl: string }>;
  validateWebhook: (body: string, headers: Record<string, string>, secret: string) => Promise<unknown>;
  applySubscriptionEvent: (event: AppliedSubscription) => Promise<boolean>;
};

type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created", "subscription.active", "subscription.updated", "subscription.canceled",
  "subscription.uncanceled", "subscription.revoked", "subscription.paused", "subscription.resumed",
  "subscription.past_due", "subscription.cycled",
]);

function cleanUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPolarConfig(env: Env = process.env): PolarConfig | null {
  const environment = env.POLAR_ENVIRONMENT === "production" ? "production" : env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : null;
  const siteUrl = cleanUrl(env.NEXT_PUBLIC_SITE_URL ?? "https://trycapture.app");
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim() ?? "";
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim() || null;
  const monthlyProductId = env.POLAR_PRODUCT_ID_MONTHLY?.trim() ?? "";
  const yearlyProductId = env.POLAR_PRODUCT_ID_YEARLY?.trim() ?? "";
  if (!environment || !siteUrl || !accessToken || !UUID.test(monthlyProductId) || !UUID.test(yearlyProductId)) return null;
  return { environment, accessToken, webhookSecret, monthlyProductId, yearlyProductId, siteUrl };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

type BoundedBody =
  | { status: "ok"; text: string }
  | { status: "too-large" }
  | { status: "bad-request" };

async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedBody> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > maxBytes) return { status: "too-large" };
  }
  if (!request.body) return { status: "ok", text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { status: "too-large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } catch {
    return { status: "bad-request" };
  } finally {
    reader.releaseLock();
  }
}

async function requestPlan(request: Request): Promise<PolarPlan | null> {
  const body = await readBoundedBody(request, 1_000);
  if (body.status !== "ok") return null;
  try {
    const value = JSON.parse(body.text) as { plan?: unknown };
    return value.plan === "monthly" || value.plan === "yearly" ? value.plan : null;
  } catch {
    return null;
  }
}

function forwardedIp(request: Request): string | undefined {
  const candidate = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return candidate && isIP(candidate) ? candidate : undefined;
}

export async function handleCheckout(request: Request, deps: PolarDependencies): Promise<Response> {
  if (!deps.isCloudEnabled()) return json({ error: "not found" }, 404);
  if (!deps.config) return json({ error: "billing is not configured" }, 503);
  const identity = await deps.identity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const plan = await requestPlan(request);
  if (!plan) return json({ error: "invalid plan" }, 400);
  try {
    if (await deps.hasActiveSubscription(identity.userId)) {
      return json({ error: "capture cloud is already active" }, 409);
    }
  } catch {
    return json({ error: "subscription status is unavailable" }, 503);
  }
  try {
    const productId = plan === "monthly" ? deps.config.monthlyProductId : deps.config.yearlyProductId;
    const customerIpAddress = forwardedIp(request);
    const checkout = await deps.createCheckout({
      products: [productId],
      externalCustomerId: identity.userId,
      customerEmail: identity.email,
      ...(customerIpAddress ? { customerIpAddress } : {}),
      successUrl: `${deps.config.siteUrl}/app?checkout_id={CHECKOUT_ID}`,
      returnUrl: `${deps.config.siteUrl}/pricing`,
      allowDiscountCodes: true,
      allowTrial: false,
      metadata: { capturePlan: plan },
    });
    return json({ url: checkout.url });
  } catch {
    return json({ error: "checkout could not be created" }, 502);
  }
}

export async function handleCustomerPortal(_request: Request, deps: PolarDependencies): Promise<Response> {
  if (!deps.isCloudEnabled()) return json({ error: "not found" }, 404);
  if (!deps.config) return json({ error: "billing is not configured" }, 503);
  const identity = await deps.identity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  try {
    const session = await deps.createCustomerSession({ externalCustomerId: identity.userId, returnUrl: `${deps.config.siteUrl}/app` });
    return json({ url: session.customerPortalUrl });
  } catch {
    return json({ error: "subscription portal is unavailable" }, 502);
  }
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizedStatus(eventType: string, status: string, cancelAtPeriodEnd: boolean): AppliedSubscription["status"] {
  if (eventType === "subscription.revoked" || status === "revoked") return "revoked";
  if (eventType === "subscription.paused" || status === "paused") return "paused";
  if (eventType === "subscription.past_due" || status === "past_due") return "past_due";
  if (eventType === "subscription.canceled" || cancelAtPeriodEnd || status === "canceled") return "canceled";
  if (status === "active" || eventType === "subscription.active" || eventType === "subscription.resumed") return "active";
  if (status === "trialing") return "trialing";
  return "inactive";
}

export function normalizeSubscription(
  eventType: string,
  eventCreatedAt: string,
  data: SubscriptionShape,
  config: PolarConfig,
): Omit<AppliedSubscription, "eventId" | "eventType" | "eventCreatedAt"> | null {
  const userId = data.customer?.external_id;
  const plan: PolarPlan | null = data.product_id === config.monthlyProductId ? "monthly" : data.product_id === config.yearlyProductId ? "yearly" : null;
  if (typeof userId !== "string" || !UUID.test(userId) || !plan || !data.id || !data.customer_id || !validDate(eventCreatedAt) || !validDate(data.current_period_start) || !validDate(data.current_period_end)) return null;
  const status = normalizedStatus(eventType, data.status, data.cancel_at_period_end);
  const isEntitled = status === "active" || status === "trialing" || status === "canceled" || status === "past_due";
  const accessExpiresAt = status === "past_due"
    ? new Date(Date.parse(eventCreatedAt) + 3 * 24 * 60 * 60 * 1000).toISOString()
    : (isEntitled ? data.current_period_end : eventCreatedAt);
  return {
    userId, status, plan, isEntitled,
    polarCustomerId: data.customer_id,
    polarSubscriptionId: data.id,
    polarProductId: data.product_id,
    currentPeriodStart: data.current_period_start,
    currentPeriodEnd: data.current_period_end,
    accessExpiresAt,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  };
}

export function effectiveEntitlement(value: { isEntitled: boolean; accessExpiresAt: string }, now = new Date()): boolean {
  return value.isEntitled && validDate(value.accessExpiresAt) && Date.parse(value.accessExpiresAt) > now.getTime();
}

function webhookHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers.entries());
}

function webhookPayload(value: unknown): { type: string; timestamp: string; data: SubscriptionShape } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.type !== "string" || typeof payload.timestamp !== "string" || !payload.data || typeof payload.data !== "object") return null;
  return { type: payload.type, timestamp: payload.timestamp, data: payload.data as SubscriptionShape };
}

export async function handlePolarWebhook(request: Request, deps: PolarDependencies): Promise<Response> {
  if (!deps.config) return json({ error: "billing is not configured" }, 503);
  if (!deps.config.webhookSecret) return json({ error: "webhook is not configured" }, 503);
  const headers = webhookHeaders(request);
  const eventId = headers["webhook-id"];
  if (!eventId || eventId.length > 200) return json({ error: "invalid webhook" }, 400);
  const bodyRead = await readBoundedBody(request, 1_000_000);
  if (bodyRead.status === "too-large") return json({ error: "webhook too large" }, 413);
  if (bodyRead.status === "bad-request") return json({ error: "invalid webhook" }, 400);
  const body = bodyRead.text;
  let raw: unknown;
  try {
    raw = await deps.validateWebhook(body, headers, deps.config.webhookSecret);
  } catch {
    return json({ error: "invalid signature" }, 403);
  }
  const payload = webhookPayload(raw);
  if (!payload) return json({ error: "invalid webhook" }, 400);
  if (!SUBSCRIPTION_EVENTS.has(payload.type)) return new Response(null, { status: 202 });
  if (
    payload.data.product_id !== deps.config.monthlyProductId &&
    payload.data.product_id !== deps.config.yearlyProductId
  ) {
    return new Response(null, { status: 202 });
  }
  const normalized = normalizeSubscription(payload.type, payload.timestamp, payload.data, deps.config);
  // A verified event from an older static checkout can have no Capture user.
  // It cannot grant access, and retries cannot repair that missing identity.
  if (!normalized) return new Response(null, { status: 202 });
  try {
    await deps.applySubscriptionEvent({ eventId, eventType: payload.type, eventCreatedAt: payload.timestamp, ...normalized });
    return new Response(null, { status: 202 });
  } catch {
    return json({ error: "webhook processing failed" }, 500);
  }
}
