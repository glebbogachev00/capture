import { permanentRedirect } from "next/navigation";
import { Landing } from "@/app/Landing";
import { PLAYGROUND } from "@/lib/playground";
import { landingMetadata } from "@/lib/seo";

export const metadata = landingMetadata(PLAYGROUND);

export default function AboutPage() {
  if (PLAYGROUND) permanentRedirect("/");
  return <Landing />;
}
