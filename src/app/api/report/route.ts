import { z } from "zod";
import { clientIp } from "@/lib/clientIp";
import { rateLimit } from "@/lib/limiter";

/**
 * File a bug without leaving the app.
 *
 * The previous version handed people a pre-filled GitHub URL, which is fine
 * for anyone who already has an account and a nuisance for everyone else.
 * This posts the issue on their behalf.
 *
 * Nothing rides along with the report but the words the person wrote. An
 * earlier version attached screen, window size, browser and board counts;
 * none of it was note content, but a board count is still a fact about
 * someone's board and a user-agent is still a fingerprint. An app that
 * promises your thinking stays yours does not get to make quiet exceptions
 * for its own convenience.
 *
 * The token never reaches the browser. It lives in the environment, is used
 * here, and is never echoed back — not in the response, not in a log line.
 * Give it the smallest possible shape: a fine-grained token, this one
 * repository, Issues read and write, nothing else. If it leaks, the worst
 * anyone can do is open issues.
 *
 * What keeps this from being a spam hole is the auth proxy: /api/* already
 * sits behind the app password, so a caller reaching this route is someone
 * who was let in. The rate limit is the second line — a person filing three
 * bugs an hour is having a bad day, thirty is a script.
 *
 * With no token configured the route says so plainly and the client falls
 * back to opening GitHub pre-filled, exactly as before. Nothing breaks
 * before the token exists.
 */

export const runtime = "nodejs";

const REPO = process.env.CAPTURE_ISSUE_REPO || "glebbogachev00/capture";

/** Bodies are small by nature; this only stops someone pasting a novel. */
const MAX = 4000;

/* Only the words they wrote. The route used to take a "context" blob of
   screen, window size, browser and board counts; it does not any more, and
   it will not accept one — an endpoint that quietly tolerates extra fields
   is how they creep back. */
const Body = z.object({ what: z.string().trim().min(1).max(MAX) }).strict();

/** A title has to fit on one line in a list of issues. */
function titleFrom(what: string): string {
  const line = what.split("\n").find((l) => l.trim()) || what;
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > 72 ? flat.slice(0, 72).trimEnd() + "…" : flat;
}

export async function POST(request: Request) {
  const gate = rateLimit("report:" + clientIp(request), 6, 60 * 60 * 1000);
  if (!gate.allowed) {
    return Response.json(
      { error: `That is a lot of bugs. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  const token = process.env.GITHUB_ISSUE_TOKEN;
  if (!token) {
    /* Not an error the person caused — the client opens GitHub instead. */
    return Response.json({ error: "no token" }, { status: 501 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const parts = [body.what, "", "<sub>Sent from the app.</sub>"];

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: titleFrom(body.what),
        body: parts.join("\n"),
        labels: ["from-the-app"],
      }),
    });
    if (!res.ok) {
      /* Status only. The response body can quote the request, and the
         request carried the token. */
      console.error("issue create failed:", res.status);
      return Response.json({ error: "github refused" }, { status: 502 });
    }
    const issue = (await res.json()) as { number?: number; html_url?: string };
    return Response.json({ number: issue.number, url: issue.html_url });
  } catch (error) {
    console.error(
      "issue create failed:",
      error instanceof Error ? error.message : "unknown"
    );
    return Response.json({ error: "unreachable" }, { status: 502 });
  }
}
