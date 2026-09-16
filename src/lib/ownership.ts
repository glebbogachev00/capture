/** One owner for one document. A revoked lifetime can never be granted again.
 * The owner is a precondition, NOT authentication. Only the server chooses paths.
 */
export type CloudIdentity = { owner: string | null; expiresAt: number; offline?: boolean };
export const OFFLINE_PERMISSION_KEY = "capture:offline-permission:v1";
/** Explicit device grant, independent of online verification expiry.
 * Old expiry-only grants are not silently upgraded to persistent consent. */
export function resumeOfflineIdentity(): CloudIdentity | null {
  try {
    assertLogoutCompleted();
    const raw = localStorage.getItem(OFFLINE_PERMISSION_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value.owner !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.owner) ||
        value.policy !== "until-revoked") return null;
    return { owner: value.owner, expiresAt: 0, offline: true };
  } catch { return null; }
}
export const OWNER_HEADER = "X-Capture-Owner";
export const AUTH_TRANSITION_KEY = "capture:auth-transition";
export const LOGOUT_PENDING_KEY = "capture:logout-pending";
export const isAuthTransition = (event: StorageEvent) => event.key === null || event.key === AUTH_TRANSITION_KEY || event.key === LOGOUT_PENDING_KEY || /^sb-.*auth-token/.test(event.key);
type Network = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class OwnershipLifetime {
  readonly cloud: boolean;
  readonly owner: string | null;
  readonly database: string;
  /** Online authority only; renewed exclusively by same-account verification. */
  expiresAt: number;
  readonly controller = new AbortController();
  private state: "active" | "offline" | "checking" | "revoked" = "active";
  // Rendered authority and pending verification are separate: polls must not
  // hide the board, but must still hold requests and deny new disclosures.
  private verifying = false;
  private get verificationPending() { return this.verifying || this.state === "checking"; }
  private listeners = new Set<() => void>();
  private importGeneration: string | null = null;
  private imports = 0;
  private get importKey() { return `capture:local-import:${this.owner}`; }

  constructor(identity?: CloudIdentity) {
    this.cloud = identity !== undefined;
    if (identity?.offline) this.state = "offline";
    this.owner = identity?.owner ?? null;
    this.expiresAt = identity?.expiresAt ?? Infinity;
    if (this.cloud && this.owner && typeof localStorage !== "undefined") this.importGeneration = localStorage.getItem(this.importKey);
    this.database = !identity ? "capture" : identity.owner === null
      ? "capture-cloud-v1-anonymous" : `capture-cloud-v1-account-${encodeURIComponent(identity.owner)}`;
  }
  beginImport() {
    this.assertOnline();
    if (!this.cloud || !this.owner) throw new Error("Verified account required");
    if (this.imports++ > 0) return;
    const generation = crypto.randomUUID();
    localStorage.setItem(this.importKey, generation);
    this.importGeneration = generation;
  }
  finishImport() {
    if (--this.imports > 0 || this.state === "revoked") return;
    // Also retire tabs that opened while the import was in progress. No lock
    // survives a crashed document; the IDB receipt is the durable retry guard.
    if (localStorage.getItem(this.importKey) !== this.importGeneration) return;
    const generation = crypto.randomUUID();
    localStorage.setItem(this.importKey, generation);
    this.importGeneration = generation;
  }
  keepOffline(enabled: boolean) {
    this.assert();
    if (enabled) {
      this.assertOnline();
      if (!this.cloud || !this.owner) throw new Error("Verify your account online first");
      localStorage.setItem(OFFLINE_PERMISSION_KEY, JSON.stringify({ owner: this.owner, policy: "until-revoked" }));
    } else {
      localStorage.removeItem(OFFLINE_PERMISSION_KEY);
      if (this.state === "offline") this.revoke();
    }
    this.notify();
  }
  private get localGrant() { return !!this.owner && resumeOfflineIdentity()?.owner === this.owner; }
  get active() { return this.state !== "revoked" && (Date.now() < this.expiresAt || this.localGrant); }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private notify() { for (const fn of this.listeners) fn(); }
  private checkImportGeneration() {
    if (this.cloud && this.owner && typeof localStorage !== "undefined" && localStorage.getItem(this.importKey) !== this.importGeneration) this.retire();
  }
  assert() {
    this.checkImportGeneration();
    if (this.cloud && pendingLogout()) this.revoke();
    if (this.state === "offline" && !this.localGrant) this.revoke();
    if (Date.now() >= this.expiresAt && this.state !== "revoked") {
      if (!this.localGrant) this.revoke();
      else if (this.state === "active") { this.state = "offline"; this.notify(); }
    }
    if (!this.active) throw new DOMException("Account lifetime ended; reload to verify identity", "AbortError");
  }
  /** Local persistence may finish while checking; disclosure may not. */
  assertDisclosure = () => {
    this.assert();
    if (this.verificationPending || (this.state !== "active" && this.state !== "offline")) throw new DOMException("Account verification pending", "AbortError");
  };
  assertOnline = () => {
    this.assert();
    if (this.cloud && (this.verificationPending || this.state !== "active" || Date.now() >= this.expiresAt || (typeof navigator !== "undefined" && !navigator.onLine)))
      throw new DOMException("Verify your account online before using Cloud or AI", "AbortError");
  };
  revoke = () => {
    if (this.state === "revoked") return;
    clearOfflinePermission(this.owner);
    this.retire();
  };
  /** A stale document must stop, but import is not withdrawal of device consent. */
  private retire = () => {
    if (this.state === "revoked") return;
    this.state = "revoked";
    this.controller.abort();
    this.notify();
  };
  private checking() {
    if (this.state === "revoked") return;
    this.state = "checking";
    this.notify();
  }

  /** Every revalidation holds network work, not local writes to this immutable
   * namespace. View retention is presentation only, never network authority. */
  private ready(): Promise<void> {
    this.assert();
    if (!this.verificationPending) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe(() => {
        if (this.verificationPending && this.state !== "revoked") return;
        unsubscribe();
        try { this.assert(); resolve(); } catch (error) { reject(error); }
      });
    });
  }

  async request(input: RequestInfo | URL, init?: RequestInit, network: Network = globalThis.fetch): Promise<Response> {
    this.assert();
    if (!this.cloud) return network(input, init);
    if (this.verificationPending) await this.ready();
    this.assertOnline();
    const url = String(input instanceof Request ? input.url : input);
    const base = typeof location === "undefined" ? "http://localhost" : location.href;
    const target = new URL(url, base);
    const path = target.pathname;
    const api = target.origin === new URL(base).origin && path.startsWith("/api/");
    if (this.owner === null && (/^\/api\/(sync|img)(\/|$|\?)/.test(path) || path === "/api/cloud/board")) {
      throw new DOMException("Anonymous board is local only", "AbortError");
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (api) headers.set(OWNER_HEADER, this.owner ?? "anonymous");
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? AbortSignal.any([callerSignal, this.controller.signal]) : this.controller.signal;
    this.assert();
    const response = await network(input, { ...init, headers, signal, cache: "no-store" });
    // A delayed rejection belongs to the requesting document, not its successor.
    this.assert();
    if (response.status === 401 || response.status === 412 || response.status === 428) this.revoke();
    if (this.verificationPending) await this.ready();
    this.assertOnline();
    // Fetch resolution is not the last await: a delayed body must not revive work.
    return new Proxy(response, {
      get: (target, prop) => {
        if (["json", "text", "blob", "arrayBuffer", "formData"].includes(String(prop))) {
          return async () => {
            if (this.verificationPending) await this.ready();
            this.assertOnline();
            const result = await (target[prop as "json"] as () => Promise<unknown>).call(target);
            if (this.verificationPending) await this.ready();
            this.assertOnline();
            return result;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  /** Hide while away/resuming; routine polls retain only the current lease. */
  watch(verify: () => Promise<CloudIdentity>): () => void {
    if (!this.cloud) return () => {};
    let stopped = false;
    let pending = false;
    let expiry: ReturnType<typeof setTimeout>;
    const scheduleExpiry = () => {
      clearTimeout(expiry);
      if (this.state === "offline") return;
      expiry = setTimeout(() => { try { this.assert(); } catch { /* assert revokes */ } },
        Math.max(0, Math.min(this.expiresAt - Date.now(), 2_147_483_647)));
    };
    const check = async () => {
      if (stopped || this.state === "revoked") return;
      // A still-visible, verified lease keeps local input/edit/focus uninterrupted.
      // Pending verification independently holds requests and denies disclosures.
      // Never reopen a hidden/resuming or offline view on an ordinary signal.
      try { this.assert(); } catch { return; }
      if (document.visibilityState === "hidden" || this.state !== "active" || Date.now() >= this.expiresAt) this.checking();
      if (pending) return;
      pending = true;
      this.verifying = true;
      try {
        const identity = await verify();
        if (stopped) return;
        // A delayed timer must not let a response revive an expired lease.
        this.assert();
        if (this.state as string === "revoked") return;
        if (identity.offline || identity.owner !== this.owner || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= Date.now() || pendingLogout()) this.revoke();
        else {
          this.expiresAt = identity.expiresAt;
          if (document.visibilityState !== "hidden") { this.state = "active"; this.notify(); }
          scheduleExpiry();
        }
      } catch (error) {
        if (stopped) return;
        this.checkImportGeneration();
        if (this.state as string === "revoked") return;
        if (error instanceof OfflineTransportError && resumeOfflineIdentity()?.owner === this.owner && this.active) {
          this.state = "offline"; this.notify();
        } else this.revoke();
      }
      finally {
        pending = false;
        this.verifying = false;
        // Same-owner polls keep the same render snapshot, but must wake waiters.
        this.notify();
      }
    };
    const foreground = () => { void check(); };
    const pageshow = (event: PageTransitionEvent) => {
      // BFCache restoration is a resume, not an ordinary visible-page signal.
      if (event.persisted) this.checking();
      foreground();
    };
    const visible = () => { if (document.visibilityState === "hidden") this.checking(); else void check(); };
    const storage = (event: StorageEvent) => {
      if (isAuthTransition(event)) this.revoke();
      else if (event.key === this.importKey) this.retire();
      if (event.key === OFFLINE_PERMISSION_KEY && resumeOfflineIdentity()?.owner !== this.owner && this.state === "offline") this.revoke();
    };
    const offline = () => {
      if (this.state === "revoked") return;
      if (resumeOfflineIdentity()?.owner === this.owner && this.active) { this.state = "offline"; this.notify(); }
      else this.revoke();
    };
    scheduleExpiry();
    window.addEventListener("storage", storage);
    window.addEventListener("online", foreground);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", foreground);
    window.addEventListener("pageshow", pageshow);
    document.addEventListener("visibilitychange", visible);
    // SSR-cookie auth can transition without localStorage (callback/another tab).
    const poll = setInterval(() => { if (document.visibilityState !== "hidden") void check(); }, 30_000);
    return () => {
      stopped = true;
      clearTimeout(expiry); clearInterval(poll);
      window.removeEventListener("storage", storage);
      window.removeEventListener("online", foreground);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("pageshow", pageshow);
      document.removeEventListener("visibilitychange", visible);
    };
  }
}

let documentLifetime: OwnershipLifetime | undefined;
/** Called by entry before ANY board child mounts. Never hot-switch a document. */
export function installDocumentLifetime(identity?: CloudIdentity): OwnershipLifetime {
  assertLogoutCompleted();
  if (documentLifetime) {
    if (documentLifetime.cloud !== (identity !== undefined) || documentLifetime.owner !== (identity?.owner ?? null)) {
      documentLifetime.revoke();
      throw new Error("Identity changed; a new document is required");
    }
    documentLifetime.assert();
    return documentLifetime;
  }
  return documentLifetime = new OwnershipLifetime(identity);
}
// Self-hosted consumers/tests retain the original contract. Cloud entry always
// installs its verified lifetime before mounting any consumer.
export function getDocumentLifetime() { return documentLifetime ?? installDocumentLifetime(); }
export const ownedFetch: Network = (input, init) => getDocumentLifetime().request(input, init);

export function announceAuthTransition() {
  clearOfflinePermission();
  documentLifetime?.revoke();
  try { localStorage.setItem(AUTH_TRANSITION_KEY, crypto.randomUUID()); } catch { /* resume checks still apply */ }
}

// The durable marker is not account data. Never remove boards/images on logout.
// Storage failure is fail-closed: without a durable interlock old cookies must
// not grant a fresh Cloud document after an unsuccessful logout.
let logoutWorking = false;
const LOGOUT_EVENT = "capture:logout-state";
function pendingLogout(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(LOGOUT_PENDING_KEY); } catch { return "storage-unavailable"; }
}
export function logoutSnapshot(): "" | "working" | "pending" {
  return logoutWorking ? "working" : pendingLogout() ? "pending" : "";
}
export function subscribeLogout(fn: () => void) {
  window.addEventListener(LOGOUT_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => { window.removeEventListener(LOGOUT_EVENT, fn); window.removeEventListener("storage", fn); };
}
function notifyLogout() { window.dispatchEvent(new Event(LOGOUT_EVENT)); }
function assertLogoutCompleted() {
  if (pendingLogout()) throw new Error("Logout has not completed. Retry logout or sign in explicitly.");
}
/** Call only after explicit authentication succeeds, never on cookie discovery. */
export function completeExplicitAuthentication() {
  localStorage.removeItem(LOGOUT_PENDING_KEY);
  announceAuthTransition();
  notifyLogout();
}
export async function logoutAndNavigate(): Promise<void> {
  if (logoutWorking) return;
  logoutWorking = true;
  const token = crypto.randomUUID();
  try {
    // Must land before the request, and before listeners can unmount the board.
    localStorage.setItem(LOGOUT_PENDING_KEY, token);
    announceAuthTransition();
    notifyLogout();
    const response = await globalThis.fetch("/api/logout", { method: "POST", cache: "no-store" });
    if (!response.ok) throw new Error("Logout has not completed");
    // A later login/logout in another tab supersedes this attempt.
    if (pendingLogout() !== token) return;
    localStorage.removeItem(LOGOUT_PENDING_KEY);
    announceAuthTransition();
    window.location.href = "/login";
  } catch {
    documentLifetime?.revoke();
    // Leave the interlock and hidden screen in place; the boundary owns retry UI.
  } finally {
    logoutWorking = false;
    notifyLogout();
  }
}

function clearOfflinePermission(owner?: string | null) {
  try {
    const raw = localStorage.getItem(OFFLINE_PERMISSION_KEY);
    if (owner === undefined || (raw && JSON.parse(raw).owner === owner)) localStorage.removeItem(OFFLINE_PERMISSION_KEY);
  } catch { /* inaccessible storage cannot grant offline access */ }
}
export class OfflineTransportError extends Error {}
class SupersededIdentityError extends Error {}
// One deadline covers headers AND body; abort alone is not a bounded promise.
export const IDENTITY_TIMEOUT_MS = 4000;
/** A cached local permission is never a server identity. */
export async function openCloudIdentity(): Promise<CloudIdentity> {
  const prior = resumeOfflineIdentity();
  const permission = localStorage.getItem(OFFLINE_PERMISSION_KEY);
  const unchanged = () => localStorage.getItem(OFFLINE_PERMISSION_KEY) === permission;
  try {
    const identity = await verifyCloudIdentity();
    if (!unchanged()) throw new SupersededIdentityError("Device permission changed during verification");
    if (resumeOfflineIdentity()?.owner !== identity.owner) clearOfflinePermission();
    return identity;
  } catch (error) {
    // A late result must neither adopt nor delete a successor's device grant.
    if (!unchanged() || error instanceof SupersededIdentityError) throw error;
    if (error instanceof OfflineTransportError) {
      const offline = resumeOfflineIdentity();
      if (prior && offline?.owner === prior.owner) return offline;
    } else clearOfflinePermission();
    throw error;
  }
}
export async function verifyCloudIdentity(): Promise<CloudIdentity> {
  assertLogoutCompleted();
  const transition = localStorage.getItem(AUTH_TRANSITION_KEY);
  let superseded = false;
  const onStorage = (event: StorageEvent) => { if (isAuthTransition(event)) superseded = true; };
  window.addEventListener("storage", onStorage);
  const assertCurrent = () => {
    if (superseded || localStorage.getItem(AUTH_TRANSITION_KEY) !== transition) throw new SupersededIdentityError("Account changed during verification");
    assertLogoutCompleted();
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new OfflineTransportError("Account verification transport timed out"));
      controller.abort();
    }, IDENTITY_TIMEOUT_MS);
  });
  // Only fetch/body transport exceptions qualify. HTTP and schema/JSON failures
  // remain fail-closed, regardless of the navigator connectivity hint.
  const transport = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      if (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) throw new OfflineTransportError("Account verification transport unavailable");
      throw error;
    }
  };
  try {
    const response = await transport(() => globalThis.fetch("/api/cloud/identity", { cache: "no-store", signal: controller.signal }));
    assertCurrent();
    if (!response.ok) throw new Error("Could not verify your account. Reload to retry.");
    const value = await transport(() => response.json());
    assertCurrent();
    if (!value || !(value.owner === null || (typeof value.owner === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value.owner))) ||
        typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
      throw new Error("Invalid account verification. Reload to retry.");
    }
    return { owner: value.owner, expiresAt: value.expiresAt };
  } catch (error) {
    assertCurrent();
    throw error;
  } finally {
    clearTimeout(timer);
    window.removeEventListener("storage", onStorage);
  }
}
