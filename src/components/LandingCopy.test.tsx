/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import motion from "./LandingMotion.module.css";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

async function page(playground = true, publicSite = true, cloud = false) {
  vi.stubGlobal("React", React);
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", playground ? "1" : "0");
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_SITE", publicSite ? "1" : "0");
  vi.stubEnv("CAPTURE_CLOUD", cloud ? "1" : "0");
  const { Landing } = await import("@/app/Landing");
  return render(<Landing />);
}

const HEADLINE = "Messy thoughts that sort themselves.";

describe("Landing copy within the existing page", () => {
  it("explains multi-topic capture without a length or accuracy guarantee", async () => {
    await page();
    expect(screen.getByText(/separates topics into new or existing threads/)).toBeTruthy();
    expect(screen.getByText(/pulls out the things to do/)).toBeTruthy();
  });
  it("preserves the exact agreed headline, with benefits outside it", async () => {
    await page();
    const hero = screen.getByRole("region", { name: HEADLINE });
    expect(within(hero).getByRole("heading", { level: 1 }).textContent).toBe(HEADLINE);
    expect(hero.querySelector(".site-lede")?.textContent?.trim()).toBe("Say what’s on your mind. Capture keeps related ideas together, separates out tasks, and helps you find your thoughts later.");
    expect(hero.querySelector(".site-lede")?.textContent).not.toMatch(/Action|Thread|Intention/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
  it("retains the existing page sections and demo instead of a new layout", async () => {
    await page();
    for (const cls of ["site-hero-split", "hero-clip", "demo-reel", "site-day", "site-problem", "site-kind-grid", "site-quiet", "site-note", "site-writing", "site-voice", "site-proof"]) {
      expect(document.querySelector(`.${cls}`)).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Watch the 25-second demo" })).toBeTruthy();
    expect(document.querySelector(".landing-benefits")).toBeNull();
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
  });
  it("explains upkeep, retrieval, and destinations in plain language", async () => {
    await page();
    for (const text of ["What you need to do.", "Thoughts you’re still developing.", "Goals that guide your choices."]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText(/Search the words you remember/)).toBeTruthy();
    expect(screen.getByText(/Keep the ones you still need/)).toBeTruthy();
    expect(screen.getByText(/businesses that run without me/)).toBeTruthy();
  });
  it("explains thread handoff and original captures without an automatic integration", async () => {
    await page();
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
  it("keeps trial and storage limits explicit", async () => {
    await page();
    expect(screen.getByText(/15 captures a day. No account. This board stays in your browser/)).toBeTruthy();
    expect(screen.getByText(/Export a backup before clearing browser data/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Apple Notes");
    expect(document.body.textContent).not.toMatch(/never lost|resurfac|Mayflies|Sediment|—/);
  });
  it.each([[true, true, false], [false, true, false], [false, true, true], [false, false, false]])(
    "retains the AI processing disclosure (playground=%s, public=%s, Cloud=%s)",
    async (playground, publicSite, cloud) => {
      await page(playground, publicSite, cloud);
      expect(document.querySelector(".site-proof")?.textContent).toContain(
        "AI features send relevant content to model providers for processing.",
      );
    },
  );
  it("explains complementary apps with only the requested logos", async () => {
    await page();
    const apps = document.querySelector(".site-other-apps")!;
    expect(apps.textContent).toContain("not a replacement for Notion or Obsidian");
    expect(apps.textContent).toContain("Develop them in Capture, or copy them into the app you choose");
    expect([...apps.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual(["/brands/notion.png", "/brands/obsidian.svg"]);
  });
  it("explains Distill as clarification with review before saving", async () => {
    await page();
    const distill = screen.getByRole("region", { name: "Distill mode" });
    expect(distill.textContent).toContain("short AI conversation");
    expect(distill.textContent).toContain("clarify an idea or decision");
    expect(distill.textContent).toContain("Review the result, then save");
  });
  it("groups both feature cards under the approved heading and supporting sentence", async () => {
    await page();
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
  it("places real app screenshots in the matching feature cards", async () => {
    await page();
    const handoff = screen.getByRole("region", { name: "Agent handoff" });
    const distill = screen.getByRole("region", { name: "Distill mode" });
    expect(within(handoff).getByRole("img").getAttribute("src")).toBe("/screenshots/record-heatmap.png");
    expect(within(handoff).getByText(/Example capture history/)).toBeTruthy();
    expect(within(distill).getByRole("img").getAttribute("src")).toBe("/screenshots/distill-mode.png");
  });
  it("preserves the existing maker and writing evidence", async () => {
    await page();
    expect(screen.getByRole("region", { name: "From the maker" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read the articles" }).getAttribute("href")).toBe("/writing");
  });
  it("preserves main's DOM order and motion hooks without the alternate order override", async () => {
    const { container } = await page();
    expect(container.querySelector("main")?.classList.contains(motion.root)).toBe(true);
    expect(container.querySelectorAll(".site-hero-heading h1 > span")).toHaveLength(5);
    expect(container.querySelector(".hero-clip")?.closest("details")).toBeNull();
    expect(container.querySelectorAll(".demo-split")).toHaveLength(1);
    for (const selector of [".site-kind-grid", ".site-day", ".site-quiet", ".site-voice"]) {
      expect(container.querySelectorAll(selector)).toHaveLength(1);
    }
    const sections = [...container.querySelectorAll(".site-wrap > *")].map(element => element.id || element.className);
    expect(sections).toEqual([
      "capture-head site-head", "site-hero site-hero-split", "site-card site-demo hero-clip", "demo-reel",
      "use-cases", "site-card site-day", "writing", "site-card site-writing", "maker", "site-card site-note",
      "site-card site-problem", "three-kinds", "site-kind-grid", "feature-chapter", "how-to", "site-card site-voice",
      "ownership", "site-card site-proof",
    ]);
    const source = readFileSync("src/app/Landing.tsx", "utf8");
    expect(source).toContain("<LandingMotion />");
    expect(source).not.toContain("./Landing.module.css");
    expect(source).not.toContain("LandingThreadExample");
  });

  it.each([false, true])("does not advertise a no-account trial on a non-playground public build (Cloud=%s)", async cloud => {
    const { container } = await page(false, true, cloud);
    expect(document.body.textContent).not.toMatch(/No account|captures a day|captures today|stay in this browser|stays in your browser/);
    expect(document.body.textContent).toContain("See pricing for availability.");
    expect(document.body.textContent).toContain("Cloud is optional and paid.");
    expect(screen.getAllByRole("link", { name: "Try Capture" }).map(link => link.getAttribute("href"))).toEqual(["/app", "/app"]);
    expect(screen.getByRole("link", { name: "Read the articles" }).getAttribute("href")).toBe("/writing");
    expect(JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!)).toMatchObject({ "@type": "WebSite", url: "https://www.trycapture.app/" });
  });

  it("keeps legacy playground entry public even with the public flag disabled", async () => {
    const { container } = await page(true, false);
    expect(screen.getByRole("link", { name: "Try Capture" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: "Try 15 captures today" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: "Read the articles" })).toBeTruthy();
    expect(container.querySelector('script[type="application/ld+json"]')).not.toBeNull();
  });

  it.each([false, true])("keeps private entry independent of Cloud transport (Cloud=%s)", async cloud => {
    const { container } = await page(false, false, cloud);
    expect(screen.getAllByRole("link", { name: "Open Capture" }).map(link => link.getAttribute("href"))).toEqual(["/", "/"]);
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/about");
    expect(document.querySelector(".site-cue")).toBeNull();
    expect(document.body.textContent).not.toMatch(/No account|captures a day|captures today/);
    expect(screen.queryByRole("link", { name: "Read the articles" })).toBeNull();
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});
