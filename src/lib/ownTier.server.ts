import "server-only";

import { createCerebras } from "@ai-sdk/cerebras";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { AsyncLocalStorage } from "node:async_hooks";
import { OWN_KEY_HEADER, ownKeyProvider, type OwnKeyProvider } from "@/lib/ownAiKey";
import type { Tier } from "@/lib/providers";

/** A Cloud member's own key, for the length of one request: every model call
 * in it goes to their provider, and nothing falls back to managed AI. */
export type OwnTier = Tier & { provider: OwnKeyProvider; apiKey: string };
const ownTiers = new AsyncLocalStorage<OwnTier>();
export const currentOwnTier = (): OwnTier | null => ownTiers.getStore() ?? null;
export const withOwnTier = <T>(tier: OwnTier, work: () => T): T => ownTiers.run(tier, work);

/** The request's own key as a tier, or null when there is none or it is not
 * a key Capture knows. The same models as managed AI, on their account. */
export function ownTierFrom(request: Request): OwnTier | null {
  const apiKey = request.headers.get(OWN_KEY_HEADER)?.trim() ?? "";
  const provider = ownKeyProvider(apiKey);
  if (!provider) return null;
  if (provider === "openrouter") {
    return { name: "own-openrouter", provider, apiKey, model: createOpenRouter({ apiKey }).chat(process.env.OWN_KEY_OPENROUTER_MODEL || "openai/gpt-oss-120b") };
  }
  if (provider === "groq") {
    return { name: "own-groq", provider, apiKey, model: createGroq({ apiKey })(process.env.GROQ_MODEL || "openai/gpt-oss-120b") };
  }
  return {
    /* Named "cerebras" so the sorter keeps Cerebras's JSON-object mode. */
    name: "cerebras",
    provider,
    apiKey,
    model: createCerebras({ apiKey })("gpt-oss-120b"),
    providerOptions: { cerebras: { reasoningEffort: "low", reasoningFormat: "hidden" } },
  };
}
