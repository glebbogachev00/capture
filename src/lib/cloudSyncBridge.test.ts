import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/sync/route";

const keys = [
  "CAPTURE_CLOUD",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.CAPTURE_CLOUD = "1";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
});

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Cloud sync compatibility route", () => {
  it("never falls through to the legacy filesystem hub for GET", async () => {
    const response = await GET(new Request("https://capture.test/api/sync"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud is not configured" });
  });

  it("never falls through to the legacy filesystem hub for POST", async () => {
    const response = await POST(new Request("https://capture.test/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: {}, tombstones: [] }),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud is not configured" });
  });
});
