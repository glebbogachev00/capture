"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { CloudLoginForm } from "./CloudLoginForm";
import { PublicThreadView } from "./PublicThreadView";
import { OWNER_HEADER } from "@/lib/ownership";
import {
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

  // A Thread published before always updates its own link: one decision, made once.
  const existing = draft && threads?.find((thread) => thread.sourceKey === draft.sourceKey);

  async function publish() {
    if (!draft || !owner) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ snapshot: draft, ...(existing ? { replace: existing.token } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(response.status === 402
          ? "Publishing needs Capture Cloud on this account."
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
        setError("Couldn't unpublish. The link still works; try again.");
        return;
      }
      setConfirming(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    setCopied((await copyText(url)) ? url : `failed:${url}`);
  }

  const discard = () => {
    setDraft(null);
    try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
  };
  const failure = error && <p className="publish-error" role="alert">{error}</p>;

  if (owner === undefined) return <p className="publish-note">Checking your account…</p>;

  if (owner === null) {
    return (
      <div className="publish-flow">
        <h2 className="publish-heading">Sign in to publish</h2>
        {cloudConfig
          ? <div className="publish-login"><CloudLoginForm config={cloudConfig} onAuthenticated={() => { setOwner(undefined); setIdentityAttempt((attempt) => attempt + 1); }} /></div>
          : <p className="publish-note">Capture Cloud isn&apos;t available right now.</p>}
        {failure}
      </div>
    );
  }

  // 1. Confirm: the exact page readers will get, and one button.
  if (draft) {
    return (
      <div className="publish-flow">
        <PublicThreadView thread={{ ...draft, publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }} preview />
        {failure}
        <div className="publish-bar publish-bar-sticky">
          <button type="button" className="capture-btn" disabled={busy || threads === null} onClick={publish}>
            {existing ? "Update" : "Publish"}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={discard}>Cancel</button>
          {existing && <span className="publish-hint">Replaces what&apos;s at your existing link.</span>}
        </div>
      </div>
    );
  }

  // 2. Done: the link, ready to copy. The end of the flow.
  if (published) {
    return (
      <div className="publish-flow">
        <section className="publish-done" aria-live="polite">
          <h2 className="publish-heading">Published</h2>
          <div className="publish-link-row">
            <input readOnly value={published.url} aria-label="Link" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="capture-btn" onClick={() => copyLink(published.url)}>
              {copied === published.url ? "Copied" : "Copy link"}
            </button>
          </div>
          {copied === `failed:${published.url}` && <p className="publish-note">Couldn&apos;t copy. Select the link above.</p>}
        </section>
        <button type="button" className="publish-quiet" onClick={() => setPublished(null)}>All published threads</button>
      </div>
    );
  }

  // 3. Everything published from this account.
  return (
    <div className="publish-flow">
      <h2 className="publish-heading">Published</h2>
      {failure}
      {threads === null ? <p className="publish-note">Loading…</p> : threads.length === 0 ? (
        <p className="publish-note">Nothing yet. Publish a thread from Capture.</p>
      ) : (
        <ul className="publish-list">
          {threads.map((thread) => (
            <li key={thread.token}>
              <a href={thread.url} target="_blank" rel="noopener">{thread.title}</a>
              <span>{publicThreadDates(thread)}</span>
              <div className="publish-list-actions">
                {confirming === thread.token ? (
                  <>
                    <button type="button" className="ghost warn" disabled={busy} onClick={() => unpublish(thread.token)}>Unpublish</button>
                    <button type="button" className="ghost" onClick={() => setConfirming(null)}>Keep</button>
                    <p className="publish-note">The link stops working at once. Copies already saved can&apos;t be recalled.</p>
                  </>
                ) : (
                  <>
                    <button type="button" className="ghost" onClick={() => copyLink(thread.url)}>{copied === thread.url ? "Copied" : "Copy link"}</button>
                    <button type="button" className="ghost" onClick={() => setConfirming(thread.token)}>Unpublish</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
