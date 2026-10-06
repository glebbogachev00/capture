import Foundation

/// The queue between the share extension and the app. The extension adds what
/// was shared; the app hands each item to Capture, which clears it once saved.
/// Both sides read the same app-group defaults.
enum SharedInbox {
    static let group = "group.app.trycapture.capture"
    private static let key = "pendingShares"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

    static func add(_ text: String) {
        defaults?.set(peek() + [["id": UUID().uuidString, "text": text]], forKey: key)
    }

    static func peek() -> [[String: String]] {
        defaults?.array(forKey: key) as? [[String: String]] ?? []
    }

    static func clear(id: String) {
        defaults?.set(peek().filter { $0["id"] != id }, forKey: key)
    }
}
