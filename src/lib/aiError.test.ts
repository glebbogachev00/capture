import { describe, expect, it } from "vitest";
import { explain } from "./aiError";
import { NoProvidersError } from "./providers";

function providerError(provider: string, message: string) {
  const e = new Error(message) as Error & { provider: string };
  e.provider = provider;
  return e;
}

describe("explain", () => {
  it("tells the operator which key to fix, by provider", () => {
    const out = explain(providerError("groq", "Invalid API key provided"));
    expect(out.message).toContain("Groq");
    expect(out.message).toContain("GROQ_API_KEY");
    expect(out.status).toBe(503);
  });

  it("names Cerebras when its key is the failure", () => {
    const out = explain(providerError("cerebras", "Invalid API key provided"));
    expect(out.message).toContain("Cerebras");
    expect(out.message).toContain("CEREBRAS_API_KEY");
    expect(out.status).toBe(503);
  });

  it("tells the operator when a provider needs billing set up", () => {
    const e = providerError(
      "cerebras",
      "Payment required to access this resource. Visit your billing tab."
    ) as Error & { provider: string; statusCode?: number };
    e.statusCode = 402;
    const out = explain(e);
    expect(out.message).toContain("Cerebras");
    expect(out.message.toLowerCase()).toContain("billing");
    expect(out.status).toBe(503);
  });

  it("maps a Cerebras 429 to rate-limit wording with the provider named", () => {
    const e = new Error("rate limit exceeded") as Error & { provider: string };
    e.provider = "cerebras";
    const out = explain(e);
    expect(out.message).toContain("Cerebras");
    expect(out.status).toBe(429);
  });

  it("names Gemini when the Google key is the failure", () => {
    const out = explain(providerError("gemini", "API key not valid"));
    expect(out.message).toContain("Google AI Studio");
    expect(out.message).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
  });

  it("stays generic when the provider is unknown", () => {
    const out = explain(new Error("API key not valid"));
    expect(out.message).not.toContain("Google");
    expect(out.message).toContain("your model provider");
  });

  it("reads the provider through the cause chain", () => {
    const inner = providerError("openrouter", "Invalid API key provided");
    const outer = new Error("wrapped", { cause: inner }) as Error & {
      provider?: string;
    };
    const out = explain(outer);
    expect(out.message).toContain("OpenRouter");
    expect(out.message).toContain("OPENROUTER_API_KEY");
  });

  it("maps 429s to rate-limit wording with the provider named", () => {
    const e = new Error("quota exceeded") as Error & { provider: string };
    e.provider = "gemini";
    const out = explain(e);
    expect(out.message).toContain("Google AI Studio");
    expect(out.status).toBe(429);
  });

  it("explains a missing provider configuration", () => {
    const out = explain(new NoProvidersError());
    expect(out.message).toContain("No model provider");
    expect(out.status).toBe(503);
  });
});
