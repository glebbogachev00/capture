"use client";

import { track } from "@vercel/analytics/react";
import { PLAYGROUND } from "./playground";
import { createPlaygroundUsage } from "./playgroundUsage";

/** Browser wiring stays outside useBoard so instrumentation cannot make that
 * already-large state owner larger. The behavior itself remains dependency-
 * injected and unit-testable in playgroundUsage.ts. */
export const playgroundUsage = createPlaygroundUsage({
  enabled: PLAYGROUND,
  emit: track,
  storage: {
    getItem: (key) =>
      typeof window === "undefined" ? null : window.localStorage.getItem(key),
    setItem: (key, value) => {
      if (typeof window !== "undefined") window.localStorage.setItem(key, value);
    },
  },
});
