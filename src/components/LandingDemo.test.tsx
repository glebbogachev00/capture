/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingDemo } from "./LandingDemo";

afterEach(cleanup);

describe("LandingDemo", () => {
  it("shows a clean result poster before revealing native video controls", () => {
    render(<LandingDemo />);

    const play = screen.getByRole("button", { name: "Watch the 25-second demo" });
    expect(play).toBeTruthy();
    expect(screen.queryByLabelText("Capture product demo")).toBeNull();

    const poster = play.querySelector("picture");
    expect(poster).toBeTruthy();
    expect(poster?.querySelector('source[type="image/avif"]')).toBeTruthy();
    expect(poster?.querySelector('source[type="image/webp"]')).toBeTruthy();
    expect(poster?.querySelector("img")?.getAttribute("fetchpriority")).toBe("high");

    fireEvent.click(play);

    const video = screen.getByLabelText("Capture product demo");
    expect(video).toBeTruthy();
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(video.querySelector('source[media="(max-width: 600px)"]')?.getAttribute("src")).toBe(
      "/demos/two-places-mobile.mp4"
    );
  });
});
