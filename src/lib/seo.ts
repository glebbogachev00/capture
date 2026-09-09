import type { Metadata, MetadataRoute } from "next";

export const SITE_URL = "https://www.trycapture.app/";
export const SITE_TITLE = "Capture — messy thoughts that sort themselves";
export const SITE_DESCRIPTION =
  "Capture rough thoughts by voice or text. It sorts them into actions, threads, or intentions without making you choose first.";
export const INSTALL_URL = new URL("install", SITE_URL).toString();
export const OG_IMAGE_URL = new URL("og.png", SITE_URL).toString();
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
