/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SiteNav } from "./SiteNav";

afterEach(cleanup);

describe("SiteNav", () => {
  it("keeps section navigation distinct from page actions", () => {
    render(<SiteNav current="writing" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Writing" }).getAttribute("href")).toBe("/writing");
    expect(screen.getByRole("link", { name: "Install" }).getAttribute("href")).toBe("/install");
    expect(screen.getByRole("link", { name: "Writing" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "About" }).getAttribute("aria-current")).toBeNull();
  });
});
