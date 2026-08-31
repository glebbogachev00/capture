#!/usr/bin/env node
/**
 * Probe: which AI providers still answer?
 *
 * Fires one tiny request at each configured tier and reports pass/fail with
 * the error. Never prints keys. Uses the same SDK providers and model ids as
 * src/lib/providers.ts so the result is what the app would actually get.
 *
 * Usage: node scripts/probe-credits.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";

/* Load .env.local like the app does (never print values). */
const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
try {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m || m[1] in process.env) continue;
    /* Next.js strips surrounding quotes when it loads .env.local; do the
       same so the keys sent to the providers are exactly the app's. */
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
} catch {
  /* no .env.local — all providers will be absent */
}

const key = (k) => !!process.env[k];

const tiers = [
  {
    name: "groq",
    enabled: key("GROQ_API_KEY"),
    build: async () => (await import("@ai-sdk/groq")).groq(
      process.env.GROQ_MODEL || "openai/gpt-oss-120b"
    ),
  },
  {
    name: "mistral",
    enabled: key("MISTRAL_API_KEY"),
    build: async () => (await import("@ai-sdk/mistral")).mistral(
      process.env.MISTRAL_MODEL || "mistral-small-latest"
    ),
  },
  {
    name: "gemini",
    enabled: key("GOOGLE_GENERATIVE_AI_API_KEY"),
    build: async () =>
      (await import("@ai-sdk/google")).google(
        process.env.GEMINI_MODEL || "gemini-3.6-flash"
      ),
  },
  {
    name: "openrouter",
    enabled: key("OPENROUTER_API_KEY"),
    build: async () => {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
      return openrouter.chat(
        process.env.OPENROUTER_MODEL || "minimax/minimax-m3:free"
      );
    },
  },
];

const short = (s) => {
  if (!s) return "";
  const t = String(s);
  return t.length > 240 ? t.slice(0, 240) + "…" : t;
};

let any = false;
for (const tier of tiers) {
  if (!tier.enabled) {
    console.log(`${tier.name.padEnd(11)} SKIP   no key configured`);
    continue;
  }
  any = true;
  const started = Date.now();
  try {
    const model = await tier.build();
    const { text } = await generateText({
      model,
      prompt: "Reply with exactly: ok",
      maxRetries: 0,
    });
    console.log(
      `${tier.name.padEnd(11)} OK     ${Date.now() - started}ms  → "${short(text.trim())}"`
    );
  } catch (error) {
    const msg = short(
      error?.statusText ||
        error?.message ||
        error?.toString?.() ||
        "unknown error"
    );
    const status = error?.status ? `HTTP ${error.status} ` : "";
    console.log(`${tier.name.padEnd(11)} FAIL   ${status}${msg}`);
  }
}
if (!any) console.log("No providers configured — add keys to .env.local");
