/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaygroundNotice } from "./PlaygroundNotice";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
});
afterEach(cleanup);

describe("PlaygroundNotice trial boundary", () => {
  it("shows the ordinary local-browser notice before the limit", () => {
    render(<PlaygroundNotice />);
    expect(screen.getByText(/your board lives in this browser only/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Use Capture Cloud" }).getAttribute("href")
    ).toBe("https://cloud.trycapture.app/login?next=%2Fapp");
    expect(
      screen.getByRole("link", { name: "run Capture yourself" }).getAttribute("href")
    ).toBe("/install");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("keeps the local path when the Cloud destination is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "");
    render(<PlaygroundNotice />);
    expect(screen.queryByRole("link", { name: "Use Capture Cloud" })).toBeNull();
    expect(screen.getByRole("link", { name: "run Capture yourself" })).toBeTruthy();
  });
});
