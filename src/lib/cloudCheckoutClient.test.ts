import { describe, expect, it, vi } from "vitest";
import {
  checkoutPlanFromNext,
  cloudCheckoutDestinationAfterLogin,
} from "@/lib/cloudCheckoutClient";

describe("Cloud checkout continuation", () => {
  it("recognizes only a safe Capture pricing checkout intent", () => {
    expect(checkoutPlanFromNext("/pricing?checkout=monthly")).toBe("monthly");
    expect(checkoutPlanFromNext("/pricing?checkout=yearly")).toBe("yearly");
    expect(checkoutPlanFromNext("/pricing?checkout=enterprise")).toBeNull();
    expect(checkoutPlanFromNext("https://evil.test/pricing?checkout=yearly")).toBeNull();
    expect(checkoutPlanFromNext("//evil.test/pricing?checkout=yearly")).toBeNull();
  });

  it("continues directly to Polar after OTP instead of returning to pricing", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      url: "https://sandbox.polar.sh/checkout/resumed",
    }));

    await expect(cloudCheckoutDestinationAfterLogin(
      "/pricing?checkout=yearly",
      fetcher,
    )).resolves.toBe("https://sandbox.polar.sh/checkout/resumed");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/cloud/checkout",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ plan: "yearly" }),
      }),
    );
  });

  it("returns a normal safe next path without opening checkout", async () => {
    const fetcher = vi.fn();
    await expect(cloudCheckoutDestinationAfterLogin("/app", fetcher)).resolves.toBe("/app");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an invalid checkout destination", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      url: "https://polar.sh.evil.test/checkout",
    }));
    await expect(cloudCheckoutDestinationAfterLogin(
      "/pricing?checkout=monthly",
      fetcher,
    )).rejects.toThrow("invalid destination");
  });
});
