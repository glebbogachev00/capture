/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheCloudEntitlement,
  clearCloudEntitlement,
  hasCloudEntitlement,
} from "./cloudEntitlement";

beforeEach(() => localStorage.clear());

describe("cached Cloud entitlement", () => {
  it("restores only the same owner's previously verified, unexpired access", () => {
    cacheCloudEntitlement("owner-a", 2_000, localStorage);

    expect(hasCloudEntitlement("owner-a", 1_000, localStorage)).toBe(true);
    expect(hasCloudEntitlement("owner-b", 1_000, localStorage)).toBe(false);
    expect(hasCloudEntitlement("owner-a", 2_000, localStorage)).toBe(false);
  });

  it("fails closed for malformed storage and clears only the matching owner", () => {
    localStorage.setItem("capture:cloud-entitlement:v1", "not json");
    expect(hasCloudEntitlement("owner-a", 1_000, localStorage)).toBe(false);

    cacheCloudEntitlement("owner-a", 2_000, localStorage);
    clearCloudEntitlement("owner-b", localStorage);
    expect(hasCloudEntitlement("owner-a", 1_000, localStorage)).toBe(true);
    clearCloudEntitlement("owner-a", localStorage);
    expect(hasCloudEntitlement("owner-a", 1_000, localStorage)).toBe(false);
  });
});
