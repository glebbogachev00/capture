import type { MetadataRoute } from "next";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { robotsFor } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return robotsFor(PUBLIC_SITE);
}
