// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { VOICE_SECONDS_PER_DAY, spendVoice, subscribeVoice, voiceSecondsLeft } from "./voiceAllowance";

const MORNING = new Date(2026, 9, 6, 9, 0).getTime();
const EVENING = new Date(2026, 9, 6, 21, 0).getTime();
const TOMORROW = new Date(2026, 9, 7, 8, 0).getTime();

beforeEach(() => localStorage.clear());

it("gives ten minutes a day and counts recordings against them", () => {
  expect(VOICE_SECONDS_PER_DAY).toBe(600);
  expect(voiceSecondsLeft(MORNING)).toBe(600);
  spendVoice(90, MORNING);
  spendVoice(30.5, EVENING);
  expect(voiceSecondsLeft(EVENING)).toBeCloseTo(479.5);
});

it("never goes below zero, and starts over the next day", () => {
  spendVoice(700, MORNING);
  expect(voiceSecondsLeft(EVENING)).toBe(0);
  expect(voiceSecondsLeft(TOMORROW)).toBe(600);
});

it("tells subscribers when voice was spent", () => {
  const listener = vi.fn();
  const stop = subscribeVoice(listener);
  spendVoice(10, MORNING);
  stop();
  spendVoice(10, MORNING);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("treats unreadable storage as a fresh day", () => {
  localStorage.setItem("capture:voice-used:v1", "{not json");
  expect(voiceSecondsLeft(MORNING)).toBe(600);
});
