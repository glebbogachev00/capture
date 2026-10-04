/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { articleBySlug } from "@/content/articles";
import { SHARED_THREADS } from "@/content/sharedThreads";
import { PublicThreadArticle, PublicThreadCard, SharedThreadCard } from "./PublicThreadArticle";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

afterEach(cleanup);

const RUNNING = articleBySlug("software-i-can-use-while-running")!;
const IMPORTED = articleBySlug("what-should-happen-after-capture")!;

describe("PublicThreadArticle", () => {
  it("presents the finished essay as a read-only Capture thread", () => {
    render(<PublicThreadArticle article={RUNNING} />);

    expect(screen.getByText("Public Capture Thread · read-only")).toBeTruthy();
    expect(screen.getByText("By Gleb Bogachev")).toBeTruthy();
    expect(screen.getByText("Where this stands")).toBeTruthy();
    expect(screen.getByText("The record behind this article")).toBeTruthy();
    expect(
      screen.getByText("Selected, lightly edited summaries. Private raw captures stay private.")
    ).toBeTruthy();
    expect(screen.getByText(`${RUNNING.sourceMoments.length} source moments`)).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Capture has to work before the thought becomes administration",
      })
    ).toBeTruthy();
    expect(screen.getByRole("article").getAttribute("data-capture-thread")).toBe("read-only");
    const navigation = screen.getByRole("navigation", { name: "Capture links" });
    expect(within(navigation).getByRole("button", { name: "Open navigation" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(navigation).getByRole("link", { name: "Writing" }).getAttribute("aria-current"))
      .toBe("page");
    const writingLinks = screen.getAllByRole("link", { name: "Written with Capture" });
    expect(writingLinks.length).toBeGreaterThanOrEqual(1);
    expect(writingLinks[0].getAttribute("href")).toBe("/writing");
  });

  it("makes article cards visibly open read-only Threads", () => {
    render(<PublicThreadCard article={RUNNING} />);

    expect(screen.getByText("Read-only thread")).toBeTruthy();
    expect(screen.getByText(`${RUNNING.sourceMoments.length} source moments`)).toBeTruthy();
    expect(screen.getByText("Open read-only Thread →")).toBeTruthy();
  });

  it("links an adapted article to its earlier X version", () => {
    render(<PublicThreadArticle article={RUNNING} />);
    const link = screen.getByRole("link", { name: `“${RUNNING.original!.title}”` });
    expect(link.getAttribute("href")).toBe(RUNNING.original!.url);
  });

  it("publishes an X article with its cover and links, without an invented record", () => {
    render(<PublicThreadArticle article={IMPORTED} />);

    expect(screen.getByRole("img", { name: IMPORTED.cover!.alt })).toBeTruthy();
    expect(screen.queryByText("Where this stands")).toBeNull();
    expect(screen.queryByText("The record behind this article")).toBeNull();
    expect(screen.getByText(/First published on X/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sep 27, 2026" }).getAttribute("href"))
      .toBe(IMPORTED.original!.url);
    const body = screen.getByRole("article");
    expect(body.textContent).not.toContain("](");
    expect(within(body).getByRole("link", { name: "https://trycapture.app/" }).getAttribute("href"))
      .toBe("https://trycapture.app/");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /^(Try|Open) Capture$/ })).toBeTruthy();
  });

  it("drops the source-moment count from cards that have none", () => {
    render(<PublicThreadCard article={IMPORTED} />);
    expect(screen.queryByText(/source moments/)).toBeNull();
  });

  it("opens shared threads on their public Capture Cloud page", () => {
    const thread = SHARED_THREADS[0];
    render(<SharedThreadCard thread={thread} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(thread.url);
    expect(screen.getByText("Open on Capture Cloud ↗")).toBeTruthy();
    expect(screen.getByRole("img", { name: thread.portrait.alt })).toBeTruthy();
  });
});
