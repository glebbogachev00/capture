"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { imgLoad, imgNow, onImageAvailable } from "@/lib/imgCache";

/** Read one image from the shared cache and update when sync supplies it. */
export function useStoredImage(id?: string): string {
  const subscribe = useCallback(
    (notify: () => void) => (id ? onImageAvailable(id, notify) : () => {}),
    [id]
  );
  const read = useCallback(() => (id ? imgNow(id) ?? "" : ""), [id]);
  const image = useSyncExternalStore(subscribe, read, () => "");

  useEffect(() => {
    if (id && !image) void imgLoad(id);
  }, [id, image]);

  return image;
}
