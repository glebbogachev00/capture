import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { clientIp } from "@/lib/clientIp";
import { ttsRateLimit } from "@/lib/limiter";

/**
 * Text-to-speech, with a human voice even when the Mac is off.
 *
 * Two engines, tried in order:
 *   1. Kokoro (TTS_URL) — open-weight, runs on this Mac, near-human and free.
 *   2. Microsoft Edge neural voices (msedge-tts) — a public, keyless cloud
 *      API, called from the server. This is the fallback that replaces the
 *      browser's robotic voice: as long as the deployment has internet, the
 *      reply sounds human even when Kokoro isn't running.
 *
 * The route is a thin proxy either way so the browser never talks to a
 * Python/cloud service directly (CORS, and the phone reaching the Mac over
 * the network). GET probes availability for the client's engine choice;
 * POST synthesises and streams audio back.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const TTS_URL = (process.env.TTS_URL || "http://localhost:8880/v1").replace(
  /\/+$/,
  ""
);
const TTS_VOICE = process.env.TTS_VOICE || "af_bella";
const EDGE_TTS_VOICE = process.env.EDGE_TTS_VOICE || "en-US-AriaNeural";

/* Kokoro usually sits on the same machine (localhost, instant). When TTS_URL
   points at a Tailscale Funnel endpoint instead, the request travels from a
   serverless function through the tunnel to the Mac — that round trip needs
   seconds, not milliseconds, so the probe is patient. The client probes once
   on entering Talk mode, so a slow first answer beats a wrong "browser"
   fallback on a perfectly healthy voice server. */
const TTS_PROBE_TIMEOUT_MS = 8000;

/* The route's maxDuration is 30s, and Kokoro + Edge are tried in sequence.
   Both budgets must fit inside that single window, or the platform would
   kill the function before the fallback ever speaks. A dead Kokoro usually
   fails fast (connection refused); these bounds only matter for a half-open
   tunnel, and 20s + 8s leaves the whole chain safely under the limit. */
const KOKORO_SYNTH_TIMEOUT_MS = 20_000;
const EDGE_SYNTH_TIMEOUT_MS = 8_000;

/* The Edge Read Aloud voices list — a cheap, keyless endpoint used purely as
   a reachability check when Kokoro is down. The client decides its engine
   from the probe, and a wrong "up" is self-healing anyway: if a POST fails
   mid-reply, the client switches to the browser voice on the spot. */
const EDGE_VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";

/** Synthesise one utterance with an Edge neural voice (server-side). */
async function edgeSpeak(text: string): Promise<ArrayBuffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(
    EDGE_TTS_VOICE,
    OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
  );
  const { audioStream } = tts.toStream(text);
  const chunks: Buffer[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Edge is a fallback — it must fail fast, not hang the whole reply. A
    // half-open WebSocket that never emits data/end/close/error would
    // otherwise stall until the platform kills the function.
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        audioStream.on("data", (c: Buffer) => chunks.push(c));
        audioStream.on("end", resolve);
        audioStream.on("close", resolve);
        audioStream.on("error", reject);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("edge tts timed out")),
          EDGE_SYNTH_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    // A settled race still leaves the timer pending; clear it so a warm
    // serverless instance isn't kept alive by a timer that already lost.
    clearTimeout(timer);
    // Release the WebSocket promptly instead of letting it linger.
    try {
      tts.close();
    } catch {
      /* socket already gone */
    }
  }
  const bytes = Buffer.concat(chunks);
  // Return a plain ArrayBuffer (like the Kokoro path) so the Response body
  // accepts it under the stricter DOM typings.
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/** Is any voice engine up? Kokoro first; Edge second. */
export async function GET() {
  try {
    const res = await fetch(`${TTS_URL}/models`, {
      signal: AbortSignal.timeout(TTS_PROBE_TIMEOUT_MS),
    });
    if (res.ok) return Response.json({ up: true });
  } catch {
    /* Kokoro is down — try Edge below */
  }
  try {
    const res = await fetch(EDGE_VOICES_URL, {
      signal: AbortSignal.timeout(5000),
    });
    return Response.json({ up: res.ok });
  } catch {
    return Response.json({ up: false });
  }
}

export async function POST(request: Request) {
  // TTS spends real resources; one open deployment shouldn't synthesise
  // audio for strangers, but the bucket is generous because a long spoken
  // reply is many sentences.
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
  const clean = text.trim();

  // 1) Kokoro, if it's running — the preferred, near-human voice.
  try {
    const upstream = await fetch(`${TTS_URL}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        voice: TTS_VOICE,
        input: clean,
        response_format: "wav",
      }),
      signal: AbortSignal.timeout(KOKORO_SYNTH_TIMEOUT_MS),
    });
    if (upstream.ok) {
      const audio = await upstream.arrayBuffer();
      return new Response(audio, {
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-store",
        },
      });
    }
    console.warn(
      `[capture] kokoro ${upstream.status}, falling back to Edge`,
      (await upstream.text().catch(() => "")).slice(0, 200)
    );
  } catch {
    console.warn("[capture] kokoro unreachable, falling back to Edge");
  }

  // 2) Edge neural voice — the near-human fallback that replaces the
  //    browser's robotic voice.
  try {
    const audio = await edgeSpeak(clean);
    if (!audio.byteLength) throw new Error("empty edge audio");
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[capture] edge tts failed", error);
    return Response.json(
      { error: "The voice server couldn't speak right now." },
      { status: 502 }
    );
  }
}
