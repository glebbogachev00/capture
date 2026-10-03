"use client";

import { useMemo, useState } from "react";
import { fmt, type Thread } from "@/lib/model";
import {
  HANDOFF_MAX,
  PUBLIC_THREAD_LIMITS,
  PUBLISH_ORIGIN,
  PublicThreadInputSchema,
  encodeHandoff,
  publicThreadSourceKey,
} from "@/lib/publicThread";
import { PublicThreadView } from "./PublicThreadView";

/**
 * Choose what a public snapshot holds, see it exactly as readers will, then
 * continue to Capture Cloud to publish. Nothing leaves this device until then,
 * and only what is shown here leaves: the ticked notes' text, the title, the
 * introduction and the name. Dates, photos, the AI summary and everything else
 * on the board stay here.
 */
export function PublishThreadSheet({ thread, publisherName, onClose }: {
  thread: Thread;
  publisherName?: string;
  onClose: () => void;
}) {
  const notes = useMemo(() => thread.frags.filter((frag) => frag.text.trim()), [thread.frags]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [title, setTitle] = useState(thread.name);
  const [intro, setIntro] = useState("");
  const [byline, setByline] = useState(publisherName?.trim() ?? "");
  const [error, setError] = useState("");

  const selected = notes.filter((frag) => picked.has(frag.id)).map((frag) => ({ text: frag.text.trim() }));
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function continueToCloud() {
    setError("");
    const parsed = PublicThreadInputSchema.safeParse({
      title, intro, byline, fragments: selected, sourceKey: await publicThreadSourceKey(thread.id),
    });
    if (!parsed.success) {
      setError(selected.length === 0 ? "Tick at least one note to publish." : "This is too long to publish as one snapshot. Untick some notes.");
      return;
    }
    const hash = encodeHandoff(parsed.data);
    if (hash.length > HANDOFF_MAX) {
      setError("This is too long to publish as one snapshot. Untick some notes.");
      return;
    }
    window.open(`${PUBLISH_ORIGIN}/publish${hash}`, "_blank", "noopener");
  }

  return (
    <section className="publish-sheet" aria-labelledby="publish-sheet-title">
      <div className="publish-sheet-head">
        <h2 id="publish-sheet-title">Publish a read-only link</h2>
        <button type="button" className="ghost" onClick={onClose}>Close</button>
      </div>
      <p className="cap-hint">
        Only what you see in the preview is sent: the notes you tick, the title, the introduction and the name.
        Dates, photos, the summary and the rest of your board stay here. You confirm on Capture Cloud.
      </p>

      <label className="publish-field">
        <span>Title</span>
        <input value={title} maxLength={PUBLIC_THREAD_LIMITS.title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="publish-field">
        <span>Introduction (optional)</span>
        <textarea value={intro} maxLength={PUBLIC_THREAD_LIMITS.intro} rows={3} onChange={(event) => setIntro(event.target.value)}
          placeholder="A line or two for readers. Written by you, not generated." />
      </label>
      <label className="publish-field">
        <span>Your name (optional)</span>
        <input value={byline} maxLength={PUBLIC_THREAD_LIMITS.byline} onChange={(event) => setByline(event.target.value)} />
      </label>

      <div className="publish-picks">
        <div className="publish-picks-head">
          <span>{selected.length} of {notes.length} notes</span>
          <button type="button" className="ghost" onClick={() => setPicked(new Set(notes.map((frag) => frag.id)))}>Select all</button>
          <button type="button" className="ghost" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
        {notes.map((frag) => (
          <label key={frag.id} className={"publish-pick" + (picked.has(frag.id) ? " on" : "")}>
            <input type="checkbox" checked={picked.has(frag.id)} onChange={() => toggle(frag.id)} />
            <span>
              <small>{fmt(frag.at)}{frag.imgs?.length ? " · photos stay private" : ""}</small>
              {frag.text.length > 240 ? `${frag.text.slice(0, 240)}…` : frag.text}
            </span>
          </label>
        ))}
      </div>

      {selected.length > 0 && title.trim() && (
        <div className="publish-preview">
          <PublicThreadView
            preview
            thread={{
              title: title.trim(), intro: intro.trim() || null, byline: byline.trim() || null, fragments: selected,
              publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            }}
          />
        </div>
      )}

      {error && <p className="publish-error" role="alert">{error}</p>}
      <div className="publish-actions">
        <button type="button" className="capture-btn" disabled={selected.length === 0 || !title.trim()} onClick={continueToCloud}>
          Continue to Capture Cloud
        </button>
      </div>
    </section>
  );
}
