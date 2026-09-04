/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlaygroundNotice } from "./PlaygroundNotice";
import { trialState } from "@/lib/playground";
import type { CaptureEntry } from "@/lib/ledger";

const entry = (id: string): CaptureEntry => ({
  id,
  at: Date.now(),
  raw: id,
  clean: id,
  kind: "action",
  source: "typed",
  targetId: id,
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("PlaygroundNotice trial boundary", () => {
  it("shows the ordinary local-browser notice before the limit", () => {
    render(<PlaygroundNotice trial={trialState([])} />);
    expect(screen.getByText(/your board lives in this browser only/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("replaces a dismissed notice when the fifth capture completes", () => {
    localStorage.setItem("capture:playground-notice:v1", "1");
    const ledger = Array.from({ length: 5 }, (_, i) => entry(String(i)));
    render(<PlaygroundNotice trial={trialState(ledger)} />);
    expect(screen.getByText(/used today's five captures/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /install your own capture/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
