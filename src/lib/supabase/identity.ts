type ClaimsClient = {
  auth: { getClaims: () => Promise<{ data: { claims?: { sub?: unknown } } | null; error: unknown }> };
};

function bounded<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export async function identityFromClaims(
  client: ClaimsClient,
  signal?: AbortSignal,
): Promise<{ userId: string } | null> {
  try {
    const result = await bounded(client.auth.getClaims(), signal);
    if (result.error) return null;
    const sub = result.data?.claims?.sub;
    return typeof sub === "string" && sub.trim() ? { userId: sub } : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
