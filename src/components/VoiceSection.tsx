"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { CaptureEntry } from "@/lib/ledger";
import type { ProfileIdentity, ProfileUpdate, Thread } from "@/lib/model";
import { ownedFetch } from "@/lib/ownership";
import { recurringThreads } from "@/lib/profile";
import { VOICE_MIN_WORDS, spokenNotes, spokenWords, voiceDue, voiceSample } from "@/lib/voice";

/* When this device may ask for a reading again. A reading takes about
   twenty seconds; one cut off (the page closed, the server restarted) is
   asked again on the next visit once its own time is up. Only an answer that
   says it failed waits hours. */
const VOICE_RUNNING_MS = 3 * 60_000;
const VOICE_FAILED_MS = 6 * 60 * 60_000;
const VOICE_NEXT_KEY = "capture:voice:next";
const voiceWaitUntil = (until: number) => {
  try {
    window.localStorage.setItem(VOICE_NEXT_KEY, String(until));
  } catch { /* storage unavailable: this visit only */ }
};

/** Read how this person talks when there is enough and it is due, then keep
 * it on the profile. Says how many words there are and whether it is reading. */
function useVoiceReading(
  ledger: CaptureEntry[],
  threads: Thread[],
  voice: ProfileIdentity["voice"],
  onProfileChange: ((profile: ProfileUpdate) => Promise<void>) | undefined,
): { words: number; reading: boolean } {
  const notes = useMemo(() => spokenNotes(ledger), [ledger]);
  const words = useMemo(() => spokenWords(notes), [notes]);
  const recurring = useMemo(() => recurringThreads(threads, 3).map((thread) => thread.name), [threads]);
  const [reading, setReading] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !onProfileChange || !voiceDue(voice, words)) return;
    try {
      if (Date.now() < Number(window.localStorage.getItem(VOICE_NEXT_KEY) || 0)) return;
    } catch { /* storage unavailable: try once this visit */ }
    voiceWaitUntil(Date.now() + VOICE_RUNNING_MS);
    started.current = true;
    void Promise.resolve()
      .then(() => {
        setReading(true);
        return ownedFetch("/api/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sample: voiceSample(notes), words, recurring }),
        });
      })
      .then(async (response) => {
        const { voice: read } = response.ok ? ((await response.json()) as { voice?: ProfileIdentity["voice"] }) : {};
        if (!read) return voiceWaitUntil(Date.now() + VOICE_FAILED_MS);
        await onProfileChange((current) => ({ ...current, voice: read }));
        voiceWaitUntil(0);
      })
      .catch(() => { /* cut off: the next visit asks again once its time is up */ })
      .finally(() => setReading(false));
  }, [notes, words, recurring, voice, onProfileChange]);
  return { words, reading };
}

/**
 * Your voice, as its own row on The Record: there from the first day, so a
 * person knows it is coming and how far off it is; open it once it has been
 * read to see how you talk, the words you reach for, and two notes in your
 * voice. What you copy for your AI carries it.
 */
export function VoiceSection({
  threads,
  ledger,
  voice,
  onProfileChange,
}: {
  threads: Thread[];
  ledger: CaptureEntry[];
  voice?: ProfileIdentity["voice"];
  onProfileChange?: (profile: ProfileUpdate) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { words, reading } = useVoiceReading(ledger, threads, voice, onProfileChange);
  const ready = !!voice?.patterns.length;
  const meta = reading
    ? t("reading…")
    : ready
      ? t("ready")
      : words >= VOICE_MIN_WORDS
        ? t("soon")
        : t("{count} of {total} words", { count: words.toLocaleString(), total: VOICE_MIN_WORDS.toLocaleString() });

  return (
    <div className="record-section">
      <button
        className="record-disclosure"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? t("Hide your voice") : t("Show your voice")}
      >
        <span className="record-disclosure-title">{t("Your voice")}</span>
        <span className="record-disclosure-meta">{meta}</span>
        {open ? <ChevronUp size={21} strokeWidth={1.7} /> : <ChevronDown size={21} strokeWidth={1.7} />}
      </button>

      {open && (
        <div className="record-disclosure-body">
          {ready ? (
            <div className="record-voice">
              <ul className="record-voice-patterns">
                {voice.patterns.map((pattern) => <li key={pattern}>{pattern}</li>)}
              </ul>
              {!!voice.phrases.length && (
                <p className="record-voice-phrases">{voice.phrases.map((phrase) => `“${phrase}”`).join(" · ")}</p>
              )}
              {/* What an agent drafting as you is told you stand for. */}
              {!!voice.viewpoint?.length && (
                <>
                  <div className="record-profile-label">{t("What you believe")}</div>
                  <ul className="record-voice-patterns">
                    {voice.viewpoint.map(({ claim }) => <li key={claim}>{claim}</li>)}
                  </ul>
                </>
              )}
              {voice.samples.map((sample) => (
                <blockquote key={sample.about} className="record-voice-sample">
                  <small>{sample.about}</small>
                  {sample.text}
                </blockquote>
              ))}
            </div>
          ) : (
            <p className="record-voice-waiting">
              {reading
                ? t("Reading how you talk. It takes about twenty seconds.")
                : t("Once you've said about {total} words, Capture shows how you talk here, and what you copy for your AI carries it, so it writes like you.", { total: VOICE_MIN_WORDS.toLocaleString() })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
