import type { Metadata, MetadataRoute } from "next";

export const SITE_URL = "https://www.trycapture.app/";
export const SITE_TITLE = "Capture — thoughts that sort themselves";
export const SITE_DESCRIPTION =
  "Say a rough thought once. Capture sorts it into an action, a thread, or an intention without making you choose first.";

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
    },
    twitter: {
      card: "summary",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
    },
  };
}

export const appMetadata: Metadata = {
  title: "Capture playground",
  description: "Try Capture with a board that stays in this browser.",
  robots: { index: false, follow: true },
};

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
    ? [{ url: SITE_URL, changeFrequency: "weekly", priority: 1 }]
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
