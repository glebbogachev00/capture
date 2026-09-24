type ClaimsClient = {
  auth: { getClaims: () => Promise<{ data: { claims?: { sub?: unknown } } | null; error: unknown }> };
};

export async function identityFromClaims(client: ClaimsClient): Promise<{ userId: string } | null> {
  try {
    const result = await client.auth.getClaims();
    if (result.error) return null;
    const sub = result.data?.claims?.sub;
    return typeof sub === "string" && sub.trim() ? { userId: sub } : null;
  } catch {
    return null;
  }
}
