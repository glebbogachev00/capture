/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.params,
}));

import {
  CheckoutReturnNotice,
  CloudCheckoutButton,
  CloudAccountPanel,
  fetchCloudSubscription,
  safePolarDestination,
} from "@/components/CloudBilling";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  navigation.push.mockReset();
  navigation.params = new URLSearchParams();
  globalThis.fetch = realFetch;
});

describe("Capture Cloud billing client", () => {
  it("accepts only HTTPS destinations owned by Polar", () => {
    expect(safePolarDestination("https://buy.polar.sh/checkout/one")).toBe("https://buy.polar.sh/checkout/one");
    expect(safePolarDestination("https://sandbox.polar.sh/portal/one")).toBe("https://sandbox.polar.sh/portal/one");
    expect(safePolarDestination("https://polar.sh.evil.test/checkout")).toBeNull();
    expect(safePolarDestination("javascript:alert(1)")).toBeNull();
  });

  it("keeps management and status retry available while pending billing denies access", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => Response.json({ tier: "free", status: "active", reconciliationRequired: true }));
    render(<CloudAccountPanel />);
    const manage = await screen.findByRole("button", { name: "Manage subscription" });
    expect(screen.queryByText("See Capture Cloud")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    fireEvent.click(manage);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/cloud/portal", expect.any(Object)));
  });
  it("normalizes the authenticated status response", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      tier: "cloud",
      status: "active",
      plan: "yearly",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2027-09-11T10:00:00.000Z",
      accessExpiresAt: "2027-09-11T10:00:00.000Z",
    }));
    const result = await fetchCloudSubscription(fetcher);
    expect(result.subscription?.tier).toBe("cloud");
    expect(fetcher).toHaveBeenCalledWith("/api/cloud/subscription", expect.objectContaining({ cache: "no-store" }));
  });

  it("preserves checkout intent while sending signed-out buyers through OTP", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    render(<CloudCheckoutButton plan="monthly">Choose monthly</CloudCheckoutButton>);
    fireEvent.click(screen.getByRole("button", { name: "Choose monthly" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(
      "/login?next=%2Fpricing%3Fcheckout%3Dmonthly",
    ));
  });

  it("resumes the selected checkout automatically after login", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(
      { error: "checkout temporarily unavailable" },
      { status: 503 },
    ));
    globalThis.fetch = fetcher;

    render(
      <CloudCheckoutButton plan="yearly" autoStart>
        Choose yearly
      </CloudCheckoutButton>,
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith(
      "/api/cloud/checkout",
      expect.objectContaining({ body: JSON.stringify({ plan: "yearly" }) }),
    );
  });

  it.each(["free", "signed-out", "unavailable", "network-error"])(
    "does not claim payment or access when checkout status is %s",
    async (status) => {
      vi.useFakeTimers();
      navigation.params = new URLSearchParams("checkout_id=forged-or-real");
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        if (status === "network-error") throw new Error("offline");
        return Response.json(
          { tier: "free" },
          { status: status === "signed-out" ? 401 : status === "unavailable" ? 503 : 200 },
        );
      });

      render(<CheckoutReturnNotice />);
      expect(screen.queryByText("Payment received.")).toBeNull();
      expect(screen.getByText("Checking checkout status…")).toBeTruthy();
      expect(screen.queryByText("Capture Cloud is active.")).toBeNull();

      await act(async () => { await vi.runAllTimersAsync(); });

      expect(globalThis.fetch).toHaveBeenCalledTimes(8);
      expect(screen.queryByText("Payment received.")).toBeNull();
      expect(screen.queryByText("Capture Cloud is active.")).toBeNull();
      expect(screen.getByText("Cloud access is not confirmed.")).toBeTruthy();
      expect(screen.getByText("Check your subscription status in Settings.")).toBeTruthy();
    },
  );

  it("does not treat checkout_id as proof and waits for server entitlement", async () => {
    navigation.params = new URLSearchParams("checkout_id=forged-or-real");
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({
      tier: "cloud",
      status: "active",
      plan: "monthly",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2026-10-11T10:00:00.000Z",
      accessExpiresAt: "2026-10-11T10:00:00.000Z",
    }));
    render(<CheckoutReturnNotice />);
    expect(screen.queryByText("Payment received.")).toBeNull();
    expect(screen.getByText("Checking checkout status…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Capture Cloud is active.")).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/cloud/subscription", expect.any(Object));
  });
});
