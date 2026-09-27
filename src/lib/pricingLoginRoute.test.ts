import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CloudBilling", () => ({ CloudCheckoutButton: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pricing" }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function pricingMarkup() {
  const { default: Pricing } = await import("@/app/pricing/page");
  return renderToStaticMarkup(await Pricing({}));
}

describe("Capture Cloud login route on pricing", () => {
  it("uses the local app route on the Cloud deployment", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "0");
    expect(await pricingMarkup()).toContain('href="/app">Log in to Capture Cloud');
  });

  it("uses the validated Cloud origin from the Playground", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "0");
    vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
    expect(await pricingMarkup()).toContain(
      'href="https://cloud.trycapture.app/app">Log in to Capture Cloud',
    );
  });

  it("does not advertise Cloud login on a personal or self-hosted deployment", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "0");
    vi.stubEnv("NEXT_PUBLIC_PLAYGROUND", "0");
    vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
    expect(await pricingMarkup()).not.toContain("Log in to Capture Cloud");
  });
});