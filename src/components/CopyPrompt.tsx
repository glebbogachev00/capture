"use client";

import { useEffect, useRef, useState } from "react";
import { INSTALL_PROMPT } from "@/lib/install";

export { INSTALL_PROMPT } from "@/lib/install";

type Status = "idle" | "copied" | "failed";

export function CopyPrompt() {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      try {
        await navigator.clipboard.writeText(INSTALL_PROMPT);
      } catch {
        /* Older browsers and automated contexts can deny the async clipboard
           even after a real click. Fall back to a selected temporary field. */
        const field = document.createElement("textarea");
        field.value = INSTALL_PROMPT;
        field.readOnly = true;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        let copied = false;
        try {
          copied = document.execCommand("copy");
        } finally {
          field.remove();
        }
        if (!copied) throw new Error("copy refused");
      }
      setStatus("copied");
      timer.current = setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("failed");
    }
  };

  const message =
    status === "copied"
      ? "Copied to clipboard"
      : status === "failed"
        ? "Clipboard unavailable — select and copy the text above"
        : "";

  return (
    <div className="copy-prompt">
      <pre
        className="copy-prompt-text"
        tabIndex={0}
        aria-label="Install prompt — select to copy"
      >
        {INSTALL_PROMPT}
      </pre>
      <div className="copy-prompt-bar">
        <button
          type="button"
          className="capture-btn"
          onClick={copy}
          aria-label={
            status === "copied"
              ? "Copied to clipboard"
              : status === "failed"
                ? "Copy failed — select the text above"
                : "Copy install prompt to clipboard"
          }
        >
          {status === "copied"
            ? "Copied"
            : status === "failed"
              ? "Copy failed"
              : "Copy prompt"}
        </button>
        <span
          className={status === "failed" ? "copy-prompt-err" : "copy-prompt-ok"}
          role="status"
        >
          {message}
        </span>
      </div>
    </div>
  );
}
