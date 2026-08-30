"use client";

/**
 * Search results — moved out of Capture.tsx as pure composition, the last
 * component the screen file was still hosting. Part of the ratchet
 * program: Capture.tsx keeps orchestration only.
 */

import { fmt, left } from "@/lib/model";
import type { Hits } from "@/lib/search";
import { IntentionCard } from "@/app/Intentions";

/**
 * What a query turned up, across all three kinds at once.
 *
 * Grouped rather than interleaved, because an action and a thread are not
 * comparable enough to rank against each other — and you usually know which
 * kind of thing you are hunting for.
 */
export function SearchResults({
  hits,
  now,
  onOpenThread,
  onOpenIntention,
}: {
  hits: Hits;
  now: number;
  onOpenThread: (id: string, fragId?: string | null) => void;
  onOpenIntention: (id: string) => void;
}) {
  if (!hits.total) {
    return (
      <div className="empty">
        <p className="big">Nothing by that shape.</p>
        <p>Every word has to appear somewhere in the item.</p>
      </div>
    );
  }

  return (
    <div>
      {!!hits.actions.length && (
        <>
          <div className="section-label">Actions · {hits.actions.length}</div>
          {hits.actions.map((a) => {
            const ms = a.expires ? a.expires - now : null;
            return (
              <div className="act" key={a.id}>
                <div className="act-body">
                  <div
                    className={
                      "act-text" + (a.done ? " is-done" : "")
                    }
                  >
                    {a.text}
                  </div>
                  <div className="act-meta">
                    <span>{fmt(a.at)}</span>
                    {a.done && <span>done</span>}
                    {a.faded && <span>faded</span>}
                  </div>
                </div>
                <span className={"chip" + (!ms ? " kept" : "")}>
                  {ms === null ? "kept" : left(ms)}
                </span>
              </div>
            );
          })}
        </>
      )}

      {!!hits.threads.length && (
        <>
          <div className="section-label">Threads · {hits.threads.length}</div>
          {hits.threads.map(({ thread, frags }) => (
            <div className="thread-hit" key={thread.id}>
              <button
                className="tcard"
                onClick={() => onOpenThread(thread.id, frags[0]?.id)}
              >
                <div className="tname">{thread.name}</div>
                <div className="tsum">
                  {thread.summary ||
                    (thread.frags.at(-1)?.text || "").slice(0, 120)}
                </div>
                <div className="act-meta" style={{ marginTop: 9 }}>
                  {frags.length
                    ? `${frags.length} matching note${frags.length === 1 ? "" : "s"}`
                    : "matches the thread itself"}
                </div>
              </button>
              {frags.map((f) => (
                <button
                  className="frag-hit"
                  key={f.id}
                  onClick={() => onOpenThread(thread.id, f.id)}
                  title="Jump to this fragment"
                >
                  <span className="frag-hit-date">{fmt(f.at)}</span>
                  {f.text}
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      {!!hits.intentions.length && (
        <>
          <div className="section-label">
            Intentions · {hits.intentions.length}
          </div>
          {hits.intentions.map((i) => (
            <IntentionCard
              key={i.id}
              intention={i}
              onOpen={() => onOpenIntention(i.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}


