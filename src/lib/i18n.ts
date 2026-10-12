import { RU } from "./i18n.ru";

/**
 * Capture speaks the device's language, with nothing to set: a phone in
 * Russian gets Russian, everything else English. The English wording is the
 * key, so a line without a translation still reads (in English) instead of
 * breaking, and i18n.test.ts fails until every t("…") in the app has one.
 */

export type Locale = "en" | "ru";

/** The first language the device prefers that Capture speaks. */
export function localeFrom(preferred: readonly string[] | string | null | undefined): Locale {
  const list = typeof preferred === "string"
    ? preferred.split(",").map((part) => part.split(";")[0])
    : preferred ?? [];
  for (const tag of list) {
    const code = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (code === "ru") return "ru";
    if (code === "en") return "en";
  }
  return "en";
}

let cached: Locale | null = null;

/** The device's language in the browser; English on the server. A preview
 * build can pin one (NEXT_PUBLIC_CAPTURE_LOCALE=ru) to look at a language
 * without a device set to it; production never sets it. */
export function deviceLocale(): Locale {
  const pinned = process.env.NEXT_PUBLIC_CAPTURE_LOCALE;
  if (pinned === "ru" || pinned === "en") return pinned;
  if (typeof navigator === "undefined") return "en";
  return cached ??= localeFrom(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

/** For tests: forget the detected language. */
export function _resetLocale(): void {
  cached = null;
}

type Vars = Record<string, string | number>;

const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;

/** The line in the given language, with {name} placeholders filled. */
export function translate(locale: Locale, text: string, vars?: Vars): string {
  return fill(locale === "ru" ? RU[text] ?? text : text, vars);
}

/** The line in the device's language. Only for what renders in the browser;
 * a server-rendered component takes its locale from LocaleProvider. */
export function t(text: string, vars?: Vars): string {
  return translate(deviceLocale(), text, vars);
}

/**
 * A count with its word: "1 capture", "3 captures"; "1 запись", "3 записи",
 * "5 записей". Russian has three forms, chosen by the last digits.
 */
export function countOf(
  n: number,
  english: [one: string, many: string],
  russian: [one: string, few: string, many: string],
  locale: Locale = deviceLocale(),
): string {
  if (locale !== "ru") return `${n} ${n === 1 ? english[0] : english[1]}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form = mod10 === 1 && mod100 !== 11 ? 0
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 1
    : 2;
  return `${n} ${russian[form]}`;
}

/* Capture's own nouns, for counts: English singular → [English plural, Russian 1 / 2–4 / 5+]. */
const NOUNS: Record<string, [string, [string, string, string]]> = {
  action: ["actions", ["дело", "дела", "дел"]],
  thread: ["threads", ["тема", "темы", "тем"]],
  intention: ["intentions", ["намерение", "намерения", "намерений"]],
  capture: ["captures", ["запись", "записи", "записей"]],
  note: ["notes", ["заметка", "заметки", "заметок"]],
  photo: ["photos", ["фото", "фото", "фото"]],
  image: ["images", ["изображение", "изображения", "изображений"]],
  principle: ["principles", ["принцип", "принципа", "принципов"]],
  "new principle": ["new principles", ["новый принцип", "новых принципа", "новых принципов"]],
  suggestion: ["suggestions", ["предложение", "предложения", "предложений"]],
  "strong suggestion": ["strong suggestions", ["важное предложение", "важных предложения", "важных предложений"]],
  item: ["items", ["запись", "записи", "записей"]],
  layer: ["layers", ["дополнение", "дополнения", "дополнений"]],
  fragment: ["fragments", ["фрагмент", "фрагмента", "фрагментов"]],
  picture: ["pictures", ["изображение", "изображения", "изображений"]],
  thought: ["thoughts", ["мысль", "мысли", "мыслей"]],
  record: ["records", ["запись", "записи", "записей"]],
  "open action": ["open actions", ["открытое дело", "открытых дела", "открытых дел"]],
  "photo-only note": ["photo-only notes", ["заметка только с фото", "заметки только с фото", "заметок только с фото"]],
};

/** "3 actions" / "3 дела" for one of Capture's nouns. */
export function countNoun(n: number, noun: string, locale: Locale = deviceLocale()): string {
  const known = NOUNS[noun];
  if (!known) return `${n} ${noun}${n === 1 ? "" : "s"}`;
  return countOf(n, [noun, known[0]], known[1], locale);
}
