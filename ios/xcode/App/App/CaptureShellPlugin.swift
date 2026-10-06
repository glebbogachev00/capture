import AVFoundation
import Capacitor

/// The native side of src/lib/nativeShell.ts: shares waiting from the share
/// sheet, and recording that carries on with the screen locked.
@objc(CaptureShellPlugin)
public class CaptureShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CaptureShellPlugin"
    public let jsName = "CaptureShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "peekShares", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearShare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "home", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHome", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chooseServer", returnType: CAPPluginReturnPromise),
    ]
    private var recorder: AVAudioRecorder?

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(becameActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// Capture listens for this to pick up anything shared while it was away.
    @objc private func becameActive() {
        bridge?.triggerWindowJSEvent(eventName: "capture:shell-active")
    }

    @objc func peekShares(_ call: CAPPluginCall) {
        call.resolve(["items": SharedInbox.peek()])
    }

    @objc func clearShare(_ call: CAPPluginCall) {
        SharedInbox.clear(id: call.getString("id") ?? "")
        call.resolve()
    }

    @objc func home(_ call: CAPPluginCall) {
        call.resolve(["url": CaptureHome.saved ?? CaptureHome.free])
    }

    @objc func setHome(_ call: CAPPluginCall) {
        CaptureHome.save(call.getString("url"))
        call.resolve()
    }

    /// Settings → "Use another server": back to the bundled address screen.
    @objc func chooseServer(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView, let local = self.bridge?.config.localURL,
                  let url = URL(string: local.absoluteString + "/index.html#choose") else {
                return call.reject("No web view")
            }
            webView.load(URLRequest(url: url))
            call.resolve()
        }
    }

    /// Records AAC to a temporary file. With the audio background mode in
    /// Info.plist, a recording started here keeps going when the phone locks.
    @objc func startRecording(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { return call.reject("Microphone access is off") }
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.record, mode: .default)
                    try session.setActive(true)
                    let url = FileManager.default.temporaryDirectory
                        .appendingPathComponent("capture-dictation.m4a")
                    let recorder = try AVAudioRecorder(url: url, settings: [
                        AVFormatIDKey: kAudioFormatMPEG4AAC,
                        AVSampleRateKey: 22_050,
                        AVNumberOfChannelsKey: 1,
                        AVEncoderBitRateKey: 48_000,
                    ])
                    guard recorder.record() else { return call.reject("Couldn't start recording") }
                    self.recorder = recorder
                    call.resolve()
                } catch {
                    call.reject("Couldn't start recording", nil, error)
                }
            }
        }
    }

    /// Hands the audio back as base64; the web app sends it to /api/transcribe.
    @objc func stopRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let recorder = self.recorder else { return call.reject("Not recording") }
            recorder.stop()
            self.recorder = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            defer { try? FileManager.default.removeItem(at: recorder.url) }
            guard let data = try? Data(contentsOf: recorder.url) else { return call.reject("Nothing was recorded") }
            call.resolve(["data": data.base64EncodedString(), "mime": "audio/mp4"])
        }
    }
}

/// The Capture this phone opens: the free version, until someone reaches the
/// board of another one (Cloud once signed in, or their own server).
enum CaptureHome {
    static let free = "https://www.trycapture.app/app"
    private static let key = "captureHome"

    static var saved: String? { UserDefaults.standard.string(forKey: key) }

    static func save(_ url: String?) {
        UserDefaults.standard.set(url, forKey: key)
    }

    /// The board's address when `url` is a board, nil for any other page
    /// (pricing, sign-in, articles), so just looking around never switches it.
    static func board(for url: URL) -> String? {
        guard url.scheme == "https", let host = url.host else { return nil }
        if host == "trycapture.app" || host.hasSuffix(".trycapture.app") {
            return url.path == "/app" ? "https://\(host)/app" : nil
        }
        if host.hasSuffix(".ts.net"), url.path.isEmpty || url.path == "/" {
            return "https://\(host)\(url.port.map { ":\($0)" } ?? "")/"
        }
        return nil
    }
}
