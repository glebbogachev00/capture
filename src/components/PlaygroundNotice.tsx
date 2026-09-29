"use client";

import { cloudAccountHandoff, cloudPricingHandoff } from "@/lib/cloudCheckoutClient";

/** Persistent, plain-language paths out of the browser-only playground. */
export function PlaygroundNotice() {
  const cloudPricing = cloudPricingHandoff();
  const cloudAccount = cloudAccountHandoff();
  return (
    <aside className="playground-note" aria-labelledby="playground-note-title">
      <div className="playground-note-copy">
        <strong id="playground-note-title">Choose where to keep your board</strong>
        <span>
          This playground stays in this browser. Use Cloud to sync across devices.
        </span>
      </div>
      <div className="playground-note-actions">
        {cloudPricing && (
          <a className="playground-note-action is-primary" href={cloudPricing}>
            Use Capture Cloud
          </a>
        )}
        {cloudAccount && (
          <a className="playground-note-action is-secondary" href={cloudAccount}>
            Log in to Capture Cloud
          </a>
        )}
      </div>
    </aside>
  );
}
