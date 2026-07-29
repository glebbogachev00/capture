import { google } from "@ai-sdk/google";

/**
 * Both routes talk to the same model, so it is named once here.
 *
 * Gemini via Google AI Studio, authenticated with GOOGLE_GENERATIVE_AI_API_KEY
 * (the provider reads that variable itself — it is never referenced in client
 * code). Flash rather than Pro: the work is a short structured sort and a
 * few sentences of prose, so latency matters more than depth, and Flash sits
 * inside the free tier.
 */
export const MODEL = google("gemini-3.6-flash");

/**
 * Gemini 3 reasons at length by default, which pushed a one-fragment summary
 * to 35 seconds — far too slow for something you use while standing in a
 * doorway. Neither job needs deep deliberation: one is a two-way sort with a
 * shelf-life judgement, the other is five sentences of synthesis.
 */
export const THINKING = {
  google: { thinkingConfig: { thinkingLevel: "low" as const } },
};
