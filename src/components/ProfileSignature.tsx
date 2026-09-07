"use client";

import type { ProfileIdentity } from "@/lib/model";
import { useStoredImage } from "@/hooks/useStoredImage";

const DEFAULT_NAME = process.env.NEXT_PUBLIC_CAPTURE_PROFILE_NAME ?? "";
const DEFAULT_IMAGE = process.env.NEXT_PUBLIC_CAPTURE_PROFILE_IMAGE ?? "";

/** The optional signed edge shared by Intention and Thread cards. */
export function ProfileSignature({ profile }: { profile?: ProfileIdentity }) {
  const storedImage = useStoredImage(profile?.imageId);
  const image = profile?.imageId ? storedImage : DEFAULT_IMAGE;

  if (!profile?.showSignature) return null;
  const name = profile.name || DEFAULT_NAME;
  if (!name && !image) return null;
  return (
    <div className="int-signature" aria-label={`Personalized for ${name || "you"}`}>
      {image && (
        <span className="int-signature-mark" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" />
        </span>
      )}
      {!!name && (
        <span className="int-signature-name">
          <span>{name}</span>
        </span>
      )}
    </div>
  );
}
