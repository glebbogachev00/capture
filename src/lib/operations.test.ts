import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  authorizeOperationsWorker,
  operationsConfiguration,
  parseOperationalReport,
} from "./operations.server";

const configured = {
  CAPTURE_OPERATIONS_ENABLED: "1",
  CAPTURE_OPERATIONS_WORKER_SECRET: "s".repeat(32),
  CAPTURE_OPERATIONS_SCHEDULE_ID: "capture-maintenance-hourly",
  CAPTURE_OPERATIONS_ALERT_DESTINATION: "https://alerts.example.invalid/capture",
  CAPTURE_OPERATIONS_ALERTS_VERIFIED: "1",
};

describe("operational cron boundary", () => {
  it("is source-disabled and fails closed until every hosted input is configured", () => {
    expect(operationsConfiguration({})).toEqual({ status: "disabled" });
    for (const missing of Object.keys(configured)) {
      const env = { ...configured, [missing]: undefined };
      expect(operationsConfiguration(env).status).not.toBe("ready");
    }
    expect(operationsConfiguration(configured)).toEqual({ status: "ready" });
  });

  it("requires the distinct worker bearer in constant-time form", () => {
    expect(authorizeOperationsWorker(new Request("https://capture.test", {
      method: "POST", headers: { authorization: `Bearer ${configured.CAPTURE_OPERATIONS_WORKER_SECRET}` },
    }), configured)).toBe("authorized");
    expect(authorizeOperationsWorker(new Request("https://capture.test", {
      method: "POST", headers: { authorization: "Bearer wrong" },
    }), configured)).toBe("unauthorized");
    expect(authorizeOperationsWorker(new Request("https://capture.test"), {})).toBe("unavailable");
  });

  it("accepts only the fixed aggregate signal schema", () => {
    const report = parseOperationalReport({
      overdueErasures: "critical",
      billingReconciliation: "warning",
      webhookDelivery: "unknown",
      imagePressure: "ok",
      quotaPressure: "warning",
      readinessDrift: "critical",
      maintenance: "ok",
    });
    expect(report).toEqual({
      overdueErasures: "critical",
      billingReconciliation: "warning",
      webhookDelivery: "unknown",
      imagePressure: "ok",
      quotaPressure: "warning",
      readinessDrift: "critical",
      maintenance: "ok",
    });
    expect(parseOperationalReport({ ...report, ownerId: "private" })).toBeNull();
    expect(parseOperationalReport({ ...report, quotaPressure: 17 })).toBeNull();
  });

  it("exposes POST only, no query-secret support, and no public payload fields", () => {
    const source = readFileSync("src/app/api/cloud/operations/cron/route.ts", "utf8");
    expect(source).toContain("export async function POST");
    expect(source).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
    expect(source).not.toMatch(/searchParams|request\.url|console\./);
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("export const maxDuration = 60");
  });
});
