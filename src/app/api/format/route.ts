import { z } from "zod";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { authorizeManagedAiRequest, withManagedAiAdmission } from "@/lib/cloudRequestGuard.server";
import { withFallback } from "@/lib/providers";
import { preferredFor } from "@/lib/routing";
import { shouldFormat } from "@/lib/captureFormat";
import { formatCapture } from "@/lib/captureFormat.server";

/**
 * Format notes that were captured before automatic formatting: the same
 * cleanup and layout every new capture gets at sort time. Notes that need
 * nothing are returned untouched without a model call; a failed or doubtful
 * answer returns the note as it was.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  texts: z.array(z.string().max(20_000)).min(1).max(40),
}).refine((body) => body.texts.reduce((sum, text) => sum + text.length, 0) <= 60_000);

export async function POST(request: Request) {
  const authorization = await authorizeManagedAiRequest(request);
  if (authorization instanceof Response) return authorization;
  return withManagedAiAdmission(authorization, async () => {
    const gate = modelRateLimit(clientIp(request));
    if (!gate.allowed) {
      return Response.json(
        { error: `Too many requests. Try again in ${gate.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
      );
    }
    let body: z.infer<typeof Body>;
    try {
      body = Body.parse(await request.json());
    } catch {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const signal = AbortSignal.timeout(55_000);
    const texts = [...body.texts];
    let next = 0;
    const worker = async () => {
      while (next < texts.length) {
        const index = next++;
        const raw = texts[index];
        if (!shouldFormat(raw)) continue;
        texts[index] = await withFallback((tier) => formatCapture(raw, { tier, abortSignal: signal }), preferredFor("sort"), { abortSignal: signal })
          .then((result) => result.value, () => raw);
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    return Response.json({ texts });
  });
}
