import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BeforeSendEvent } from "@vercel/analytics/next";
import {
  hasCheckoutReturnState,
  redactBrowserUrl,
  sanitizeAnalyticsEvent,
  snapshotCheckoutReturnState,
} from "./urlPrivacy";

describe("Capture-controlled URL privacy", () => {
  it("removes checkout, portal, erasure, and token identifiers while preserving navigation state", () => {
    expect(redactBrowserUrl(
      "https://capture.test/app?checkout_id=secret&tab=threads&receiptToken=receipt&portal_session_id=portal#import-local",
    )).toBe("/app?tab=threads#import-local");
    expect(redactBrowserUrl(
      "https://capture.test/pricing?checkout=yearly&utm_source=launch",
    )).toBe("/pricing?utm_source=launch");
    expect(redactBrowserUrl(
      "https://capture.test/app?operationId=op&operation_id=op2&token_hash=hash&import-local=1",
    )).toBe("/app?import-local=1");
  });

  it("does not rewrite an unrelated URL", () => {
    expect(redactBrowserUrl("https://capture.test/app?tab=record#import-local")).toBeNull();
  });

  it("hands checkout return behavior across URL replacement without retaining the identifier", () => {
    const state = snapshotCheckoutReturnState(
      "https://capture.test/app?checkout_id=private-checkout",
      { nextRouterState: "preserved" },
    );
    expect(state).toEqual({ nextRouterState: "preserved", __captureCheckoutReturn: true });
    expect(hasCheckoutReturnState(state)).toBe(true);
    expect(JSON.stringify(state)).not.toContain("private-checkout");
    expect(hasCheckoutReturnState({ __captureCheckoutReturn: "true" })).toBe(false);
  });

  it("strips every query and fragment from Vercel pageview and event URLs", () => {
    for (const type of ["pageview", "event"] as const) {
      const event = sanitizeAnalyticsEvent({
        type,
        url: "https://capture.test/app?checkout_id=secret&operationId=op#private",
      } as BeforeSendEvent);
      expect(event).toEqual({ type, url: "https://capture.test/app" });
      expect(JSON.stringify(event)).not.toMatch(/secret|operationId|checkout_id|private/);
    }
  });

  it("mounts Analytics only through the redaction boundary", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const boundary = readFileSync("src/components/PrivateAnalytics.tsx", "utf8");
    expect(layout).toContain("<PrivateAnalytics />");
    expect(layout).not.toContain("<Analytics");
    expect(boundary).toContain("window.history.replaceState");
    expect(boundary).toContain("beforeSend={sanitizeAnalyticsEvent}");
    expect(boundary.indexOf("redactBrowserUrl(window.location.href)")).toBeLessThan(
      boundary.indexOf("setReady(true)"),
    );
  });

  it("drops malformed analytics URLs rather than forwarding them", () => {
    expect(sanitizeAnalyticsEvent({ type: "pageview", url: "not a url" })).toBeNull();
  });
});
