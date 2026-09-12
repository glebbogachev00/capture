import type { PolarPlan } from "@/lib/polar";
import { safeNext } from "@/lib/safeNext";

export function safePolarDestination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const polarHost = url.hostname === "polar.sh" || url.hostname.endsWith(".polar.sh");
    return url.protocol === "https:" && polarHost ? url.toString() : null;
  } catch {
    return null;
  }
}

export function checkoutPlanFromNext(nextPath: string | null | undefined): PolarPlan | null {
  const destination = safeNext(nextPath);
  const url = new URL(destination, "https://capture.invalid");
  if (url.pathname !== "/pricing") return null;
  const plan = url.searchParams.get("checkout");
  return plan === "monthly" || plan === "yearly" ? plan : null;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function responseError(body: Record<string, unknown>): string {
  return typeof body.error === "string" && body.error.length <= 160
    ? body.error
    : "Checkout is unavailable right now.";
}

export async function requestCloudCheckout(
  plan: PolarPlan,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher("/api/cloud/checkout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new Error(responseError(body));
  const destination = safePolarDestination(body.url);
  if (!destination) throw new Error("Checkout returned an invalid destination.");
  return destination;
}

export async function cloudCheckoutDestinationAfterLogin(
  nextPath: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const safePath = safeNext(nextPath || "/app");
  const plan = checkoutPlanFromNext(safePath);
  if (!plan) return safePath;
  return requestCloudCheckout(plan, fetcher);
}
