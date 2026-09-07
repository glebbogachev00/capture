"use client";

import type { ProfileIdentity } from "@/lib/model";
import { useStoredImage } from "@/hooks/useStoredImage";

const DEFAULT_NAME = process.env.NEXT_PUBLIC_CAPTURE_PROFILE_NAME ?? "";
const DEFAULT_IMAGE = process.env.NEXT_PUBLIC_CAPTURE_PROFILE_IMAGE ?? "";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** The optional signed edge shared by Intention and Thread cards. */
export function ProfileSignature({ profile }: { profile?: ProfileIdentity }) {
  const storedImage = useStoredImage(profile?.imageId);
  const image = profile?.imageId ? storedImage : DEFAULT_IMAGE;

  if (!profile?.showSignature) return null;
  const name = profile.name || DEFAULT_NAME;
  if (!name && !image) return null;
  return (
    <div className="int-signature" aria-label={`Personalized for ${name || "you"}`}>
      <span className="int-signature-mark" aria-hidden="true">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" />
        ) : (
          initials(name)
        )}
      </span>
      {!!name && <span>{name}</span>}
    </div>
  );
}
