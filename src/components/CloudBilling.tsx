"use client";

import { useT } from "@/components/LocaleProvider";
import { t as tr } from "@/lib/i18n";
import { deviceLocale } from "@/lib/i18n";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PolarPlan } from "@/lib/polar";
import type { PublicCloudSubscription } from "@/lib/cloudSubscription";
import { cloudCheckoutHandoff, safePolarDestination } from "@/lib/cloudCheckoutClient";
import { hasCheckoutReturnState } from "@/lib/urlPrivacy";
import { getDocumentLifetime } from "@/lib/ownership";
import { OWN_KEY_PROVIDER_NAMES, clearOwnKey, ownKeyProvider, readOwnKey, saveOwnKey } from "@/lib/ownAiKey";

export { safePolarDestination } from "@/lib/cloudCheckoutClient";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function fetchCloudSubscription(
  fetcher: typeof fetch = fetch,
): Promise<{ response: Response; subscription: PublicCloudSubscription | null }> {
  const response = await fetcher("/api/cloud/subscription", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await responseBody(response);
  const subscription = response.ok && (body.tier === "free" || body.tier === "cloud")
    ? body as PublicCloudSubscription
    : null;
  return { response, subscription };
}

/* The server's own wording is English; a Russian reader gets ours. */
function messageFrom(body: Record<string, unknown>, fallback: string): string {
  return deviceLocale() !== "ru" && typeof body.error === "string" && body.error.length <= 160 ? body.error : fallback;
}

export function CloudCheckoutButton({
  plan,
  children,
  autoStart = false,
}: {
  plan: PolarPlan;
  children: React.ReactNode;
  autoStart?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const busyRef = useRef(false);
  const startedRef = useRef(false);
  const cloudHandoff = cloudCheckoutHandoff(plan);

  const begin = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/cloud/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        const resumePath = `/pricing?checkout=${plan}`;
        router.push(`/login?next=${encodeURIComponent(resumePath)}`);
        return;
      }
      if (!response.ok) {
        setNote(messageFrom(body, tr("Checkout is unavailable right now.")));
        return;
      }
      const destination = safePolarDestination(body.url);
      if (!destination) {
        setNote(tr("Checkout returned an invalid destination."));
        return;
      }
      window.location.assign(destination);
    } catch {
      setNote(tr("Checkout is unavailable right now."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [plan, router]);

  useEffect(() => {
    if (!autoStart || cloudHandoff || startedRef.current) return;
    startedRef.current = true;
    void begin();
  }, [autoStart, begin, cloudHandoff]);

  if (cloudHandoff) {
    return (
      <div className="cloud-action">
        <a className="capture-btn cloud-checkout-btn" href={cloudHandoff}>
          {children}
        </a>
      </div>
    );
  }

  return (
    <div className="cloud-action">
      <button className="capture-btn cloud-checkout-btn" onClick={() => void begin()} disabled={busy}>
        {busy ? t("Opening checkout…") : children}
      </button>
      {note && <p className="cloud-action-note" role="status">{note}</p>}
    </div>
  );
}

export function CloudAccountPanel() {
  const t = useT();
  const [subscription, setSubscription] = useState<PublicCloudSubscription | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "unavailable">("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    void fetchCloudSubscription()
      .then((result) => {
        if (stopped) return;
        if (result.response.status === 401) {
          setState("signed-out");
          return;
        }
        if (!result.response.ok || !result.subscription) {
          setState("unavailable");
          return;
        }
        setSubscription(result.subscription);
        setState("ready");
      })
      .catch(() => {
        if (!stopped) setState("unavailable");
      });
    return () => {
      stopped = true;
    };
  }, []);

  const openPortal = async () => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/cloud/portal", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await responseBody(response);
      if (!response.ok) {
        setNote(messageFrom(body, t("The subscription portal is unavailable right now.")));
        return;
      }
      const destination = safePolarDestination(body.url);
      if (!destination) {
        setNote(t("The subscription portal returned an invalid destination."));
        return;
      }
      window.location.assign(destination);
    } catch {
      setNote(t("The subscription portal is unavailable right now."));
    } finally {
      setBusy(false);
    }
  };

  const retryStatus = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await fetchCloudSubscription();
      if (!result.subscription) throw new Error("status unavailable");
      setSubscription(result.subscription);
    } catch {
      setNote(t("Cloud status is unavailable. Your subscription has not been changed."));
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return <p className="settings-copy">{t("Checking your Cloud access…")}</p>;
  if (state === "unavailable") return <p className="settings-copy">{t("Cloud billing is not available on this installation.")}</p>;
  if (state === "signed-out") {
    return <Link className="ghost cloud-inline-link" href="/login?next=%2Fapp">{t("Sign in to Capture Cloud")}</Link>;
  }
  if (!subscription || (subscription.tier === "free" && !subscription.reconciliationRequired)) {
    return (
      <div className="settings-group cloud-account-copy">
        <p className="settings-copy">{t("Your board is local. Cloud adds recovery and access across devices.")}</p>
        <Link className="capture-btn cloud-inline-link" href="/pricing">{t("See Capture Cloud")}</Link>
      </div>
    );
  }

  const end = subscription.currentPeriodEnd
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(subscription.currentPeriodEnd))
    : null;
  return (
    <div className="settings-group cloud-account-copy">
      <p className="settings-copy">
        {subscription.reconciliationRequired
          ? t("Cloud access is awaiting billing confirmation. Your existing subscription may still be charging; do not purchase again.")
          : subscription.accessSource === "complimentary"
            ? t("Complimentary Capture Cloud is active.")
          : subscription.cancelAtPeriodEnd && end
            ? (subscription.plan === "yearly" ? t("Yearly Cloud is active until {end}", { end }) : t("Monthly Cloud is active until {end}", { end }))
            : (subscription.plan === "yearly" ? t("Yearly Cloud is active.") : t("Monthly Cloud is active."))}
      </p>
      {subscription.canManageBilling !== false && (
        <button className="ghost" onClick={() => void openPortal()} disabled={busy}>
          {busy ? t("Opening…") : t("Manage subscription")}
        </button>
      )}
      {subscription.reconciliationRequired && <button className="ghost" onClick={() => void retryStatus()} disabled={busy}>{t("Retry status")}</button>}
      {note && <p className="cloud-action-note" role="status">{note}</p>}
      <OwnAiKey />
    </div>
  );
}

/** One optional field: a member's own AI key, kept on this device only. */
function OwnAiKey() {
  const t = useT();
  const owner = getDocumentLifetime().owner;
  const [saved, setSaved] = useState(() => ownKeyProvider(readOwnKey(owner)));
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState(false);
  if (!owner) return null;
  const save = () => {
    const provider = saveOwnKey(owner, draft);
    setRefused(!provider);
    if (provider) {
      setSaved(provider);
      setDraft("");
    }
  };
  return (
    <div className="own-key">
      <p className="settings-copy">
        {saved
          ? t("Using your own {provider} key on this device. Cloud's AI allowance doesn't apply.", { provider: OWN_KEY_PROVIDER_NAMES[saved] })
          : t("Need more AI than Cloud includes? Add your own OpenRouter, Groq or Cerebras key. It stays on this device.")}
      </p>
      {saved ? (
        <button className="ghost" onClick={() => { clearOwnKey(owner); setSaved(null); }}>{t("Remove key")}</button>
      ) : (
        <div className="own-key-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("Your AI key")}
            aria-label={t("Your AI key")}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setRefused(false); }}
          />
          <button className="ghost" onClick={save} disabled={!draft.trim()}>{t("Save")}</button>
        </div>
      )}
      {refused && <p className="cloud-action-note" role="status">{t("That isn't an OpenRouter, Groq or Cerebras key.")}</p>}
    </div>
  );
}

export function CheckoutReturnNotice() {
  const t = useT();
  const searchParams = useSearchParams();
  // Snapshot during render. If Analytics hydrated first, its history-state
  // handoff contains only a boolean marker, never the checkout identifier.
  const [checkoutReturn] = useState(() => searchParams.has("checkout_id")
    || (typeof window !== "undefined" && hasCheckoutReturnState(window.history.state)));
  const [state, setState] = useState<"confirming" | "active" | "delayed">("confirming");

  useEffect(() => {
    if (!checkoutReturn) return;
    let stopped = false;
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      try {
        const result = await fetchCloudSubscription();
        if (!stopped && result.subscription?.tier === "cloud") {
          setState("active");
          return;
        }
      } catch {
        // The signed webhook remains authoritative; a failed poll grants nothing.
      }
      if (stopped) return;
      if (attempts >= 8) setState("delayed");
      else window.setTimeout(() => void check(), 1_500);
    };
    void check();
    return () => { stopped = true; };
  }, [checkoutReturn]);

  if (!checkoutReturn) return null;
  return (
    <div className={`cloud-return ${state}`} role="status">
      <strong>{state === "active" ? t("Capture Cloud is active.") : state === "delayed" ? t("Cloud access is not confirmed.") : t("Checking checkout status…")}</strong>
      <span>
        {state === "active"
          ? t("This board can now recover across your devices.")
          : state === "delayed"
            ? t("Check your subscription status in Settings.")
            : t("Confirming your Cloud access…")}
      </span>
    </div>
  );
}
