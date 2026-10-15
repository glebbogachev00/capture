"use client";

import { countNoun, t } from "@/lib/i18n";
import { getDocumentLifetime } from "@/lib/ownership";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Image as ImageIcon } from "lucide-react";
import {
  type ProfileIdentity,
  type ProfileUpdate,
  type Thread,
  uid,
} from "@/lib/model";
import {
  EMPTY_PROFILE_IDENTITY,
  parseProfileIdentity,
  recurringThreads,
  type ProfileDefaults,
} from "@/lib/profile";
import { imgSave } from "@/lib/imgCache";
import { useStoredImage } from "@/hooks/useStoredImage";
import { shrinkFile } from "@/lib/shrink";
import { ownedFetch } from "@/lib/ownership";
import type { CaptureEntry } from "@/lib/ledger";
import { spokenNotes, spokenWords, voiceDue, voiceSample } from "@/lib/voice";

/* A reading that failed waits before this device tries again. */
const VOICE_RETRY_MS = 6 * 60 * 60_000;
const VOICE_TRIED_KEY = "capture:voice:tried";

/** Read how this person talks when there is enough and it is due, then keep
 * it on the profile. Quiet: nothing shows until a reading exists. */
function useVoiceReading(
  ledger: CaptureEntry[] | undefined,
  recurring: Thread[],
  profile: ProfileIdentity | undefined,
  onProfileChange: ((profile: ProfileUpdate) => Promise<void>) | undefined,
) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !ledger || !onProfileChange) return;
    const notes = spokenNotes(ledger);
    const words = spokenWords(notes);
    if (!voiceDue(profile?.voice, words)) return;
    try {
      const tried = Number(window.localStorage.getItem(VOICE_TRIED_KEY) || 0);
      if (Date.now() - tried < VOICE_RETRY_MS) return;
      window.localStorage.setItem(VOICE_TRIED_KEY, String(Date.now()));
    } catch { /* storage unavailable: try once this visit */ }
    started.current = true;
    void ownedFetch("/api/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sample: voiceSample(notes), words, recurring: recurring.map((thread) => thread.name) }),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const { voice } = (await response.json()) as { voice?: ProfileIdentity["voice"] };
        if (voice) await onProfileChange((current) => ({ ...current, voice }));
      })
      .catch(() => { /* the next visit after the wait tries again */ });
  }, [ledger, recurring, profile?.voice, onProfileChange]);
}

function readSaved(key: string): ProfileDefaults {
  if (typeof window === "undefined" || getDocumentLifetime().cloud) return EMPTY_PROFILE_IDENTITY;
  return parseProfileIdentity(window.localStorage.getItem(key));
}

function readOpen(key: string): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(key + ":open") !== "false";
}

function profileLine(threads: Thread[]): string {
  const names = threads.map((thread) => thread.name.replace(/\.$/, ""));
  if (!names.length) return t("Your recurring threads will appear here.");
  if (names.length === 1) return t("Your record keeps returning to {a}.", { a: names[0] });
  if (names.length === 2)
    return t("Your record keeps returning to {a} and {b}.", { a: names[0], b: names[1] });
  return t("Your record keeps returning to {a}, {b}, and {c}.", { a: names[0], b: names[1], c: names[2] });
}

export function CaptureProfile({
  threads,
  onOpenThread,
  defaults,
  profile,
  onProfileChange,
  migrationReady = true,
  storageKey = "capture:profile:v1",
  ledger,
}: {
  threads: Thread[];
  onOpenThread: (id: string) => void;
  defaults: ProfileDefaults;
  profile?: ProfileIdentity;
  onProfileChange?: (profile: ProfileUpdate) => Promise<void>;
  migrationReady?: boolean;
  /** Kept for the open preference and one-time migration of v1 local data. */
  storageKey?: string;
  /** The Record, whose spoken words the voice is read from. */
  ledger?: CaptureEntry[];
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey));
  const [legacy] = useState(() => readSaved(storageKey));
  const storedImage = useStoredImage(profile?.imageId);
  const imageSrc = profile?.imageId
    ? storedImage
    : legacy.image || defaults.image;
  const fileRef = useRef<HTMLInputElement>(null);
  const migrationStarted = useRef(false);
  const recurring = useMemo(() => recurringThreads(threads, 3), [threads]);
  const name = profile?.name ?? (legacy.name || defaults.name);
  useVoiceReading(ledger, recurring, profile, onProfileChange);


  /* A profile created before board sync lived only in localStorage. Move it
     once into the board and put its photo bytes on the normal image path. */
  useEffect(() => {
    if (
      migrationStarted.current ||
      !migrationReady ||
      profile ||
      !onProfileChange ||
      (!legacy.name && !legacy.image)
    )
      return;
    migrationStarted.current = true;
    void (async () => {
      const imageId = legacy.image ? uid() : undefined;
      if (imageId) await imgSave(imageId, legacy.image);
      await onProfileChange((current) =>
        current.name || current.imageId || current.showSignature !== undefined
          ? current
          : { name: legacy.name, imageId, showSignature: false }
      );
    })().catch(() => {
      /* Keep the local copy so the next mount can try the migration again. */
      migrationStarted.current = false;
    });
  }, [legacy, migrationReady, onProfileChange, profile, storageKey]);


  const saveName = (name: string) => {
    if (onProfileChange) void onProfileChange((current) => ({ ...current, name }));
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    window.localStorage.setItem(storageKey + ":open", String(next));
  };

  const pickImage = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !onProfileChange) return;
    try {
      const image = await shrinkFile(file);
      const imageId = uid();
      await imgSave(imageId, image);
      await onProfileChange((current) => ({ ...current, imageId }));
    } catch {
      /* Keep the current portrait when the device cannot read the file. */
    }
  };

  return (
    <div className="record-profile">
      <button
        className="record-profile-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? t("Hide your Capture profile") : t("Show your Capture profile")}
      >
        <span>{t("Your Capture")}</span>
        {open ? (
          <ChevronUp size={21} strokeWidth={1.7} />
        ) : (
          <ChevronDown size={21} strokeWidth={1.7} />
        )}
      </button>

      {open && (
        <div className="record-profile-body">
          <div className="record-profile-identity">
            <button
              className="record-profile-photo"
              onClick={() => fileRef.current?.click()}
              aria-label={imageSrc ? t("Change profile image") : t("Add profile image")}
            >
              {imageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageSrc} alt="" />
              ) : (
                <ImageIcon size={20} strokeWidth={1.6} />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void pickImage(event.target.files);
                event.target.value = "";
              }}
            />

            <div className="record-profile-person">
              <div className="record-profile-name-row">
                <input
                  className="record-profile-name"
                  aria-label={t("Your name")}
                  value={name}
                  maxLength={48}
                  placeholder={t("Your name")}
                  onChange={(event) =>
                    saveName(event.target.value)
                  }
                />
                <span className="landed-point" aria-label={t("Formed from your Capture record")}>
                  <i />
                  <i />
                  <i />
                  <b />
                </span>
              </div>
              <span className="record-profile-origin">{t("formed from your record")}</span>
            </div>
          </div>

          <p className="record-profile-reading">{profileLine(recurring)}</p>

          {!!recurring.length && (
            <div className="record-profile-threads">
              <div className="record-profile-label">{t("What keeps returning")}</div>
              {recurring.map((thread) => (
                <button
                  key={thread.id}
                  className="record-profile-thread"
                  onClick={() => onOpenThread(thread.id)}
                >
                  <span>
                    <b>{thread.name}</b>
                    <small>{thread.summary || t("A thread still taking shape.")}</small>
                  </span>
                  <em>
                    {countNoun(thread.frags.length, "layer")}
                  </em>
                </button>
              ))}
            </div>
          )}

          {!!profile?.voice?.patterns.length && (
            <div className="record-profile-voice">
              <div className="record-profile-label">{t("Your voice")}</div>
              <ul className="record-voice-patterns">
                {profile.voice.patterns.map((pattern) => <li key={pattern}>{pattern}</li>)}
              </ul>
              {!!profile.voice.phrases.length && (
                <p className="record-voice-phrases">{profile.voice.phrases.map((phrase) => `“${phrase}”`).join(" · ")}</p>
              )}
              {profile.voice.samples.map((sample) => (
                <blockquote key={sample.about} className="record-voice-sample">
                  <small>{sample.about}</small>
                  {sample.text}
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
