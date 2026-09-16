import { permanentRedirect } from "next/navigation";
import { Landing } from "@/app/Landing";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { landingMetadata } from "@/lib/seo";

export const metadata = landingMetadata(PUBLIC_SITE);

export default function AboutPage() {
  if (PUBLIC_SITE) permanentRedirect("/");
  return <Landing />;
}
