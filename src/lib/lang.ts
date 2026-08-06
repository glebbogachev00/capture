/**
 * Best-effort language detection for a short spoken line.
 *
 * Capture is English-first but not English-only; a spoken reply in another
 * language should be read by a voice that speaks it. This is a cheap,
 * structural guess — character sets are enough to route a TTS voice — not a
 * full language detector. English is the default when nothing distinctive
 * shows up, matching the app's existing behaviour.
 */
export function detectLang(text: string): string {
  if (!text) return "en";
  // Japanese kana gets a Japanese voice rather than a Mandarin one.
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  // Chinese han characters.
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  // Cyrillic.
  if (/[а-яёЁ]/i.test(text)) return "ru";
  // Vietnamese's distinctive diacritic stack — ạ ộ ữ ơ ư ă ê ô đ and friends.
  // (é, è, ó… alone are shared with French/Spanish, so only the marks
  // Vietnamese owns count, plus the long vowel forms that mark it clearly.)
  if (
    /[ắằẳẵặấầẩẫậẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỷỵđơưă]/i.test(
      text
    )
  ) {
    return "vi";
  }
  return "en";
}

/**
 * The best voice for a line, from a browser's loaded voices.
 *
 * Prefers a voice that speaks the detected language, falls back to English,
 * then to any voice at all — a Mac without a Vietnamese voice should still
 * read Vietnamese aloud with the only voice it has rather than staying
 * silent. Within a language pool, the clearest-sounding voices win.
 */
export function pickVoiceFor(
  text: string,
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const lang = detectLang(text);
  const byLang = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(lang)
  );
  const pool = byLang.length
    ? byLang
    : voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const finalPool = pool.length ? pool : voices;
  return (
    finalPool.find(
      (v) =>
        /natural|samantha|google us english|google [a-z]+ english/i.test(
          v.name
        ) || v.name.toLowerCase().includes(lang)
    ) || finalPool[0]
  );
}
