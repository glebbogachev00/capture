import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicThreadText } from "./PublicThreadText";

const html = (text: string) => renderToStaticMarkup(<PublicThreadText text={text} />);

describe("untrusted note text on a public page", () => {
  it("never interprets HTML", () => {
    const out = html(`<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a>`);
    expect(out).not.toMatch(/<script|<img|<a /);
    expect(out).toContain("&lt;script&gt;");
  });

  it("links only http(s), without referrer or opener", () => {
    const out = html("[safe](https://example.com/a?b=1) [bad](javascript:alert(1)) see https://youtu.be/x?t=303s.");
    expect(out).toContain(`<a href="https://example.com/a?b=1" target="_blank" rel="nofollow ugc noopener noreferrer">safe</a>`);
    expect(out).toContain(`<a href="https://youtu.be/x?t=303s" target="_blank" rel="nofollow ugc noopener noreferrer">https://youtu.be/x?t=303s</a>.`);
    expect(out).not.toContain(`href="javascript`);
    expect(out).toContain("[bad](javascript:alert(1))");
  });

  it("keeps the structure that separates source, interpretation and exercise", () => {
    const out = html("## The source\n\n> He recalls a dynamometer test.\n\n## Try it on your own product\n\n- Choose one sentence\n- Put it beside evidence\n\nIn *Origins of Oakley*, a **real** advantage.\nNext line.");
    expect(out).toBe([
      "<h3>The source</h3>",
      "<blockquote>He recalls a dynamometer test.</blockquote>",
      "<h3>Try it on your own product</h3>",
      "<ul><li>Choose one sentence</li><li>Put it beside evidence</li></ul>",
      "<p>In <em>Origins of Oakley</em>, a <strong>real</strong> advantage.<br/>Next line.</p>",
    ].join(""));
  });
});
