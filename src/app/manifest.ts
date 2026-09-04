import type { MetadataRoute } from "next";
import { PLAYGROUND } from "@/lib/playground";
import { appStartUrl } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "capture",
    short_name: "capture",
    description:
      "One capture surface, three destinations, self-clearing. Actions fade. Threads never do.",
    start_url: appStartUrl(PLAYGROUND),
    display: "standalone",
    background_color: "#EDEFE8",
    theme_color: "#EDEFE8",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
