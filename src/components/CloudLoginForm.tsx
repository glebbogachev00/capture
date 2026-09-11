"use client";

import { useMemo, useState } from "react";
import type { CloudConfig } from "@/lib/supabase/config";
import { createCloudBrowserClient } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/safeNext";

type Props = {
  config: CloudConfig;
  nextPath?: string | null;
  onAuthenticated?: () => void;
};

export function CloudLoginForm({ config, nextPath, onAuthenticated }: Props) {
  const client = useMemo(() => createCloudBrowserClient(config), [config]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("Enter your email address.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { error: authError } = await client.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true },
      });

      if (authError) {
        setError(authError.message || "We couldn't send the code. Try again.");
        return;
      }

      setEmail(cleanEmail);
      setStage("code");
    } catch {
      setError("We couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    const cleanCode = code.trim();
    if (!/^\d{6,10}$/.test(cleanCode)) {
      setError("Enter the verification code from the email.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { error: authError } = await client.auth.verifyOtp({
        email,
        token: cleanCode,
        type: "email",
      });

      if (authError) {
        setError(authError.message || "That code didn't work. Request a new one.");
        return;
      }

      if (onAuthenticated) {
        onAuthenticated();
        return;
      }
      window.location.href = safeNext(nextPath || "/app");
    } catch {
      setError("We couldn't verify that code. Request a new one.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "code") {
    return (
      <div className="cloud-login">
        <div className="cloud-login-copy">
          <p className="cloud-login-kicker">Check your email</p>
          <h1>Your code is waiting.</h1>
          <p>Enter the code sent to {email}.</p>
        </div>
        <form onSubmit={verifyCode}>
          <label htmlFor="capture-code">Verification code</label>
          <input
            id="capture-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            maxLength={10}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Enter your code"
            autoFocus
          />
          <button className="capture-btn" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Open Capture"}
          </button>
          <button
            className="cloud-login-link"
            type="button"
            onClick={() => {
              setStage("email");
              setCode("");
              setError("");
            }}
          >
            Use a different email
          </button>
          {error && <div className="err" role="alert">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="cloud-login">
      <div className="cloud-login-copy">
        <p className="cloud-login-kicker">Capture Cloud</p>
        <h1>Your thoughts, wherever you open Capture.</h1>
        <p>Enter your email. We’ll send a verification code, so there is no password to remember and no link to chase.</p>
      </div>
      <form onSubmit={sendCode}>
        <label htmlFor="capture-email">Email</label>
        <input
          id="capture-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoFocus
        />
        <button className="capture-btn" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send code"}
        </button>
        {error && <div className="err" role="alert">{error}</div>}
      </form>
    </div>
  );
}
