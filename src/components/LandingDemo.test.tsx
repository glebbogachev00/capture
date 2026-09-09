/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingDemo } from "./LandingDemo";

afterEach(cleanup);

describe("LandingDemo", () => {
  it("shows a clean result poster before revealing native video controls", () => {
    render(<LandingDemo />);

    expect(screen.getByRole("button", { name: "Play Capture demo" })).toBeTruthy();
    expect(screen.queryByLabelText("Capture product demo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play Capture demo" }));

    const video = screen.getByLabelText("Capture product demo");
    expect(video).toBeTruthy();
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
  });
});
