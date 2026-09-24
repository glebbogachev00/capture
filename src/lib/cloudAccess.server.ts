import "server-only";

export type CloudAccessRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function validOwnerId(userId: string): void {
  if (!userId.trim()) throw new Error("Cloud access unavailable");
}

/** The only application-side access check. The database RPC is authoritative. */
export async function hasCurrentCloudAccess(
  client: CloudAccessRpcClient,
  userId: string,
): Promise<boolean> {
  validOwnerId(userId);
  const { data, error } = await client.rpc("capture_cloud_access_current", {
    p_user_id: userId,
  });
  if (error || typeof data !== "boolean") throw new Error("Cloud access unavailable");
  return data;
}

/** Atomic current-grant state for status/timer display. */
export async function currentComplimentaryAccess(
  client: CloudAccessRpcClient,
  userId: string,
): Promise<{ current: boolean; expiresAt: string | null }> {
  validOwnerId(userId);
  const { data, error } = await client.rpc("capture_cloud_complimentary_grant_status", {
    p_user_id: userId,
  });
  const value = data as { current?: unknown; expiresAt?: unknown } | null;
  if (error || typeof value?.current !== "boolean"
      || (value.expiresAt !== null && (typeof value.expiresAt !== "string"
        || !Number.isFinite(Date.parse(value.expiresAt))))) {
    throw new Error("Cloud access unavailable");
  }
  return { current: value.current, expiresAt: value.expiresAt as string | null };
}
