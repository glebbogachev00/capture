import { Capture } from "../Capture";
import { appMetadata } from "@/lib/seo";

export const metadata = appMetadata;

/** The board. On the playground / is the landing and the app lives here;
    on a personal instance this is simply a second door to the same board. */
export default function AppPage() {
  return <Capture />;
}
