import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  expect(match, `missing ${selector} rule`).toBeTruthy();
  return match?.[1] ?? "";
}

describe("Unsorted capture geometry", () => {
  it("keeps pending feedback neutral despite the later landed styles and gives Undo a real tap target", () => {
    expect(rule(".landed.pending-receipt")).toMatch(/background:\s*var\(--card\)/);
    expect(rule(".capture-receipt .undo-btn")).toMatch(/min-height:\s*44px/);
  });
  it("keeps secondary controls in one compact Capture-styled row", () => {
    expect(rule(".unsorted-more-menu")).toMatch(/display:\s*flex/);
    expect(rule(".unsorted-more-menu")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".unsorted-more-menu button")).toMatch(/width:\s*auto/);
    expect(rule(".unsorted-more-menu button")).toMatch(/min-height:\s*44px/);
    expect(rule(".unsorted-more-menu button")).toMatch(/font:\s*inherit/);
    expect(css).not.toContain(".unsorted-place-picker");
  });
  it("uses the full content grid with a quiet compact section toggle", () => {
    const section = rule(".unsorted-captures");
    expect(section).toMatch(/width:\s*100%/);
    expect(section).toMatch(/min-width:\s*0/);
    expect(section).toMatch(/max-width:\s*620px/);
    expect(section).toMatch(/margin-inline:\s*auto/);

    const summary = rule(".unsorted-summary");
    expect(summary).toMatch(/width:\s*fit-content/);
    expect(summary).toMatch(/min-height:\s*44px/);
    expect(summary).toMatch(/border:\s*0/);
    expect(summary).toMatch(/background:\s*none/);
  });

  it("keeps expanded recovery cards in a restrained full-width stack", () => {
    const track = rule(".unsorted-track");
    expect(track).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(track).not.toMatch(/overflow-x:\s*auto/);

    const card = rule(".unsorted-card");
    expect(card).toMatch(/width:\s*100%/);
    expect(card).toMatch(/min-height:\s*0/);
    expect(card).toMatch(/padding:\s*16px/);
    expect(rule(".unsorted-preview")).toMatch(/font-size:\s*14\.5px/);
  });

  it("uses natural tap targets and a fixed picker that cannot resize cards", () => {
    const primary = rule(".unsorted-primary");
    expect(primary).toMatch(/min-height:\s*44px/);
    expect(primary).toMatch(/background:\s*var\(--accent-soft\)/);

    const more = rule(".unsorted-more");
    expect(more).toMatch(/width:\s*44px/);
    expect(more).toMatch(/height:\s*44px/);
    const actions = rule(".unsorted-card-actions");
    expect(actions).toMatch(/gap:\s*8px/);
    expect(actions).toMatch(/margin-top:\s*0/);
    expect(actions).toMatch(/padding-top:\s*18px/);

    const layer = rule(".destination-picker-layer");
    expect(layer).toMatch(/position:\s*fixed/);
    expect(layer).toMatch(/inset:\s*0/);
    expect(layer).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(layer).toMatch(/font-size:\s*16px/);
    const picker = rule(".destination-picker");
    expect(picker).toMatch(/width:\s*min\(400px,/);
    expect(picker).toMatch(/max-height:\s*min\(640px,/);
    expect(rule(".destination-picker-results")).toMatch(/overflow-y:\s*auto/);

    const input = rule(".destination-picker input");
    expect(input).toMatch(/min-height:\s*44px/);
    expect(input).toMatch(/border-radius:\s*11px/);
    expect(input).toMatch(/font-size:\s*15px/);
    const labels = rule(".destination-picker-results h3,\n.destination-picker-name label");
    expect(labels).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(labels).toMatch(/font-size:\s*12px/);
    expect(labels).toMatch(/letter-spacing:\s*0/);
    expect(labels).toMatch(/text-transform:\s*none/);
    const pickerCss = css.slice(css.indexOf(".destination-picker-layer"), css.indexOf("@media (max-width: 640px)"));
    expect(pickerCss).not.toMatch(/var\(--font-display\)|var\(--font-mono\)|Georgia|monospace/);

    const mobile = css.match(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(mobile).toMatch(/\.destination-picker-layer\s*\{[\s\S]*align-items:\s*end/);
    expect(mobile).toMatch(/\.destination-picker\s*\{[\s\S]*width:\s*100%/);
    expect(mobile).toMatch(/max-height:\s*min\(86dvh,\s*720px\)/);
    expect(mobile).toMatch(/padding-bottom:\s*calc\([^;]*env\(safe-area-inset-bottom\)/);
    expect(mobile).toMatch(/\.unsorted-primary\s*\{[\s\S]*min-height:\s*48px/);
  });
});
