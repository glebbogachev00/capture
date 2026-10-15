import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isKeyProvider, isSubscription, providerOfKey, validModel,
  type AiConnection, type AiSettingsView, type KeyProvider,
} from "@/lib/aiProviders";
import { subscriptionModel } from "@/lib/subscriptions.server";
import type { Tier } from "@/lib/providers";
import type { OwnTier } from "@/lib/ownTier.server";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServiceClient } from "@/lib/supabase/service";

/**
 * Where a person's connected AI lives, keys included. On a self-hosted
 * Capture it is one file beside the synced board, readable by the owner only;
 * on Capture Cloud it is one row per account, encrypted with a server secret.
 * Either way every device gets the same list, and no key is ever sent back
 * to a browser.
 */

export type StoredConnection = AiConnection & { key: string };
export type StoredSettings = { connections: StoredConnection[] };

const EMPTY: StoredSettings = { connections: [] };
const MAX_CONNECTIONS = 8;

/** Keep only well-formed connections whose key matches their provider.
 * Subscriptions (no key) are kept only on a self-hosted Capture. */
export function cleanSettings(value: unknown, selfHosted = false): StoredSettings {
  const list = (value as { connections?: unknown })?.connections;
  if (!Array.isArray(list)) return EMPTY;
  const connections: StoredConnection[] = [];
  for (const item of list.slice(0, MAX_CONNECTIONS)) {
    const { id, provider, model, key } = (item ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id)) continue;
    if (isSubscription(provider)) {
      if (selfHosted && validModel(model)) connections.push({ id, provider, model, key: "", hint: "" });
      continue;
    }
    if (!isKeyProvider(provider) || !validModel(model) || typeof key !== "string") continue;
    if (providerOfKey(key) !== provider) continue;
    connections.push({ id, provider, model, key: key.trim(), hint: key.trim().slice(-4) });
  }
  return { connections };
}

export const viewOf = (settings: StoredSettings): AiSettingsView => ({
  connections: settings.connections.map(({ id, provider, model, hint }) => ({ id, provider, model, hint })),
});

/* ---------------------------- self-hosted file --------------------------- */

const localFile = () => path.join(process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data"), "ai-settings.json");

async function loadLocal(): Promise<StoredSettings> {
  try {
    return cleanSettings(JSON.parse(await readFile(localFile(), "utf8")), true);
  } catch {
    return EMPTY;
  }
}

async function saveLocal(settings: StoredSettings): Promise<void> {
  const file = localFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(settings), { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => {});
}

/* ------------------------------ Capture Cloud ---------------------------- */

const TABLE = "capture_ai_settings";

/** The 32-byte secret that seals every account's keys; null when unset. */
function secret(): Buffer | null {
  const raw = process.env.CAPTURE_AI_KEY_SECRET?.trim();
  if (!raw) return null;
  const bytes = Buffer.from(raw, "base64");
  return bytes.length === 32 ? bytes : null;
}

export function seal(settings: StoredSettings, key: Buffer): { iv: string; sealed: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(settings), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString("base64"), sealed: body.toString("base64") };
}

export function unseal(row: { iv: string; sealed: string }, key: Buffer): StoredSettings {
  const body = Buffer.from(row.sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  return cleanSettings(JSON.parse(plain.toString("utf8")));
}

function cloudService() {
  const config = getCloudConfig();
  return config?.status === "ready" ? createCloudServiceClient(config) : null;
}

/** Whether this Cloud deployment can keep members' keys at all. */
export const cloudKeysAvailable = () => !!secret() && !!cloudService();

async function loadCloud(ownerId: string): Promise<StoredSettings> {
  const key = secret();
  const client = cloudService();
  if (!key || !client) return EMPTY;
  const { data, error } = await client.from(TABLE).select("iv, sealed").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error("AI settings unavailable");
  return data ? unseal(data as { iv: string; sealed: string }, key) : EMPTY;
}

async function saveCloud(ownerId: string, settings: StoredSettings): Promise<void> {
  const key = secret();
  const client = cloudService();
  if (!key || !client) throw new Error("AI settings unavailable");
  const { error } = settings.connections.length
    ? await client.from(TABLE).upsert({ owner_id: ownerId, ...seal(settings, key), updated_at: new Date().toISOString() })
    : await client.from(TABLE).delete().eq("owner_id", ownerId);
  if (error) throw new Error("AI settings could not be saved");
}

/* --------------------------------- shared -------------------------------- */

/** A Cloud owner's settings, or the self-hosted file when there is no owner. */
export const loadAiSettings = (ownerId: string | null) => ownerId ? loadCloud(ownerId) : loadLocal();
export const saveAiSettings = (ownerId: string | null, settings: StoredSettings) =>
  ownerId ? saveCloud(ownerId, settings) : saveLocal(settings);

/** One tier per connection, in the person's order. */
export function tiersFor(settings: StoredSettings): OwnTier[] {
  return settings.connections.map(({ provider, model, key }) => ({
    name: `own-${provider}`,
    provider,
    apiKey: key,
    model: isSubscription(provider) ? subscriptionModel(provider, model) : modelFor(provider, model, key),
    ...(provider === "cerebras" ? { providerOptions: { cerebras: { reasoningEffort: "low" } } } : {}),
  }));
}

function modelFor(provider: KeyProvider, model: string, apiKey: string): Tier["model"] {
  switch (provider) {
    case "openai": return createOpenAI({ apiKey })(model);
    case "anthropic": return createAnthropic({ apiKey })(model);
    case "google": return createGoogleGenerativeAI({ apiKey })(model);
    case "openrouter": return createOpenRouter({ apiKey }).chat(model);
    case "groq": return createGroq({ apiKey })(model);
    case "cerebras": return createCerebras({ apiKey })(model);
  }
}

/* Models a key can use, for the picker. Text models only. */
const NOT_TEXT = /(embed|tts|whisper|transcribe|audio|realtime|image|dall-e|moderation|search|guard|vision-preview|veo|imagen|aqa|orpheus|playai)/i;

export async function modelsFor(provider: KeyProvider, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const get = async (url: string, headers: Record<string, string>) => {
    const response = await fetch(url, { headers, signal });
    if (!response.ok) throw Object.assign(new Error("models unavailable"), { status: response.status });
    return response.json() as Promise<Record<string, unknown>>;
  };
  const ids = (list: unknown, field = "id") =>
    Array.isArray(list) ? list.map((item) => String((item as Record<string, unknown>)[field] ?? "")).filter(Boolean) : [];
  let found: string[];
  switch (provider) {
    case "openai":
      found = ids((await get("https://api.openai.com/v1/models", { authorization: `Bearer ${apiKey}` })).data)
        .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id));
      break;
    case "anthropic":
      found = ids((await get("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" })).data);
      break;
    case "google":
      found = ((await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`, {})).models as { name?: string; supportedGenerationMethods?: string[] }[] ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => String(model.name ?? "").replace(/^models\//, ""))
        .filter((id) => id.startsWith("gemini"));
      break;
    case "openrouter":
      found = ids((await get("https://openrouter.ai/api/v1/models", { authorization: `Bearer ${apiKey}` })).data);
      break;
    case "groq":
      found = ids((await get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${apiKey}` })).data);
      break;
    case "cerebras":
      found = ids((await get("https://api.cerebras.ai/v1/models", { authorization: `Bearer ${apiKey}` })).data);
      break;
  }
  return [...new Set(found.filter((id) => validModel(id) && !NOT_TEXT.test(id)))].sort();
}
