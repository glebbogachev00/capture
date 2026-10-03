"use client";

import { useEffect, useRef, useState } from "react";

/** Copies the snapshot's Markdown. When the clipboard refuses (permissions,
 * an embedded browser, an old phone), the same text appears selected so it can
 * be copied by hand; nothing is lost either way. */
export function CopyContextButton({ markdown }: { markdown: string }) {
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
      <button type="button" className="capture-btn" onClick={copy}>
        {state === "copied" ? "Copied" : "Copy context"}
      </button>
      <p role="status" aria-live="polite" className={state === "failed" ? "public-snapshot-status" : "visually-hidden"}>
        {state === "copied" && "Copied as Markdown."}
        {state === "failed" && "Couldn't copy. The text is selected below."}
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
