import type { MetadataRoute } from "next";
import { PLAYGROUND } from "@/lib/playground";
import { sitemapFor } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapFor(PLAYGROUND);
}
