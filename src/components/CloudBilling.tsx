"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PolarPlan } from "@/lib/polar";
import type { PublicCloudSubscription } from "@/lib/cloudSubscription";
import { safePolarDestination } from "@/lib/cloudCheckoutClient";

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

function messageFrom(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error.length <= 160 ? body.error : fallback;
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const busyRef = useRef(false);
  const startedRef = useRef(false);

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
        setNote(messageFrom(body, "Checkout is unavailable right now."));
        return;
      }
      const destination = safePolarDestination(body.url);
      if (!destination) {
        setNote("Checkout returned an invalid destination.");
        return;
      }
      window.location.assign(destination);
    } catch {
      setNote("Checkout is unavailable right now.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [plan, router]);

  useEffect(() => {
    if (!autoStart || startedRef.current) return;
    startedRef.current = true;
    void begin();
  }, [autoStart, begin]);

  return (
    <div className="cloud-action">
      <button className="capture-btn cloud-checkout-btn" onClick={() => void begin()} disabled={busy}>
        {busy ? "Opening checkout…" : children}
      </button>
      {note && <p className="cloud-action-note" role="status">{note}</p>}
    </div>
  );
}

export function CloudAccountPanel() {
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
        setNote(messageFrom(body, "The subscription portal is unavailable right now."));
        return;
      }
      const destination = safePolarDestination(body.url);
      if (!destination) {
        setNote("The subscription portal returned an invalid destination.");
        return;
      }
      window.location.assign(destination);
    } catch {
      setNote("The subscription portal is unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return <p className="settings-copy">Checking your Cloud access…</p>;
  if (state === "unavailable") return <p className="settings-copy">Cloud billing is not available on this installation.</p>;
  if (state === "signed-out") {
    return <Link className="ghost cloud-inline-link" href="/login?next=%2Fapp">Sign in to Capture Cloud</Link>;
  }
  if (!subscription || subscription.tier === "free") {
    return (
      <div className="settings-group cloud-account-copy">
        <p className="settings-copy">Your board is local. Cloud adds recovery and access across devices.</p>
        <Link className="capture-btn cloud-inline-link" href="/pricing">See Capture Cloud</Link>
      </div>
    );
  }

  const end = subscription.currentPeriodEnd
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(subscription.currentPeriodEnd))
    : null;
  return (
    <div className="settings-group cloud-account-copy">
      <p className="settings-copy">
        {subscription.plan === "yearly" ? "Yearly" : "Monthly"} Cloud is active
        {subscription.cancelAtPeriodEnd && end ? ` until ${end}` : "."}
      </p>
      <button className="ghost" onClick={() => void openPortal()} disabled={busy}>
        {busy ? "Opening…" : "Manage subscription"}
      </button>
      {note && <p className="cloud-action-note" role="status">{note}</p>}
    </div>
  );
}

export function CheckoutReturnNotice() {
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const [state, setState] = useState<"confirming" | "active" | "delayed">("confirming");

  useEffect(() => {
    if (!checkoutId) return;
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
  }, [checkoutId]);

  if (!checkoutId) return null;
  return (
    <div className={`cloud-return ${state}`} role="status">
      <strong>{state === "active" ? "Capture Cloud is active." : "Payment received."}</strong>
      <span>
        {state === "active"
          ? "This board can now recover across your devices."
          : state === "delayed"
            ? "Access is still being confirmed. Your payment is not used as proof on this page."
            : "Confirming your Cloud access…"}
      </span>
    </div>
  );
}
