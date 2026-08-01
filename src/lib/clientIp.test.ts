import { describe, expect, it } from "vitest";
import { clientIp } from "./clientIp";

const req = (headers: Record<string, string>) =>
  new Request("http://localhost", { headers });

describe("clientIp", () => {
  it("prefers the Cloudflare header when present", () => {
    expect(
      clientIp(
        req({
          "x-forwarded-for": "1.2.3.4, 5.6.7.8",
          "cf-connecting-ip": "9.9.9.9",
        })
      )
    ).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(req({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
  });

  it("takes the rightmost x-forwarded-for entry, not the client-set first one", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "spoofed, 1.1.1.1, 2.2.2.2" }))
    ).toBe("2.2.2.2");
  });

  it("uses the single value when there is only one", () => {
    expect(clientIp(req({ "x-forwarded-for": "7.7.7.7" }))).toBe("7.7.7.7");
  });

  it("returns unknown when nothing is present", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });
});
