import { generateObject } from "ai";
import { PlannedRoutingProposalSchema } from "./plannedRouting";
import type { Tier } from "./providers";

const MAX_PLANNED_ROUTING_OUTPUT_TOKENS = 32_000;
const MAX_PLANNED_ROUTING_JSON_CHARS = 400_000;

/**
 * Generate one untrusted planned-routing candidate.
 *
 * Cerebras rejects the complete plan's JSON Schema before inference. Its
 * no-schema object mode still asks the transport for one JSON object, while
 * the unchanged Zod schema remains the local application boundary in
 * planRoutingWithRetry. Other providers retain schema-backed generation.
 */
export async function generatePlannedRoutingCandidate({
  tier,
  prompt,
  abortSignal,
}: {
  tier: Tier;
  prompt: string;
  abortSignal: AbortSignal;
}): Promise<unknown> {
  const common = {
    model: tier.model,
    maxRetries: 0 as const,
    maxOutputTokens: MAX_PLANNED_ROUTING_OUTPUT_TOKENS,
    abortSignal,
    temperature: 0,
    prompt,
    providerOptions: tier.name === "cerebras"
      ? {
          ...tier.providerOptions,
          cerebras: {
            ...tier.providerOptions?.cerebras,
            reasoningEffort: "medium",
          },
        }
      : tier.providerOptions,
  };

  if (tier.name !== "cerebras") {
    const { object } = await generateObject({
      ...common,
      schema: PlannedRoutingProposalSchema,
    });
    return object;
  }

  /* AI SDK no-schema mode uses its secure, exact JSON parser and sends
     response_format=json_object without attaching a schema. It rejects prose,
     trailing values, and code fences. The checks below narrow the accepted
     JSON value to one bounded object before unchanged Zod validation. */
  const { object } = await generateObject({
    ...common,
    output: "no-schema",
  });
  if (
    object === null ||
    typeof object !== "object" ||
    Array.isArray(object) ||
    JSON.stringify(object).length > MAX_PLANNED_ROUTING_JSON_CHARS
  ) {
    throw new Error("invalid planned routing output");
  }
  return object;
}
