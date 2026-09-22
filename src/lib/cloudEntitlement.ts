const KEY = "capture:cloud-entitlement:v1";

type CachedCloudEntitlement = {
  owner: string;
  accessExpiresAt: number;
};

function read(storage: Storage): CachedCloudEntitlement | null {
  try {
    const raw = storage.getItem(KEY);
    const value = raw ? JSON.parse(raw) as Partial<CachedCloudEntitlement> : null;
    if (!value || typeof value.owner !== "string" ||
        typeof value.accessExpiresAt !== "number" ||
        !Number.isFinite(value.accessExpiresAt)) return null;
    return { owner: value.owner, accessExpiresAt: value.accessExpiresAt };
  } catch {
    return null;
  }
}

/** Last server-verified paid boundary for this exact owner. */
export function cloudEntitlementExpiresAt(
  owner: string,
  storage: Storage = localStorage,
): number | null {
  const cached = read(storage);
  return cached?.owner === owner ? cached.accessExpiresAt : null;
}

/** Last server-verified paid access, used only for that owner while offline. */
export function hasCloudEntitlement(
  owner: string,
  now = Date.now(),
  storage: Storage = localStorage,
): boolean {
  const accessExpiresAt = cloudEntitlementExpiresAt(owner, storage);
  return accessExpiresAt !== null && accessExpiresAt > now;
}

export function cacheCloudEntitlement(
  owner: string,
  accessExpiresAt: number,
  storage: Storage = localStorage,
): void {
  if (!owner || !Number.isFinite(accessExpiresAt)) return;
  try {
    storage.setItem(KEY, JSON.stringify({ owner, accessExpiresAt }));
  } catch {
    /* Billing remains authoritative online; blocked storage simply disables offline reuse. */
  }
}

export function clearCloudEntitlement(
  owner: string,
  storage: Storage = localStorage,
): void {
  try {
    const cached = read(storage);
    if (!cached || cached.owner === owner) storage.removeItem(KEY);
  } catch {
    /* No cached grant can be read from blocked storage. */
  }
}
