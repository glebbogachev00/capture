import { isPublicThreadToken, publicThreadMarkdown, publicThreadPath, PUBLISH_ORIGIN } from "@/lib/publicThread";
import { publicThreadReader } from "@/lib/publicThreadRoutes.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Never cached anywhere: unpublishing must stop this response at once. */
const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reader = publicThreadReader();
  const thread = reader && isPublicThreadToken(token) ? await reader.read(token).catch(() => undefined) : null;
  if (thread === undefined) return new Response("Temporarily unavailable.\n", { status: 503, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  if (!thread) return new Response("Not found.\n", { status: 404, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(publicThreadMarkdown(thread, PUBLISH_ORIGIN + publicThreadPath(thread.token)), {
    headers: { ...HEADERS, "Content-Type": "text/markdown; charset=utf-8" },
  });
}
