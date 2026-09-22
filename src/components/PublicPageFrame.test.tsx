/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ARTICLES } from "@/content/articles";
import { PublicThreadArticle } from "./PublicThreadArticle";

afterEach(cleanup);

it("uses the complete landing frame without narrowing individual articles", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  expect(css).toMatch(/\.site-page > \.capture-wrap\s*\{\s*max-width: 760px;\s*padding-inline: 18px;/);
  expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{[\s\S]*?\.site-page > \.capture-wrap\s*\{\s*max-width: 1120px;/);
  expect(css).toMatch(/\.capture-wrap\s*\{\s*max-width: 620px;\s*margin: 0 auto;\s*padding: 0 18px;/);
  expect(css).not.toMatch(/(?:\.funding-wrap|\.writing-wrap)\s*\{\s*max-width:/);
  expect(css).toMatch(/\.public-thread-content\s*\{[^}]*width: 100%;[^}]*max-width: none;[^}]*margin-inline: 0;/);
  expect(css).toMatch(/\.public-thread-state\s*\{[^}]*max-width: none;/);
  expect(css).toMatch(/\.public-record\s*\{[^}]*max-width: none;/);
  expect(css).toMatch(/\.finished-thread\s*\{[^}]*max-width: none;/);
  expect(css).toMatch(/\.article-end\s*\{[^}]*max-width: none;/);
  expect(css).toMatch(/\.article-body\s*\{[^}]*max-width: 900px;[^}]*margin-inline: auto;/);
  expect(css).toMatch(/\.public-thread-head h1\s*\{[^}]*margin: 0 auto;[^}]*text-align: center;/);
  expect(css).not.toMatch(/\.public-thread-content\s*\{[^}]*text-align: center;/);
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
