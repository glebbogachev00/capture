import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/LandingDemo", () => ({ LandingDemo: () => null }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

async function page(playground: boolean) {
  vi.stubGlobal("React", React);
  vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", playground ? "1" : "0");
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_SITE", "1");
  const { Landing } = await import("@/app/Landing");
  return renderToStaticMarkup(<Landing />);
}

it("puts accumulating thinking before categories, use, writing, and maker proof", async () => {
  const html = await page(true);
  const markers = ['<h1>', 'id="thread-example-title"', 'id="three-kinds"', 'id="use-cases"', 'aria-label="Agent handoff"', 'aria-label="Voice typing compatibility"', 'id="writing"', 'id="maker"', 'id="ownership"'];
  const positions = markers.map(marker => html.indexOf(marker));
  expect(positions.every(p => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a,b) => a-b));
  expect(html).toContain('Say it, write it. Capture sorts it out.');
  expect(html).toContain('No account needed.');
  expect(html).toContain('relevant content to model providers');
  expect(html).toContain('manual handoff, not an automatic integration');
  for (const link of ['/app', '/install', '/pricing', '/writing']) expect(html).toContain(`href="${link}"`);
});

it("does not advertise a no-account trial on a Cloud-only public build", async () => {
  const html = await page(false);
  expect(html).not.toContain('No account needed.');
  expect(html).toContain('See pricing for availability.');
});
