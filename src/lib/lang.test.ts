import { describe, expect, it } from "vitest";
import { detectLang, pickVoiceFor } from "./lang";

describe("detectLang", () => {
  it("defaults to English", () => {
    expect(detectLang("")).toBe("en");
    expect(detectLang("Nothing to capture here — just a hello.")).toBe("en");
    expect(detectLang("Don't forget the cat food, 3pm")).toBe("en");
  });

  it("spots Vietnamese by its distinctive diacritics", () => {
    expect(detectLang("Tôi đang nghĩ về một ý tưởng")).toBe("vi");
    expect(detectLang("Hôm nay tôi rất mệt")).toBe("vi");
  });

  it("does not mistake plain French or Spanish accents for Vietnamese", () => {
    expect(detectLang("C'est une très bonne idée")).toBe("en");
    expect(detectLang("¿Qué hora es?")).toBe("en");
  });

  it("spots Cyrillic", () => {
    expect(detectLang("Привет, как дела?")).toBe("ru");
  });

  it("spots CJK characters, Japanese separately from Chinese", () => {
    expect(detectLang("你好，今天怎么样？")).toBe("zh");
    expect(detectLang("こんにちは")).toBe("ja");
    expect(detectLang("今日は、元気ですか")).toBe("ja");
  });
});

describe("pickVoiceFor", () => {
  const voices = (
    ...langs: string[]
  ): SpeechSynthesisVoice[] =>
    langs.map((lang, i) => ({
      lang,
      name: `Voice ${i} (${lang})`,
      default: false,
      localService: true,
      voiceURI: `voice-${i}`,
    }));

  it("returns null with no voices", () => {
    expect(pickVoiceFor("hello", [])).toBeNull();
  });

  it("prefers a voice for the detected language", () => {
    const v = voices("vi-VN", "en-US");
    expect(pickVoiceFor("Tôi đang nghĩ về một ý tưởng", v)?.lang).toBe("vi-VN");
  });

  it("falls back to an English voice when the language is missing", () => {
    const v = voices("fr-FR", "en-US", "de-DE");
    expect(pickVoiceFor("Tôi đang nghĩ về một ý tưởng", v)?.lang).toBe("en-US");
  });

  it("falls back to any voice when even English is missing", () => {
    const v = voices("fr-FR", "de-DE");
    expect(pickVoiceFor("hello there", v)).not.toBeNull();
  });

  it("picks the clear-sounding voice within the language pool", () => {
    const v: SpeechSynthesisVoice[] = [
      { lang: "en-US", name: "Google US English", default: false, localService: true, voiceURI: "a" },
      { lang: "en-US", name: "Zarvox", default: false, localService: true, voiceURI: "b" },
    ];
    expect(pickVoiceFor("hello", v)?.name).toBe("Google US English");
  });
});
