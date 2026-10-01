/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IntentionCard, IntentionDetail } from "@/app/Intentions";
import type { Intention } from "@/lib/model";

afterEach(cleanup);
it.each([
  ["An intention for how I live: I rest without guilt.", "I rest without guilt."],
  ["I know what I want: time to rest.", "I know what I want: time to rest."],
  ["An intention for how I live:", "An intention for how I live:"],
])("shows only the intention without changing stored text: %s", (text, expected) => {
  const intention: Intention = { id: "rest", number: 53, rawInput: text, expandedIntention: text, recommendedActions: ["I take a walk."], counterIntentions: ["I keep checking work."], at: 1, updatedAt: 1 };
  const before = JSON.stringify(intention);
  const { container } = render(<>
    <IntentionCard intention={intention} onOpen={() => {}} />
    <IntentionDetail intention={intention} onBack={() => {}} onChange={() => {}} onCopy={() => {}} onDelete={() => {}} />
  </>);
  expect(container.querySelector(".int-card-text")?.textContent).toBe(expected);
  expect(container.querySelector(".int-expanded")?.textContent).toBe(expected);
  expect(JSON.stringify(intention)).toBe(before);
});
