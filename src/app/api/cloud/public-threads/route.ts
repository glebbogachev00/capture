import { deletePublicThread, getPublicThreads, postPublicThread, publicThreadsDeps } from "@/lib/publicThreadRoutes.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const off = () => Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
const failed = () => Response.json({ error: "public threads unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });

async function run(request: Request, handler: typeof getPublicThreads): Promise<Response> {
  const deps = publicThreadsDeps();
  if (!deps) return off();
  try {
    return await handler(request, deps);
  } catch {
    return failed();
  }
}

export const GET = (request: Request) => run(request, getPublicThreads);
export const POST = (request: Request) => run(request, postPublicThread);
export const DELETE = (request: Request) => run(request, deletePublicThread);
