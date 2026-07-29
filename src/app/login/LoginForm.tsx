"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // A full load so the middleware sees the new cookie.
        window.location.href = params.get("next") || "/";
        return;
      }
      const body = await res.json().catch(() => ({}));
      setErr(body.error || "Wrong password");
    } catch {
      setErr("Couldn't reach the server.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        aria-label="Password"
        autoFocus
      />
      <button className="capture-btn" type="submit" disabled={busy || !password}>
        {busy ? "…" : "Open"}
      </button>
      {err && <div className="err">{err}</div>}
    </form>
  );
}
