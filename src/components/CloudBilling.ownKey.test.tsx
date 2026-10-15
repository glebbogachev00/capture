// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CloudAccountPanel } from "@/components/CloudBilling";
import { installDocumentLifetime } from "@/lib/ownership";
import { readOwnKey } from "@/lib/ownAiKey";

afterEach(() => { cleanup(); localStorage.clear(); });

it("lets an active Cloud member keep their own AI key on this device, and remove it", async () => {
  installDocumentLifetime({ owner: "member", expiresAt: Date.now() + 60_000 });
  globalThis.fetch = vi.fn().mockImplementation(async () => Response.json({
    tier: "cloud", status: "active", plan: "monthly", cancelAtPeriodEnd: false,
    currentPeriodEnd: null, accessSource: "subscription", captureLimit: null, canManageBilling: true,
  }));
  render(<CloudAccountPanel />);

  const field = await screen.findByLabelText("Your AI key");
  fireEvent.change(field, { target: { value: "not-a-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("That isn't an OpenRouter, Groq or Cerebras key.")).toBeTruthy();
  expect(readOwnKey("member")).toBeNull();

  const key = "sk-or-v1-" + "a".repeat(40);
  fireEvent.change(field, { target: { value: key } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText(/Using your own OpenRouter key on this device/)).toBeTruthy();
  expect(readOwnKey("member")).toBe(key);
  expect(document.body.textContent).not.toContain(key);

  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  expect(readOwnKey("member")).toBeNull();
  expect(screen.getByLabelText("Your AI key")).toBeTruthy();
});
