"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * Caught a bug? Capture it.
 *
 * The joke is the mechanic: this app exists to catch loose things, and a
 * bug is a loose thing. It is the one place the product is allowed to be
 * pleased with itself.
 *
 * Two words and a box. Filing a bug should cost less than deciding not to,
 * so there is no title field, no category, no severity — the first line
 * becomes the title, and everything else is inferred.
 *
 * No email is published. A raw address in a public repo is scraped within
 * a week, and a report is more useful as an issue anyway: searchable,
 * answerable in public, and the next person with the same problem finds it
 * instead of writing it again.
 *
 * Diagnostics are shown, not hidden, and they are counts only — how many
 * of each kind exist, never a word of what any of them say. If the server
 * has no token the whole thing degrades to opening GitHub pre-filled,
 * which is where this started.
 */

const REPO = "https://github.com/glebbogachev00/capture";

export type BugContext = {
  /** Where they were when it went wrong. */
  screen: string;
  actions: number;
  threads: number;
  intentions: number;
};

function contextLines(ctx: BugContext): string {
  const device =
    typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
  const size =
    typeof window === "undefined"
      ? "unknown"
      : `${window.innerWidth}×${window.innerHeight}`;
  return [
    `- screen: ${ctx.screen}`,
    `- board: ${ctx.actions} actions · ${ctx.threads} threads · ${ctx.intentions} intentions`,
    `- window: ${size}`,
    `- device: ${device}`,
  ].join("\n");
}

/** The old path, still the fallback: GitHub, pre-filled, in a new tab. */
function githubUrl(what: string, ctx: BugContext): string {
  const body = [what, "", "---", "", contextLines(ctx)].join("\n");
  return `${REPO}/issues/new?body=${encodeURIComponent(body)}`;
}

export function ReportBugForm({
  ctx,
  onClose,
}: {
  ctx: BugContext;
  onClose: () => void;
}) {
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number?: number; url?: string } | null>(
    null
  );
  const [err, setErr] = useState("");

  const send = async () => {
    if (!what.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          what: what.trim(),
          context: contextLines(ctx),
        }),
      });
      if (res.ok) {
        setDone((await res.json()) as { number?: number; url?: string });
        return;
      }
      /* 501 means no token is configured — not this person's problem, so
         hand them the pre-filled page rather than an apology. */
      if (res.status === 501) {
        window.open(githubUrl(what, ctx), "_blank", "noreferrer");
        onClose();
        return;
      }
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(out.error || "That didn't send. Try again in a moment.");
    } catch {
      setErr("That didn't send. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div className="modal-in bug-modal" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <p className="discard-title">Caught.</p>
            <p className="discard-hint">
              {done.number ? `Filed as #${done.number}. ` : "Filed. "}
              Thanks — it is on the pile that actually gets read.
            </p>
            <div className="tools">
              {done.url && (
                <a
                  className="ghost"
                  href={done.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  See it
                </a>
              )}
              <button className="ghost" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="discard-title">Caught a bug?</p>
            {/* One box, like the rest of the app. The split into "what
                happened" and "what you expected" was form-thinking: two
                rectangles to fill in, when the placeholder asks for both in
                a sentence and most people write one anyway. */}
            <textarea
              className="bug-field"
              rows={5}
              autoFocus
              placeholder="It did this, and I expected…"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
            />
            {!!err && <p className="bug-err">{err}</p>}
            <div className="tools">
              <button
                className="bug-send"
                onClick={send}
                disabled={!what.trim() || busy}
              >
                {busy ? "Sending…" : "Send it"}
              </button>
              <button className="ghost" onClick={onClose}>
                Never mind
              </button>
            </div>
            {/* Shown rather than collected — under the buttons, where it is
                available without being part of the task. */}
            <details className="bug-ctx">
              <summary>what gets sent with it</summary>
              <pre>{contextLines(ctx)}</pre>
            </details>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/** The quiet line at the bottom of the board. */
export function ReportBug({ ctx }: { ctx: BugContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="report-bug">
        <button onClick={() => setOpen(true)}>Caught a bug? Capture it.</button>
      </p>
      {open && <ReportBugForm ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}
