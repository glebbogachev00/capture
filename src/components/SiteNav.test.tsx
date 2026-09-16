/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SiteNav } from "./SiteNav";

afterEach(cleanup);

describe("SiteNav", () => {
  it("toggles the mobile disclosure and closes with Escape", () => {
    render(<SiteNav current="pricing" />);
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("link", { name: "Pricing" }), { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });
  it("keeps section navigation distinct from page actions", () => {
    render(<SiteNav current="writing" />);

    expect(screen.getByRole("button", { name: "Open navigation" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Writing" }).getAttribute("href")).toBe("/writing");
    expect(screen.getByRole("link", { name: "Install" }).getAttribute("href")).toBe("/install");
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
    expect(screen.getByRole("link", { name: "Writing" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "About" }).getAttribute("aria-current")).toBeNull();
  });
});
