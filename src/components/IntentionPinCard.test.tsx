/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntentionCard, IntentionDetail } from "@/app/Intentions";
import type { Intention, ProfileIdentity } from "@/lib/model";

const intention: Intention = { id: "rest", number: 1, rawInput: "I rest.", expandedIntention: "I rest.", recommendedActions: ["I take a walk."], counterIntentions: ["I keep checking work."], at: 1, updatedAt: 1 };
afterEach(cleanup);
it("uses a current display number in cards and details without changing the stored number", () => {
  const old = { ...intention, number: 51 };
  const { container } = render(<>
    <IntentionCard intention={old} displayNumber={2} onOpen={() => {}} />
    <IntentionDetail intention={old} displayNumber={2} onBack={() => {}} onChange={() => {}} onCopy={() => {}} onDelete={() => {}} />
  </>);
  expect([...container.querySelectorAll(".int-number")].map(node => node.textContent)).toEqual(["(02)", "(02)"]);
  expect(old.number).toBe(51);
});
it("pins from its own button while the card still opens the intention", () => {
  const onTogglePin = vi.fn(), onOpen = vi.fn();
  const profile: ProfileIdentity = { name: "", intentionShowcaseEnabled: true, pinnedIntentionIds: [] };
  const { rerender } = render(<IntentionCard intention={intention} profile={profile} onTogglePin={onTogglePin} onOpen={onOpen} />);
  const pin = screen.getByRole("button", { name: /^Pin intention/ });
  expect(pin.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(pin);
  expect(onTogglePin).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  rerender(<IntentionCard intention={intention} profile={{ ...profile, pinnedIntentionIds: ["rest"] }} onTogglePin={onTogglePin} onOpen={onOpen} />);
  const unpin = screen.getByRole("button", { name: /^Unpin intention/ });
  expect(unpin.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(unpin);
  expect(onTogglePin).toHaveBeenCalledTimes(2);
  expect(onOpen).not.toHaveBeenCalled();
  const card = screen.getAllByRole("button").find(button => button !== unpin)!;
  fireEvent.click(card);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onTogglePin).toHaveBeenCalledTimes(2);
});
it.each([undefined, { name: "", intentionShowcaseEnabled: false }])("preserves normal tap-to-open when the feature is off", profile => {
  const onOpen = vi.fn(), onTogglePin = vi.fn();
  render(<IntentionCard intention={intention} profile={profile} onTogglePin={onTogglePin} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onTogglePin).not.toHaveBeenCalled();
});
