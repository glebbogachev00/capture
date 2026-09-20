#!/usr/bin/env node
/**
 * OpenRouter key wizard — run with: npm run setup:openrouter
 *
 * The key is hidden. The model slug is not secret, but it must be copied
 * exactly from OpenRouter because Capture cannot infer which paid model to use.
 */

import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  isOpenRouterModelSlug,
  setOpenRouterConfig,
  successMessage,
} from "./setupEnv.mjs";

const ENV_FILE = resolve(process.cwd(), ".env.local");
const ENV_EXAMPLE = resolve(process.cwd(), ".env.example");
const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/models";

/* Refuse pipes and agent transcripts before any secret can be read. */
if (!process.stdin.isTTY) {
  process.stderr.write(
    "Run 'npm run setup:openrouter' in your own terminal — this wizard needs a TTY and will not accept piped input.\n"
  );
  process.exit(1);
}

console.log("");
console.log("Capture OpenRouter setup");
console.log("────────────────────────");
console.log(`Create or copy an API key: ${OPENROUTER_KEYS_URL}`);
console.log(`Copy the exact paid model slug: ${OPENROUTER_MODELS_URL}`);
console.log("");

/** Read a pasted secret without echoing it. */
function readSecret(prompt) {
  return new Promise((resolveSecret, rejectSecret) => {
    const stream = process.stdin;
    let value = "";
    let settled = false;

    const cleanup = () => {
      stream.removeListener("data", onData);
      stream.removeListener("error", onError);
      try {
        stream.setRawMode(false);
      } catch {
        /* A real TTY supports raw mode. Restore failure must not print data. */
      }
      stream.pause();
    };
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      process.stdout.write("\n");
      if (error) rejectSecret(error);
      else resolveSecret(result);
    };
    const onError = () => finish("", new Error("Input failed"));
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish(value);
          return;
        }
        if (ch === "\u0003") {
          finish("", new Error("Cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };

    try {
      stream.setRawMode(true);
      stream.setEncoding("utf8");
      stream.on("data", onData);
      stream.on("error", onError);
      stream.resume();
      process.stdout.write(prompt);
    } catch {
      finish("", new Error("Input failed"));
    }
  });
}

let apiKey;
try {
  apiKey = await readSecret("Paste your OpenRouter API key (hidden): ");
} catch {
  console.log("Cancelled. Nothing was written.");
  process.exit(0);
}

apiKey = apiKey.trim();
if (!apiKey) {
  console.error("No key entered. Nothing was written.");
  process.exit(1);
}

const terminal = createInterface({ input: process.stdin, output: process.stdout });
let model;
try {
  model = (await terminal.question("Exact OpenRouter model slug (provider/model): ")).trim();
} finally {
  terminal.close();
}
if (!isOpenRouterModelSlug(model)) {
  console.error(
    "Enter an exact provider/model slug from OpenRouter. Current Jev Decisions slugs cannot use Capture's chat provider. Nothing was written."
  );
  process.exit(1);
}

let existing;
try {
  if (existsSync(ENV_FILE)) {
    existing = readFileSync(ENV_FILE, "utf8");
  } else if (existsSync(ENV_EXAMPLE)) {
    existing = readFileSync(ENV_EXAMPLE, "utf8");
  } else {
    console.error(".env.example was not found. Run this from the Capture directory.");
    process.exit(1);
  }
} catch {
  console.error("Could not read the environment file. Nothing was written.");
  process.exit(1);
}

const updated = setOpenRouterConfig(existing, apiKey, model);
const tmp = `${ENV_FILE}.setup-tmp-${process.pid}`;
try {
  writeFileSync(tmp, updated, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, ENV_FILE);
  try {
    chmodSync(ENV_FILE, 0o600);
  } catch {
    /* Windows can ignore POSIX permissions. The key is still written once. */
  }
} catch {
  try {
    if (existsSync(tmp)) unlinkSync(tmp);
  } catch {
    /* Do not replace the useful write error with a cleanup error. */
  }
  console.error("Write failed. The existing environment file was not changed.");
  process.exit(1);
}

console.log("");
console.log(successMessage(ENV_FILE));
