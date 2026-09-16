import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/Capture", () => ({ Capture: () => null }));
vi.mock("@/app/Landing", () => ({ Landing: () => null }));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("public-site presentation independent of Cloud transport", () => {
  it.each([
    ["public Cloud", "0", "1", "1", true],
    ["legacy playground", "1", undefined, undefined, true],
    ["playground cannot lose its public front door", "1", "0", "1", true],
    ["self-hosted default", undefined, undefined, undefined, false],
    ["private Cloud", "0", "0", "1", false],
  ])("%s", async (_label, playground, publicSite, cloud, isPublic) => {
    vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", playground);
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_SITE", publicSite);
    vi.stubEnv("CAPTURE_CLOUD", cloud);
    vi.stubGlobal("React", React);
    const { default: Home, metadata } = await import("@/app/page");
    const { Landing } = await import("@/app/Landing");
    const { Capture } = await import("@/app/Capture");
    const { default: manifest } = await import("@/app/manifest");
    const { default: sitemap } = await import("@/app/sitemap");
    const { default: robots } = await import("@/app/robots");
    const { PLAYGROUND } = await import("@/lib/playground");
    const { OwnershipBoundary } = await import("@/components/OwnershipBoundary");
    const home = Home();
    expect(home.type).toBe(isPublic ? Landing : OwnershipBoundary);
    if (!isPublic) {
      expect(home.props.cloud).toBe(cloud === "1");
      expect(home.props.children.type).toBe(Capture);
    }
    expect(metadata.alternates?.canonical).toBe(isPublic ? "https://www.trycapture.app/" : undefined);
    expect(manifest().start_url).toBe(isPublic ? "/app" : "/");
    expect(sitemap().length > 0).toBe(isPublic);
    expect(robots().rules).toEqual(isPublic ? { userAgent: "*", allow: "/" } : { userAgent: "*", disallow: "/" });
    expect(PLAYGROUND).toBe(playground === "1");
  });
});
