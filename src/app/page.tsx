import { OwnershipBoundary } from "@/components/OwnershipBoundary";
import { isCloudEnabled } from "@/lib/cloudBoard";
import { Capture } from "./Capture";
import { Landing } from "./Landing";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { landingMetadata } from "@/lib/seo";

export const metadata = landingMetadata(PUBLIC_SITE);

/**
 * The playground's front door is the landing page — a stranger gets the
 * sentence and the videos before the empty board — and the board itself
 * lives at /app. A personal instance is the other way round: the board IS
 * the app, and the landing stays at /about.
 */
export default function Home() {
  return PUBLIC_SITE ? <Landing /> : <OwnershipBoundary cloud={isCloudEnabled()}><Capture /></OwnershipBoundary>;
}
