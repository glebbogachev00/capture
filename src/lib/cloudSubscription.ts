import { NextResponse } from "next/server";
import { TRIAL_LIMIT } from "@/lib/playground";

export type CloudSubscriptionRow = {
  status: string;
  plan: string | null;
  is_entitled: boolean;
  current_period_end: string | null;
  access_expires_at: string | null;
  cancel_at_period_end: boolean;
  last_event_at: string;
};

export type PublicCloudSubscription = {
  tier: "free" | "cloud";
  status: string;
  plan: "monthly" | "yearly" | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  accessExpiresAt: string | null;
  captureLimit: number | null;
};

export type CloudSubscriptionDependencies = {
  isEnabled: () => boolean;
  isConfigured: () => boolean;
  requiresSubscription: () => boolean;
  verifyIdentity: (request: Request) => Promise<{ userId: string } | null>;
  getSubscriptions: (userId: string) => Promise<CloudSubscriptionRow[]>;
  now?: () => Date;
};

type ServerEnv = Record<string, string | undefined>;

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isSubscriptionRequired(env: ServerEnv = process.env): boolean {
  if (env.CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION === "0") return false;
  return env.CAPTURE_CLOUD === "1";
}

export function isCurrentCloudEntitlement(
  row: Pick<CloudSubscriptionRow, "is_entitled" | "access_expires_at"> | null,
  now = new Date(),
): boolean {
  return !!row?.is_entitled && validDate(row.access_expires_at) && Date.parse(row.access_expires_at) > now.getTime();
}

export function publicCloudSubscription(
  rows: CloudSubscriptionRow[] | null,
  now = new Date(),
  requiresSubscription = true,
): PublicCloudSubscription {
  const row = rows?.find((candidate) => isCurrentCloudEntitlement(candidate, now)) ?? rows?.[0] ?? null;
  if (!row) {
    return {
      tier: "free",
      status: "inactive",
      plan: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      accessExpiresAt: null,
      captureLimit: requiresSubscription ? TRIAL_LIMIT : null,
    };
  }

  const isEntitled = isCurrentCloudEntitlement(row, now);
  return {
    tier: isEntitled ? "cloud" : "free",
    status: typeof row.status === "string" ? row.status.slice(0, 40) : "inactive",
    plan: row.plan === "monthly" || row.plan === "yearly" ? row.plan : null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    currentPeriodEnd: validDate(row.current_period_end) ? row.current_period_end : null,
    accessExpiresAt: validDate(row.access_expires_at) ? row.access_expires_at : null,
    captureLimit: requiresSubscription && !isEntitled ? TRIAL_LIMIT : null,
  };
}

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function handleCloudSubscriptionStatus(
  request: Request,
  deps: CloudSubscriptionDependencies,
): Promise<Response> {
  if (!deps.isEnabled()) return json({ error: "not found" }, 404);
  if (!deps.isConfigured()) return json({ error: "cloud is not configured" }, 503);

  try {
    const identity = await deps.verifyIdentity(request);
    if (!identity?.userId.trim()) {
      return json({
        error: "unauthorized",
        captureLimit: deps.requiresSubscription() ? TRIAL_LIMIT : null,
      }, 401);
    }
    const rows = await deps.getSubscriptions(identity.userId);
    return json(publicCloudSubscription(
      rows,
      deps.now?.() ?? new Date(),
      deps.requiresSubscription(),
    ));
  } catch {
    return json({ error: "subscription status is unavailable" }, 503);
  }
}
