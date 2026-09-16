import { expect, it } from "vitest";
import { distillSource, distillUserTurn, hydrateDistill } from "./distill";

it("hydrates legacy, valid original, and malformed source fields without rewriting edited text", () => {
  const session = hydrateDistill(JSON.stringify({ id: "session", at: 1, turns: [
    { role: "user", text: "Legacy text", at: 2 },
    { role: "user", text: "Edited text", transcript: "  original\n", at: 3 },
    { role: "user", text: "Bad source", transcript: { text: "not a string" }, at: 4 },
    { role: "user", text: "Empty source", transcript: "", at: 5 },
    { role: "assistant", text: "A reply", transcript: "Not recogniser evidence", at: 6 },
  ] }));
  expect(session.turns).toEqual([
    { role: "user", text: "Legacy text", at: 2 },
    { role: "user", text: "Edited text", transcript: "  original\n", at: 3 },
    { role: "user", text: "Bad source", at: 4 },
    { role: "user", text: "Empty source", at: 5 },
    { role: "assistant", text: "A reply", at: 6 },
  ]);
});

it("exports the edited conversation separately from original user utterances", () => {
  const session = { id: "s", at: 1, turns: [
    distillUserTurn("Edited first", 1, " First original. "),
    { role: "assistant" as const, text: "Reply.", at: 2 },
    distillUserTurn("Typed turn.", 3),
    distillUserTurn("Edited second", 4, "Second original.\n"),
  ] };
  expect(distillSource(hydrateDistill(JSON.stringify(session)))).toEqual({
    raw: "Edited first Reply. Typed turn. Edited second", source: "distill",
    transcript: " First original. \n\nSecond original.\n",
  });
});

it("typed-only exports do not invent recogniser evidence", () => {
  expect(distillSource({ id: "s", at: 1, turns: [distillUserTurn("Typed", 1)] })).toEqual({
    raw: "Typed", source: "distill",
  });
});
