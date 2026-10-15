/**
 * A Cloud member's own AI key: theirs on this device, sent along with AI
 * requests only, and used instead of Capture's managed AI and its allowance.
 * It is never stored on the server. The provider is told by the key itself,
 * so there is nothing to choose.
 */

export const OWN_KEY_HEADER = "x-capture-ai-key";

export type OwnKeyProvider = "openrouter" | "groq" | "cerebras";

export const OWN_KEY_PROVIDER_NAMES: Record<OwnKeyProvider, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
  cerebras: "Cerebras",
};

/** The provider a key belongs to, by its prefix; null for anything else. */
export function ownKeyProvider(key: string | null | undefined): OwnKeyProvider | null {
  const value = key?.trim() ?? "";
  if (!/^[\x21-\x7e]{20,300}$/.test(value)) return null;
  if (value.startsWith("sk-or-")) return "openrouter";
  if (value.startsWith("gsk_")) return "groq";
  if (value.startsWith("csk-")) return "cerebras";
  return null;
}

/* The routes that call a model. Sync, board, account and billing routes
   never see the key. */
const AI_ROUTE = /^\/api\/(ask|cleanup|combine|distill|format|group|intention|judge|organize|sort|summarize|transcribe|untangle|wrap)(\/|$)/;
export const carriesOwnKey = (path: string) => AI_ROUTE.test(path);

/* Per account on this device, so another account signing in here does not
   inherit it. */
const storageKey = (owner: string) => `capture:own-ai-key:${owner}`;

export function readOwnKey(owner: string | null): string | null {
  if (!owner || typeof localStorage === "undefined") return null;
  try {
    const key = localStorage.getItem(storageKey(owner));
    return ownKeyProvider(key) ? key : null;
  } catch {
    return null;
  }
}

export function saveOwnKey(owner: string, key: string): OwnKeyProvider | null {
  const provider = ownKeyProvider(key);
  if (!provider) return null;
  try {
    localStorage.setItem(storageKey(owner), key.trim());
    return provider;
  } catch {
    return null;
  }
}

export function clearOwnKey(owner: string): void {
  try { localStorage.removeItem(storageKey(owner)); } catch { /* nothing kept */ }
}
