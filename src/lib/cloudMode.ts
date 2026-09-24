type ServerEnv = Record<string, string | undefined>;

/** Disposable browser-local Preview: no Cloud and no shared self-hosted hub. */
export function isLocalTestPreview(env: ServerEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview" && env.CAPTURE_LOCAL_TEST_PREVIEW === "1";
}

/** One Cloud-mode decision for the rendered shell and every server route. */
export function isCloudEnabled(env: ServerEnv = process.env): boolean {
  // Disposable Preview builds need one coherent local mode. The override is
  // ignored by Production even if it is accidentally configured there.
  if (isLocalTestPreview(env)) return false;
  return env.CAPTURE_CLOUD === "1";
}
