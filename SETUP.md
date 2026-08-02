# SETUP.md — Self-hosting capture on a Mac

capture is a self-hosted Next.js app. All your data lives in the browser's
IndexedDB on the device you use it from; the server is just a thin API layer
that calls your model providers. This guide covers running it on a Mac,
keeping it reachable from your phone, and keeping the Mac awake so the server
survives you walking away.

## What you need

- macOS with Node 20+ (`node -v`)
- At least one model provider key (see below)
- Nothing else. No database, no account, no Docker, no root.

## 1. One-time install

```bash
git clone https://github.com/glebbogachev00/capture.git
cd capture
npm install
cp .env.example .env.local
```

Edit `.env.local` and add at least one key:

| Provider | Get a key | Env var |
|---|---|---|
| OpenRouter | https://openrouter.ai/keys | `OPENROUTER_API_KEY` |
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` |
| Google AI Studio | https://aistudio.google.com/apikey | `GOOGLE_GENERATIVE_AI_API_KEY` |

Tiers are tried in that order (OpenRouter → Groq → Gemini last, since a free
Gemini tier is the most likely to be spent); a missing key just skips that
tier, so one key is a complete setup. If every provider fails, captures are still saved
verbatim and flagged unsorted — nothing is ever lost, it just waits to be
sorted.

## 2. Run it

Development:

```bash
npm run dev
```

Production (faster, steadier for always-on hosting):

```bash
npm run build
npm start -- -H 0.0.0.0 -p 3000
```

Open http://localhost:3000 on the Mac.

## 3. Reach it from your phone

The phone only ever needs one URL — the Mac's. Voice (mic, recognition,
replies) runs in the phone's browser; Kokoro TTS runs on the Mac and is
proxied through the app, so nothing else needs to be reachable.

**The smooth way: Tailscale (recommended).** Works from any network, not
just home Wi-Fi, and gives you real HTTPS — which voice *requires* (the
browser blocks the mic on plain HTTP). One-time setup:

1. Install Tailscale on the Mac and the phone
   (https://tailscale.com/download), sign both into the same account.
2. In the Tailscale admin console (login.tailscale.com → DNS), turn on
   **MagicDNS** and **HTTPS Certificates** — both free for personal use.
3. Run the app and expose it:

   ```bash
   npm run phone
   ```

   That one command builds, starts the server bound to the network under
   `caffeinate` (so the Mac doesn't sleep), and runs
   `tailscale serve --bg 3000` to give you
   `https://<yourmac>.<your-tailnet>.ts.net` with a valid Let's Encrypt cert.
4. On the phone (Tailscale app on, same account), open that `https://…ts.net`
   URL in Safari (iPhone) or Chrome (Android). Allow the mic the first time.

**Or the quick way: same Wi-Fi.** Find the Mac's IP:

```bash
ipconfig getifaddr en0
```

Open `http://<that-ip>:3000` on the phone. Typing works immediately; voice
needs HTTPS, so for voice add a tunnel (`cloudflared tunnel --url
http://localhost:3000` or ngrok) or a self-signed cert with `mkcert`.

**Use the production command for phone access.** The dev server
(`npm run dev`) binds to localhost only — your phone can't reach it. Use the
build + `npm start -- -H 0.0.0.0` commands above (or add `-H 0.0.0.0` to the dev
command) so the server answers on the network.

**Set a password whenever the server is reachable beyond your own devices** —
see §5 (`APP_PASSWORD`); an open `/api/sort` is an open tab on your model
quota. With `npm run phone` the serve is tailnet-only (only devices on your
Tailnet can reach it), so it's optional there — but required if you ever make
the serve public (`tailscale serve --https=443`).

**Voice note.** Voice runs in the browser on whatever device you're using —
the Mac only serves the app. Distill's chat box carries two icon buttons
next to Send:

- **Mic** — dictation: the browser's built-in speech recognition, dropping
  your words into the text box to edit and send.
- **Voice** — a real spoken conversation: you speak, the reply is spoken
  aloud sentence by sentence, the mic comes back on its own when it
  finishes, and tapping the orb while it's talking cuts it off mid-word so
  you can answer. No Send button — pausing is the turn boundary. The
  keyboard button underneath the orb returns you to the text box.

By default the spoken replies use the browser's built-in voice — free,
instant, no setup, a little robotic. For a human-sounding voice, run the
optional Kokoro server (§7); the app probes it once and switches
automatically. Same experience either way.

Voice needs a "secure context": `localhost` counts, `http://192.168.x.x`
does not. On the Mac at localhost both work; on the phone over plain HTTP
the browser blocks them — HTTPS (Tailscale or a tunnel) fixes that.

**iPhone note.** Apple disables speech recognition when the app runs as an
installed standalone PWA ("Add to Home Screen" launches it full-screen
without the APIs). On iPhone, use the Voice feature from **Safari directly**;
on Android the installed PWA works fine.

## 4. Keep the Mac awake

If the Mac sleeps, the server goes down with it. Two ways to stop that:

**Quick — one session under caffeinate.** Run the build once first, then
prevent idle sleep (works on AC and battery):

```bash
caffeinate -i npm start -- -H 0.0.0.0 -p 3000
```

When the Mac is plugged in you can add `-s` (prevents system sleep on AC):

```bash
caffeinate -i -s npm start -- -H 0.0.0.0 -p 3000
```

`caffeinate` is built into macOS (`/usr/bin/caffeinate`) — no install.

**Persistent — the OS switch.** Set the Mac to never auto-sleep on power:

- System Settings → Battery (or Energy Saver) → Options → turn on
  *Prevent automatic sleeping on power adapter when the display is off*.
- Or from the terminal (needs admin once; survives until you change it back):

```bash
sudo pmset -a sleep 0 displaysleep 0
```

Wake it back up later with:

```bash
sudo pmset -a sleep 1 displaysleep 1
```

The launchd way — a LaunchAgent that starts capture at login and keeps it
alive — is overkill for a one-person host; the two options above cover the
normal cases.

## 5. Optional: password gate

Add to `.env.local`:

```
APP_PASSWORD=something-secret
```

The whole app then sits behind a single-password gate. Set it whenever the
server is reachable from anything other than localhost — an open `/api/sort`
is an open tab on your model quota.

## 7. Optional: a human-sounding voice (Kokoro)

Spoken replies sound robotic by default (the browser's built-in voice). For
near-human audio, capture can use **Kokoro** — an open-weight TTS model that
runs locally, often faster than realtime on Apple Silicon — servedthrough a tiny FastAPI server that the app proxies to. The app works without it —
spoken replies use whatever voice is available; Kokoro simply makes them
near-human.

One-time install (uv is the only tool needed — Homebrew users likely have it
via `brew install uv`):

```bash
git clone https://github.com/remsky/Kokoro-FastAPI.git
cd Kokoro-FastAPI
./start-cpu.sh          # runs on any Mac, no GPU needed
# on Apple Silicon, the MPS-accelerated script is faster:
# ./start-gpu_mac.sh
```

That's it. The server listens on http://localhost:8880 — exactly the app's
default `TTS_URL`, so no config is required. Start it in its own terminal
before you want spoken replies. First audio for a short sentence lands in
well under a second on a modern Mac, and each sentence speaks the moment it
streams.

To pick a different voice, add to `.env.local` and restart the app:

```
TTS_VOICE=af_bella     # warm, clear female — the default
# TTS_VOICE=am_michael # deeper male; browse them all at
#                      # http://localhost:8880/v1/audio/voices
```

The proxy means your phone gets the same voice automatically (no CORS to
fight) once you're on HTTPS. If the Kokoro server isn't running, replies
just fall back to the browser voice — nothing breaks.

Your board lives in the browser's IndexedDB on each device, not on the server.
Use **Settings → Download backup** regularly and keep the JSON somewhere safe —
clearing site data deletes everything. Restores merge by id, so restoring
twice is safe.
