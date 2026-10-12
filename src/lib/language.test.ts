import { describe, expect, it } from "vitest";
import { acceptRussian, needsRussian, writtenInRussian } from "./language";
import { speechLanguage } from "./speechLanguage";

describe("keeping a Russian capture in Russian", () => {
  it("tells a Russian capture from an English one by its letters", () => {
    expect(writtenInRussian("Купить молоко и забрать посылку")).toBe(true);
    expect(writtenInRussian("Скачать Notion и перенести туда заметки")).toBe(true);
    expect(writtenInRussian("Buy milk and call Mia")).toBe(false);
    expect(writtenInRussian("")).toBe(false);
  });

  it("only flags model-written English for a Russian source, never anything for an English one", () => {
    const ru = "Написать пост про новую выставку и отправить его Ане";
    expect(needsRussian(ru, "Send the post to Anna for review")).toBe(true);
    expect(needsRussian(ru, "Отправить пост Ане")).toBe(false);
    expect(needsRussian(ru, "Notion")).toBe(true);
    expect(needsRussian("Buy milk and call Mia", "Buy milk")).toBe(false);
    expect(needsRussian(ru, null)).toBe(false);
  });

  it("accepts only a Russian line per original, not much longer", () => {
    expect(acceptRussian(["Bakery", "Write a post"], { lines: ["Кондитерская", "Написать пост"] }))
      .toEqual(["Кондитерская", "Написать пост"]);
    expect(acceptRussian(["Bakery"], { lines: ["Bakery"] })).toBeNull();
    expect(acceptRussian(["Bakery", "Work"], { lines: ["Кондитерская"] })).toBeNull();
    expect(acceptRussian(["Work"], { lines: ["Работа, проекты, сроки, коллеги и всё, что связано с офисом и задачами"] })).toBeNull();
    expect(acceptRussian(["Work"], "nonsense")).toBeNull();
  });

  it("tells the speech model the language only for Russian phones", () => {
    expect(speechLanguage("ru-RU")).toBe("ru");
    expect(speechLanguage("ru")).toBe("ru");
    expect(speechLanguage("en-US")).toBeUndefined();
    expect(speechLanguage(null)).toBeUndefined();
  });
});

describe("Russian answers, tidied", () => {
  it("drops a list number the model copied into a line", () => {
    expect(acceptRussian(["Personal", "Recipe"], { lines: ["1. Личное", "2) Рецепт"] })).toEqual(["Личное", "Рецепт"]);
    expect(acceptRussian(["3. Steps"], { lines: ["3. Шаги"] })).toEqual(["3. Шаги"]);
  });
});
