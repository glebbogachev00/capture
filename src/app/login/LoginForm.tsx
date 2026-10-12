"use client";

import { useT } from "@/components/LocaleProvider";
import { useSearchParams } from "next/navigation";
import { completeExplicitAuthentication } from "@/lib/ownership";
import { safeNext } from "@/lib/safeNext";
import { useState } from "react";

export function LoginForm() {
  const t = useT();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    /* Read the field directly instead of trusting React state: iOS autofill
       fills the input without firing onChange, which used to strand the
       page with a value on screen the submit couldn't see. */
    const field = (e.target as HTMLFormElement).elements.namedItem(
      "password"
    ) as HTMLInputElement | null;
    const value = field?.value ?? password;
    if (!value) {
      setErr(t("Enter the password"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: value }),
      });
      if (res.ok) {
        completeExplicitAuthentication();
        /* A full load so the middleware sees the new cookie — and only ever
           to a path inside this app. `next` arrives in the URL, so anyone
           can choose it. */
        window.location.href = safeNext(params.get("next"));
        return;
      }
      const body = await res.json().catch(() => ({})) as { error?: string };
      setErr(res.status === 429 || body.error === "rate limited" ? t("Too many attempts — wait a minute and try again.") : t("Wrong password"));
    } catch {
      setErr(t("Couldn't reach the server."));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        name="password"
        placeholder={t("Password")}
        aria-label={t("Password")}
        autoFocus
      />
      <button className="capture-btn" type="submit" disabled={busy}>
        {busy ? "…" : t("Open")}
      </button>
      {err && <div className="err">{err}</div>}
    </form>
  );
}
