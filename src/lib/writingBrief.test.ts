import { describe, expect, it } from "vitest";
import type { VoiceReading } from "./model";
import { acceptVoice } from "./voice";
import { WRITING_STANDARD, writingForAgents } from "./writingBrief";

const source = "Okay so simplicity beats complexity, every time. I want almost 0 friction when I capture. So yeah.";
const reading = (over: Partial<VoiceReading> = {}): VoiceReading => ({
  patterns: ["You open with Okay or So.", "You land on So yeah.", "You argue from what you saw."],
  phrases: [], samples: [], words: 6_000, at: 1, ...over,
});

describe("how to write as me, for an agent", () => {
  it("keeps only beliefs the notes really say, with their exact words", () => {
    const voice = acceptVoice({
      ...reading(),
      viewpoint: [
        { claim: "Simple solutions beat complex ones.", words: "simplicity beats complexity" },
        { claim: "Capturing should cost no effort.", words: "“almost 0 friction”" },
        { claim: "Hustle is the only way to win.", words: "hustle is the only way" },
      ],
      onThePage: ["Keep the direct, plain claims.", "Drop the spoken check-ins like right? and So yeah.", "x"],
    }, source, 6_000, 1)!;
    expect(voice.viewpoint).toEqual([
      { claim: "Simple solutions beat complex ones.", words: "simplicity beats complexity" },
      { claim: "Capturing should cost no effort.", words: "almost 0 friction" },
    ]);
    expect(voice.onThePage).toEqual(["Keep the direct, plain claims.", "Drop the spoken check-ins like right? and So yeah."]);
  });

  it("still accepts a reading without the new parts, as an empty viewpoint", () => {
    expect(acceptVoice(reading(), source, 6_000, 1)?.viewpoint).toEqual([]);
  });

  it("hands over what they believe, their voice on the page, the standard and the last pass", () => {
    const text = writingForAgents(reading({
      viewpoint: [{ claim: "Simple solutions beat complex ones.", words: "simplicity beats complexity" }],
      onThePage: ["Drop the spoken check-ins."],
    }), "## How to write as me").join("\n");
    expect(text).toContain("## How to write as me");
    expect(text).toContain("- Simple solutions beat complex ones. (“simplicity beats complexity”)");
    expect(text).toContain("### My voice on the page\n- Drop the spoken check-ins.");
    expect(text).toContain("### Signal, not noise");
    expect(text).toContain("### Before you hand it over");
  });

  it("gives the standard even before there is a voice to read", () => {
    const text = writingForAgents(undefined, "## How to write as me").join("\n");
    expect(text).not.toContain("What I believe");
    for (const line of WRITING_STANDARD) expect(text).toContain(line);
  });
});
