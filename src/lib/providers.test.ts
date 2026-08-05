import { afterEach, describe, expect, it, vi } from "vitest";
import { chain } from "./providers";

const ALL_KEYS = [
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chain", () => {
  it("tries Groq, Cerebras, Gemini, then OpenRouter when every key is present", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    expect(chain().map((t) => t.name)).toEqual([
      "groq",
      "cerebras",
      "gemini",
      "openrouter",
    ]);
  });

  it("skips a tier whose key is absent", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    vi.stubEnv("CEREBRAS_API_KEY", "");
    expect(chain().map((t) => t.name)).toEqual(["groq", "gemini", "openrouter"]);
  });

  it("returns an empty chain when nothing is configured", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "");
    expect(chain()).toEqual([]);
  });

  it("defaults Cerebras to gpt-oss-120b unless CEREBRAS_MODEL overrides it", () => {
    // LanguageModel's id isn't on the public type; read it from the runtime
    // object, which carries modelId like every provider instance does.
    const idOf = (tier?: { model: unknown }) =>
      (tier?.model as unknown as { modelId: string }).modelId;
    vi.stubEnv("CEREBRAS_API_KEY", "test-key");
    // Clear the override first so a host env can't leak into the default.
    vi.stubEnv("CEREBRAS_MODEL", "");
    expect(idOf(chain().find((t) => t.name === "cerebras"))).toBe("gpt-oss-120b");

    vi.stubEnv("CEREBRAS_MODEL", "qwen-3-32b");
    expect(idOf(chain().find((t) => t.name === "cerebras"))).toBe("qwen-3-32b");
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
