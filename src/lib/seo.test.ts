import { describe, expect, it } from "vitest";
import {
  appMetadata,
  appStartUrl,
  articleMetadata,
  installMetadata,
  isPublicHome,
  landingMetadata,
  robotsFor,
  siteHome,
  sitemapFor,
  utilityMetadata,
  websiteSchema,
  writingMetadata,
} from "./seo";

const SITE = "https://www.trycapture.app/";

describe("TryCapture search identity", () => {
  it("gives the public home a descriptive canonical identity", () => {
    const metadata = landingMetadata(true);
    expect(metadata.title).toBe("Capture — messy thoughts that sort themselves");
    expect(metadata.description).toBe(
      "Capture rough thoughts by voice or text. It sorts them into actions, threads, or intentions without making you choose first."
    );
    expect(metadata.alternates?.canonical).toBe(SITE);
    expect(metadata.openGraph).toMatchObject({
      title: "Capture — messy thoughts that sort themselves",
      url: SITE,
      siteName: "Capture",
      type: "website",
      images: [
        {
          url: "https://www.trycapture.app/og-v2.png",
          width: 1200,
          height: 630,
          alt: "Capture turning a rough thought into an action and a continuing thread",
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: ["https://www.trycapture.app/og-v2.png"],
    });
  });

  it("keeps self-hosted deployments free of a TryCapture canonical", () => {
    expect(landingMetadata(false).alternates).toBeUndefined();
    expect(siteHome(false)).toBe("/about");
    expect(siteHome(true)).toBe("/");
    expect(appStartUrl(false)).toBe("/");
    expect(appStartUrl(true)).toBe("/app");
    expect(isPublicHome("/", true)).toBe(true);
    expect(isPublicHome("/", false)).toBe(false);
    expect(isPublicHome("/app", true)).toBe(false);
  });

  it("gives the public install page its own canonical identity", () => {
    expect(installMetadata(true)).toMatchObject({
      title: "Install Capture locally",
      alternates: { canonical: "https://www.trycapture.app/install" },
    });
    expect(installMetadata(false).alternates).toBeUndefined();
  });

  it("keeps the local playground out of search while allowing Google to crawl the directive", () => {
    expect(appMetadata.robots).toMatchObject({ index: false, follow: true });
    expect(robotsFor(true)).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://www.trycapture.app/sitemap.xml",
    });
  });

  it("blocks crawling on a private self-host and omits its sitemap", () => {
    expect(robotsFor(false)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
    expect(sitemapFor(false)).toEqual([]);
  });

  it("lists the public landing, install, writing index, and every article", () => {
    const urls = sitemapFor(true).map((entry) => entry.url);
    expect(urls).toContain(SITE);
    expect(urls).toContain("https://www.trycapture.app/install");
    expect(urls).toContain("https://www.trycapture.app/writing");
    expect(urls).toContain(
      "https://www.trycapture.app/writing/software-i-can-use-while-running"
    );
    expect(urls).toHaveLength(6);
  });

  it("gives the writing index and each article a canonical search identity", () => {
    expect(writingMetadata(true)).toMatchObject({
      title: "Written with Capture",
      alternates: { canonical: "https://www.trycapture.app/writing" },
    });
    expect(articleMetadata(true, {
      slug: "software-i-can-use-while-running",
      title: "The Software I Can Use While Running",
      description: "A field note.",
    })).toMatchObject({
      title: "The Software I Can Use While Running",
      alternates: {
        canonical: "https://www.trycapture.app/writing/software-i-can-use-while-running",
      },
      openGraph: { type: "article" },
    });
    expect(articleMetadata(false, {
      slug: "software-i-can-use-while-running",
      title: "The Software I Can Use While Running",
      description: "A field note.",
    }).robots).toMatchObject({ index: false, follow: false });
  });

  it("keeps utility routes out of search", () => {
    expect(utilityMetadata("Login").robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it("publishes only a truthful WebSite identity", () => {
    expect(websiteSchema(true)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Capture",
      alternateName: "trycapture.app",
      url: SITE,
    });
    expect(websiteSchema(false)).toBeNull();
  });
});
