import { handleAccountErasureConfirm } from "@/lib/accountErasure";
import { createAccountErasureRouteDependencies } from "@/lib/accountErasureRoutes.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAccountErasureConfirm(request, await createAccountErasureRouteDependencies());
}
