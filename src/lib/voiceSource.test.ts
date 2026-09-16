import { describe, expect, it } from "vitest";
import { appendDictationTranscript } from "./voiceSource";

describe("dictation source accumulation", () => {
  it("uses unchanged text when a provider supplies an empty raw value", () => {
    expect(appendDictationTranscript("First.", "Next.", "")).toBe("First. Next.");
  });
  it("preserves recogniser wording and whitespace without name correction", () => {
    expect(appendDictationTranscript("First.", "Call Sarah.", "  sea rah\nnext line  "))
      .toBe("First.   sea rah\nnext line  ");
  });

  it("keeps a wholly unchanged multi-utterance recording", () => {
    const first = appendDictationTranscript("", "First unchanged.");
    expect(appendDictationTranscript(first, "Second unchanged."))
      .toBe("First unchanged. Second unchanged.");
  });

  it("keeps unchanged chunks before and after cleaned chunks", () => {
    let transcript = appendDictationTranscript("", "First unchanged.");
    transcript = appendDictationTranscript(transcript, "Call Sarah.", "call sea rah");
    transcript = appendDictationTranscript(transcript, "Last unchanged.");
    expect(transcript).toBe("First unchanged. call sea rah Last unchanged.");
  });
});
