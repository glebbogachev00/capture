"use client";

import { useCallback, useState } from "react";
import { degradedTier, type Answered } from "@/lib/degraded";

type Routing = {
  preferred?: string | null;
  fallback?: boolean;
  fallbackReason?: "rate_limit" | "provider_failure" | null;
};

/** Keep provider-status bookkeeping out of the board's capture machinery. */
export function useDegradedProviderStatus() {
  const [answers, setAnswers] = useState<Answered[]>([]);
  const noteVia = useCallback((via?: string | null, routing?: Routing) => {
    if (!via || !routing || typeof routing.fallback !== "boolean") return;
    const fallback = routing.fallback;
    setAnswers((previous) => [...previous, {
      via,
      preferred: routing.preferred,
      fallback,
      fallbackReason: routing.fallbackReason ?? null,
      at: Date.now(),
    }].slice(-12));
  }, []);
  return { degraded: degradedTier(answers), noteVia };
}
