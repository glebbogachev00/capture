"use client";

import { useEffect, useRef, useState } from "react";

/** Copies the snapshot's Markdown. When the clipboard refuses (permissions,
 * an embedded browser, an old phone), the same text appears selected so it can
 * be copied by hand; nothing is lost either way. */
export function CopyContextButton({ markdown, textHref }: { markdown: string; textHref: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const fallback = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state === "failed") fallback.current?.select();
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="public-snapshot-actions">
      <div className="public-snapshot-buttons">
        <button type="button" className="capture-btn" onClick={copy}>
          {state === "copied" ? "Copied" : "Copy context"}
        </button>
        <a className="ghost" href={textHref}>Plain text</a>
      </div>
      <p role="status" aria-live="polite" className="public-snapshot-status">
        {state === "copied" && "Copied as Markdown, ready to paste into your agent."}
        {state === "failed" && "Couldn't reach the clipboard. The text below is selected; copy it by hand."}
      </p>
      {state === "failed" && (
        <textarea
          ref={fallback}
          className="public-snapshot-fallback"
          readOnly
          value={markdown}
          aria-label="Context to copy"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
