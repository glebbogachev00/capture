"use client";

import { useMemo, useState } from "react";
import type { Thread } from "@/lib/model";
import {
  HANDOFF_MAX,
  PUBLIC_THREAD_LIMITS,
  PUBLISH_ORIGIN,
  PublicThreadInputSchema,
  encodeHandoff,
  publicThreadSourceKey,
} from "@/lib/publicThread";
import { PublicThreadText } from "./PublicThreadText";

/**
 * Publishing, local half: the notes themselves are the preview. Tick what to
 * share; the title and an optional introduction edit in place. Publish hands
 * exactly that, and nothing else, to Capture Cloud to confirm. Dates, photos,
 * the summary and the rest of the board never leave the device.
 */
/* Title and introduction grow with their text instead of scrolling. */
const grow = (field: HTMLTextAreaElement | null) => {
  if (!field) return;
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
};

export function PublishThreadSheet({ thread, publisherName }: {
  thread: Thread;
  publisherName?: string;
}) {
  const notes = useMemo(() => thread.frags.filter((frag) => frag.text.trim()), [thread.frags]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [title, setTitle] = useState(thread.name);
  const [intro, setIntro] = useState("");
  const [error, setError] = useState("");

  const selected = notes.filter((frag) => picked.has(frag.id)).map((frag) => ({ text: frag.text.trim() }));
  const all = picked.size === notes.length && notes.length > 0;
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function publish() {
    setError("");
    const parsed = PublicThreadInputSchema.safeParse({
      title, intro, byline: publisherName, fragments: selected, sourceKey: await publicThreadSourceKey(thread.id),
    });
    const hash = parsed.success ? encodeHandoff(parsed.data) : "";
    if (!parsed.success || hash.length > HANDOFF_MAX) {
      setError("Too long to publish at once. Untick a few notes.");
      return;
    }
    window.open(`${PUBLISH_ORIGIN}/publish${hash}`, "_blank", "noopener");
  }

  return (
    <section className="publish-sheet" aria-label="Publish">
      <textarea
        className="publish-title"
        value={title}
        maxLength={PUBLIC_THREAD_LIMITS.title}
        rows={1}
        ref={grow}
        onChange={(event) => { setTitle(event.target.value.replace(/\n/g, " ")); grow(event.target); }}
        aria-label="Title"
      />
      <textarea
        className="publish-intro"
        value={intro}
        maxLength={PUBLIC_THREAD_LIMITS.intro}
        rows={1}
        ref={grow}
        onChange={(event) => { setIntro(event.target.value); grow(event.target); }}
        placeholder="Add an introduction (optional)"
        aria-label="Introduction"
      />

      <div className="publish-notes">
        {notes.map((frag) => (
          <label key={frag.id} className={"publish-note-pick" + (picked.has(frag.id) ? " on" : "")}>
            <input type="checkbox" checked={picked.has(frag.id)} onChange={() => toggle(frag.id)} />
            <div className="publish-note-text"><PublicThreadText text={frag.text} /></div>
          </label>
        ))}
      </div>

      {error && <p className="publish-error" role="alert">{error}</p>}
      <div className="publish-bar publish-bar-sticky">
        <button type="button" className="capture-btn" disabled={selected.length === 0 || !title.trim()} onClick={publish}>
          Publish
        </button>
        <button type="button" className="ghost" onClick={() => setPicked(all ? new Set() : new Set(notes.map((frag) => frag.id)))}>
          {all ? "Clear" : "Select all"}
        </button>
        <span className="publish-hint">Only ticked notes are shared.</span>
      </div>
    </section>
  );
}
