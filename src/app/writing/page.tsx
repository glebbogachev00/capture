import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLES } from "@/content/articles";
import { SHARED_THREADS } from "@/content/sharedThreads";
import { PublicThreadCard, SharedThreadCard } from "@/components/PublicThreadArticle";
import { SiteNav } from "@/components/SiteNav";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { siteHome, writingMetadata } from "@/lib/seo";

export const metadata: Metadata = writingMetadata(PUBLIC_SITE);
const HOME = siteHome(PUBLIC_SITE);

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
                Each article opens as a read-only Capture Thread. Where I&rsquo;ve
                shared them, the source moments sit beside the finished work.
              </p>
            </div>
          </div>
        </section>

        <section className="public-thread-list" aria-labelledby="writing-articles">
          <h2 className="funding-card-label writing-section-label" id="writing-articles">
            Articles
          </h2>
          {ARTICLES.map((article) => (
            <PublicThreadCard article={article} key={article.slug} />
          ))}
        </section>

        <section className="public-thread-list shared-thread-list" aria-labelledby="writing-threads">
          <div className="writing-section-head">
            <h2 className="funding-card-label writing-section-label" id="writing-threads">
              Shared threads
            </h2>
            <p>
              Shorter pieces published straight from Capture. Each one takes an idea
              from someone else&rsquo;s work and applies it to building Capture.
            </p>
          </div>
          {SHARED_THREADS.map((thread) => (
            <SharedThreadCard thread={thread} key={thread.slug} />
          ))}
          <p className="shared-thread-credits">
            Portraits are AI-assisted editorial illustrations. They don&rsquo;t imply
            endorsement. The Alex Karp portrait is adapted from{" "}
            <a href="https://commons.wikimedia.org/wiki/File:Alex-karp.jpg" target="_blank" rel="noopener noreferrer">
              Alex-karp.jpg
            </a>{" "}
            by Benamischarfstein,{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
              CC BY-SA 4.0
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
