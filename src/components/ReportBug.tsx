"use client";

/**
 * Caught a bug? Capture it.
 *
 * The joke is the mechanic: this app exists to catch loose things, and a
 * bug is a loose thing. It is the one place the product is allowed to be
 * pleased with itself, and it earns that by sitting at the very bottom —
 * below every note, where people arrive when something has already gone
 * wrong and they are looking for someone to tell.
 *
 * No email is published. A raw address in a public repo is scraped within
 * a week, and the report is more useful as an issue anyway: it is
 * searchable, it can be replied to in public, and the next person with the
 * same problem finds it instead of writing it again.
 *
 * Nothing is sent from here. The issue opens pre-filled in a new tab and
 * the person reads it before pressing anything — which also means the
 * diagnostics below are inspectable rather than collected. Counts only:
 * how many of each kind exist, never a word of what any of them say.
 */

const REPO = "https://github.com/glebbogachev00/capture";

export type BugContext = {
  /** Where they were when it went wrong. */
  screen: string;
  actions: number;
  threads: number;
  intentions: number;
};

function bodyFor(ctx: BugContext): string {
  const device =
    typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
  const size =
    typeof window === "undefined"
      ? "unknown"
      : `${window.innerWidth}×${window.innerHeight}`;
  return [
    "### What happened",
    "",
    "",
    "### What you expected instead",
    "",
    "",
    "---",
    "",
    "<sub>Filled in automatically — counts only, none of your notes.</sub>",
    "",
    `- screen: ${ctx.screen}`,
    `- board: ${ctx.actions} actions · ${ctx.threads} threads · ${ctx.intentions} intentions`,
    `- window: ${size}`,
    `- device: ${device}`,
  ].join("\n");
}

export function ReportBug({ ctx }: { ctx: BugContext }) {
  const href = `${REPO}/issues/new?title=${encodeURIComponent(
    ""
  )}&body=${encodeURIComponent(bodyFor(ctx))}`;
  return (
    <p className="report-bug">
      <a href={href} target="_blank" rel="noreferrer">
        <span aria-hidden="true">🐛</span> Caught a bug? Capture it.
      </a>
    </p>
  );
}
