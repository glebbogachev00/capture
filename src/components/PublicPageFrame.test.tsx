/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ARTICLES } from "@/content/articles";
import { PublicThreadArticle } from "./PublicThreadArticle";

afterEach(cleanup);

it("shares the landing outer frame without changing the board container", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  expect(css).toMatch(/\.site-page > \.capture-wrap\s*\{\s*max-width: 760px;\s*padding-inline: 18px;/);
  expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{[\s\S]*?\.site-page > \.capture-wrap\s*\{\s*max-width: 1120px;/);
  expect(css).toMatch(/\.capture-wrap\s*\{\s*max-width: 620px;\s*margin: 0 auto;\s*padding: 0 18px;/);
  expect(css).not.toMatch(/(?:\.funding-wrap|\.writing-wrap)\s*\{\s*max-width:/);
  expect(css).toMatch(/\.public-thread-content\s*\{[^}]*max-width: 724px;\s*margin-inline: auto;/);
});

it.each(ARTICLES)("keeps $slug readable inside the shared header frame", (article) => {
  const { container } = render(<PublicThreadArticle article={article} />);
  const frame = container.querySelector(".site-page > .capture-wrap");
  const content = frame?.querySelector(":scope > .public-thread-content");
  expect(frame?.querySelector(":scope > .site-head")).not.toBeNull();
  expect(content?.querySelector(".site-head")).toBeNull();
  expect(content?.querySelector(".finished-thread")).not.toBeNull();
  expect(content?.querySelector(".public-record")).not.toBeNull();
  expect(content?.querySelector(".article-end")).not.toBeNull();
});
