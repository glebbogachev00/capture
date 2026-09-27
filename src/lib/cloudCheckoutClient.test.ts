import { describe, expect, it } from "vitest";
import {
  checkoutPlanFromNext,
  cloudAccountHandoff,
  cloudCheckoutDestinationAfterLogin,
  cloudCheckoutHandoff,
  cloudLoginHandoff,
  cloudPricingHandoff,
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

  it("rejects an unsafe or non-origin Cloud handoff configuration", () => {
    expect(cloudCheckoutHandoff("monthly", "http://cloud.trycapture.app")).toBeNull();
    expect(cloudCheckoutHandoff("monthly", "https://user:pass@cloud.trycapture.app")).toBeNull();
    expect(cloudCheckoutHandoff("monthly", "https://cloud.trycapture.app/app")).toBeNull();
    expect(cloudCheckoutHandoff("monthly", "https://cloud.trycapture.app/?next=evil")).toBeNull();
  });

  it("builds the normal playground-to-Cloud app handoff with the same origin checks", () => {
    expect(cloudLoginHandoff("https://cloud.trycapture.app")).toBe(
      "https://cloud.trycapture.app/login?next=%2Fapp",
    );
    expect(cloudLoginHandoff("http://cloud.trycapture.app")).toBeNull();
    expect(cloudLoginHandoff("https://cloud.trycapture.app/app")).toBeNull();
  });

  it("builds a direct existing-account path that lets Cloud decide whether login is needed", () => {
    expect(cloudAccountHandoff("https://cloud.trycapture.app")).toBe(
      "https://cloud.trycapture.app/app",
    );
    expect(cloudAccountHandoff("http://cloud.trycapture.app")).toBeNull();
    expect(cloudAccountHandoff("https://cloud.trycapture.app/app")).toBeNull();
  });

  it("sends undecided playground visitors to Cloud pricing before login", () => {
    expect(cloudPricingHandoff("https://cloud.trycapture.app")).toBe(
      "https://cloud.trycapture.app/pricing#plans",
    );
    expect(cloudPricingHandoff("http://cloud.trycapture.app")).toBeNull();
    expect(cloudPricingHandoff("https://cloud.trycapture.app/app")).toBeNull();
  });

  it("returns to the selected pricing plan after OTP so checkout has a clean authenticated page", async () => {
    await expect(cloudCheckoutDestinationAfterLogin(
      "/pricing?checkout=yearly",
    )).resolves.toBe("/pricing?checkout=yearly");
  });

  it("returns a normal safe next path without opening checkout", async () => {
    await expect(cloudCheckoutDestinationAfterLogin("/app")).resolves.toBe("/app");
  });

  it("falls back to the app for an unsafe post-login destination", async () => {
    await expect(cloudCheckoutDestinationAfterLogin(
      "https://evil.test/pricing?checkout=monthly",
    )).resolves.toBe("/app");
  });
});
