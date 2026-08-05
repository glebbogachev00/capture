import { describe, expect, it } from "vitest";
import { parseCommandPrefix } from "./command";

const parse = (raw: string) => {
  const { force, payload } = parseCommandPrefix(raw);
  return [force ?? "none", payload] as const;
};

describe("parseCommandPrefix", () => {
  it("accepts the typed slash form", () => {
    expect(parse("/action call the dentist")).toEqual([
      "action",
      "call the dentist",
    ]);
    expect(parse("/thread sleep cycles")).toEqual(["thread", "sleep cycles"]);
    expect(parse("/intention I live somewhere with light")).toEqual([
      "intention",
      "I live somewhere with light",
    ]);
  });

  it("accepts the dictated slash form (the word 'slash')", () => {
    expect(parse("slash action call the dentist")).toEqual([
      "action",
      "call the dentist",
    ]);
    expect(parse("slash intention I speak calmly in meetings")).toEqual([
      "intention",
      "I speak calmly in meetings",
    ]);
  });

  it("accepts the kind word closed by a period or colon", () => {
    expect(parse("action. send the notes")).toEqual(["action", "send the notes"]);
    expect(parse("thread: what to name the product")).toEqual([
      "thread",
      "what to name the product",
    ]);
    expect(parse("Action, ")).not.toEqual(["action", ""]); // comma is not a command
    expect(parse("intention.")).toEqual(["intention", ""]);
  });

  it("is case-insensitive", () => {
    expect(parse("/ACTION CALL THE DENTIST")).toEqual([
      "action",
      "CALL THE DENTIST",
    ]);
    expect(parse("Slash Thread sleep")).toEqual(["thread", "sleep"]);
    expect(parse("Action. send it")).toEqual(["action", "send it"]);
  });

  it("strips stray punctuation after the slash-word form", () => {
    expect(parse("slash action: send it")).toEqual(["action", "send it"]);
    expect(parse("slash thread . cold brew")).toEqual(["thread", "cold brew"]);
  });

  it("leaves ordinary speech alone", () => {
    expect(parse("action items for tomorrow")).toEqual([
      "none",
      "action items for tomorrow",
    ]);
    expect(parse("I need to take action on this")).toEqual([
      "none",
      "I need to take action on this",
    ]);
    expect(parse("been reading about sleep cycles")).toEqual([
      "none",
      "been reading about sleep cycles",
    ]);
    expect(parse("remember to check out /action later")).toEqual([
      "none",
      "remember to check out /action later",
    ]);
    expect(parse("buy milk /action")).toEqual(["none", "buy milk /action"]);
  });

  it("does not match plurals or compound words", () => {
    expect(parse("/actions are plural")).toEqual([
      "none",
      "/actions are plural",
    ]);
    expect(parse("/threading a needle")).toEqual(["none", "/threading a needle"]);
    expect(parse("actions. are plural")).toEqual(["none", "actions. are plural"]);
    expect(parse("threading. a needle")).toEqual([
      "none",
      "threading. a needle",
    ]);
  });

  it("a bare command word with no payload still forces the kind", () => {
    expect(parse("/thread")).toEqual(["thread", ""]);
    expect(parse("action:")).toEqual(["action", ""]);
  });
});
