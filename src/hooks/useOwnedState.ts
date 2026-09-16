"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { getDocumentLifetime } from "@/lib/ownership";

/** Late continuations cannot replace the visible board after revocation. */
export function useOwnedState<T>(initial: T) {
  const [lifetime] = useState(getDocumentLifetime);
  const ownershipStatus = useSyncExternalStore(lifetime.subscribe, lifetime.snapshot, lifetime.snapshot);
  const [data, updateData] = useState(initial);
  const setData = useCallback((next: T) => {
    if (lifetime.active) updateData(next);
  }, [lifetime]);
  return { lifetime, ownershipStatus, data, setData };
}
