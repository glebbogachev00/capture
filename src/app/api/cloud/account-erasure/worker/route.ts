import { runAccountErasureWorker } from "@/lib/accountErasure";
import {
  authorizeAccountErasureWorker,
  createAccountErasureRouteDependencies,
} from "@/lib/accountErasureRoutes.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reply = (body: unknown, status: number) => Response.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
});

export async function POST(request: Request) {
  const authorization = authorizeAccountErasureWorker(request);
  if (authorization === "unavailable") return reply({ error: "account erasure worker unavailable" }, 503);
  if (authorization === "unauthorized") return reply({ error: "unauthorized" }, 401);

  try {
    const dependencies = await createAccountErasureRouteDependencies();
    if (!dependencies.isEnabled()) return reply({ error: "not found" }, 404);
    if (!dependencies.isConfigured() || !dependencies.isWorkerConfigured()) {
      return reply({ error: "account erasure worker unavailable" }, 503);
    }
    // Exactly one durable stage per invocation. Repeated calls resume by
    // reclaiming only due/expired leases; no unbounded provider loop runs in a
    // single serverless request.
    return reply(await runAccountErasureWorker(dependencies), 200);
  } catch {
    return reply({ error: "account erasure worker unavailable" }, 503);
  }
}
