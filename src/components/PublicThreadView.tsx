import type { ReactNode } from "react";
import { PUBLIC_THREAD_NOTICE, publicThreadDates, type PublicThread } from "@/lib/publicThread";
import { PublicThreadText } from "./PublicThreadText";

function Sediment({ count = 4 }: { count?: number }) {
  return (
    <span className="public-sediment" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <i key={index} style={{ width: `${100 - index * 14}%` }} />)}
    </span>
  );
}

/**
 * One rendering of a snapshot for every place it is seen: the owner's preview
 * before publishing, the Cloud confirmation, and the public page. What the
 * owner reviews is therefore exactly what a reader gets.
 */
export function PublicThreadView({ thread, actions, preview = false }: {
  thread: Omit<PublicThread, "token">;
  /** The public page's Copy context and plain-text link. */
  actions?: ReactNode;
  preview?: boolean;
}) {
  return (
    <div className="public-thread-content public-snapshot">
      <header className="public-thread-head">
        <div className="public-thread-kicker">
          <span className="thread-glyph" aria-hidden="true">≋</span>
          <span>{preview ? "Preview · not published yet" : "Shared snapshot"}</span>
        </div>
        <h1>{thread.title}</h1>
        <div className="public-thread-meta">
          {thread.byline && <span>{thread.byline}</span>}
          {!preview && <span>{publicThreadDates(thread)}</span>}
        </div>
        <Sediment />
      </header>

      {thread.intro && (
        <section className="state public-thread-state" aria-label="Introduction">
          <PublicThreadText text={thread.intro} />
        </section>
      )}

      <article className="finished-thread public-snapshot-body" data-capture-thread="read-only">
        <div className="article-body">
          {thread.fragments.map((fragment, index) => (
            <section className="public-snapshot-fragment" key={index}>
              <PublicThreadText text={fragment.text} />
            </section>
          ))}
        </div>
      </article>

      {!preview && (
        <footer className="public-snapshot-foot">
          {actions}
          <p>{PUBLIC_THREAD_NOTICE}</p>
        </footer>
      )}
    </div>
  );
}
