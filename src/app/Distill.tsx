"use client";

/* ============================================================
   DISTILL — the second input mode. For thoughts that aren't
   clear yet. You talk it through; the engine asks one question
   at a time until it's clear; then "Distill & save" turns the
   whole exchange into an action, a thread, or an intention.

   Same input, two buttons: Capture files it as-is, Distill
   interrogates it first. The transcript lives in IndexedDB via
   useBoard, so a half-finished conversation survives a reload.

   The movement matters as much as the words: turns enter with a
   small rise, the assistant's thinking shows as settling dots,
   the live stream trails a caret, and the log keeps the newest
   words in sight no matter how long the conversation grows.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, VolumeX } from "lucide-react";
import type { DistillResult, DistillSession } from "@/lib/distill";
import { type ShelfLife, SHELF } from "@/lib/model";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";

/* A seed beats a blank box: one tap drops a real thought in the box. */
const STARTERS = [
  "I'm stuck on whether to leave my job.",
  "I have an idea for an app but it's fuzzy.",
  "I keep putting off one thing — I don't know why.",
];

export function DistillView({
  session,
  input,
  onInput,
  busy,
  err,
  canDictate,
  listening,
  onToggleMic,
  onSend,
  onSendText,
  onSettle,
  onBack,
  settled,
  onSave,
  onDiscard,
}: {
  session: DistillSession;
  input: string;
  onInput: (text: string) => void;
  busy: boolean;
  err: string;
  canDictate: boolean;
  listening: boolean;
  onToggleMic: () => void;
  onSend: () => void;
  onSendText: (text: string) => void;
  onSettle: () => void;
  onBack: () => void;
  settled: DistillResult | null;
  onSave: (clean: string, actions: string[], shelfLife: string) => void;
  onDiscard: () => void;
}) {
  /* The log follows its own tail: a new turn glides the view down, while the
     live stream snaps it down so the growing bubble stays in sight. Only when
     the tail is already near the bottom — scrolling up to re-read an earlier
     part is never yanked back down mid-stream. */
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTurn = session.turns.at(-1);
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.55) return;
    el.scrollIntoView({
      block: "end",
      behavior: busy ? "auto" : "smooth",
    });
  }, [session.turns.length, lastTurn?.text, busy, settled]);

  /* Spoken replies + the conversation loop. `mode` is how you talk to the
     engine: Type keeps the text box and the read-aloud toggle; Talk runs the
     mic as a real conversation — you speak, it answers aloud, the mic comes
     back on its own, and a tap interrupts mid-word. The voice engine is the
     same either way, so the speaker toggle and the orb share one stack. */
  const [mode, setMode] = useState<"type" | "talk">("type");
  const convo = useVoiceConversation(
    session.turns,
    busy,
    (t) => onSendText(t),
    !settled && mode === "talk"
  );
  const voice = convo.voice;
  /* `convo` is a fresh object every render; its handlers are stable
     useCallbacks, so destructure to keep effect deps stable. */
  const stopTalk = convo.stop;

  /* The review step replaces the chat — nothing keeps listening behind it.
     The `active` prop gates the auto-rearm; this stops a live recogniser and
     any half-spoken reply the moment the conversation is over. */
  useEffect(() => {
    if (settled) stopTalk();
  }, [settled, stopTalk]);

  if (settled) {
    return (
      <DistillReview
        settled={settled}
        busy={busy}
        onSave={onSave}
        onDiscard={onDiscard}
      />
    );
  }

  return (
    <div className="distill-view">
      <button className="back" onClick={onBack}>
        ← capture
      </button>

      <div className="distill-head">
        <div className="int-eyebrow">Distill</div>
        <div className="distill-voice">
          {/* Voice: a spoken conversation instead of typing. Off is Type —
              the text box; on hands the floor to the mic, and the reply is
              spoken aloud, barge-in and all. */}
          <button
            className={"distill-mode-btn" + (mode === "talk" ? " on" : "")}
            onClick={() => {
              if (mode === "talk") {
                setMode("type");
                convo.stop();
              } else {
                setMode("talk");
                convo.start();
              }
            }}
            aria-pressed={mode === "talk"}
            disabled={!convo.canDictate || !voice.supported}
            title={
              convo.canDictate && voice.supported
                ? "Voice — a spoken conversation"
                : "Voice isn't supported in this browser"
            }
          >
            <Mic size={15} strokeWidth={1.8} />
            Voice
          </button>
          {voice.supported && (
            <button
              className={
                "distill-mode-btn" +
                (voice.enabled ? " on" : "") +
                (voice.speaking ? " live" : "")
              }
              onClick={voice.toggle}
              aria-pressed={voice.enabled}
              aria-label={
                voice.enabled ? "Mute spoken replies" : "Speak replies aloud"
              }
              title={
                voice.enabled ? "Mute spoken replies" : "Speak replies aloud"
              }
            >
              {voice.enabled ? (
                <Volume2 size={15} strokeWidth={1.8} />
              ) : (
                <VolumeX size={15} strokeWidth={1.8} />
              )}
              Speaker
            </button>
          )}
        </div>
      </div>
      <p className="int-note">
        A thought that isn&apos;t clear yet. Talk it through — it asks one
        question at a time, then files the whole exchange when you&apos;re
        ready.
      </p>

      <div className="distill-log">
        {!session.turns.length && (
          <div className="empty">
            <p className="big">What&apos;s unclear?</p>
            <p>
              Say it however it comes out. The engine will ask what&apos;s
              missing.
            </p>
            <div className="distill-starters">
              {STARTERS.map((s) => (
                <button key={s} className="ghost" onClick={() => onInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {session.turns.map((t, i) => {
          const last = i === session.turns.length - 1;
          const thinking = last && busy && t.role === "assistant" && !t.text;
          const streaming = last && busy && t.role === "assistant" && !!t.text;
          return (
            <div className={"distill-turn " + t.role} key={i}>
              <span className="distill-who">
                {t.role === "user" ? "You" : "capture"}
              </span>
              <p>
                {thinking ? (
                  <span className="distill-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <>
                    {t.text}
                    {streaming && (
                      <span className="distill-caret" aria-hidden="true" />
                    )}
                  </>
                )}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {err && <div className="err">{err}</div>}

      {mode === "talk" ? (
        <TalkPad convo={convo} busy={busy} />
      ) : (
        <div className="cap">
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            placeholder="Say it however it comes out."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend();
            }}
          />
          <div className="cap-bar">
            {canDictate && (
              <button
                className={"icon-btn" + (listening ? " live" : "")}
                onClick={onToggleMic}
                aria-label="Dictate"
              >
                <Mic size={18} strokeWidth={1.7} />
              </button>
            )}
            <div className="cap-hint">
              {canDictate
                ? "or tap the mic key on your keyboard"
                : "tap the mic key on your keyboard to dictate"}
            </div>
            <button
              className="capture-btn"
              onClick={onSend}
              disabled={busy || !input.trim()}
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}

      <button
        className="ghost distill-settle"
        onClick={onSettle}
        disabled={busy || session.turns.length === 0}
      >
        {busy ? "Distilling…" : "Distill &amp; save"}
      </button>
    </div>
  );
}

/**
 * The spoken half of Distill — the orb that makes it a conversation.
 *
 * Tap to talk, pause to send, tap again while it's answering to cut in.
 * The orb wears the current state so you always know what it's doing:
 * grey and still when it's waiting, breathing when it listens, lit and
 * pulsing while it speaks, dots while it thinks.
 */
function TalkPad({
  convo,
  busy,
}: {
  convo: ReturnType<typeof useVoiceConversation>;
  busy: boolean;
}) {
  const speaking = convo.speaking;
  const thinking = busy && !speaking;
  const label = speaking
    ? "Speaking — tap to interrupt"
    : thinking
      ? "Thinking…"
      : convo.listening
        ? "Listening — speak now"
        : "Tap to talk";
  return (
    <div className="talk">
      <button
        className={
          "orb" +
          (speaking ? " speaking" : "") +
          (thinking ? " thinking" : "") +
          (convo.listening ? " listening" : "")
        }
        onClick={convo.tap}
        aria-label={label}
        aria-live="polite"
      >
        {thinking ? (
          <span className="distill-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Mic size={32} strokeWidth={1.6} />
        )}
      </button>
      <div className="talk-status">{label}</div>
      <div className="talk-hint">
        {speaking
          ? "tap to cut in — it stops the moment you do"
          : thinking
            ? "the reply is on its way — it'll speak out loud"
            : convo.listening
              ? "speak, pause when you're done — no Send button"
              : "a spoken conversation. talk, it answers aloud, and the mic comes back on its own."}
      </div>
    </div>
  );
}

/**
 * The review step: the whole conversation, distilled to one record.
 *
 * Same philosophy as the intention draft — you see and reshape what the
 * engine wrote before it becomes real. The kind is already decided; you
 * edit the wording, the actions (for an action), and the shelf life.
 */
function DistillReview({
  settled,
  busy,
  onSave,
  onDiscard,
}: {
  settled: DistillResult;
  busy: boolean;
  onSave: (clean: string, actions: string[], shelfLife: string) => void;
  onDiscard: () => void;
}) {
  const [clean, setClean] = useState(settled.clean);
  const [actions, setActions] = useState<string[]>(settled.actions || []);
  const [shelfLife, setShelfLife] = useState<string>(
    (settled.shelfLife as string) || "keep"
  );
  const [draft, setDraft] = useState("");

  const addAction = () => {
    const v = draft.trim();
    if (!v) return;
    setActions((a) => [...a, v]);
    setDraft("");
  };

  return (
    <div className="distill-review">
      <button className="back" onClick={onDiscard}>
        ← keep talking
      </button>

      <div className="int-eyebrow">Distilled · {settled.kind}</div>
      <p className="int-note">
        What the conversation settled into. Edit the wording if it&apos;s off,
        then save.
      </p>

      <textarea
        className="review-clean"
        value={clean}
        onChange={(e) => setClean(e.target.value)}
        aria-label="Distilled wording"
      />

      {settled.kind === "action" && (
        <>
          <div className="int-block">
            <h4 className="int-label">Actions</h4>
            <ul className="int-list">
              {actions.map((a, i) => (
                <li key={i}>
                  <span>{a}</span>
                  <button
                    className="ghost"
                    onClick={() =>
                      setActions((x) => x.filter((_, j) => j !== i))
                    }
                    aria-label={"Remove: " + a}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="int-add">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAction()}
                placeholder="Add an action"
                aria-label="Add an action"
              />
              <button
                className="ghost"
                onClick={addAction}
                disabled={!draft.trim()}
              >
                Add
              </button>
            </div>
          </div>

          <div className="int-block">
            <h4 className="int-label">Shelf life</h4>
            <div className="shelf">
              {(Object.keys(SHELF) as ShelfLife[])
                .filter((k) => k !== "keep")
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => setShelfLife(k)}
                    style={
                      shelfLife === k
                        ? { borderColor: "var(--accent)", color: "var(--accent)" }
                        : undefined
                    }
                  >
                    {k}
                  </button>
                ))}
              <button
                onClick={() => setShelfLife("keep")}
                style={
                  shelfLife === "keep"
                    ? { borderColor: "var(--accent)", color: "var(--accent)" }
                    : undefined
                }
              >
                keep
              </button>
            </div>
          </div>
        </>
      )}

      <div className="int-commit">
        <button
          className="capture-btn"
          onClick={() => onSave(clean.trim(), actions, shelfLife)}
          disabled={busy || !clean.trim()}
        >
          Save
        </button>
        <button className="ghost" onClick={onDiscard} disabled={busy}>
          Keep talking
        </button>
      </div>
    </div>
  );
}
