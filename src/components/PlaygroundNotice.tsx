"use client";

import { t } from "@/lib/i18n";
import { cloudPricingHandoff } from "@/lib/cloudCheckoutClient";
import { QUICKSTART_URL } from "@/lib/playground";

/** Persistent, plain-language paths out of the browser-only playground. */
export function PlaygroundNotice() {
  const cloudPricing = cloudPricingHandoff();
  return (
    <aside className="playground-note" aria-labelledby="playground-note-title">
      <div className="playground-note-copy">
        <strong id="playground-note-title">{t("Choose where to keep your board")}</strong>
        <span>
          {t("This playground stays in this browser. Use Cloud to sync across devices.")}
        </span>
      </div>
      <div className="playground-note-actions">
        {cloudPricing && (
          <a className="playground-note-action is-primary" href={cloudPricing}>
            {t("Start with Capture Cloud")}
          </a>
        )}
        <a className="playground-note-action is-secondary" href={QUICKSTART_URL}>
          {t("Try Capture Locally")}
        </a>
      </div>
    </aside>
  );
}
