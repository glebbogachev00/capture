import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the landing eyebrow close to the navigation", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  expect(css).toMatch(/\.site-hero\.site-hero-split\s*\{\s*padding-top: 12px;/);
  expect(css).toMatch(/\.site-page:not\(\.install-page\) \.site-wrap > \.site-hero\.site-hero-split\s*\{[^}]*padding-top: 16px;/);
});
