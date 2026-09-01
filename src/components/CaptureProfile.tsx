"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Image as ImageIcon } from "lucide-react";
import type { Thread } from "@/lib/model";
import {
  parseProfileIdentity,
  recurringThreads,
  type ProfileIdentity,
} from "@/lib/profile";
import { shrinkFile } from "@/lib/shrink";

function readSaved(key: string, defaults: ProfileIdentity): ProfileIdentity {
  if (typeof window === "undefined") return defaults;
  return parseProfileIdentity(window.localStorage.getItem(key), defaults);
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
  storageKey = "capture:profile:v1",
}: {
  threads: Thread[];
  onOpenThread: (id: string) => void;
  defaults: ProfileIdentity;
  storageKey?: string;
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey));
  const [identity, setIdentity] = useState(() => readSaved(storageKey, defaults));
  const fileRef = useRef<HTMLInputElement>(null);
  const recurring = useMemo(() => recurringThreads(threads, 3), [threads]);

  const saveIdentity = (next: ProfileIdentity) => {
    setIdentity(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    window.localStorage.setItem(storageKey + ":open", String(next));
  };

  const pickImage = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const image = await shrinkFile(file);
      saveIdentity({ ...identity, image });
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
              aria-label={identity.image ? "Change profile image" : "Add profile image"}
            >
              {identity.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={identity.image} alt="" />
              ) : (
                <>
                  <ImageIcon size={18} strokeWidth={1.7} />
                  <span>Add photo</span>
                </>
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
