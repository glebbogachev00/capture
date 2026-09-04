import type { MetadataRoute } from "next";
import { PLAYGROUND } from "@/lib/playground";
import { robotsFor } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return robotsFor(PLAYGROUND);
}
