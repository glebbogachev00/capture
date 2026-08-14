"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { capability } from "@/lib/clock";

/**
 * Push-to-talk dictation backed by a real speech model via /api/transcribe,
 * instead of the browser's SpeechRecognition (which on iPhone is Apple's
 * stock dictation — the thing that kept mishearing captures).
 *
 * Same shape as useDictation, so a call site swaps by changing the import:
 * tap the mic to start recording, tap again to stop; the whole utterance is
 * transcribed in one shot and handed to `onResult`. Unlike the recogniser
 * there are no interim results — text lands once, after `transcribing`.
 */
export function useRecordedDictation(
  onResult: (text: string, raw?: string) => void
) {
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  /* Same SSR-safe capability read as useDictation: the server snapshot says
     "no", the client snapshot answers for real once mounted. */
  const canDictate = useSyncExternalStore(
    capability.subscribe,
    () =>
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined",
    () => false
  );

  const toggleMic = () => {
    if (listening) {
      recorder.current?.stop();
      setListening(false);
      return;
    }
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return; // mic permission refused — the button simply does nothing
      }
      /* Safari records audio/mp4, Chrome audio/webm; ask for whichever this
         browser actually supports and let the server sniff the container. */
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t)
      );
      const r = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      );
      chunks.current = [];
      r.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, {
          type: r.mimeType || "audio/mp4",
        });
        chunks.current = [];
        if (blob.size < 1_000) return; // accidental tap, nothing recorded
        setTranscribing(true);
        void fetch("/api/transcribe", {
          method: "POST",
          headers: { "content-type": blob.type },
          body: blob,
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(await res.text());
            const { text, raw } = (await res.json()) as {
              text: string;
              raw?: string;
            };
            /* `raw` is what the recogniser heard before the cleanup pass
               rewrote it — handed on so the ledger can keep the evidence
               next to the tidied words. */
            if (text) onResultRef.current(text, raw);
          })
          .catch((err) => console.error("transcription failed:", err))
          .finally(() => setTranscribing(false));
      };
      r.start();
      recorder.current = r;
      setListening(true);
    })();
  };

  return { canDictate, listening, transcribing, toggleMic };
}
