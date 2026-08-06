import { afterEach, describe, expect, it, vi } from "vitest";
import { chain } from "./providers";

const ALL_KEYS = [
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chain", () => {
  it("tries Groq, Mistral, Gemini, then OpenRouter when every key is present", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    expect(chain().map((t) => t.name)).toEqual([
      "groq",
      "mistral",
      "gemini",
      "openrouter",
    ]);
  });

  it("skips a tier whose key is absent", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    vi.stubEnv("MISTRAL_API_KEY", "");
    expect(chain().map((t) => t.name)).toEqual(["groq", "gemini", "openrouter"]);
  });

  it("returns an empty chain when nothing is configured", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "");
    expect(chain()).toEqual([]);
  });

  it("defaults Mistral to mistral-small-latest unless MISTRAL_MODEL overrides it", () => {
    // LanguageModel's id isn't on the public type; read it from the runtime
    // object, which carries modelId like every provider instance does.
    const idOf = (tier?: { model: unknown }) =>
      (tier?.model as unknown as { modelId: string }).modelId;
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    // Clear the override first so a host env can't leak into the default.
    vi.stubEnv("MISTRAL_MODEL", "");
    expect(idOf(chain().find((t) => t.name === "mistral"))).toBe(
      "mistral-small-latest"
    );

    vi.stubEnv("MISTRAL_MODEL", "mistral-large-latest");
    expect(idOf(chain().find((t) => t.name === "mistral"))).toBe(
      "mistral-large-latest"
    );
  });

  it("defaults OpenRouter to a free model unless OPENROUTER_MODEL overrides it", () => {
    const idOf = (tier?: { model: unknown }) =>
      (tier?.model as unknown as { modelId: string }).modelId;
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // The tier is last-resort: without credits the default must be free.
    vi.stubEnv("OPENROUTER_MODEL", "");
    expect(idOf(chain().find((t) => t.name === "openrouter"))).toContain(":free");

    vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
    expect(idOf(chain().find((t) => t.name === "openrouter"))).toBe(
      "anthropic/claude-sonnet-4.5"
    );
  });
});
