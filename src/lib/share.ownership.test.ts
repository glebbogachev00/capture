// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { OwnershipLifetime } from "./ownership";
import { shareText } from "./share";

afterEach(() => vi.restoreAllMocks());
const payload = { title: "A", text: "A PRIVATE", summary: "private" };

it("does not fall back to clipboard after a held native share rejects following revocation", async () => {
  const lifetime = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  let reject!: (error: Error) => void;
  const share = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });
  try {
    const pending = shareText(payload, lifetime.assertDisclosure);
    expect(share).toHaveBeenCalledTimes(1);
    lifetime.revoke();
    reject(new Error("unsupported payload"));
    expect(await pending).not.toBe("copied");
    expect(writeText).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
