"use client";

import { cloudLoginHandoff } from "@/lib/cloudCheckoutClient";
import { QUICKSTART_URL } from "@/lib/playground";

/** Persistent, plain-language paths out of the browser-only playground. */
export function PlaygroundNotice() {
  const cloudLogin = cloudLoginHandoff();
  return (
    <aside className="playground-note" aria-labelledby="playground-note-title">
      <div className="playground-note-copy">
        <strong id="playground-note-title">Choose where to keep your board</strong>
        <span>
          This playground stays in this browser. Use Cloud to sync across devices,
          or install Capture to run it yourself.
        </span>
      </div>
      <div className="playground-note-actions">
        {cloudLogin && <a className="capture-btn" href={cloudLogin}>Use Capture Cloud</a>}
        <a className="ghost" href={QUICKSTART_URL}>Install Capture</a>
      </div>
    </aside>
  );
}
