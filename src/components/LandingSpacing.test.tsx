import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("stacks feature copy above its screenshot at every viewport width", () => {
  const css = readFileSync("src/app/landing-content.css", "utf8");
  const layout = css.match(/\.landing-content \.feature-card-layout\s*\{([^}]+)\}/)?.[1];
  expect(layout).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
  expect(layout).toMatch(/gap:\s*24px;/);
});

it("stacks handoff step labels above their explanations like mobile", () => {
  const css = readFileSync("src/app/landing-content.css", "utf8");
  expect(css).toMatch(/\.landing-content \.site-quiet \.note-beats > div\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*gap:\s*3px;/);
});

it("bounds the whole feature card so copy and media share one compact column", () => {
  const css = readFileSync("src/app/landing-content.css", "utf8");
  const card = css.match(/\.landing-content \.feature-card-layout\s*\{([^}]+)\}/)?.[1];
  expect(card).toMatch(/width:\s*100%;/);
  expect(card).toMatch(/max-width:\s*560px;/);
  expect(card).toMatch(/margin-inline:\s*auto;/);
  const figure = css.match(/\.landing-content \.feature-card-image\s*\{([^}]+)\}/)?.[1];
  expect(figure).toMatch(/width:\s*100%;/);
  expect(figure).not.toMatch(/max-width:/);
});

it("places complete cards beside each other on desktop and stacks them on narrow screens", () => {
  const css = readFileSync("src/app/landing-content.css", "utf8");
  expect(css).toMatch(/\.landing-content \.feature-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  expect(css).toMatch(/@media \(max-width: 900px\)\s*\{\s*\.landing-content \.feature-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
});

it("keeps the landing eyebrow close to the navigation", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  expect(css).toMatch(/\.site-hero\.site-hero-split\s*\{\s*padding-top: 12px;/);
  expect(css).toMatch(/\.site-page:not\(\.install-page\) \.site-wrap > \.site-hero\.site-hero-split\s*\{[^}]*padding-top: 16px;/);
});
