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
