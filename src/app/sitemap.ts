import type { MetadataRoute } from "next";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { sitemapFor } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapFor(PUBLIC_SITE);
}
