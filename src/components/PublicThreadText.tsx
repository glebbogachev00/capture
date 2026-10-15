import type { ReactNode } from "react";

/**
 * Untrusted note text → React elements. A tiny Markdown subset (headings,
 * quotes, bulleted and numbered lists, *emphasis*, **strong**, [label](url)
 * and bare links) and nothing else: no HTML is ever interpreted, and only
 * http(s) links become links, opened without referrer or opener.
 */

const LINK = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<>"')\]]{1,2000})|\*\*([^*\n]{1,500})\*\*|\*([^*\n]{1,500})\*|_([^_\n]{1,500})_/g;

export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="nofollow ugc noopener noreferrer">{children}</a>;
}

export function inline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    const [whole, label, labelUrl, bareUrl, strong, em, emUnderscore] = match;
    if (labelUrl) {
      const href = safeHref(labelUrl);
      out.push(href ? <ExternalLink key={key} href={href}>{label}</ExternalLink> : whole);
    } else if (bareUrl) {
      const trailing = bareUrl.match(/[.,;:!?]+$/)?.[0] ?? "";
      const url = trailing ? bareUrl.slice(0, -trailing.length) : bareUrl;
      const href = safeHref(url);
      out.push(href ? <ExternalLink key={key} href={href}>{url}</ExternalLink> : url);
      if (trailing) out.push(trailing);
    } else if (strong) {
      out.push(<strong key={key}>{strong}</strong>);
    } else {
      out.push(<em key={key}>{em ?? emUnderscore}</em>);
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function lines(text: string, keyPrefix: string): ReactNode[] {
  return text.split("\n").flatMap((line, index) =>
    index === 0 ? inline(line, `${keyPrefix}-${index}`) : [<br key={`${keyPrefix}-br-${index}`} />, ...inline(line, `${keyPrefix}-${index}`)],
  );
}

const BULLET = /^[-*•]\s+/;
const NUMBERED = /^\d{1,3}[.)]\s+/;

export function PublicThreadText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const heading = block.match(/^(#{1,3})\s+(.+)$/);
        if (heading && !block.includes("\n")) {
          return heading[1].length === 3
            ? <h4 key={key}>{inline(heading[2], key)}</h4>
            : <h3 key={key}>{inline(heading[2], key)}</h3>;
        }
        const rows = block.split("\n");
        if (rows.every((row) => /^>\s?/.test(row))) {
          return <blockquote key={key}>{lines(rows.map((row) => row.replace(/^>\s?/, "")).join("\n"), key)}</blockquote>;
        }
        /* A lead-in line and the list under it, or a list on its own. */
        const runs: { kind: "p" | "ul" | "ol"; rows: string[] }[] = [];
        for (const row of rows) {
          const kind = BULLET.test(row) ? "ul" : NUMBERED.test(row) ? "ol" : "p";
          const last = runs.at(-1);
          if (last?.kind === kind) last.rows.push(row);
          else runs.push({ kind, rows: [row] });
        }
        return runs.map(({ kind, rows: run }, part) => {
          const runKey = `${key}-${part}`;
          if (kind === "p") return <p key={runKey}>{lines(run.join("\n"), runKey)}</p>;
          const items = run.map((row, item) => (
            <li key={`${runKey}-${item}`}>{inline(row.replace(kind === "ul" ? BULLET : NUMBERED, ""), `${runKey}-${item}`)}</li>
          ));
          return kind === "ul"
            ? <ul key={runKey}>{items}</ul>
            : <ol key={runKey} start={Number(run[0].match(/^\d+/)![0])}>{items}</ol>;
        });
      })}
    </>
  );
}
