"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    /* Ask the browser to keep this origin's storage.
 
       Never asked before, which left every byte here "best effort": a
       phone under storage pressure may evict the whole of IndexedDB, and
       eviction is exactly what "my images don't actually save — I open the
       app and wait minutes for them to come back" looks like. The board
       itself recovers in seconds because it is small text the hub holds; a
       few MB of photos trickle back one serverless round-trip at a time,
       and covers that were never uploaded anywhere are simply gone.
 
       persist() is a request, not a guarantee — browsers grant it on their
       own heuristics (installed PWA, frequent use), and there is no prompt
       to annoy anyone. Fire and forget; a refusal changes nothing about
       how the app behaves, it just leaves eviction possible. */
    try {
      void navigator.storage?.persist?.().catch(() => {});
    } catch {
      /* older WebKit without the API */
    }
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
