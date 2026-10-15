/**
 * The AI a person connects themselves: any of these providers' keys. The
 * provider is told by the key, a model is picked from what that key can
 * use, and the order of the list is the order they are tried in. Shared by
 * the Settings panel and the server; keys themselves never come back to a
 * browser, only their last four characters.
 */

export type KeyProvider = "openai" | "anthropic" | "google" | "openrouter" | "groq" | "cerebras";

export const KEY_PROVIDERS: Record<KeyProvider, { name: string; defaultModel: string }> = {
  openai: { name: "OpenAI", defaultModel: "gpt-5-mini" },
  anthropic: { name: "Claude", defaultModel: "claude-haiku-5-5" },
  google: { name: "Gemini", defaultModel: "gemini-3.6-flash" },
  openrouter: { name: "OpenRouter", defaultModel: "openai/gpt-oss-120b" },
  groq: { name: "Groq", defaultModel: "openai/gpt-oss-120b" },
  cerebras: { name: "Cerebras", defaultModel: "gpt-oss-120b" },
};

export const isKeyProvider = (value: unknown): value is KeyProvider =>
  typeof value === "string" && value in KEY_PROVIDERS;

/** The provider a key belongs to, by its prefix; null when it is not one. */
export function providerOfKey(key: string | null | undefined): KeyProvider | null {
  const value = key?.trim() ?? "";
  if (!/^[\x21-\x7e]{20,400}$/.test(value)) return null;
  if (value.startsWith("sk-or-")) return "openrouter";
  if (value.startsWith("sk-ant-")) return "anthropic";
  if (value.startsWith("gsk_")) return "groq";
  if (value.startsWith("csk-")) return "cerebras";
  if (value.startsWith("AIza")) return "google";
  if (value.startsWith("sk-")) return "openai";
  return null;
}

/** One connected AI, as the browser sees it: never the key. */
export type AiConnection = {
  id: string;
  provider: KeyProvider;
  model: string;
  /** The key's last four characters, so two keys can be told apart. */
  hint: string;
};

export type AiSettingsView = { connections: AiConnection[] };

/** A model id is a short, plain identifier. */
export const validModel = (model: unknown): model is string =>
  typeof model === "string" && /^[\w.:/@-]{1,120}$/.test(model);

/* Fast, low-cost models first when choosing a default from a provider's list. */
const QUICK = /(mini|haiku|flash|gpt-oss-120b|instant|small)/i;

/** The model to start with: the usual default if the key can use it, else
 * the first quick one it offers, else the first it offers. */
export function defaultModel(provider: KeyProvider, available: string[]): string {
  const usual = KEY_PROVIDERS[provider].defaultModel;
  if (!available.length || available.includes(usual)) return usual;
  return available.find((id) => QUICK.test(id)) ?? available[0];
}
