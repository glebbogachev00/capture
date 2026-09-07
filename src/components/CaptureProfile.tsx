"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Image as ImageIcon } from "lucide-react";
import {
  type ProfileDraft,
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

function readSaved(key: string): ProfileDefaults {
  if (typeof window === "undefined") return EMPTY_PROFILE_IDENTITY;
  return parseProfileIdentity(window.localStorage.getItem(key));
}

function readOpen(key: string): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(key + ":open") !== "false";
}

function profileLine(threads: Thread[]): string {
  const names = threads.map((thread) => thread.name.replace(/\.$/, ""));
  if (!names.length) return "Your recurring threads will appear here.";
  if (names.length === 1) return `Your record keeps returning to ${names[0]}.`;
  if (names.length === 2)
    return `Your record keeps returning to ${names[0]} and ${names[1]}.`;
  return `Your record keeps returning to ${names[0]}, ${names[1]}, and ${names[2]}.`;
}

export function CaptureProfile({
  threads,
  onOpenThread,
  defaults,
  profile,
  onProfileChange,
  migrationReady = true,
  storageKey = "capture:profile:v1",
}: {
  threads: Thread[];
  onOpenThread: (id: string) => void;
  defaults: ProfileDefaults;
  profile?: ProfileIdentity;
  onProfileChange?: (profile: ProfileUpdate) => Promise<void>;
  migrationReady?: boolean;
  /** Kept for the open preference and one-time migration of v1 local data. */
  storageKey?: string;
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
  const identity: ProfileDraft = {
    name: profile?.name ?? (legacy.name || defaults.name),
    imageId: profile?.imageId,
    showSignature: profile?.showSignature ?? false,
  };


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


  const saveIdentity = (next: ProfileDraft) => {
    if (onProfileChange) void onProfileChange(next);
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
        aria-label={`${open ? "Hide" : "Show"} your Capture profile`}
      >
        <span>Your Capture</span>
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
              aria-label={imageSrc ? "Change profile image" : "Add profile image"}
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
                  aria-label="Your name"
                  value={identity.name}
                  maxLength={48}
                  placeholder="Your name"
                  onChange={(event) =>
                    saveIdentity({ ...identity, name: event.target.value })
                  }
                />
                <span className="landed-point" aria-label="Formed from your Capture record">
                  <i />
                  <i />
                  <i />
                  <b />
                </span>
              </div>
              <span className="record-profile-origin">formed from your record</span>
            </div>
          </div>

          <p className="record-profile-reading">{profileLine(recurring)}</p>

          {!!recurring.length && (
            <div className="record-profile-threads">
              <div className="record-profile-label">What keeps returning</div>
              {recurring.map((thread) => (
                <button
                  key={thread.id}
                  className="record-profile-thread"
                  onClick={() => onOpenThread(thread.id)}
                >
                  <span>
                    <b>{thread.name}</b>
                    <small>{thread.summary || "A thread still taking shape."}</small>
                  </span>
                  <em>
                    {thread.frags.length} layer{thread.frags.length === 1 ? "" : "s"}
                  </em>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
