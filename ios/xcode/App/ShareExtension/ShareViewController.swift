import UIKit
import UniformTypeIdentifiers

/// Capture in the share sheet. Keeps the shared text or link, says so, and
/// closes. There is nothing to decide here: Capture files it the next time the
/// app is open, because the board lives in the app.
class ShareViewController: UIViewController {
    private let paper = UIColor(red: 0xED / 255, green: 0xEF / 255, blue: 0xE8 / 255, alpha: 1)
    private let ink = UIColor(red: 0x19 / 255, green: 0x1D / 255, blue: 0x19 / 255, alpha: 1)
    private let muted = UIColor(red: 0x60 / 255, green: 0x68 / 255, blue: 0x5E / 255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = paper
        Task {
            let text = await sharedText()
            if let text { SharedInbox.add(text) }
            show(text == nil
                ? ("Nothing to keep", "Capture takes text and links.")
                : ("Saved to Capture", "It lands on your board when you next open Capture."))
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            close()
        }
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(close)))
    }

    @objc private func close() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func show(_ copy: (title: String, detail: String)) {
        let title = UILabel()
        title.text = copy.title
        title.font = UIFont(descriptor: UIFont.systemFont(ofSize: 28, weight: .medium).fontDescriptor
            .withDesign(.serif) ?? UIFont.systemFont(ofSize: 28).fontDescriptor, size: 28)
        title.textColor = ink
        let detail = UILabel()
        detail.text = copy.detail
        detail.font = .systemFont(ofSize: 17)
        detail.textColor = muted
        detail.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [title, detail])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    /// Text and links from the share, once each (Safari sends the link both as
    /// a URL and as text), with the page title first when there is one.
    private func sharedText() async -> String? {
        var parts: [String] = []
        for item in extensionContext?.inputItems as? [NSExtensionItem] ?? [] {
            if let title = item.attributedContentText?.string { parts.append(title) }
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    parts.append(url.absoluteString)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    parts.append(text)
                }
            }
        }
        var seen = Set<String>()
        let text = parts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
            .joined(separator: "\n")
        return text.isEmpty ? nil : text
    }
}
