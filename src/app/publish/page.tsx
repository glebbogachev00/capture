import { notFound } from "next/navigation";
import { PublishConfirm } from "@/components/PublishConfirm";
import { publicThreadMode } from "@/lib/publicThreadStore.server";
import { utilityMetadata } from "@/lib/seo";
import { getCloudConfig } from "@/lib/supabase/config";

export const metadata = { ...utilityMetadata("Publish a Thread"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Where the local app hands a reviewed snapshot to Capture Cloud. Nothing is
 * stored by opening this page: the snapshot lives in the URL fragment until the
 * signed-in owner presses Publish. */
export default function PublishPage() {
  const mode = publicThreadMode();
  if (mode === "off") notFound();
  const cloud = getCloudConfig();
  return (
    <main className="capture-root site-page writing-page public-snapshot-page">
      <div className="capture-wrap site-wrap writing-wrap">
        <header className="capture-head site-head">
          <span className="capture-mark funding-mark">capture<span>.</span></span>
        </header>
        <PublishConfirm cloudConfig={mode === "cloud" && cloud?.status === "ready" ? cloud : null} />
      </div>
    </main>
  );
}
