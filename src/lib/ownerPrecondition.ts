/** Defense against cookie TOCTOU and cached pre-boundary clients. This header
 * can only restrict independently authenticated identity, never grant access.
 */
export function ownerPrecondition(request: Request, verifiedUserId: string): Response | null {
  const expected = request.headers.get("X-Capture-Owner");
  const status = expected === null ? 428 : expected !== verifiedUserId ? 412 : null;
  if (status === null) return null;
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: "Account changed or client is outdated; reload and verify your account" }), {
    status,
    headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json" },
  });
}
