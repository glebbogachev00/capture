import { describe, expect, it } from "vitest";
import { preferredFor, supportsSemanticSort } from "./routing";

describe("semantic Sort provider qualification", () => {
  it("prefers the provider verified against the source-grounded semantic contract", () => {
    expect(preferredFor("sort")).toBe("cerebras");
  });

  it("admits only providers with output-level semantic verification", () => {
    expect(supportsSemanticSort({ name: "gemini", modelId: "gemini-3.6-flash" })).toBe(false);
    expect(supportsSemanticSort({ name: "groq", modelId: "openai/gpt-oss-120b" })).toBe(false);
    expect(supportsSemanticSort({ name: "groq-2", modelId: "openai/gpt-oss-120b" })).toBe(false);
    expect(supportsSemanticSort({ name: "openrouter", modelId: "openai/gpt-5-mini" })).toBe(true);
    expect(supportsSemanticSort({ name: "gemini", modelId: "gemini-3.5-flash" })).toBe(false);
    expect(supportsSemanticSort({ name: "groq", modelId: "custom-override" })).toBe(false);
    expect(supportsSemanticSort({ name: "cerebras", modelId: "gpt-oss-120b" })).toBe(true);
    expect(supportsSemanticSort({ name: "mistral", modelId: "mistral-small-latest" })).toBe(false);
    expect(supportsSemanticSort({ name: "openrouter", modelId: "anything" })).toBe(false);
  });

  it("permits one exact OpenRouter candidate only in an opted-in Preview", () => {
    const before = {
      vercel: process.env.VERCEL_ENV,
      enabled: process.env.CAPTURE_SEMANTIC_SORT_CANDIDATE,
      groqModel: process.env.GROQ_MODEL,
      cerebrasModel: process.env.CEREBRAS_MODEL,
      model: process.env.OPENROUTER_MODEL,
      geminiModel: process.env.GEMINI_MODEL,
    };
    process.env.VERCEL_ENV = "preview";
    process.env.CAPTURE_SEMANTIC_SORT_CANDIDATE = "1";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.CEREBRAS_MODEL = "gpt-oss-120b";
    process.env.OPENROUTER_MODEL = "google/gemini-3.8-flash";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    try {
      expect(supportsSemanticSort({ name: "groq", modelId: "openai/gpt-oss-120b" })).toBe(true);
      expect(supportsSemanticSort({ name: "cerebras", modelId: "gpt-oss-120b" })).toBe(true);
      expect(supportsSemanticSort({ name: "openrouter", modelId: "google/gemini-3.8-flash" })).toBe(true);
      expect(supportsSemanticSort({ name: "gemini", modelId: "gemini-3.8-flash" })).toBe(true);
      expect(supportsSemanticSort({ name: "openrouter", modelId: "openai/gpt-5-mini" })).toBe(true);
      process.env.OPENROUTER_MODEL = "unknown/model";
      expect(supportsSemanticSort({ name: "openrouter", modelId: "unknown/model" })).toBe(false);
      process.env.VERCEL_ENV = "production";
      expect(supportsSemanticSort({ name: "groq", modelId: "openai/gpt-oss-120b" })).toBe(false);
      expect(supportsSemanticSort({ name: "cerebras", modelId: "gpt-oss-120b" })).toBe(true);
      expect(supportsSemanticSort({ name: "gemini", modelId: "gemini-3.8-flash" })).toBe(false);
      expect(supportsSemanticSort({ name: "openrouter", modelId: "google/gemini-3.8-flash" })).toBe(false);
    } finally {
      if (before.vercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = before.vercel;
      if (before.enabled === undefined) delete process.env.CAPTURE_SEMANTIC_SORT_CANDIDATE;
      else process.env.CAPTURE_SEMANTIC_SORT_CANDIDATE = before.enabled;
      if (before.groqModel === undefined) delete process.env.GROQ_MODEL;
      else process.env.GROQ_MODEL = before.groqModel;
      if (before.cerebrasModel === undefined) delete process.env.CEREBRAS_MODEL;
      else process.env.CEREBRAS_MODEL = before.cerebrasModel;
      if (before.model === undefined) delete process.env.OPENROUTER_MODEL;
      else process.env.OPENROUTER_MODEL = before.model;
      if (before.geminiModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = before.geminiModel;
    }
  });
});
