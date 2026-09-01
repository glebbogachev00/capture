import type { Thread } from "./model";

export type ProfileIdentity = {
  name: string;
  image: string;
};

export const EMPTY_PROFILE_IDENTITY: ProfileIdentity = {
  name: "",
  image: "",
};

export function parseProfileIdentity(
  saved: string | null,
  defaults: ProfileIdentity = EMPTY_PROFILE_IDENTITY
): ProfileIdentity {
  if (!saved) return defaults;
  try {
    const value = JSON.parse(saved) as Partial<ProfileIdentity>;
    return {
      name: typeof value.name === "string" ? value.name : defaults.name,
      image: typeof value.image === "string" ? value.image : defaults.image,
    };
  } catch {
    return defaults;
  }
}

export function recurringThreads(threads: Thread[], limit = 3): Thread[] {
  return [...threads]
    .sort((a, b) => {
      const byLayers = b.frags.length - a.frags.length;
      if (byLayers) return byLayers;
      const aAt = a.frags.at(-1)?.at ?? 0;
      const bAt = b.frags.at(-1)?.at ?? 0;
      return bAt - aAt;
    })
    .slice(0, Math.max(0, limit));
}
