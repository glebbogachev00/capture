const FIRST_CAPTURE_KEY = "capture:playground:first-capture:v1";
const KNOWN_PROVIDERS = new Set([
  "cerebras",
  "groq",
  "mistral",
  "google",
  "openrouter",
]);

type UsageProperties = Record<string, string | number | boolean | null>;
type UsageEmitter = (name: string, properties?: UsageProperties) => void;
type UsageStorage = Pick<Storage, "getItem" | "setItem">;

type PlaygroundUsageDependencies = {
  enabled: boolean;
  emit: UsageEmitter;
  storage: UsageStorage;
};

function providerCategory(via: unknown): string {
  if (typeof via !== "string") return "unknown";
  const provider = via.trim().toLowerCase();
  return KNOWN_PROVIDERS.has(provider) ? provider : "unknown";
}

function failureCategory(message: unknown): string {
  if (typeof message !== "string") return "other";
  if (/too many|busy|rate.?limit|429/i.test(message)) return "busy";
  if (/fetch|network|offline|internet|load failed/i.test(message)) return "offline";
  return "other";
}

export function createPlaygroundUsage({
  enabled,
  emit,
  storage,
}: PlaygroundUsageDependencies) {
  return {
    captureSorted(via: unknown) {
      if (!enabled) return;
      const provider = providerCategory(via);
      emit("capture_sorted", { provider });
      if (storage.getItem(FIRST_CAPTURE_KEY) === "1") return;
      emit("first_capture_sorted", { provider });
      storage.setItem(FIRST_CAPTURE_KEY, "1");
    },

    captureFailed(message: unknown) {
      if (!enabled) return;
      emit("capture_sort_failed", { reason: failureCategory(message) });
    },

    trialLimitReached() {
      if (!enabled) return;
      emit("trial_limit_reached");
    },
  };
}
