"use client";

/*
 * The recogniser plumbing shared by the voice surfaces. The useDictation
 * hook that used to live here was superseded by useRecordedDictation (the
 * recorded path with the /api/transcribe fallback) and is gone; what
 * remains is the browser SpeechRecognition typing and detection that
 * useVoiceConversation still builds on.
 */

/* Not in lib.dom yet, and only the handful of members used here matter. */
export type Recogniser = {
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: {
    resultIndex: number;
    results: {
      [i: number]: { [j: number]: { transcript: string }; isFinal?: boolean };
      length: number;
    };
  }) => void;
  onend: () => void;
  onerror?: (e: unknown) => void;
  onspeechstart?: () => void;
  start: () => void;
  stop: () => void;
};
export type RecogniserCtor = new () => Recogniser;

export function speechRecogniser(): RecogniserCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecogniserCtor;
    webkitSpeechRecognition?: RecogniserCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
