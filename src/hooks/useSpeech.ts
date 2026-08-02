"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DistillTurn } from "@/lib/distill";
import { takeCompleteSentences } from "@/lib/sentences";

/* ============================================================
   Voice replies — the third leg of a spoken conversation.

   The mic hears you (Web Speech API), the model thinks (the distill
   route), and this hook speaks. Everything runs on your Mac and in
   the browser you're holding: the mic and any fallback voice live
   in the browser, and the human-sounding voice comes from Kokoro,
   an open TTS model served locally and proxied through /api/tts.

   The reply streams in as text; this hook speaks each complete
   sentence the moment it lands, so first audio arrives while the
   model is still writing the rest. Two engines:

   - "server": Kokoro, through the browser's Web Audio API. Sentences
     are queued on a playhead so they always play in order, and a tap
     interrupts mid-word.
   - "browser": the fallback, the browser's built-in speech synthesis,
     used when Kokoro isn't running.
   ============================================================ */

const KEY = "capture:speak-replies";

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

/** The best-sounding English voice the browser offers, when it has one. */
function pickVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const voices = s.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang.startsWith("en"));
  const pool = en.length ? en : voices;
  return (
    pool.find((v) => /natural|samantha|google us english/i.test(v.name)) ||
    pool[0]
  );
}

type Engine = "server" | "browser";

/**
 * Watch a Distill transcript and speak the assistant's reply as it streams.
 *
 * `enabled` is read once at first render from localStorage and mirrored in a
 * ref; `engine` starts unknown and is set once by probing /api/tts. `speaking`
 * is driven purely by audio events through a counter, so back-to-back queued
 * sentences don't make it blink.
 */
export function useVoiceReplies(turns: DistillTurn[], busy: boolean) {
  const supported = typeof window !== "undefined" && !!window.speechSynthesis;
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [speaking, setSpeaking] = useState(false);
  const [engine, setEngine] = useState<Engine>("browser");
  /* Bumped to force a re-probe even when `enabled` didn't change — entering
     Talk mode with replies already on calls setEnabled(true) on the same
     value, and without this the stale "browser" label would never refresh. */
  const [probeNonce, setProbeNonce] = useState(0);

  /* Refs mirror what the async handlers need without stale closures. */
  const enabledRef = useRef(enabled);
  const engineRef = useRef<Engine>("browser");
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const spokenRef = useRef(0); // chars of the current reply already spoken
  const tailRef = useRef(""); // incomplete sentence awaiting the next chunk
  const activeRef = useRef(0); // sentences queued or playing
  const probedRef = useRef(false);
  /* Bumped when a probe must start over (a real re-probe, e.g. setEnabled).
     A generation check — not the effect cleanup — decides staleness, because
     React StrictMode runs this effect twice on mount and its cleanup would
     otherwise discard the very fetch it just started. */
  const probeGenRef = useRef(0);
  const genRef = useRef(0); // bumped on stop; stale work checks it

  /* Web Audio: the playhead keeps queued sentences in order, the sources set
     is what a stop must silence, the queue serialises synthesis so a slow
     request can't overtake a fast one. */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playheadRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  /* Voices for the browser fallback load asynchronously; re-pick on change. */
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const refresh = () => {
      voiceRef.current = pickVoice();
    };
    refresh();
    s.addEventListener("voiceschanged", refresh);
    return () => s.removeEventListener("voiceschanged", refresh);
  }, []);

  /* Ask the server which engine is real. Runs whenever replies are wanted;
     `probeNonce` makes it re-run when setEnabled(true) lands on a value that
     didn't actually change (Talk mode entry, Kokoro started after load). */
  useEffect(() => {
    if (!enabledRef.current || probedRef.current) return;
    probedRef.current = true;
    const gen = ++probeGenRef.current;
    fetch("/api/tts")
      .then((r) => r.json())
      .then((d: { up?: boolean }) => {
        if (gen !== probeGenRef.current) return;
        engineRef.current = d.up ? "server" : "browser";
        setEngine(engineRef.current);
      })
      .catch(() => {
        if (gen !== probeGenRef.current) return;
        engineRef.current = "browser";
        setEngine("browser");
      });
  }, [enabled, probeNonce]);

  /* Create the AudioContext inside a user gesture so the browser will allow
     playback later, when the reply is streaming. The toggle's click warms it;
     so does a one-time pointerdown, covering the case where replies were left
     on from a previous session and no click just happened. */
  const ensureAudio = useCallback(async (): Promise<AudioContext> => {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) throw new Error("no audio context");
      ctx = new AC();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      // The browser won't resume until a gesture. Wait briefly for the warm-up
      // above, then give up — the queue's caller falls back to the browser
      // voice instead of stalling the whole reply in silence.
      await Promise.race([
        ctx.resume(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("audio needs a gesture")), 1500)
        ),
      ]);
    }
    return ctx;
  }, []);

  /* Replies can be restored on from localStorage with no click behind them —
     warm the context on the first tap anywhere, inside that gesture. */
  useEffect(() => {
    if (!enabledRef.current) return;
    const warm = () => {
      ensureAudio().catch(() => {});
      window.removeEventListener("pointerdown", warm);
    };
    window.addEventListener("pointerdown", warm);
    return () => window.removeEventListener("pointerdown", warm);
  }, [enabled, ensureAudio]);

  /** Speak one sentence with Kokoro, played through Web Audio. */
  const serverSpeak = useCallback(
    async (text: string) => {
      const gen = genRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: ctrl.signal,
        });
        if (genRef.current !== gen) {
          ctrl.abort();
          return;
        }
        if (!res.ok) throw new Error(`tts ${res.status}`);
        const buf = await res.arrayBuffer();
        const ctx = await ensureAudio();
        const audio = await ctx.decodeAudioData(buf);
        if (genRef.current !== gen) return;

        const src = ctx.createBufferSource();
        src.buffer = audio;
        src.connect(ctx.destination);
        const when = Math.max(ctx.currentTime, playheadRef.current);
        playheadRef.current = when + audio.duration;
        activeRef.current += 1;
        setSpeaking(true);
        src.onended = () => {
          sourcesRef.current.delete(src);
          activeRef.current = Math.max(0, activeRef.current - 1);
          if (activeRef.current === 0) setSpeaking(false);
        };
        sourcesRef.current.add(src);
        src.start(when);
      } catch (error) {
        if (
          (error as Error)?.name === "AbortError" ||
          genRef.current !== gen
        ) {
          return; // a stop or a stale sentence — say nothing
        }
        throw error; // the queue's caller flips to the browser voice
      }
    },
    [ensureAudio]
  );

  /** Speak one sentence with the browser's built-in voice. */
  const synthSpeak = useCallback((text: string) => {
    const s = synth();
    if (!s || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = 1.02;
    activeRef.current += 1;
    setSpeaking(true);
    const done = () => {
      activeRef.current = Math.max(0, activeRef.current - 1);
      if (activeRef.current === 0) setSpeaking(false);
    };
    u.onstart = () => setSpeaking(true);
    u.onend = done;
    u.onerror = done;
    try {
      s.speak(u);
    } catch {
      done();
    }
  }, []);

  /* The public speak: serialised so sentences play in order, routing to the
     engine that is real. A server failure mid-reply silences Web Audio and
     switches the rest of the reply to the browser voice. */
  const speak = useCallback(
    (text: string) => {
      const gen = genRef.current;
      queueRef.current = queueRef.current
        .then(async () => {
          if (genRef.current !== gen) return;
          if (engineRef.current === "server") {
            try {
              await serverSpeak(text);
              return; // scheduled (or a stop swallowed it)
            } catch {
              // Kokoro is gone — silence its audio and switch engines.
              abortRef.current?.abort();
              for (const src of sourcesRef.current) {
                try {
                  src.stop();
                } catch {
                  /* already stopped */
                }
              }
              sourcesRef.current.clear();
              playheadRef.current = 0;
              activeRef.current = 0;
              engineRef.current = "browser";
              setEngine("browser");
            }
          }
          if (genRef.current !== gen) return;
          synthSpeak(text);
        })
        .catch(() => {
          /* never break the chain */
        });
    },
    [serverSpeak, synthSpeak]
  );

  /* Cut off whatever is sounding. State-free (the ended events clear the
     indicator) so it can be called from inside effects. */
  const stop = useCallback(() => {
    genRef.current += 1;
    abortRef.current?.abort();
    synth()?.cancel();
    for (const src of sourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current.clear();
    playheadRef.current = 0;
    activeRef.current = 0;
    queueRef.current = Promise.resolve();
  }, []);

  /* Never leave a reply half-spoken behind the component — and let the audio
     engine go so a single page keeps only the one it needs. */
  useEffect(
    () => () => {
      stop();
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      ctx?.close().catch(() => {});
    },
    [stop]
  );

  /* Sentence-chunk the live reply as the text streams in. */
  useEffect(() => {
    if (!enabledRef.current) return;
    const last = turns.at(-1);
    if (!last) return;
    if (last.role === "user") {
      // The user is talking again — cut the previous reply off.
      stop();
      spokenRef.current = 0;
      tailRef.current = "";
      return;
    }
    const fresh = last.text.slice(spokenRef.current);
    spokenRef.current = last.text.length;
    const { sentences, rest } = takeCompleteSentences(tailRef.current + fresh);
    tailRef.current = rest;
    for (const s of sentences) speak(s);
  }, [turns, busy, speak, stop]);

  /* When the stream ends, speak whatever sentence was left unfinished. */
  useEffect(() => {
    if (!enabledRef.current) return;
    if (!busy && tailRef.current.trim()) {
      speak(tailRef.current.trim());
      tailRef.current = "";
    }
  }, [busy, enabled, speak]);

  /** Turn spoken replies on or off, persisting the choice. The conversation
      loop uses this to force replies on when Talk mode starts. */
  const setEnabled = useCallback(
    (next: boolean) => {
      enabledRef.current = next;
      setEnabledState(next);
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) {
        // Create the context inside this click gesture so later streaming
        // playback is allowed by the browser.
        ensureAudio().catch(() => {});
        // Re-probe: the Kokoro server may have come up since the last check —
        // and even if `enabled` didn't change, nudge the probe effect to run.
        // Bump the generation too so any in-flight probe from the previous
        // enable is discarded in favour of this fresh one.
        probedRef.current = false;
        probeGenRef.current += 1;
        setEngine("browser");
        setProbeNonce((n) => n + 1);
      } else {
        stop();
        setSpeaking(false);
      }
    },
    [ensureAudio, stop]
  );

  const toggle = () => setEnabled(!enabledRef.current);

  return { supported, enabled, speaking, engine, toggle, setEnabled, stop };
}
