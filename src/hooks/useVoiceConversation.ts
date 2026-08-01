"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DistillTurn } from "@/lib/distill";
import { capability } from "@/lib/clock";
import { type Recogniser, speechRecogniser } from "@/hooks/useDictation";
import { useVoiceReplies } from "@/hooks/useSpeech";

/* ============================================================
   Voice conversation — the third mode of Distill, and the one
   that makes it feel like talking to a person rather than typing
   at a machine.

   The mic runs in "utterance" mode: `continuous: false`, so the
   browser recogniser ends by itself at the pause between sentences.
   That pause IS the turn boundary — you talk, pause, and your
   words are sent as the next turn without touching anything.

   The loop:
     1. Tap the orb (or press Talk) — the mic arms, inside that
        gesture so the browser grants permission.
     2. You speak; you pause; the recogniser ends and your words
        go out as a user turn.
     3. The reply streams in and is spoken aloud, sentence by
        sentence, by useVoiceReplies.
     4. The moment it finishes, the mic comes back on its own —
        the conversation keeps going hands-free.
     5. Tap the orb while it's speaking and it cuts off mid-word
        and listens to you instead.

   The mic is deliberately quiet while the assistant talks, so the
   assistant's own voice can't feed back into the recogniser — the
   interruption is the tap, exactly like pressing the mic button in
   ChatGPT's interface.
   ============================================================ */

export function useVoiceConversation(
  turns: DistillTurn[],
  busy: boolean,
  onUtterance: (text: string) => void,
  active = true
) {
  const voice = useVoiceReplies(turns, busy);
  /* Stable handles from the reply hook — `voice` itself is a fresh object
     every render, so destructuring avoids identity churn in deps. */
  const voiceSetEnabled = voice.setEnabled;
  const voiceStop = voice.stop;

  /* Whether the browser can hear at all — the Talk switch is disabled
     otherwise. Mirrored in a ref for the recogniser paths. */
  const canDictate = useSyncExternalStore(
    capability.subscribe,
    () => Boolean(speechRecogniser()),
    () => false
  );

  const [on, setOn] = useState(false); // talk mode active
  const [listening, setListening] = useState(false);

  /* Refs mirror what the async recogniser handlers need without stale
     closures — the recogniser callbacks are created once and live for the
     life of one utterance. */
  const onRef = useRef(on);
  const activeRef = useRef(active);
  const listeningRef = useRef(false);
  const busyRef = useRef(busy);
  const speakingRef = useRef(voice.speaking);
  const onUtteranceRef = useRef(onUtterance);
  const recogRef = useRef<Recogniser | null>(null);
  const bufferRef = useRef(""); // words of the current utterance
  const pendingRef = useRef(""); // held while a reply is still streaming
  const rearmTimerRef = useRef<number | null>(null);
  const genRef = useRef(0); // bumped on stop; stale recognisers check it

  useEffect(() => {
    onRef.current = on;
  }, [on]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    speakingRef.current = voice.speaking;
  }, [voice.speaking]);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);

  const setListeningBoth = (v: boolean) => {
    listeningRef.current = v;
    setListening(v);
  };

  const clearRearm = () => {
    if (rearmTimerRef.current !== null) {
      window.clearTimeout(rearmTimerRef.current);
      rearmTimerRef.current = null;
    }
  };

  /** Send whatever was captured as the next turn. If a reply is still
      streaming (interrupting it), hold the words until the engine is free
      rather than dropping them — the next effect releases them. */
  const flush = useCallback(() => {
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    if (!text || !onRef.current) return;
    if (busyRef.current) pendingRef.current = text;
    else onUtteranceRef.current(text);
  }, []);

  /* Words spoken over the tail of a reply are released once the engine is
     free to answer them. */
  useEffect(() => {
    if (!busy && pendingRef.current) {
      const t = pendingRef.current;
      pendingRef.current = "";
      if (onRef.current) onUtteranceRef.current(t);
    }
  }, [busy]);

  /* Start a recogniser that ends itself at the pause between sentences.
     It does NOT schedule its own re-arm — ending the utterance flips the
     `listening` state, which the auto-rearm effect below watches. That keeps
     `arm` free of any reference back to `maybeArm`, so the compiler can
     preserve both memos. */
  const arm = useCallback(() => {
    if (recogRef.current || !onRef.current) return;
    const SR = speechRecogniser();
    if (!SR) return;
    const r = new SR();
    r.continuous = false; // the pause between sentences ends the utterance
    r.interimResults = false; // final words only
    bufferRef.current = "";
    const gen = genRef.current;
    r.onresult = (e) => {
      if (gen !== genRef.current) return;
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        s += e.results[i][0].transcript;
      }
      bufferRef.current = s.trim();
    };
    const finish = () => {
      if (gen !== genRef.current) return;
      recogRef.current = null;
      setListeningBoth(false); // the auto-rearm effect sees this and re-arms
      flush();
    };
    r.onend = finish;
    r.onerror = () => {
      if (gen !== genRef.current) return;
      recogRef.current = null;
      setListeningBoth(false);
    };
    recogRef.current = r;
    try {
      r.start();
      setListeningBoth(true);
    } catch {
      recogRef.current = null;
      setListeningBoth(false);
    }
  }, [flush]);

  /* Only pick the mic back up when the engine is neither thinking nor
     speaking — otherwise the assistant's own voice would be captured. */
  const maybeArm = useCallback(() => {
    if (!onRef.current || !activeRef.current || recogRef.current) return;
    if (busyRef.current || speakingRef.current) return;
    arm();
  }, [arm]);

  /* The hands-free half of the loop: whenever the mic is quiet (an utterance
     just ended, or a reply just finished), it comes back after a short beat.
     `listening` is in the deps so ending an utterance re-triggers this even
     when busy never changed. */
  useEffect(() => {
    if (!on || !active) return;
    if (busy || voice.speaking) return;
    if (recogRef.current) return; // already listening
    clearRearm();
    rearmTimerRef.current = window.setTimeout(() => {
      rearmTimerRef.current = null;
      maybeArm();
    }, 450);
    return clearRearm;
  }, [on, active, busy, voice.speaking, listening, maybeArm]);

  /** Enter talk mode. Called from a tap, so the browser grants the mic. The
      `active` prop only flips on the render AFTER the click, so this must not
      read it — the gesture itself is the permission, and the auto-rearm is
      what respects `active`. */
  const start = useCallback(() => {
    onRef.current = true;
    setOn(true);
    // Talk mode only makes sense if replies are spoken.
    voiceSetEnabled(true);
    arm();
  }, [voiceSetEnabled, arm]);

  /** Leave talk mode: stop the mic, cancel any re-arm, send nothing. */
  const stop = useCallback(() => {
    genRef.current += 1;
    onRef.current = false;
    setOn(false);
    clearRearm();
    if (recogRef.current) {
      try {
        recogRef.current.stop();
      } catch {
        /* already stopped */
      }
      recogRef.current = null;
    }
    bufferRef.current = "";
    pendingRef.current = "";
    setListeningBoth(false);
  }, []);

  /** The orb. Idle → listen. Listening → send now. Speaking → interrupt. */
  const tap = useCallback(() => {
    if (!onRef.current) {
      start();
      return;
    }
    if (speakingRef.current) {
      // Cut the reply off mid-word and listen instead.
      voiceStop();
      recogRef.current = null;
      setListeningBoth(false);
      arm();
      return;
    }
    if (listeningRef.current) {
      // End the turn early — the recogniser's own onend flushes + re-arms.
      try {
        recogRef.current?.stop();
      } catch {
        /* already stopped */
      }
      return;
    }
    arm();
  }, [start, voiceStop, arm]);

  /* Settling (or leaving the screen) must close the mic behind the review
     step — nothing keeps listening when the conversation is over. The parent
     calls stop() when `active` flips false; this guard stops the auto-rearm
     from opening it again in the gap before that call lands. */
  /* Never leave the mic open behind the component. */
  useEffect(() => () => stop(), [stop]);

  return {
    voice,
    listening,
    speaking: voice.speaking,
    engine: voice.engine,
    canDictate,
    start,
    stop,
    tap,
  };
}
