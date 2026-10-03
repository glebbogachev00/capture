"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { CloudLoginForm } from "./CloudLoginForm";
import { PublicThreadView } from "./PublicThreadView";
import { OWNER_HEADER } from "@/lib/ownership";
import {
  PUBLIC_THREAD_NOTICE,
  PublicThreadInputSchema,
  decodeHandoff,
  publicThreadDates,
  type OwnedPublicThread,
  type PublicThreadInput,
} from "@/lib/publicThread";
import type { CloudConfig } from "@/lib/supabase/config";

type Listed = OwnedPublicThread & { url: string };
const DRAFT_KEY = "capture:publish-draft";
const API = "/api/cloud/public-threads";

function readDraft(): PublicThreadInput | null {
  const fromLink = decodeHandoff(window.location.hash);
  if (fromLink) {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(fromLink)); } catch {}
    return fromLink;
  }
  try {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    const parsed = saved ? PublicThreadInputSchema.safeParse(JSON.parse(saved)) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const noSubscribe = () => () => {};

/** Reads the handoff from this tab, so it renders in the browser only. */
export function PublishConfirm({ cloudConfig }: { cloudConfig: CloudConfig | null }) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  return inBrowser ? <PublishFlow cloudConfig={cloudConfig} /> : <p className="publish-note">Checking your Capture Cloud account…</p>;
}

function PublishFlow({ cloudConfig }: { cloudConfig: CloudConfig | null }) {
  const [draft, setDraft] = useState<PublicThreadInput | null>(readDraft);
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const [threads, setThreads] = useState<Listed[] | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [choice, setChoice] = useState<"auto" | "new" | string>("auto");
  const [published, setPublished] = useState<Listed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const headers = useCallback((extra: Record<string, string> = {}) => ({ [OWNER_HEADER]: owner ?? "", ...extra }), [owner]);
  const refresh = () => setListVersion((version) => version + 1);

  // The snapshot stays in this tab only; drop it from the address bar once
  // the router has settled, or it writes the original URL back.
  useEffect(() => {
    const clear = () => {
      if (window.location.hash) history.replaceState(history.state, "", window.location.pathname);
    };
    const timer = setTimeout(clear, 0);
    window.addEventListener("load", clear);
    return () => { clearTimeout(timer); window.removeEventListener("load", clear); };
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`${API}?whoami=1`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => { if (live) setOwner(typeof body.owner === "string" ? body.owner : null); })
      .catch(() => {
        if (!live) return;
        setOwner(null);
        setError("Couldn't reach Capture Cloud. Check your connection and reload.");
      });
    return () => { live = false; };
  }, [identityAttempt]);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    fetch(API, { headers: { [OWNER_HEADER]: owner }, cache: "no-store" })
      .then(async (response) => {
        if (!live) return;
        if (!response.ok) {
          setError(response.status === 402 ? "Publishing needs Capture Cloud access on this account." : "Couldn't load your published threads.");
          return;
        }
        const body = await response.json();
        if (live) setThreads(body.threads as Listed[]);
      })
      .catch(() => { if (live) setError("Couldn't load your published threads."); });
    return () => { live = false; };
  }, [owner, listVersion]);

  // Publishing the same private thread again defaults to updating its link.
  const existing = draft && threads?.find((thread) => thread.sourceKey === draft.sourceKey);
  const target = choice === "auto" ? existing?.token ?? "new" : choice;
  const setTarget = setChoice;

  async function publish() {
    if (!draft || !owner) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ snapshot: draft, ...(target === "new" ? {} : { replace: target }) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(response.status === 402
          ? "Publishing needs Capture Cloud access on this account."
          : response.status === 429 ? "Too many changes just now. Try again in a minute." : "Couldn't publish. Nothing was made public.");
        return;
      }
      setPublished({ ...(body.thread as OwnedPublicThread), url: body.url as string });
      setDraft(null);
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function unpublish(token: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}?token=${encodeURIComponent(token)}`, { method: "DELETE", headers: headers() });
      if (!response.ok && response.status !== 404) {
        setError("Couldn't unpublish. The link is still live; try again.");
        return;
      }
      setConfirming(null);
      if (published?.token === token) setPublished(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    setCopied((await copyText(url)) ? url : `failed:${url}`);
  }

  if (owner === undefined) return <p className="publish-note">Checking your Capture Cloud account…</p>;

  if (owner === null) {
    return (
      <div className="publish-flow">
        {draft && <p className="publish-note">Sign in to publish “{draft.title}”. Nothing is public yet.</p>}
        {cloudConfig
          ? <div className="publish-login"><CloudLoginForm config={cloudConfig} onAuthenticated={() => { setOwner(undefined); setIdentityAttempt((attempt) => attempt + 1); }} /></div>
          : <p className="publish-note">Capture Cloud isn&apos;t available right now.</p>}
        {error && <p className="publish-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="publish-flow">
      {published && (
        <section className="publish-done" aria-live="polite">
          <p className="funding-card-label">Published</p>
          <h2>Anyone with this link can read it.</h2>
          <div className="publish-link-row">
            <input readOnly value={published.url} aria-label="Public link" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="capture-btn" onClick={() => copyLink(published.url)}>
              {copied === published.url ? "Copied" : "Copy link"}
            </button>
            <a className="ghost" href={published.url} target="_blank" rel="noopener">Open</a>
          </div>
          {copied === `failed:${published.url}` && <p className="publish-note">Couldn&apos;t reach the clipboard. The link above is selectable.</p>}
        </section>
      )}

      {draft && (
        <section className="publish-review" aria-labelledby="publish-review-title">
          <div className="publish-review-head">
            <div>
              <p className="funding-card-label">Review before publishing</p>
              <h2 id="publish-review-title">This is exactly what readers will see.</h2>
            </div>
            <div className="publish-target" role="radiogroup" aria-label="Where to publish">
              {existing && (
                <label>
                  <input type="radio" name="target" checked={target === existing.token} onChange={() => setTarget(existing.token)} />
                  Update the existing link
                </label>
              )}
              <label>
                <input type="radio" name="target" checked={target === "new"} onChange={() => setTarget("new")} />
                {existing ? "Publish as a new link" : "Publish a new link"}
              </label>
            </div>
          </div>
          <PublicThreadView thread={{ ...draft, publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }} preview />
          <div className="publish-actions">
            <button type="button" className="capture-btn" disabled={busy} onClick={publish}>
              {target === "new" ? "Publish read-only link" : "Update published snapshot"}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => { setDraft(null); try { sessionStorage.removeItem(DRAFT_KEY); } catch {} }}>
              Discard
            </button>
          </div>
        </section>
      )}

      {error && <p className="publish-error" role="alert">{error}</p>}

      <section className="publish-list" aria-labelledby="publish-list-title">
        <p className="funding-card-label" id="publish-list-title">Your published threads</p>
        {threads === null ? <p className="publish-note">Loading…</p> : threads.length === 0 ? (
          <p className="publish-note">Nothing published yet. Use “Publish read-only link” on a thread in Capture.</p>
        ) : (
          <ul>
            {threads.map((thread) => (
              <li key={thread.token}>
                <div>
                  <a href={thread.url} target="_blank" rel="noopener">{thread.title}</a>
                  <span>{publicThreadDates(thread)}</span>
                </div>
                <div className="publish-list-actions">
                  <button type="button" className="ghost" onClick={() => copyLink(thread.url)}>{copied === thread.url ? "Copied" : "Copy link"}</button>
                  {confirming === thread.token ? (
                    <>
                      <button type="button" className="ghost danger" disabled={busy} onClick={() => unpublish(thread.token)}>Unpublish</button>
                      <button type="button" className="ghost" onClick={() => setConfirming(null)}>Keep</button>
                    </>
                  ) : (
                    <button type="button" className="ghost" onClick={() => setConfirming(thread.token)}>Unpublish…</button>
                  )}
                </div>
                {confirming === thread.token && (
                  <p className="publish-note">The link stops working at once. Copies someone already saved can&apos;t be taken back.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="publish-note">{PUBLIC_THREAD_NOTICE}</p>
    </div>
  );
}
