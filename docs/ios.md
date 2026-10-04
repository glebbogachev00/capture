# Capture for iOS

Work happens on the `ios` branch. Merge into main only when a phase is finished and tested.

## Approach: a native shell around the web app, then native edges

Capture is already a full web app: IndexedDB board, sync to the hub or Cloud, and server-side AI routes. A rewrite in Swift would mean porting ~100k lines and keeping two clients in step. Instead:

1. **Shell.** A Capacitor (WKWebView) app that loads Capture from the user's server: the Mac over Tailscale, or Cloud. Every web fix ships to iOS too, with no App Store review.
2. **Native edges.** Add these one at a time. Each one can be absent.
   - Recording through native audio, so the mic doesn't re-prompt and Capture can record with the screen locked.
   - A Share extension: send text, links or photos into Capture.
   - A Shortcut and an Action button entry ("Capture a thought").
   - A Lock Screen or Home Screen widget that opens straight into recording.
3. **App Store.** Privacy labels and sign in. The native edges are what get past guideline 4.2 ("not just a website").

## Known edges

- WKWebView doesn't run service workers outside App-Bound Domains, so `public/sw.js` offline mode needs App-Bound Domains or a native fallback.
- Server choice: the first-run screen asks for the server URL (the Tailscale address or cloud.trycapture.app). That's the only setup step.
- Cookies and auth must persist in WKWebView across launches.
- Each server keeps its own IndexedDB. That matches the web app's ownership model (`src/lib/storage.ts`).

## Prerequisites

- Full Xcode from the App Store. Command Line Tools alone can't build iOS apps.
- An Apple Developer account ($99/yr) for TestFlight and the App Store. Not needed to run on the simulator or your own phone.
