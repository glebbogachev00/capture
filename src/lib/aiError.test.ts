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
