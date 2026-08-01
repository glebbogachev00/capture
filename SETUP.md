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
| Google AI Studio | https://aistudio.google.com/apikey | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` |
| OpenRouter | https://openrouter.ai/keys | `OPENROUTER_API_KEY` |

Tiers are tried top to bottom; a missing key just skips that tier, so one key
is a complete setup. If every provider fails, captures are still saved
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
npm start -H 0.0.0.0 -p 3000
```

Open http://localhost:3000 on the Mac.

## 3. Reach it from your phone

The Mac and phone must be on the same Wi-Fi. Find the Mac's IP:

```bash
ipconfig getifaddr en0
```

Open `http://<that-ip>:3000` on the phone and Add to Home Screen — it is a
PWA and runs full-screen with its own icon.

**Use the production command for phone access.** The dev server
(`npm run dev`) binds to localhost only — your phone can't reach it. Use the
build + `npm start -H 0.0.0.0` commands above (or add `-H 0.0.0.0` to the dev
command) so the server answers on the network.

**Voice note.** Dictation (the mic) is the browser's *built-in* speech
recognition — no server, key, or setup of its own. But browsers only allow the
mic in a "secure context": `localhost` counts, `http://192.168.x.x` does not.
So on the Mac at localhost the mic just works; on the phone over plain HTTP
the browser blocks it. For voice on the phone you need HTTPS: a tunnel
(`cloudflared tunnel --url http://localhost:3000` or ngrok), or a self-signed
cert with `mkcert`. Typing works over plain HTTP either way.

## 4. Keep the Mac awake

If the Mac sleeps, the server goes down with it. Two ways to stop that:

**Quick — one session under caffeinate.** Run the build once first, then
prevent idle sleep (works on AC and battery):

```bash
caffeinate -i npm start -H 0.0.0.0 -p 3000
```

When the Mac is plugged in you can add `-s` (prevents system sleep on AC):

```bash
caffeinate -i -s npm start -H 0.0.0.0 -p 3000
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

## 6. Backup

Your board lives in the browser's IndexedDB on each device, not on the server.
Use **Settings → Download backup** regularly and keep the JSON somewhere safe —
clearing site data deletes everything. Restores merge by id, so restoring
twice is safe.
