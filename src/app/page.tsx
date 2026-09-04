import { Capture } from "./Capture";
import { Landing } from "./Landing";
import { PLAYGROUND } from "@/lib/playground";
import { landingMetadata } from "@/lib/seo";

export const metadata = landingMetadata(PLAYGROUND);

/**
 * The playground's front door is the landing page — a stranger gets the
 * sentence and the videos before the empty board — and the board itself
 * lives at /app. A personal instance is the other way round: the board IS
 * the app, and the landing stays at /about.
 */
export default function Home() {
  return PLAYGROUND ? <Landing /> : <Capture />;
}
