import { describe, expect, it } from "vitest";
import {
  checkPassword,
  createSessionValue,
  isValidSession,
} from "@/lib/auth";

describe("auth", () => {
  it("produces a valid session that passes isValidSession", async () => {
    const cookie = await createSessionValue("correct-password");
    await expect(isValidSession(cookie, "correct-password")).resolves.toBe(true);
  });

  it("fails with a wrong password", async () => {
    const cookie = await createSessionValue("correct-password");
    await expect(isValidSession(cookie, "wrong-password")).resolves.toBe(false);
  });

  it("fails an expired payload (timestamp in the past)", async () => {
    const cookie = await createSessionValue("pw");
    const [, signature] = cookie.split(".");
    // A payload of "1" is an epoch far in the past, so it must be rejected.
    await expect(isValidSession(`1.${signature}`, "pw")).resolves.toBe(false);
  });

  it("fails a tampered cookie (corrupt signature)", async () => {
    const cookie = await createSessionValue("pw");
    const [payload] = cookie.split(".");
    const tampered = `${payload}.deadbeef`;
    await expect(isValidSession(tampered, "pw")).resolves.toBe(false);
  });

  it("fails on a garbage cookie", async () => {
    await expect(isValidSession("garbage", "pw")).resolves.toBe(false);
    await expect(isValidSession("", "pw")).resolves.toBe(false);
    await expect(isValidSession(undefined, "pw")).resolves.toBe(false);
    await expect(isValidSession("abc.def.ghi", "pw")).resolves.toBe(false);
  });

  it("checkPassword accepts the right password and rejects wrong ones", async () => {
    await expect(checkPassword("correct-password", "correct-password")).resolves.toBe(
      true
    );
    await expect(checkPassword("correct-password", "wrong-password")).resolves.toBe(
      false
    );
    await expect(checkPassword("", "pw")).resolves.toBe(false);
  });
});
