export class CloudQuotaError extends Error {
  constructor(readonly resetAt: number | null) {
    const time = resetAt === null ? null : new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(Math.ceil(resetAt / 60_000) * 60_000);
    super(time ? `Your AI allowance resets ${time}.` : "Your AI allowance is used up. The reset time is unavailable.");
    this.name = "CloudQuotaError";
  }
  get captureMessage() {
    return `Saved in Unsorted. ${this.message} ${this.resetAt === null
      ? "You can choose a place now."
      : "Choose a place now, or retry after that."}`;
  }
}

export function cloudQuotaError(response: Response, message: unknown): CloudQuotaError | null {
  if (response.status !== 429 || message !== "quota exceeded") return null;
  const retry = response.headers.get("Retry-After")?.trim() ?? "";
  const serverTime = Date.parse(response.headers.get("Date") ?? "");
  const now = Number.isFinite(serverTime) ? serverTime : Date.now();
  const resetAt = /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
  return new CloudQuotaError(Number.isFinite(new Date(resetAt).getTime()) ? resetAt : null);
}
