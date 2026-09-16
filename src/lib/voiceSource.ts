/** Append recogniser evidence for EVERY utterance, not just cleaned ones.
 * `raw` is absent when the recogniser text was returned unchanged. Keep
 * source wording verbatim and separate from typed/edited capture text.
 */
export function appendDictationTranscript(
  previous: string,
  text: string,
  raw?: string,
): string {
  const chunk = raw || text;
  return (previous ? previous + " " : "") + chunk;
}
