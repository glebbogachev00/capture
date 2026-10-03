import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyContextButton } from "@/components/CopyContextButton";
import { PublicThreadView } from "@/components/PublicThreadView";
import {
  PUBLISH_ORIGIN,
  isPublicThreadToken,
  publicThreadMarkdown,
  publicThreadPath,
  publicThreadTextPath,
  type PublicThread,
} from "@/lib/publicThread";
import { publicThreadReader } from "@/lib/publicThreadRoutes.server";
import { SITE_URL } from "@/lib/seo";

/* Rendered per request and never cached, so unpublishing takes effect at once. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ token: string }> };

async function load(token: string): Promise<PublicThread | null> {
  const reader = publicThreadReader();
  if (!reader || !isPublicThreadToken(token)) return null;
  return reader.read(token);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const thread = await load(token).catch(() => null);
  if (!thread) return { title: "Not found · Capture", robots: { index: false, follow: false } };
  return {
    title: `${thread.title} · Capture`,
    description: thread.intro?.slice(0, 160) ?? "A read-only Thread shared from Capture.",
    robots: { index: false, follow: false },
    alternates: { types: { "text/markdown": publicThreadTextPath(thread.token) } },
  };
}

export default async function PublicThreadPage({ params }: Props) {
  const { token } = await params;
  const thread = await load(token);
  if (!thread) notFound();
  const url = PUBLISH_ORIGIN + publicThreadPath(thread.token);

  return (
    <main className="capture-root site-page writing-page public-snapshot-page">
      <div className="capture-wrap site-wrap writing-wrap">
        <header className="capture-head site-head">
          <a className="capture-mark funding-mark" href={SITE_URL}>
            capture<span>.</span>
          </a>
        </header>
        <PublicThreadView
          thread={thread}
          actions={<CopyContextButton markdown={publicThreadMarkdown(thread, url)} />}
        />
      </div>
    </main>
  );
}
