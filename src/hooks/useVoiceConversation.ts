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

   The mic runs continuously and a silence clock decides when the
   turn ends. A pause to think is NOT the end — the recogniser
   keeps listening and your words keep accumulating, and only a
   genuine pause of about two seconds commits the turn. You talk,
   pause, think, say more; the moment you fall quiet for two
   seconds, your whole turn goes out at once.

   The loop:
     1. Tap the orb (or press Talk) — the mic arms, inside that
        gesture so the browser grants permission.
     2. You speak. Every new word resets the silence clock; a short
        pause to think changes nothing.
     3. Two seconds of quiet commits the turn — the mic stops and
        everything you said goes out as one user turn. Tap the orb
        mid-thought to send immediately instead.
     4. The reply streams in and is spoken aloud, sentence by
        sentence, by useVoiceReplies.
     5. The moment it finishes, the mic comes back on its own —
        the conversation keeps going hands-free.
     6. Tap the orb while it's speaking and it cuts off mid-word
        and listens to you instead.

   The mic is deliberately quiet while the assistant talks, so the
   assistant's own voice can't feed back into the recogniser — the
   interruption is the tap, exactly like pressing the mic button in
   ChatGPT's interface.
   ============================================================ */

/* A pause this long with no new words commits the turn. Short enough to
   keep the conversation moving, long enough that a moment of thought
   never cuts the user off mid-sentence. */
const SILENCE_MS = 2500;

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
  /* The words heard so far this turn, shown under the orb so the user can
     see the mic is following them — and see a misheard word as it happens. */
  const [hearing, setHearing] = useState("");

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
  const bufferRef = useRef(""); // words of the current turn, across recognisers
  const pendingRef = useRef(""); // held while a reply is still streaming
  const rearmTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  /* A tap asked to end the turn now — the recogniser's own onend commits
     instead of just re-arming. */
  const endIntentRef = useRef(false);
  /* A turn was just sent; the mic must not re-arm until the engine has
     actually gone busy (which it does a beat after the send, once the
     session write lands), or the reply's first words would be heard
     as the user's next turn. */
  const turnSentRef = useRef(false);
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

  const clearSilence = () => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  /** Send the accumulated words as the next turn. Only the silence clock
      or an explicit tap ever calls this — a thinking pause never does. If
      a reply is still streaming (interrupting it), hold the words until
      the engine is free rather than dropping them; the next effect
      releases them. */
  const commit = useCallback(() => {
    clearSilence();
    if (recogRef.current) {
      try {
        recogRef.current.stop();
      } catch {
        /* already stopped */
      }
      recogRef.current = null;
    }
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    setHearing("");
    setListeningBoth(false);
    if (!text || !onRef.current) return;
    // Consume any lingering tap intent and fence the mic until the engine
    // is confirmed busy (see the turnSentRef effect below).
    endIntentRef.current = false;
    turnSentRef.current = true;
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

  /* Start a continuous recogniser that stays live across the whole turn,
     so a pause to think is never treated as the end — the silence clock
     below is what commits, and any new word resets it. Platforms that end
     the recogniser on their own (Safari) simply re-arm; the words already
     heard stay in the buffer and the clock keeps running, so nothing is
     lost. It does NOT schedule its own re-arm — ending flips the
     `listening` state, which the auto-rearm effect below watches. */
  const arm = useCallback(() => {
    if (recogRef.current || !onRef.current) return;
    // A fresh recogniser must not inherit a tap intent from an earlier one.
    endIntentRef.current = false;
    const SR = speechRecogniser();
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true; // live partials for the hearing line
    const gen = genRef.current;
    r.onresult = (e) => {
      if (gen !== genRef.current) return;
      let finals = "";
      let interim = "";
      /* Append only the new results (resultIndex marks where they start) so
         multi-segment turns and words carried across re-arms both build
         up instead of replacing what was already heard. Committed segments
         go into the buffer; live partials only decorate the display. */
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r0 = e.results[i];
        if (r0.isFinal) finals += r0[0].transcript;
        else interim += r0[0].transcript;
      }
      // Any speech activity — a committed segment or a live partial —
      // resets the end-of-turn clock, so continuous speech never commits
      // early and a thought-pause needs a full SILENCE_MS to commit.
      if (finals.trim() || interim.trim()) {
        clearSilence();
        silenceTimerRef.current = window.setTimeout(() => {
          silenceTimerRef.current = null;
          commit();
        }, SILENCE_MS);
      }
      if (finals.trim()) {
        bufferRef.current = (bufferRef.current + " " + finals).trim();
      }
      setHearing((bufferRef.current + " " + interim).trim());
    };
    const finish = () => {
      if (gen !== genRef.current) return;
      recogRef.current = null;
      setListeningBoth(false); // the auto-rearm effect sees this and re-arms
      // An explicit tap ended the turn: send now. A spontaneous end (the
      // platform dropped the recogniser mid-thought) just re-arms — the
      // silence clock keeps running and the words stay in the buffer.
      if (endIntentRef.current) {
        endIntentRef.current = false;
        commit();
      }
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
  }, [commit]);

  /* Only pick the mic back up when the engine is neither thinking nor
     speaking — otherwise the assistant's own voice would be captured. */
  const maybeArm = useCallback(() => {
    if (!onRef.current || !activeRef.current || recogRef.current) return;
    if (turnSentRef.current || busyRef.current || speakingRef.current) return;
    arm();
  }, [arm]);

  /* The fence opened by commit(): once the engine has actually gone busy
     (the reply is streaming), the mic is free to re-arm when it's quiet. */
  useEffect(() => {
    if (busy) turnSentRef.current = false;
  }, [busy]);

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
    clearSilence();
    endIntentRef.current = false;
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
    setHearing("");
    setListeningBoth(false);
  }, []);

  /** The orb. Idle → listen. Listening → send now. Speaking → interrupt. */
  const tap = useCallback(() => {
    if (!onRef.current) {
      start();
      return;
    }
    if (speakingRef.current) {
      // Cut the reply off mid-word and listen instead. Bump the generation
      // so any recogniser still alive (a re-arm that raced the reply) is
      // silenced — its callbacks must not capture words or null the one
      // about to start.
      voiceStop();
      genRef.current += 1;
      recogRef.current = null;
      setListeningBoth(false);
      arm();
      return;
    }
    if (listeningRef.current) {
      // End the turn now — the recogniser's own onend commits the words.
      if (recogRef.current) {
        endIntentRef.current = true;
        try {
          recogRef.current.stop();
        } catch {
          /* already stopped */
        }
      } else {
        commit();
      }
      return;
    }
    arm();
  }, [start, voiceStop, arm, commit]);

  /* Settling (or leaving the screen) must close the mic behind the review
     step — nothing keeps listening when the conversation is over. The parent
     calls stop() when `active` flips false; this guard stops the auto-rearm
     from opening it again in the gap before that call lands. */
  /* Never leave the mic open behind the component. */
  useEffect(() => () => stop(), [stop]);

  return {
    voice,
    listening,
    hearing,
    speaking: voice.speaking,
    engine: voice.engine,
    canDictate,
    start,
    stop,
    tap,
  };
}
