/**
 * Which build is the server serving?
 *
 * The answer is the same string the client bundle was stamped with, so a
 * running app can compare what it is against what is being served and know
 * it has fallen behind. Nothing else is exposed: a deployment id is not a
 * secret, and no board data comes near this route.
 *
 * Never cached, by any layer. A cached answer to "are you current?" is worse
 * than no answer, because it is confidently wrong.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return new Response(
    JSON.stringify({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
