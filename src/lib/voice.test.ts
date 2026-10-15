import { describe, expect, it } from "vitest";
import type { CaptureEntry } from "./ledger";
import type { VoiceReading } from "./model";
import { shareRecord, shareThread } from "./share";
import { EMPTY } from "./model";
import { VOICE_MIN_WORDS, acceptVoice, spokenNotes, spokenWords, voiceDue, voiceForAgents, voiceSample } from "./voice";

const entry = (over: Partial<CaptureEntry>): CaptureEntry =>
  ({ id: Math.random().toString(36), at: 1, raw: "", clean: "", kind: "thread", source: "dictated", targetId: "t", ...over }) as CaptureEntry;

describe("the words a voice is read from", () => {
  it("are each capture's own words once, never pasted documents or scraps", () => {
    const said = "okay so I think the main thing right now is getting the sorting right, right?";
    const notes = spokenNotes([
      entry({ at: 2, raw: said, captureId: "c1" }),
      entry({ at: 2, raw: said, captureId: "c1", kind: "action" }),
      entry({ at: 3, raw: "the tidied text", transcript: "uh the real words I said out loud on the walk", captureId: "c2" }),
      entry({ at: 4, raw: "fix it", captureId: "c3" }),
      entry({ at: 5, raw: "# Plan\n- one thing here\n- two things here\n- three things here", captureId: "c4" }),
    ]);
    expect(notes.map((note) => note.text)).toEqual([said, "uh the real words I said out loud on the walk"]);
  });

  it("are read once there is enough, then again as they grow", () => {
    const voice = { patterns: [], phrases: [], samples: [], words: 8_000, at: 1 } as VoiceReading;
    expect(voiceDue(undefined, VOICE_MIN_WORDS - 1)).toBe(false);
    expect(voiceDue(undefined, VOICE_MIN_WORDS)).toBe(true);
    expect(voiceDue(voice, 9_000)).toBe(false);
    expect(voiceDue(voice, 10_000)).toBe(true);
  });

  it("are sampled across time within the budget", () => {
    const notes = Array.from({ length: 100 }, (_, index) => ({ at: index, text: `note ${index} ${"word ".repeat(98)}` }));
    const sample = voiceSample(notes, 2_000);
    expect(spokenWords([{ text: sample }])).toBeLessThanOrEqual(2_200);
    expect(sample).toContain("note 0 ");
    expect(sample).toContain("note 95 ");
  });
});

describe("a reading", () => {
  const source = "Okay so I think the whole point is reducing friction, right? So yeah. I keep coming back to the sorting and it basically needs to just work every single time without me thinking about it at all.";
  const good = {
    patterns: ["You open with Okay or So and land the point first.", "You check yourself with right? as you go.", "You close with So yeah."],
    phrases: ["So yeah.", "reducing friction", "made-up phrase"],
    samples: [
      { about: "Capture", text: "Okay so here's the thing with Capture, right? I just want to talk and have it land where it belongs, no folders, no thinking about it. If I have to decide where it goes, that's friction, and friction is the thing I'm trying to remove. So yeah." },
      { about: "Copied", text: "I keep coming back to the sorting and it basically needs to just work every single time without me thinking about it at all and that is the note again word for word here." },
    ],
  };

  it("keeps real phrases, new samples, and refuses copied ones", () => {
    const voice = acceptVoice(good, source, 6_000, 42)!;
    expect(voice.patterns).toHaveLength(3);
    expect(voice.phrases).toEqual(["So yeah.", "reducing friction"]);
    expect(voice.samples.map((sample) => sample.about)).toEqual(["Capture"]);
    expect(voice).toMatchObject({ words: 6_000, at: 42 });
  });

  it("is refused without enough patterns", () => {
    expect(acceptVoice({ ...good, patterns: ["You talk."] }, source, 6_000, 1)).toBeNull();
    expect(acceptVoice("nonsense", source, 6_000, 1)).toBeNull();
  });

  it("travels with the board and a thread to an agent, under How I talk", () => {
    const voice = acceptVoice(good, source, 6_000, 1)!;
    expect(voiceForAgents(undefined, "## How I talk")).toEqual([]);
    const board = { ...EMPTY, principles: [], profile: { name: "Gleb", voice } };
    const whole = shareRecord(board).text;
    expect(whole).toContain("## How I talk\n\n- You open with Okay or So");
    expect(whole).toContain("“So yeah.” · “reducing friction”");
    const thread = shareThread({ id: "t", name: "Capture", summary: "", frags: [{ id: "f", at: 1, text: "x" }] }, undefined, voice).text;
    expect(thread).toMatch(/## How I talk\n\n- You open with/);
    expect(shareThread({ id: "t", name: "Capture", summary: "", frags: [{ id: "f", at: 1, text: "x" }] }).text).not.toContain("How I talk");
  });
});
