import { describe, expect, it, vi } from "vitest";
import {
  checkoutPlanFromNext,
  cloudCheckoutDestinationAfterLogin,
  cloudCheckoutHandoff,
  cloudLoginHandoff,
} from "@/lib/cloudCheckoutClient";

describe("Cloud checkout continuation", () => {
  it("recognizes only a safe Capture pricing checkout intent", () => {
    expect(checkoutPlanFromNext("/pricing?checkout=monthly")).toBe("monthly");
    expect(checkoutPlanFromNext("/pricing?checkout=yearly")).toBe("yearly");
    expect(checkoutPlanFromNext("/pricing?checkout=enterprise")).toBeNull();
    expect(checkoutPlanFromNext("https://evil.test/pricing?checkout=yearly")).toBeNull();
    expect(checkoutPlanFromNext("//evil.test/pricing?checkout=yearly")).toBeNull();
  });

  it("builds a safe playground-to-Cloud login handoff", () => {
    expect(cloudCheckoutHandoff("monthly", "https://cloud.trycapture.app")).toBe(
      "https://cloud.trycapture.app/login?next=%2Fpricing%3Fcheckout%3Dmonthly",
    );
    expect(cloudCheckoutHandoff("yearly", "https://preview.vercel.app/")).toBe(
      "https://preview.vercel.app/login?next=%2Fpricing%3Fcheckout%3Dyearly",
    );
  });

  it("builds a safe playground-to-Cloud app handoff", () => {
    expect(cloudLoginHandoff("https://cloud.trycapture.app")).toBe(
      "https://cloud.trycapture.app/login?next=%2Fapp",
    );
    expect(cloudLoginHandoff("http://cloud.trycapture.app")).toBeNull();
  });

  it("rejects an unsafe or non-origin Cloud handoff configuration", () => {
    expect(cloudCheckoutHandoff("monthly", "http://cloud.trycapture.app")).toBeNull();
    expect(cloudCheckoutHandoff("monthly", "https://user:pass@cloud.trycapture.app")).toBeNull();
    expect(cloudCheckoutHandoff("monthly", "https://cloud.trycapture.app/app")).toBeNull();
    expect(cloudCheckoutHandoff("monthly", "https://cloud.trycapture.app/?next=evil")).toBeNull();
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
