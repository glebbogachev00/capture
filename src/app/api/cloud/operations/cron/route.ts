import {
  authorizeOperationsWorker,
  runOperationalMaintenance,
} from "@/lib/operations.server";
import { opsEvent } from "@/lib/opsEvent.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reply = (body: unknown, status: number) => Response.json(body, {
  status,
  headers: {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  },
});

export async function POST(request: Request) {
  const authorization = authorizeOperationsWorker(request);
  if (authorization === "unavailable") {
    opsEvent({ event: "operational_health", outcome: "skipped", reason: "source_disabled" });
    return reply({ error: "operations worker unavailable" }, 503);
  }
  if (authorization === "unauthorized") {
    opsEvent({ event: "operational_health", outcome: "denied", reason: "not_authorized" });
    return reply({ error: "unauthorized" }, 401);
  }

  try {
    const signals = await runOperationalMaintenance();
    const critical = Object.values(signals).some((state) => state === "critical");
    const degraded = critical || Object.values(signals).some((state) => state !== "ok");
    opsEvent({
      event: "operational_health",
      outcome: degraded ? "degraded" : "success",
      reason: degraded ? "backlog_present" : "none",
    });
    return reply({ signals }, critical ? 503 : 200);
  } catch {
    opsEvent({ event: "operational_health", outcome: "failure", reason: "dependency_unavailable" });
    return reply({ error: "operations worker unavailable" }, 503);
  }
}
