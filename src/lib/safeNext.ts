/**
 * Where the login page is allowed to send you afterwards.
 *
 * The login URL carries `?next=` so a lapsed session returns you to the page
 * you were on. Following it as given makes the app an open redirect: a link
 * to `/login?next=https://look-a-like.example` walks a person through a real
 * Capture login and then lands them somewhere else, at the exact moment they
 * have just proved they trust the page.
 *
 * This deliberately does not try to spot bad strings. Two rounds of that
 * failed — first on a leading newline, then on `/x\n/../..//evil.example`,
 * which reads like a path, survives every prefix check, and still resolves
 * to `//evil.example` once the browser has stripped the newline and applied
 * the `..` segments. The only thing that reliably knows where a URL leads is
 * a URL parser, so this resolves the value the way the browser will and then
 * asks a single question: did we leave the origin?
 *
 * What comes back is the RESOLVED path, never the input, so a caller cannot
 * navigate to a string this function did not actually check.
 */

/** The board: where anything unusable lands. */
const HOME = "/";

/* Any origin will do — nothing is ever fetched from it. It exists so that a
   relative path has something to resolve against, and so that "did the
   origin change?" is a question with an answer. */
const BASE = "http://capture.invalid";

export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw) return HOME;

  /* Browsers delete tabs, newlines and carriage returns from a URL wherever
     they appear, so strip them first: what gets validated must be what gets
     navigated to, not the decorated version of it. */
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!cleaned.startsWith("/")) return HOME;

  let url: URL;
  try {
    url = new URL(cleaned, BASE);
  } catch {
    return HOME;
  }

  /* The whole test. A protocol-relative value, an absolute URL, a backslash
     host and a path that climbs out with `..` all fail here alike, because
     every one of them resolves somewhere that is not BASE. */
  if (url.origin !== BASE) return HOME;

  /* One more step, and it is the one the parser cannot take for us. A path
     can resolve to something that begins with two slashes — "/x/../..//host"
     does — and that is same-origin to a parser given a base, but a BROWSER
     handed it as a location reads it as protocol-relative and leaves. So the
     resolved path has to be a single-slash path as well. */
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return HOME;
  return path;
}
