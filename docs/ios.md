# Capture for iOS

Work happens on the `ios` branch. Merge into main only when a phase is finished and tested.

## Approach: a native shell around the web app, then native edges

Capture is already a full web app: IndexedDB board, sync to the hub or Cloud, and server-side AI routes. A rewrite in Swift would mean porting ~100k lines and keeping two clients in step. Instead:

1. **Shell.** A Capacitor (WKWebView) app that loads Capture from the user's server: the Mac over Tailscale, or Cloud. Every web fix ships to iOS too, with no App Store review.
2. **Native edges.** Add these one at a time. Each one can be absent.
   - Recording through native audio, so Capture can record with the screen locked. (The mic already asks only once: Capacitor grants WebView capture after the system prompt.)
   - A Share extension: send text, links or photos into Capture.
   - A Shortcut and an Action button entry ("Capture a thought").
   - A Lock Screen or Home Screen widget that opens straight into recording.
3. **App Store.** Privacy labels and sign in. The native edges are what get past guideline 4.2 ("not just a website").

## Run it

```
cd ios
npm install
npx cap sync ios
npx cap open ios
```

In Xcode, pick an iPhone simulator and press Run.

## Where the app opens

- **Free, by default:** the first launch opens www.trycapture.app/app, with no setup. The board lives on the phone, with 15 sorted captures a day.
- **Cloud:** sign in from the free version ("Start with Capture Cloud"). Once a Cloud board opens, the app opens Cloud from then on.
- **Your own server:** Settings → Capture Cloud → Server → "Use another server" takes a Tailscale address. "Use the free version" goes back.

The app remembers the last board it reached, never a pricing or sign-in page (`CaptureHome` in `CaptureShellPlugin.swift`). The bundled screen in `ios/shell/` only shows when that server can't be reached, or when choosing another server.

## Native pieces

- **Share sheet** (`ios/xcode/App/ShareExtension`): text and links go into an app-group queue (`Shared/SharedInbox.swift`). Capture files them the next time it's open (`src/hooks/useNativeShares.ts`).
- **Recording** (`CaptureShellPlugin.swift`): records natively with the audio background mode, so it keeps going when the phone locks. The web app reaches it through `src/lib/nativeShell.ts`.

What's where:
- `ios/shell/`: the bundled fallback screen. Everything else loads from the server.
- `ios/capacitor.config.json`: which hosts the app may open (Tailscale `*.*.ts.net` and trycapture.app). Any other link opens in Safari.
- `ios/xcode/`: the Xcode project, with the icon, splash, permission strings and the share extension.

## Still to do

- Voice in the free version (it's switched off there today), with a daily cap.
- Bring the phone board along when someone upgrades to Cloud.
- Apple in-app purchase for Cloud.
- Photos in the share sheet; Action button and Shortcut; Lock Screen widget.

## Known edges

- WKWebView doesn't run service workers outside App-Bound Domains, so `public/sw.js` offline mode needs App-Bound Domains or a native fallback.
- Cookies and auth must persist in WKWebView across launches.
- Each server keeps its own IndexedDB. That matches the web app's ownership model (`src/lib/storage.ts`).

## Prerequisites

- Full Xcode from the App Store. Command Line Tools alone can't build iOS apps.
- An Apple Developer account ($99/yr) for TestFlight and the App Store. Not needed to run on the simulator or your own phone.
