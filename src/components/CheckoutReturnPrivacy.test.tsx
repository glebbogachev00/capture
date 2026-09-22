/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@vercel/analytics/next", () => ({
  Analytics: ({ beforeSend }: { beforeSend: (event: { type: "pageview"; url: string }) => unknown }) => {
    analytics.events.push(beforeSend({ type: "pageview", url: window.location.href }));
    return null;
  },
}));

import { CheckoutReturnNotice } from "@/components/CloudBilling";
import { PrivateAnalytics } from "@/components/PrivateAnalytics";

const realFetch = globalThis.fetch;

beforeEach(() => {
  analytics.events.length = 0;
  window.history.replaceState({}, "", "/app?checkout_id=private-checkout&tab=threads#private-fragment");
  globalThis.fetch = vi.fn().mockResolvedValue(Response.json({
    tier: "cloud",
    status: "active",
    plan: "monthly",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-10-11T10:00:00.000Z",
    accessExpiresAt: "2026-10-11T10:00:00.000Z",
  }));
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("checkout return privacy handoff", () => {
  it("keeps polling after URL redaction while Analytics receives no query or fragment", async () => {
    const view = render(
      <>
        <CheckoutReturnNotice />
        <PrivateAnalytics />
      </>,
    );

    await waitFor(() => expect(window.location.href).toBe(
      "http://localhost:3000/app?tab=threads#private-fragment",
    ));
    expect(window.history.state).toMatchObject({ __captureCheckoutReturn: true });
    expect(JSON.stringify(window.history.state)).not.toContain("private-checkout");
    view.rerender(
      <>
        <CheckoutReturnNotice />
        <PrivateAnalytics />
      </>,
    );

    await waitFor(() => expect(screen.getByText("Capture Cloud is active.")).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/cloud/subscription", expect.any(Object));
    await waitFor(() => expect(analytics.events.length).toBeGreaterThan(0));
    expect(analytics.events).toContainEqual({
      type: "pageview",
      url: "http://localhost:3000/app",
    });
    expect(JSON.stringify(analytics.events)).not.toMatch(/checkout|tab=|private/);
  });

  it("hands off checkout-return state when Analytics hydrates first", async () => {
    const view = render(<PrivateAnalytics />);
    await waitFor(() => expect(window.location.search).toBe("?tab=threads"));

    view.rerender(
      <>
        <CheckoutReturnNotice />
        <PrivateAnalytics />
      </>,
    );

    await waitFor(() => expect(screen.getByText("Capture Cloud is active.")).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/cloud/subscription", expect.any(Object));
    expect(JSON.stringify(analytics.events)).not.toMatch(/checkout|tab=|private/);
  });
});
