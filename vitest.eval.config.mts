import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/* Evals measure the product against a live model; they are not part of
   `npm test`. Same resolution as vitest.config.mts, different files. */
export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
});
