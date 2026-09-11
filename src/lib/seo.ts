import type { Metadata, MetadataRoute } from "next";
import { ARTICLES, type CaptureArticle } from "@/content/articles";

export const SITE_URL = "https://www.trycapture.app/";
export const SITE_TITLE = "Capture — messy thoughts that sort themselves";
export const SITE_DESCRIPTION =
  "Capture rough thoughts by voice or text. It sorts them into actions, threads, or intentions without making you choose first.";
export const INSTALL_URL = new URL("install", SITE_URL).toString();
export const WRITING_URL = new URL("writing", SITE_URL).toString();
export const OG_IMAGE_URL = new URL("og-v2.png", SITE_URL).toString();
const OG_IMAGE_ALT =
  "Capture turning a rough thought into an action and a continuing thread";
const INSTALL_TITLE = "Install Capture locally";
const INSTALL_DESCRIPTION =
  "Run Capture on your own computer with your own model keys and data.";

export function landingMetadata(playground: boolean): Metadata {
  const shared: Metadata = {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  };
  if (!playground) return shared;
  return {
    ...shared,
    alternates: { canonical: SITE_URL },
    openGraph: {
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      siteName: "Capture",
      type: "website",
      images: [
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: OG_IMAGE_ALT,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [OG_IMAGE_URL],
    },
  };
}

export function installMetadata(playground: boolean): Metadata {
  const shared: Metadata = {
    title: INSTALL_TITLE,
    description: INSTALL_DESCRIPTION,
  };
  if (!playground) return shared;
  return {
    ...shared,
    alternates: { canonical: INSTALL_URL },
    openGraph: {
      title: INSTALL_TITLE,
      description: INSTALL_DESCRIPTION,
      url: INSTALL_URL,
      siteName: "Capture",
      type: "website",
    },
  };
}

export const appMetadata: Metadata = {
  title: "Capture playground",
  description: "Try Capture with a board that stays in this browser.",
  robots: { index: false, follow: true },
};

export function utilityMetadata(title: string, description?: string): Metadata {
  return {
    title: `${title} · capture`,
    ...(description ? { description } : {}),
    robots: { index: false, follow: true },
  };
}

export function writingMetadata(playground: boolean): Metadata {
  const title = "Written with Capture";
  const description =
    "Long-form articles spoken while moving, sorted in Capture, developed with Hermes, and edited by Gleb.";
  if (!playground) {
    return { title, description, robots: { index: false, follow: false } };
  }
  return {
    title,
    description,
    alternates: { canonical: WRITING_URL },
    openGraph: {
      title,
      description,
      url: WRITING_URL,
      siteName: "Capture",
      type: "website",
    },
  };
}

type ArticleIdentity = Pick<CaptureArticle, "slug" | "title" | "description">;

export function articleMetadata(
  playground: boolean,
  article: ArticleIdentity
): Metadata {
  const url = new URL(`writing/${article.slug}`, SITE_URL).toString();
  if (!playground) {
    return {
      title: article.title,
      description: article.description,
      robots: { index: false, follow: false },
    };
  }
  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: url },
    openGraph: {
      title: article.title,
      description: article.description,
      url,
      siteName: "Capture",
      type: "article",
      images: [
        { url: OG_IMAGE_URL, width: 1200, height: 630, alt: OG_IMAGE_ALT },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.description,
      images: [OG_IMAGE_URL],
    },
  };
}

export const siteHome = (playground: boolean) => (playground ? "/" : "/about");
export const appStartUrl = (playground: boolean) => (playground ? "/app" : "/");
export const isPublicHome = (pathname: string, playground: boolean) =>
  playground && pathname === "/";

export function robotsFor(playground: boolean): MetadataRoute.Robots {
  return playground
    ? {
        rules: { userAgent: "*", allow: "/" },
        sitemap: "https://www.trycapture.app/sitemap.xml",
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}

export function sitemapFor(playground: boolean): MetadataRoute.Sitemap {
  return playground
    ? [
        { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
        {
          url: INSTALL_URL,
          changeFrequency: "monthly",
          priority: 0.6,
        },
        {
          url: WRITING_URL,
          changeFrequency: "weekly",
          priority: 0.8,
        },
        ...ARTICLES.map((article) => ({
          url: new URL(`writing/${article.slug}`, SITE_URL).toString(),
          lastModified: article.publishedAt,
          changeFrequency: "monthly" as const,
          priority: 0.7,
        })),
      ]
    : [];
}

export function websiteSchema(playground: boolean) {
  if (!playground) return null;
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Capture",
    alternateName: "trycapture.app",
    url: SITE_URL,
  };
}

export function articleSchema(article: CaptureArticle) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    author: { "@type": "Person", name: "Gleb Bogachev" },
    publisher: { "@type": "Organization", name: "Capture" },
    mainEntityOfPage: new URL(`writing/${article.slug}`, SITE_URL).toString(),
  };
}
