import { clientIp } from "@/lib/clientIp";
import { ttsRateLimit } from "@/lib/limiter";

/**
 * Text-to-speech, through the local Kokoro server.
 *
 * Kokoro (https://github.com/remsky/Kokoro-FastAPI) is an open-weight TTS
 * model that runs on this Mac — often faster than realtime — and sounds
 * near-human. It is the "great voice" upgrade over the browser's robotic
 * default. This route is a thin proxy so the browser never talks to the
 * Python server directly (CORS, and the phone reaching the Mac over the
 * network).
 *
 * When Kokoro isn't running, GET reports unavailable and POST returns 502;
 * the client falls back to the browser's built-in voices. So the app works
 * without it, and gets better the moment the server is up.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const TTS_URL = (process.env.TTS_URL || "http://localhost:8880/v1").replace(
  /\/+$/,
  ""
);
const TTS_VOICE = process.env.TTS_VOICE || "af_bella";

/* Kokoro usually sits on the same machine (localhost, instant). When TTS_URL
   points at a Tailscale Funnel endpoint instead, the request travels from a
   serverless function through the tunnel to the Mac — that round trip needs
   seconds, not milliseconds, so the probe is patient. The client probes once
   on entering Talk mode, so a slow first answer beats a wrong "browser"
   fallback on a perfectly healthy voice server. */
const TTS_PROBE_TIMEOUT_MS = 8000;

/** Is the Kokoro server up? The client uses this once to pick its engine. */
export async function GET() {
  try {
    const res = await fetch(`${TTS_URL}/models`, {
      signal: AbortSignal.timeout(TTS_PROBE_TIMEOUT_MS),
    });
    return Response.json({ up: res.ok });
  } catch {
    return Response.json({ up: false });
  }
}

export async function POST(request: Request) {
  // TTS spends local CPU; one open deployment shouldn't synthesise audio
  // for strangers, but the bucket is generous because a long spoken reply
  // is many sentences.
  const gate = ttsRateLimit(clientIp(request));
  if (!gate.allowed) {
    return Response.json(
      { error: `Too many requests. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > 1000) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${TTS_URL}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        voice: TTS_VOICE,
        input: text.trim(),
        response_format: "wav",
      }),
      // Long enough for a sentence to synth locally or through a tunnel.
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      console.warn(
        `[capture] kokoro ${upstream.status}`,
        (await upstream.text().catch(() => "")).slice(0, 200)
      );
      return Response.json(
        { error: "The voice server couldn't speak right now." },
        { status: 502 }
      );
    }
    const audio = await upstream.arrayBuffer();
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "The voice server isn't running." },
      { status: 502 }
    );
  }
}
