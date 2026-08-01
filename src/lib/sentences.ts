/**
 * Split a growing stream of text into complete sentences.
 *
 * Spoken replies can't wait for the whole answer to finish — first audio
 * should land while the model is still writing. But a sentence that ends
 * mid-word is worse than silence. So each chunk hands in everything read so
 * far; whatever forms a complete sentence (ends on . ! ? … or a line break)
 * comes out ready to speak, and the tail — the possibly-half-finished
 * sentence — is held back for the next chunk.
 *
 * Runs of terminators ("...", "?!") collapse into a single boundary so they
 * are spoken as one beat, not a stutter of empty sentences.
 */

const TERMINATORS = new Set([".", "!", "?", "…", "\n"]);

export function takeCompleteSentences(text: string): {
  sentences: string[];
  rest: string;
} {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (TERMINATORS.has(text[i])) {
      // Consume the whole run of terminators as one boundary.
      let j = i + 1;
      while (j < text.length && TERMINATORS.has(text[j])) j++;
      const sentence = text.slice(start, j).trim();
      if (sentence) sentences.push(sentence);
      start = j;
      i = j - 1;
    }
  }
  return { sentences, rest: text.slice(start).trim() };
}
