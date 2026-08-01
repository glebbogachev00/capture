"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { capability } from "@/lib/clock";

/* Not in lib.dom yet, and only the handful of members used here matter. */
type Recogniser = {
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: {
    resultIndex: number;
    results: {
      [i: number]: { [j: number]: { transcript: string } };
      length: number;
    };
  }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
type RecogniserCtor = new () => Recogniser;

function speechRecogniser(): RecogniserCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecogniserCtor;
    webkitSpeechRecognition?: RecogniserCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * The mic, as a shared hook so the capture box and the Distill chat both
 * dictate without duplicating the recogniser plumbing.
 *
 * `onResult` is read through a ref, so the handler passed at render time can
 * capture whatever state is current without the recogniser going stale.
 */
export function useDictation(onResult: (text: string) => void) {
  const recog = useRef<Recogniser | null>(null);
  const [listening, setListening] = useState(false);
  const onResultRef = useRef(onResult);
  /* Refs are not written during render; the effect keeps the handler current
     after every render that produces a new one. */
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const canDictate = useSyncExternalStore(
    capability.subscribe,
    () => Boolean(speechRecogniser()),
    () => false
  );

  const toggleMic = () => {
    const SR = speechRecogniser();
    if (!SR) return;
    if (listening) {
      recog.current?.stop();
      setListening(false);
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        s += e.results[i][0].transcript;
      }
      onResultRef.current(s.trim());
    };
    r.onend = () => setListening(false);
    r.start();
    recog.current = r;
    setListening(true);
  };

  return { canDictate, listening, toggleMic };
}
