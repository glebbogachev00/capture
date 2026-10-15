/**
 * A key an earlier version kept on one device only. Settings moves it into
 * the synced AI models list once, then forgets it here.
 */
const storageKey = (owner: string) => `capture:own-ai-key:${owner}`;

export function readLegacyOwnKey(owner: string | null): string | null {
  if (!owner || typeof localStorage === "undefined") return null;
  try { return localStorage.getItem(storageKey(owner)); } catch { return null; }
}

export function clearLegacyOwnKey(owner: string): void {
  try { localStorage.removeItem(storageKey(owner)); } catch { /* nothing kept */ }
}
