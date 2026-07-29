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
