"use client";

import { useEffect, useRef } from "react";
import { isTemporaryThread, type Thread } from "@/lib/model";

/**
 * A thread with notes and no description gets one.
 *
 * The sorter chooses a thread by its description. A description is written
 * after notes land, and that request can be lost for good: the app closed
 * during the twenty seconds a subscription takes to answer, a provider out
 * for the day. Nothing asked again, so the thread stayed invisible to the
 * sorter: the owner's "Mountain Lion" thread, seven notes and no description,
 * lost every new Mountain Lion note to "Ovid", whose description was rich.
 * So each thread with notes and no description is asked for one, once each
 * time the app opens.
 */
export function useMissingSummaries(loaded: boolean, threads: Thread[], summarize: (threadId: string) => void) {
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    for (const thread of threads) {
      if (!thread.frags.length || isTemporaryThread(thread) || thread.summary?.trim() || asked.current.has(thread.id)) continue;
      asked.current.add(thread.id);
      summarize(thread.id);
    }
  }, [loaded, threads, summarize]);
}
