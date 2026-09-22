import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServiceClient } from "@/lib/supabase/service";

export const OPERATIONAL_STATES = ["ok", "warning", "critical", "unknown"] as const;
export type OperationalState = typeof OPERATIONAL_STATES[number];

export const OPERATIONAL_SIGNALS = [
  "overdueErasures",
  "billingReconciliation",
  "webhookDelivery",
  "imagePressure",
  "quotaPressure",
  "readinessDrift",
  "maintenance",
] as const;

export type OperationalReport = Record<typeof OPERATIONAL_SIGNALS[number], OperationalState>;
type Env = Record<string, string | undefined>;

function validAlertDestination(value: string | undefined): boolean {
  if (!value || value.length > 400) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.hash;
  } catch {
    return false;
  }
}

export function operationsConfiguration(env: Env = process.env): { status: "disabled" | "unavailable" | "ready" } {
  if (env.CAPTURE_OPERATIONS_ENABLED !== "1") return { status: "disabled" };
  const secret = env.CAPTURE_OPERATIONS_WORKER_SECRET?.trim() ?? "";
  const schedule = env.CAPTURE_OPERATIONS_SCHEDULE_ID?.trim() ?? "";
  if (secret.length < 32
      || !/^[a-z0-9_-]{8,64}$/i.test(schedule)
      || !validAlertDestination(env.CAPTURE_OPERATIONS_ALERT_DESTINATION)
      || env.CAPTURE_OPERATIONS_ALERTS_VERIFIED !== "1") {
    return { status: "unavailable" };
  }
  return { status: "ready" };
}

export type OperationsAuthorization = "authorized" | "unauthorized" | "unavailable";

export function authorizeOperationsWorker(request: Request, env: Env = process.env): OperationsAuthorization {
  if (operationsConfiguration(env).status !== "ready") return "unavailable";
  const configured = env.CAPTURE_OPERATIONS_WORKER_SECRET!.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedHash = createHash("sha256").update(configured).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash) ? "authorized" : "unauthorized";
}

export function parseOperationalReport(value: unknown): OperationalReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join("|") !== [...OPERATIONAL_SIGNALS].sort().join("|")) return null;
  const allowed = new Set<string>(OPERATIONAL_STATES);
  if (!OPERATIONAL_SIGNALS.every((signal) => allowed.has(String(row[signal])))) return null;
  return Object.fromEntries(OPERATIONAL_SIGNALS.map((signal) => [signal, row[signal]])) as OperationalReport;
}

type ServiceClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function runOperationalMaintenance(env: Env = process.env): Promise<OperationalReport> {
  if (operationsConfiguration(env).status !== "ready") throw new Error("operations unavailable");
  const config = getCloudConfig(env);
  if (config?.status !== "ready") throw new Error("operations unavailable");
  const client = createCloudServiceClient(config) as ServiceClient | null;
  if (!client) throw new Error("operations unavailable");

  const now = new Date();
  const maintenance = await client.rpc("run_capture_operational_maintenance", {
    p_lease_id: randomUUID(),
    p_now: now.toISOString(),
    p_lease_expires_at: new Date(now.getTime() + 55_000).toISOString(),
  });
  if (maintenance.error || !maintenance.data || typeof maintenance.data !== "object") {
    throw new Error("operations unavailable");
  }
  const outcome = (maintenance.data as Record<string, unknown>).outcome;
  if (outcome !== "completed" && outcome !== "contended") throw new Error("operations unavailable");

  const health = await client.rpc("capture_operational_health");
  if (health.error) throw new Error("operations unavailable");
  const report = parseOperationalReport(health.data);
  if (!report) throw new Error("operations unavailable");
  return report;
}
