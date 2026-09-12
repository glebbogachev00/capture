import { handlePolarWebhook } from "@/lib/polar";
import { createPolarDependencies } from "@/lib/polarServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handlePolarWebhook(request, await createPolarDependencies());
}
