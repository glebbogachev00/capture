import { generateText } from "ai";
import { clientIp } from "@/lib/clientIp";
import { transcribeRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";
import { CLEANUP_SYSTEM } from "@/lib/dictationCleanup";

/**
 * Transcribe — recorded audio in, text out.
 *
 * Replaces the browser's SpeechRecognition (Apple's stock dictation on
 * iPhone, the whole reason dictation felt bad) with a real speech model.
 * Two backends, tried in order:
 *
 *   1. The local Parakeet server on the Mac that serves this app
 *      (~/whisper — `uv run python server.py`). Free, on-device, and since
 *      the phone reaches this app through the Mac anyway, "local to the
 *      server" covers the phone too.
 *   2. Groq's hosted whisper-large-v3-turbo, when GROQ_API_KEY is set —
 *      the same open-source model family, ~$0.04 per HOUR of audio, for
 *      when the local server isn't running.
 *
 * The client sends raw audio bytes with its content-type (Safari records
 * audio/mp4, Chrome audio/webm); both backends sniff the container.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const LOCAL_URL =
  process.env.LOCAL_TRANSCRIBE_URL ?? "http://127.0.0.1:8756/transcribe";
/* When the Mac is memory-starved the local model can take 20s+ to page back
   in; past this deadline the route stops waiting and lets Groq answer, so
   dictation stays usable on a loaded machine. */
const LOCAL_TIMEOUT_MS = Number(process.env.LOCAL_TRANSCRIBE_TIMEOUT_MS ?? 15_000);
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

/** Groq wants a filename whose extension matches the container. */
function extensionFor(contentType: string): string {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "mp4";
}

async function transcribeLocal(
  audio: ArrayBuffer,
  contentType: string,
  timeoutMs: number = LOCAL_TIMEOUT_MS
): Promise<string> {
  const res = await fetch(LOCAL_URL, {
    method: "POST",
    headers: { "content-type": contentType },
    body: audio,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`local transcriber: ${await res.text()}`);
  const { text } = (await res.json()) as { text: string };
  return text;
}

async function transcribeGroq(
  audio: ArrayBuffer,
  contentType: string,
  apiKey: string
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([audio], { type: contentType }),
    `audio.${extensionFor(contentType)}`
  );
  form.append("model", GROQ_MODEL);
  form.append("response_format", "json");
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`groq: ${res.status} ${await res.text()}`);
  const { text } = (await res.json()) as { text: string };
  return text;
}

/**
 * The Wispr-style second stage: the raw transcript keeps every "um", false
 * start, and self-correction the speaker made; one fast LLM pass removes the
 * speech artifacts while leaving the wording and meaning alone. The sort and
 * distill prompts do the *interpreting* later — this pass only makes the box
 * show what the speaker meant to type. Any failure returns the raw text, so
 * cleanup can never cost a dictation.
 */
const CLEANUP_ON = process.env.CAPTURE_DICTATION_CLEANUP !== "0";

async function cleanUp(raw: string): Promise<string> {
  const { value } = await withFallback(async (tier) => {
    const { text } = await generateText({
      model: tier.model,
      system: CLEANUP_SYSTEM,
      prompt: raw,
      providerOptions: tier.providerOptions,
      /* The chain IS the retry — like every other route. The SDK default
         (2 retries with backoff) would stall a live dictation for seconds
         on a throttled tier before the next provider even gets a turn. */
      maxRetries: 0,
    });
    return text.trim();
  });
  return value || raw;
}

export async function POST(request: Request) {
  const gate = transcribeRateLimit(clientIp(request));
  if (!gate.allowed) {
    return Response.json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSec) } }
    );
  }

  const contentType = request.headers.get("content-type") ?? "audio/mp4";
  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0) {
    return Response.json({ error: "empty audio" }, { status: 400 });
  }

  /* Local first with a short deadline; Groq when it's slow or absent; and a
     patient local retry last, because Groq is geo-blocked from some networks
     (Cloudflare 1010) while the local model may just be paging back into a
     tight-RAM machine — slow text still beats no text. */
  let raw = "";
  try {
    raw = (await transcribeLocal(audio, contentType)).trim();
  } catch {
    const groqKey = process.env.GROQ_API_KEY;
    try {
      if (!groqKey) throw new Error("no GROQ_API_KEY");
      raw = (await transcribeGroq(audio, contentType, groqKey)).trim();
    } catch {
      try {
        raw = (await transcribeLocal(audio, contentType, 55_000)).trim();
      } catch (err) {
        return Response.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "transcription failed — is the local server running? " +
                  "(~/whisper: uv run python server.py)",
          },
          { status: 502 }
        );
      }
    }
  }

  if (!raw) return Response.json({ text: "" });
  const text = CLEANUP_ON ? await cleanUp(raw).catch(() => raw) : raw;
  /* `raw` rides along: the words the recogniser actually heard, before the
     cleanup pass rewrote them. A cleaned line is a convenience; the
     transcript is the evidence, and it must never be the thing that is
     silently thrown away. Omitted when cleanup changed nothing. */
  return Response.json(text === raw ? { text } : { text, raw });
}
