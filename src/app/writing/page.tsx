import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLES } from "@/content/articles";
import { PublicThreadCard } from "@/components/PublicThreadArticle";
import { SiteNav } from "@/components/SiteNav";
import { PLAYGROUND } from "@/lib/playground";
import { siteHome, writingMetadata } from "@/lib/seo";

export const metadata: Metadata = writingMetadata(PLAYGROUND);
const HOME = siteHome(PLAYGROUND);

export default function WritingPage() {
  return (
    <main className="capture-root site-page writing-index-page">
      <div className="capture-wrap site-wrap writing-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href={HOME}>
            capture<span>.</span>
          </Link>
          <SiteNav current="writing" homeHref={HOME} />
        </header>

        <section className="site-hero writing-index-hero">
          <div className="site-hero-heading">
            <p className="funding-kicker">Written with Capture</p>
            <h1>How I Started Writing Articles While Walking and Running</h1>
          </div>
          <div className="site-hero-aside">
            <p className="funding-lede site-lede">
              I speak while walking or running, Capture keeps the fragments, and
              Hermes helps me research and shape them. These are the finished pieces.
            </p>
            <div className="writing-index-note">
              <span className="thread-glyph" aria-hidden="true">≋</span>
              <p>
                Each article opens as a read-only Capture Thread, with the source
                moments beside the finished work rather than hidden behind it.
              </p>
            </div>
          </div>
        </section>

        <section className="public-thread-list" aria-label="Articles written with Capture">
          {ARTICLES.map((article) => (
            <PublicThreadCard article={article} key={article.slug} />
          ))}
        </section>
      </div>
    </main>
  );
}
