import Link from "next/link";
import type { CaptureArticle } from "@/content/articles";
import { articleReadingMinutes, articleWordCount } from "@/content/articles";
import { SiteNav } from "./SiteNav";

function Sediment({ count = 3 }: { count?: number }) {
  return (
    <span className="public-sediment" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <i key={index} style={{ width: `${100 - index * 14}%` }} />
      ))}
    </span>
  );
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function PublicThreadArticle({ article }: { article: CaptureArticle }) {
  const blocks = article.body.split(/\n\n+/).filter(Boolean);

  return (
    <main className="capture-root site-page writing-page">
      <div className="capture-wrap site-wrap writing-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href="/">
            capture<span>.</span>
          </Link>
          <SiteNav current="writing" />
        </header>

        <div className="thread-route" aria-label="Article location">
          <Link href="/writing">Written with Capture</Link>
          <span aria-hidden="true">/</span>
          <span>Thread</span>
        </div>

        <header className="public-thread-head">
          <div className="public-thread-kicker">
            <span className="thread-glyph" aria-hidden="true">≋</span>
            <span>Public Capture Thread · read-only</span>
          </div>
          <h1>{article.title}</h1>
          <p className="public-thread-explainer">
            A Thread keeps related fragments together and its current summary up to date.
          </p>
          <div className="public-thread-meta">
            <span>By Gleb Bogachev</span>
            <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
            <span>{articleWordCount(article).toLocaleString("en")} words</span>
            <span>{articleReadingMinutes(article)} min read</span>
          </div>
          <Sediment count={4} />
        </header>

        <section className="state public-thread-state" aria-labelledby="thread-state-title">
          <h2 id="thread-state-title">Where this stands</h2>
          <p>{article.threadSummary}</p>
        </section>

        <p className="article-provenance">{article.provenance}</p>

        <section className="public-record" aria-labelledby="record-title">
          <div className="public-record-heading">
            <div>
              <p className="funding-card-label">Selected source moments</p>
              <h2 id="record-title">The record behind this article</h2>
              <p className="public-record-note">
                Selected, lightly edited summaries. Private raw captures stay private.
              </p>
            </div>
            <span>{article.sourceMoments.length} source moments</span>
          </div>
          <div className="public-fragments">
            {article.sourceMoments.map((moment, index) => (
              <div className="public-fragment" key={`${moment.label}-${index}`}>
                <div className="public-fragment-date">
                  <span>{moment.label}</span>
                  <span>Public summary {String(index + 1).padStart(2, "0")}</span>
                </div>
                <p>{moment.text}</p>
              </div>
            ))}
          </div>
        </section>

        <article className="finished-thread" data-capture-thread="read-only">
          <div className="finished-thread-label">
            <span>Finished article</span>
            <span>Read-only</span>
          </div>
          <div className="article-body">
            {blocks.map((block, index) => {
              if (block.startsWith("## ")) {
                return <h2 key={index}>{block.slice(3)}</h2>;
              }
              if (block.startsWith("> ")) {
                return <blockquote key={index}>{block.slice(2)}</blockquote>;
              }
              return <p key={index}>{block}</p>;
            })}
          </div>
        </article>

        <footer className="article-end">
          <div>
            <p className="funding-card-label">The next rough thought</p>
            <p>Say it before you decide where it belongs.</p>
          </div>
          <div className="site-actions article-end-actions">
            <Link className="capture-btn" href="/app">Try Capture</Link>
            <Link className="ghost site-ghost" href="/install">Install locally</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

export function PublicThreadCard({ article }: { article: CaptureArticle }) {
  return (
    <Link className="public-thread-card" href={`/writing/${article.slug}`}>
      <span className="public-thread-card-kind">
        <span className="thread-glyph" aria-hidden="true">≋</span>
        Read-only thread
      </span>
      <h2>{article.title}</h2>
      <p>{article.description}</p>
      <div className="public-thread-card-foot">
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
        <span>{articleReadingMinutes(article)} min read</span>
        <span>{article.sourceMoments.length} source moments</span>
      </div>
      <span className="public-thread-card-open">Open read-only Thread →</span>
    </Link>
  );
}
