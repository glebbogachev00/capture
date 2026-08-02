import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

/**
 * The model chain, tried in order until one answers.
 *
 * Free tiers run out, and when the only provider is spent the app stops being
 * able to think at all. Each tier is included only when its key is present, so
 * a machine with just one key configured behaves exactly as before.
 *
 * Model ids are overridable by env so a retired model can be swapped without
 * a deploy from source.
 */

export type Tier = {
  name: string;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
};

export function chain(): Tier[] {
  const tiers: Tier[] = [];

  // OpenRouter first: a paid/keyed tier with broadly current models, then
  // Groq, and Gemini last — its free tier is the most likely to be spent.
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    tiers.push({
      name: "openrouter",
      model: openrouter.chat(
        process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash"
      ),
    });
  }

  if (process.env.GROQ_API_KEY) {
    tiers.push({
      name: "groq",
      model: groq(process.env.GROQ_MODEL || "openai/gpt-oss-120b"),
    });
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    tiers.push({
      name: "gemini",
      model: google(process.env.GEMINI_MODEL || "gemini-3.6-flash"),
      // Gemini 3 reasons at length by default; a two-way sort does not need it.
      providerOptions: {
        google: { thinkingConfig: { thinkingLevel: "low" } },
      },
    });
  }

  return tiers;
}

export class NoProvidersError extends Error {
  constructor() {
    super("no model provider is configured");
  }
}

/**
 * Run `attempt` against each tier until one succeeds.
 *
 * The last error is rethrown when every tier fails, so the caller still gets a
 * real reason to show rather than a generic one.
 */
export async function withFallback<T>(
  attempt: (tier: Tier) => Promise<T>
): Promise<{ value: T; via: string }> {
  const tiers = chain();
  if (!tiers.length) throw new NoProvidersError();

  let last: unknown;
  for (const tier of tiers) {
    try {
      return { value: await attempt(tier), via: tier.name };
    } catch (error) {
      last = error;
      console.warn(`[capture] ${tier.name} failed, trying next`, error);
      // Remember which tier this error came from so the message shown to the
      // operator names the provider that actually failed.
      try {
        (error as { provider?: string }).provider = tier.name;
      } catch {
        /* frozen error object; message stays generic */
      }
    }
  }
  throw last;
}
