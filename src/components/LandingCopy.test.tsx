/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "@/app/Landing";
vi.mock("@/lib/playground", () => ({ PLAYGROUND: true, TRIAL_LIMIT: 15 }));
afterEach(cleanup);

const HEADLINE = "Messy thoughts that sort themselves.";

describe("Landing copy within the existing page", () => {
  it("explains multi-topic capture without a length or accuracy guarantee", () => {
    render(<Landing />);
    expect(screen.getByText(/separates topics into new or existing threads/)).toBeTruthy();
    expect(screen.getByText(/pulls out the things to do/)).toBeTruthy();
  });
  it("preserves the exact agreed headline, with benefits outside it", () => {
    render(<Landing />);
    const hero = screen.getByRole("region", { name: HEADLINE });
    expect(within(hero).getByRole("heading", { level: 1 }).textContent).toBe(HEADLINE);
    expect(hero.querySelector(".site-lede")?.textContent?.trim()).toBe("Say what’s on your mind. Capture keeps related ideas together, separates out tasks, and helps you find your thoughts later.");
    expect(hero.querySelector(".site-lede")?.textContent).not.toMatch(/Action|Thread|Intention/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
  it("retains the existing page sections and demo instead of a new layout", () => {
    render(<Landing />);
    for (const cls of ["site-hero-split", "hero-clip", "demo-reel", "site-day", "site-problem", "site-kind-grid", "site-quiet", "site-note", "site-writing", "site-voice", "site-proof"]) {
      expect(document.querySelector(`.${cls}`)).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Watch the 25-second demo" })).toBeTruthy();
    expect(document.querySelector(".landing-benefits")).toBeNull();
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
  });
  it("explains upkeep, retrieval, and destinations in plain language", () => {
    render(<Landing />);
    for (const text of ["What you need to do.", "Thoughts you’re still developing.", "Goals that guide your choices."]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText(/Search the words you remember/)).toBeTruthy();
    expect(screen.getByText(/Keep the ones you still need/)).toBeTruthy();
    expect(screen.getByText(/businesses that run without me/)).toBeTruthy();
  });
  it("explains thread handoff and original captures without an automatic integration", () => {
    render(<Landing />);
    expect(screen.getByText(/everything you’ve added, with dates/)).toBeTruthy();
    const handoff = screen.getByRole("region", { name: "Agent handoff" });
    expect(handoff.textContent).toContain("heat map");
    expect(handoff.textContent).toContain("Click any day");
    expect(handoff.textContent).toContain("Click Share");
    expect(handoff.textContent).toContain("that day’s captures");
    expect(handoff.textContent).toContain("summary and dated notes");
    expect(handoff.textContent).toContain("that tab’s list");
    expect(handoff.textContent).toContain("copy and paste");
  });
  it("keeps trial and storage limits explicit", () => {
    render(<Landing />);
    expect(screen.getByText(/15 captures a day. No account. This board stays in your browser/)).toBeTruthy();
    expect(screen.getByText(/Export a backup before clearing browser data/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Apple Notes");
    expect(document.body.textContent).not.toMatch(/never lost|resurfac|Mayflies|Sediment|—/);
  });
  it("explains complementary apps with only the requested logos", () => {
    render(<Landing />);
    const apps = document.querySelector(".site-other-apps")!;
    expect(apps.textContent).toContain("not a replacement for Notion or Obsidian");
    expect(apps.textContent).toContain("Develop them in Capture, or copy them into the app you choose");
    expect([...apps.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual(["/brands/notion.png", "/brands/obsidian.svg"]);
  });
  it("explains Distill as clarification with review before saving", () => {
    render(<Landing />);
    const distill = screen.getByRole("region", { name: "Distill mode" });
    expect(distill.textContent).toContain("short AI conversation");
    expect(distill.textContent).toContain("clarify an idea or decision");
    expect(distill.textContent).toContain("Review the result, then save");
  });
  it("groups both feature cards under the approved heading and supporting sentence", () => {
    render(<Landing />);
    const title = "When you need to do more with a thought.";
    const section = screen.getByRole("region", { name: title });
    const heading = within(section).getByRole("heading", { name: title, level: 2 });
    expect(section.parentElement?.classList.contains("site-wrap")).toBe(true);
    expect(heading.closest(".site-card")).toBeNull();
    expect(heading.parentElement?.querySelector("p")?.textContent).toBe("Work through an idea, or share it with your agent.");
    const cards = section.querySelectorAll(".feature-card-grid > .feature-card-layout");
    expect(cards).toHaveLength(2);
    expect([...cards].map(card => card.id)).toEqual(["distill", "handoff"]);
    for (const card of cards) expect(heading.compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(document.querySelectorAll(".feature-chapter")).toHaveLength(1);
    expect(screen.getByRole("heading", {name: "Distill mode", level: 3})).toBeTruthy();
    expect(screen.getByRole("heading", {name: "Agent handoff", level: 3})).toBeTruthy();
    expect(document.querySelector(".site-distill .feature-screenshot-frame img")).not.toBeNull();
    expect(screen.getByText(/Tap this icon beside Capture/)).toBeTruthy();
    expect(screen.getByText(/Tap the counts below Capture/)).toBeTruthy();
  });
  it("places real app screenshots in the matching feature cards", () => {
    render(<Landing />);
    const handoff = screen.getByRole("region", { name: "Agent handoff" });
    const distill = screen.getByRole("region", { name: "Distill mode" });
    expect(within(handoff).getByRole("img").getAttribute("src")).toBe("/screenshots/record-heatmap.png");
    expect(within(handoff).getByText(/Example capture history/)).toBeTruthy();
    expect(within(distill).getByRole("img").getAttribute("src")).toBe("/screenshots/distill-mode.png");
  });
  it("preserves the existing maker and writing evidence", () => {
    render(<Landing />);
    expect(screen.getByRole("region", { name: "From the maker" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read the articles" }).getAttribute("href")).toBe("/writing");
  });
});
