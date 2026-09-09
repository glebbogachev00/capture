/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlaygroundNotice } from "./PlaygroundNotice";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("PlaygroundNotice trial boundary", () => {
  it("shows the ordinary local-browser notice before the limit", () => {
    render(<PlaygroundNotice />);
    expect(screen.getByText(/your board lives in this browser only/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Run Capture yourself" }).getAttribute("href")
    ).toBe("/install");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("stays dismissed because quota belongs to the meter", () => {
    localStorage.setItem("capture:playground-notice:v1", "1");
    render(<PlaygroundNotice />);
    expect(screen.queryByText(/used today's \d+ captures/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
