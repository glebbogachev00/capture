import "server-only";
import {
  ROUTING_FAILURE_CODES,
  type RoutingValidationObservation,
} from "./plannedRouting";

export const OPS_EVENT_NAMES = [
  "managed_ai_provider_attempt",
  "managed_ai_route",
  "cloud_identity",
  "cloud_board_read",
  "cloud_board_write",
  "self_hosted_sync_read",
  "self_hosted_sync_write",
  "billing_checkout",
  "billing_portal",
  "billing_webhook",
  "billing_reconciliation",
  "image_read",
  "image_write",
  "backup_read",
  "account_erasure_prepare",
  "account_erasure_status",
  "account_erasure_confirm",
  "account_erasure_worker",
  "retention_cleanup",
  "operational_health",
] as const;

export const OPS_OUTCOMES = [
  "success",
  "failure",
  "denied",
  "degraded",
  "skipped",
] as const;

export const OPS_REASONS = [
  "none",
  "not_configured",
  "not_authorized",
  "invalid_input",
  "rate_limited",
  "provider_rejected",
  "provider_unavailable",
  "dependency_unavailable",
  "migration_required",
  "readiness_drift",
  "lease_contended",
  "backlog_present",
  "capacity_pressure",
  "source_disabled",
] as const;

export const LATENCY_BUCKETS = [
  "lt_100ms",
  "100ms_500ms",
  "500ms_2s",
  "2s_10s",
  "gte_10s",
  "not_measured",
] as const;

export const COUNT_BUCKETS = [
  "zero",
  "one",
  "2_9",
  "10_99",
  "100_999",
  "gte_1000",
  "not_measured",
] as const;

export type OpsEventName = typeof OPS_EVENT_NAMES[number];
export type OpsOutcome = typeof OPS_OUTCOMES[number];
export type OpsReason = typeof OPS_REASONS[number];
export type LatencyBucket = typeof LATENCY_BUCKETS[number];
export type CountBucket = typeof COUNT_BUCKETS[number];

export const ROUTING_STAGES = [
  "recovery",
  "planner",
  "destination_adjudication",
  "action_identity",
  "deadline_adjudication",
  "final_validation",
] as const;
export const ROUTING_PROVIDER_TIERS = [
  "groq", "groq-2", "cerebras", "mistral", "gemini", "openrouter",
] as const;
export const ROUTING_STAGE_RESULTS = ["accepted", "rejected"] as const;
export const ROUTING_STAGE_CODES = [
  "SUCCESS",
  "PROVIDER_OR_OUTPUT_FAILURE",
  "ABORTED",
  "DEADLINE_EXPIRED",
  "OUTPUT_SCHEMA_INVALID",
  "COVERAGE_INVALID",
  "SOURCE_PARTITION_INVALID",
  "DESTINATION_ID_INVALID",
  "ACTION_ID_INVALID",
  "DEADLINE_ID_INVALID",
  "DEADLINE_SEMANTICS_INVALID",
  "FIELD_IMMUTABILITY_INVALID",
  "FINAL_PLAN_INVALID",
  ...ROUTING_FAILURE_CODES,
] as const;

export type RoutingStage = typeof ROUTING_STAGES[number];
export type RoutingProviderTier = typeof ROUTING_PROVIDER_TIERS[number];
export type RoutingStageResult = typeof ROUTING_STAGE_RESULTS[number];
export type RoutingStageCode = typeof ROUTING_STAGE_CODES[number];
export type RoutingStageObservation = Readonly<{
  stage: RoutingStage;
  providerTier: RoutingProviderTier;
  result: RoutingStageResult;
  code: RoutingStageCode;
  itemCount: number | null;
  decisionCount: number | null;
}>;

export type OpsEvent = Readonly<{
  event: OpsEventName;
  outcome: OpsOutcome;
  reason: OpsReason;
  latency?: LatencyBucket;
  count?: CountBucket;
}>;

export function latencyBucket(milliseconds: number): LatencyBucket {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "not_measured";
  if (milliseconds < 100) return "lt_100ms";
  if (milliseconds < 500) return "100ms_500ms";
  if (milliseconds < 2_000) return "500ms_2s";
  if (milliseconds < 10_000) return "2s_10s";
  return "gte_10s";
}

export function countBucket(count: number): CountBucket {
  if (!Number.isSafeInteger(count) || count < 0) return "not_measured";
  if (count === 0) return "zero";
  if (count === 1) return "one";
  if (count < 10) return "2_9";
  if (count < 100) return "10_99";
  if (count < 1_000) return "100_999";
  return "gte_1000";
}

const OPS_EVENT_NAME_SET: ReadonlySet<unknown> = new Set(OPS_EVENT_NAMES);
const OPS_OUTCOME_SET: ReadonlySet<unknown> = new Set(OPS_OUTCOMES);
const OPS_REASON_SET: ReadonlySet<unknown> = new Set(OPS_REASONS);
const LATENCY_BUCKET_SET: ReadonlySet<unknown> = new Set(LATENCY_BUCKETS);
const COUNT_BUCKET_SET: ReadonlySet<unknown> = new Set(COUNT_BUCKETS);
const MISSING = Symbol("missing operational field");
const ROUTING_FAILURE_CODE_SET: ReadonlySet<unknown> = new Set(ROUTING_FAILURE_CODES);
const ROUTING_STAGE_SET: ReadonlySet<unknown> = new Set(ROUTING_STAGES);
const ROUTING_PROVIDER_TIER_SET: ReadonlySet<unknown> = new Set(ROUTING_PROVIDER_TIERS);
const ROUTING_STAGE_RESULT_SET: ReadonlySet<unknown> = new Set(ROUTING_STAGE_RESULTS);
const ROUTING_STAGE_CODE_SET: ReadonlySet<unknown> = new Set(ROUTING_STAGE_CODES);

function ownDataValue(input: object, key: PropertyKey): unknown | typeof MISSING {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && "value" in descriptor ? descriptor.value : MISSING;
}

/**
 * The only operational log sink. Every value is checked again at runtime as an
 * exact primitive from a closed allowlist. This boundary may receive hostile
 * casts or adapter output, so it never coerces, invokes getters, or logs input.
 */
export function opsEvent(input: OpsEvent): void {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    const event = ownDataValue(input, "event");
    const outcome = ownDataValue(input, "outcome");
    const reason = ownDataValue(input, "reason");
    if (typeof event !== "string" || !OPS_EVENT_NAME_SET.has(event)
        || typeof outcome !== "string" || !OPS_OUTCOME_SET.has(outcome)
        || typeof reason !== "string" || !OPS_REASON_SET.has(reason)) return;

    const suppliedLatency = ownDataValue(input, "latency");
    const suppliedCount = ownDataValue(input, "count");
    const latency = typeof suppliedLatency === "string" && LATENCY_BUCKET_SET.has(suppliedLatency)
      ? suppliedLatency as LatencyBucket
      : "not_measured";
    const count = typeof suppliedCount === "string" && COUNT_BUCKET_SET.has(suppliedCount)
      ? suppliedCount as CountBucket
      : "not_measured";

    writeOperationalLog("[capture-ops]", {
      version: 1,
      event: event as OpsEventName,
      outcome: outcome as OpsOutcome,
      reason: reason as OpsReason,
      latency,
      count,
    });
  } catch {
    // A malformed Proxy or unavailable sink must not escape this privacy wall.
  }
}

function writeOperationalLog(prefix: string, payload: object): void {
  console.info(prefix, payload);
}

/** Fixed-code/count-only routing diagnostics; source and provider prose cannot enter. */
export function routingValidationEvent(input: RoutingValidationObservation): void {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    const attempt = ownDataValue(input, "attempt");
    const failureCodes = ownDataValue(input, "failureCodes");
    if ((attempt !== 1 && attempt !== 2) || !Array.isArray(failureCodes)
        || failureCodes.some((code) => typeof code !== "string" || !ROUTING_FAILURE_CODE_SET.has(code))) return;

    const countKeys = [
      "itemCount",
      "destinationCount",
      "newThreadCount",
      "sourceCharacterCount",
      "accountedSourceCharacterCount",
      "matchingPrefixCharacterCount",
      "matchingSuffixCharacterCount",
    ] as const;
    const counts = Object.fromEntries(countKeys.map((key) => [key, ownDataValue(input, key)]));
    if (Object.values(counts).some(
      (value) => value !== null && (!Number.isSafeInteger(value) || (value as number) < 0)
    )) return;

    writeOperationalLog("[capture-routing-validation]", {
      attempt,
      failureCodes: [...failureCodes],
      ...counts,
    });
  } catch {
    // Malformed input or an unavailable sink cannot affect routing.
  }
}

/** Per-tier stage provenance with no source, ids, model output, or provider prose. */
export function routingStageEvent(input: RoutingStageObservation): void {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    const stage = ownDataValue(input, "stage");
    const providerTier = ownDataValue(input, "providerTier");
    const result = ownDataValue(input, "result");
    const code = ownDataValue(input, "code");
    const itemCount = ownDataValue(input, "itemCount");
    const decisionCount = ownDataValue(input, "decisionCount");
    if (
      typeof stage !== "string" || !ROUTING_STAGE_SET.has(stage) ||
      typeof providerTier !== "string" || !ROUTING_PROVIDER_TIER_SET.has(providerTier) ||
      typeof result !== "string" || !ROUTING_STAGE_RESULT_SET.has(result) ||
      typeof code !== "string" || !ROUTING_STAGE_CODE_SET.has(code) ||
      [itemCount, decisionCount].some((value) =>
        value !== null && (!Number.isSafeInteger(value) || (value as number) < 0)
      )
    ) return;
    writeOperationalLog("[capture-routing-stage]", {
      stage,
      providerTier,
      result,
      code,
      itemCount,
      decisionCount,
    });
  } catch {
    // The privacy wall and routing outcome remain intact on hostile input.
  }
}
