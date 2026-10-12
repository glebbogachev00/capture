import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetLocale, countOf, localeFrom, t, translate } from "./i18n";
import { RU, RU_PRINCIPLES } from "./i18n.ru";
import { SEED_PRINCIPLES, shownPrinciple } from "./model";
import { receiptLabel, receiptLines } from "./receiptCopy";

const source = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return source(path);
  return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && !/i18n/.test(name) ? [path] : [];
});
/* Every literal passed to t("…") / t(`…`) / tr("…") anywhere in the app. */
const keys = () => {
  const found = new Map<string, string>();
  for (const file of source(join(process.cwd(), "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b(?:t|tr)\(\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g)) {
      if (match[1] === "`" && match[2].includes("${")) continue;
      found.set(match[2].replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n"), file);
    }
  }
  return found;
};

describe("Russian", () => {
  afterEach(() => { vi.unstubAllGlobals(); _resetLocale(); });

  it("has a translation for every line the app shows", () => {
    const missing = [...keys()].filter(([key]) => !(key in RU)).map(([key, file]) => `${file.replace(process.cwd() + "/", "")}: ${key}`);
    expect(missing).toEqual([]);
  });

  it("carries no translation for a line the app no longer shows", () => {
    const used = keys();
    expect(Object.keys(RU).filter((key) => !used.has(key))).toEqual([]);
  });

  it("keeps every placeholder and writes every line in Russian", () => {
    for (const [english, russian] of Object.entries(RU)) {
      const names = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(names(russian), english).toEqual(names(english));
      expect(russian.trim(), english).not.toBe("");
      /* Names that stay as they are in any language. */
      if (["Capture Cloud", "you@example.com"].includes(english)) continue;
      if (/[A-Za-z]{3}/.test(english.replace(/\{\w+\}/g, ""))) expect(/[а-яё]/i.test(russian), english).toBe(true);
    }
  });

  it("follows the device: Russian phones get Russian, everything else English", () => {
    expect(localeFrom(["ru-RU", "en-US"])).toBe("ru");
    expect(localeFrom("ru-RU,ru;q=0.9,en-US;q=0.8")).toBe("ru");
    expect(localeFrom(["en-GB", "ru"])).toBe("en");
    expect(localeFrom(["vi-VN"])).toBe("en");
    expect(localeFrom(null)).toBe("en");
  });

  it("falls back to English for a line without a translation, and fills placeholders", () => {
    expect(translate("ru", "No such line {n}", { n: 3 })).toBe("No such line 3");
    expect(translate("en", "Shared — {summary}.", { summary: "2 captures" })).toBe("Shared — 2 captures.");
  });

  it("reads the phone's language in the browser", () => {
    vi.stubGlobal("navigator", { languages: ["ru-RU"], language: "ru-RU" });
    _resetLocale();
    expect(t("No such line")).toBe("No such line");
  });

  it("counts in Russian with its three forms", () => {
    const words: [string, string, string] = ["запись", "записи", "записей"];
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => countOf(n, ["capture", "captures"], words, "ru")))
      .toEqual(["1 запись", "2 записи", "5 записей", "11 записей", "12 записей", "21 запись", "22 записи", "25 записей", "111 записей"]);
    expect(countOf(1, ["capture", "captures"], words, "en")).toBe("1 capture");
    expect(countOf(3, ["capture", "captures"], words, "en")).toBe("3 captures");
  });

  it("shows the built-in principles in Russian until they are reworded", () => {
    vi.stubGlobal("navigator", { languages: ["ru-RU"], language: "ru-RU" });
    _resetLocale();
    for (const seed of SEED_PRINCIPLES) expect(RU_PRINCIPLES[seed.name]).toBeDefined();
    expect(shownPrinciple(SEED_PRINCIPLES[6]).name).toBe("Упрощайте");
    expect(shownPrinciple({ ...SEED_PRINCIPLES[6], description: "My own words" }).name).toBe("Simplify");
  });

  it("reads English receipt tokens and shows them in Russian", () => {
    vi.stubGlobal("navigator", { languages: ["ru-RU"], language: "ru-RU" });
    _resetLocale();
    expect(receiptLines("Спортзал · a new thread")).toEqual(["Новая тема: Спортзал"]);
    expect(receiptLines("2 actions · a layer on Спортзал")).toEqual(["2 дела", "Добавлено в тему: Спортзал"]);
    expect(receiptLabel("Actions")).toBe("Дела");
  });
});
