import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COUNT_BUCKETS,
  LATENCY_BUCKETS,
  OPS_EVENT_NAMES,
  OPS_OUTCOMES,
  OPS_REASONS,
  countBucket,
  latencyBucket,
  opsEvent,
} from "./opsEvent.server";

describe("fixed-schema operational events", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits exactly the approved fixed fields and no caller-controlled values", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    opsEvent({
      event: "managed_ai_provider_attempt",
      outcome: "degraded",
      reason: "provider_unavailable",
      latency: "2s_10s",
      count: "2_9",
    });

    expect(info).toHaveBeenCalledExactlyOnceWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_provider_attempt",
      outcome: "degraded",
      reason: "provider_unavailable",
      latency: "2s_10s",
      count: "2_9",
    });
    expect(Object.keys(info.mock.calls[0][1] as object).sort()).toEqual([
      "count", "event", "latency", "outcome", "reason", "version",
    ]);
  });

  it("keeps every dimension finite and bucketed", () => {
    expect(OPS_EVENT_NAMES).toEqual(expect.arrayContaining([
      "managed_ai_provider_attempt",
      "cloud_board_read",
      "billing_webhook",
      "image_write",
      "backup_read",
      "account_erasure_worker",
      "retention_cleanup",
      "operational_health",
    ]));
    expect(OPS_OUTCOMES).toEqual(["success", "failure", "denied", "degraded", "skipped"]);
    expect(OPS_REASONS).not.toContain("unknown_error");
    expect(LATENCY_BUCKETS).toEqual(["lt_100ms", "100ms_500ms", "500ms_2s", "2s_10s", "gte_10s", "not_measured"]);
    expect(COUNT_BUCKETS).toEqual(["zero", "one", "2_9", "10_99", "100_999", "gte_1000", "not_measured"]);
  });

  it("coarsens latency and counts at fixed boundaries", () => {
    expect([0, 99, 100, 499, 500, 1_999, 2_000, 9_999, 10_000].map(latencyBucket)).toEqual([
      "lt_100ms", "lt_100ms", "100ms_500ms", "100ms_500ms", "500ms_2s",
      "500ms_2s", "2s_10s", "2s_10s", "gte_10s",
    ]);
    expect([0, 1, 2, 9, 10, 99, 100, 999, 1_000].map(countBucket)).toEqual([
      "zero", "one", "2_9", "2_9", "10_99", "10_99", "100_999", "100_999", "gte_1000",
    ]);
  });

  it("drops hostile required dimensions without coercing or logging them", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const secret = "private-runtime-value";
    const coercible = { toString: () => "success", secret };
    const getter = Object.defineProperty({
      outcome: "success",
      reason: "none",
    }, "event", {
      enumerable: true,
      get: () => { throw new Error(secret); },
    });

    for (const input of [
      secret,
      { event: secret, outcome: "success", reason: "none" },
      { event: "managed_ai_route", outcome: coercible, reason: "none" },
      { event: "managed_ai_route", outcome: "success", reason: new String("none") },
      getter,
      new Proxy({ event: "managed_ai_route", outcome: "success", reason: "none" }, {
        getOwnPropertyDescriptor: () => { throw new Error(secret); },
      }),
    ]) {
      opsEvent(input as never);
    }

    expect(info).not.toHaveBeenCalled();
  });

  it("replaces hostile optional dimensions with fixed buckets", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const secret = "private-optional-value";

    opsEvent({
      event: "managed_ai_route",
      outcome: "failure",
      reason: "dependency_unavailable",
      latency: { toString: () => "2s_10s", secret },
      count: new String("2_9"),
    } as never);

    expect(info).toHaveBeenCalledExactlyOnceWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_route",
      outcome: "failure",
      reason: "dependency_unavailable",
      latency: "not_measured",
      count: "not_measured",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(secret);
  });
});
