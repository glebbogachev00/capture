/**
 * Tests for the pure env-file transformation in scripts/setupEnv.mjs.
 *
 * The module is plain ESM with no Node built-ins, so vitest can import it
 * directly without any special configuration.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { setGroqKey, successMessage } from "../../scripts/setupEnv.mjs";

const EXAMPLE = [
  "# Model keys",
  "# GROQ_API_KEY=",
  "# MISTRAL_API_KEY=",
  "APP_PASSWORD=",
  "",
].join("\n");

describe("setGroqKey — adding the key", () => {
  it("appends an active GROQ_API_KEY when none is present", () => {
    const result = setGroqKey(EXAMPLE, "gsk_test");
    expect(result).toContain("\nGROQ_API_KEY=gsk_test\n");
  });

  it("preserves commented examples", () => {
    const result = setGroqKey(EXAMPLE, "gsk_test");
    expect(result).toContain("# GROQ_API_KEY=");
  });

  it("preserves unrelated active settings", () => {
    const result = setGroqKey(EXAMPLE, "gsk_test");
    expect(result).toContain("APP_PASSWORD=");
  });
});

describe("setGroqKey — replacing an existing key", () => {
  const WITH_KEY = "GROQ_API_KEY=old_key\nAPP_PASSWORD=\n";

  it("replaces an existing active key", () => {
    const result = setGroqKey(WITH_KEY, "new_key");
    expect(result).toContain("GROQ_API_KEY=new_key");
    expect(result).not.toContain("GROQ_API_KEY=old_key");
  });

  it("does not duplicate the line", () => {
    const result = setGroqKey(WITH_KEY, "new_key");
    const count = result.split("\n").filter((l) => l.startsWith("GROQ_API_KEY=")).length;
    expect(count).toBe(1);
  });

  it("preserves APP_PASSWORD line after replacement", () => {
    const result = setGroqKey(WITH_KEY, "new_key");
    expect(result).toContain("APP_PASSWORD=");
  });
});

describe("setGroqKey — duplicate active lines", () => {
  it("collapses duplicate active GROQ_API_KEY lines", () => {
    const dupe = "GROQ_API_KEY=first\nGROQ_API_KEY=second\nAPP_PASSWORD=\n";
    const result = setGroqKey(dupe, "final");
    const count = result.split("\n").filter((l) => l.startsWith("GROQ_API_KEY=")).length;
    expect(count).toBe(1);
    expect(result).toContain("GROQ_API_KEY=final");
  });
});

describe("successMessage", () => {
  it("mentions the file path and next command", () => {
    const msg = successMessage(".env.local");
    expect(msg).toContain(".env.local");
    expect(msg).toContain("npm run dev");
  });

  it("never contains a key or key fragment", () => {
    const msg = successMessage(".env.local");
    expect(msg).not.toMatch(/gsk_/);
    expect(msg).not.toMatch(/API_KEY=/);
  });
});

describe("setup terminal boundary", () => {
  it("refuses non-interactive input before it can request a secret", () => {
    const setup = resolve(process.cwd(), "scripts/setup.mjs");
    const result = spawnSync(process.execPath, [setup], {
      cwd: process.cwd(),
      input: "gsk_must_not_be_read\n",
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toLowerCase()).toContain(
      "run 'npm run setup' in your own terminal"
    );
    expect(result.stdout).not.toContain("gsk_must_not_be_read");
  });
});
