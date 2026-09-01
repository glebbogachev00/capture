/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Thread } from "@/lib/model";
import { CaptureProfile } from "./CaptureProfile";

const threads: Thread[] = [
  {
    id: "capture",
    name: "Capture.",
    summary: "A thinking system shaped through daily use.",
    frags: [{ id: "f1", at: 1, text: "first" }],
  },
];

describe("CaptureProfile", () => {
  it("keeps the title visible while the chevron hides the profile", () => {
    render(
      <CaptureProfile
        threads={threads}
        onOpenThread={() => {}}
        defaults={{ name: "Gleb", image: "/gleb.jpg" }}
        storageKey="capture:test-profile"
      />
    );

    expect(screen.getByDisplayValue("Gleb")).toBeTruthy();
    const toggle = screen.getByRole("button", {
      name: "Hide your Capture profile",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);

    expect(screen.queryByDisplayValue("Gleb")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show your Capture profile" })
    ).toBeTruthy();
    expect(screen.getByText("Your Capture")).toBeTruthy();
  });
});
