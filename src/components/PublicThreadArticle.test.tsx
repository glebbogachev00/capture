/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTICLES } from "@/content/articles";
import { PublicThreadArticle, PublicThreadCard } from "./PublicThreadArticle";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

afterEach(cleanup);

describe("PublicThreadArticle", () => {
  it("presents the finished essay as a read-only Capture thread", () => {
    render(<PublicThreadArticle article={ARTICLES[0]} />);

    expect(screen.getByText("Public Capture Thread · read-only")).toBeTruthy();
    expect(screen.getByText("By Gleb Bogachev")).toBeTruthy();
    expect(screen.getByText("Where this stands")).toBeTruthy();
    expect(screen.getByText("The record behind this article")).toBeTruthy();
    expect(
      screen.getByText("Selected, lightly edited summaries. Private raw captures stay private.")
    ).toBeTruthy();
    expect(screen.getByText(`${ARTICLES[0].sourceMoments.length} source moments`)).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Capture has to work before the thought becomes administration",
      })
    ).toBeTruthy();
    expect(screen.getByRole("article").getAttribute("data-capture-thread")).toBe("read-only");
    const navigation = screen.getByRole("navigation", { name: "Capture links" });
    expect(within(navigation).queryByRole("button")).toBeNull();
    expect(within(navigation).getByRole("link", { name: "Writing" }).getAttribute("aria-current"))
      .toBe("page");
    const writingLinks = screen.getAllByRole("link", { name: "Written with Capture" });
    expect(writingLinks.length).toBeGreaterThanOrEqual(1);
    expect(writingLinks[0].getAttribute("href")).toBe("/writing");
  });

  it("makes article cards visibly open read-only Threads", () => {
    render(<PublicThreadCard article={ARTICLES[0]} />);

    expect(screen.getByText("Read-only thread")).toBeTruthy();
    expect(screen.getByText(`${ARTICLES[0].sourceMoments.length} source moments`)).toBeTruthy();
    expect(screen.getByText("Open read-only Thread →")).toBeTruthy();
  });
});
