import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/LandingDemo", () => ({ LandingDemo: () => null }));
vi.mock("@/components/CloudBilling", () => ({ CloudCheckoutButton: () => null }));
vi.mock("next/navigation", () => ({ permanentRedirect: vi.fn(), usePathname: () => "/" }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it("public Cloud retains public links, article SEO, and the about redirect", async () => {
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "0");
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_SITE", "1");
  vi.stubEnv("CAPTURE_CLOUD", "1");
  vi.stubGlobal("React", React);
  const { Landing } = await import("@/app/Landing");
  const { default: Install, metadata: installMetadata } = await import("@/app/install/page");
  const { default: Writing, metadata: writingMetadata } = await import("@/app/writing/page");
  const { default: Pricing } = await import("@/app/pricing/page");
  const { generateMetadata } = await import("@/app/writing/[slug]/page");
  const { PublicThreadArticle } = await import("@/components/PublicThreadArticle");
  const { ARTICLES } = await import("@/content/articles");
  const { default: About } = await import("@/app/about/page");
  const { permanentRedirect } = await import("next/navigation");
  const landing = renderToStaticMarkup(React.createElement(Landing));
  expect(landing).toContain('href="/app"');
  expect(landing).toContain('"@type":"WebSite"');
  expect(landing).toContain('href="/writing"');
  for (const page of [Install(), Writing(), await Pricing({})]) {
    expect(renderToStaticMarkup(page)).toMatch(/class="capture-mark funding-mark" href="\/"/);
  }
  expect(installMetadata.alternates?.canonical).toBe("https://www.trycapture.app/install");
  expect(writingMetadata.alternates?.canonical).toBe("https://www.trycapture.app/writing");
  expect((await generateMetadata({ params: Promise.resolve({ slug: ARTICLES[0].slug }) })).alternates?.canonical)
    .toBe(`https://www.trycapture.app/writing/${ARTICLES[0].slug}`);
  expect(renderToStaticMarkup(React.createElement(PublicThreadArticle, { article: ARTICLES[0] }))).toContain('href="/app"');
  About();
  expect(permanentRedirect).toHaveBeenCalledWith("/");
});
