/* Languages the speech model is told outright when the phone uses them. Left
   to itself it guesses, and a few Russian words can come back as another
   language. English needs no hint. */
const HINTED = new Set(["ru"]);

/** The hint for a device language header ("ru-RU" → "ru"), or none. */
export function speechLanguage(header: string | null): string | undefined {
  const code = (header ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return HINTED.has(code) ? code : undefined;
}
