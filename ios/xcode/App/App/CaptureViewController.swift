import UIKit
import Capacitor

/// Keeps Capture below the status bar. The web app pads the bottom safe area
/// itself (as it does when installed to the Home Screen) but not the top, so
/// Capacitor's view sits under the status bar and the strip above it stays paper.
/// Capacitor makes the web view its root view, hence the container.
class CaptureViewController: UIViewController {
    private let bridge = CaptureBridgeViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0xED / 255, green: 0xEF / 255, blue: 0xE8 / 255, alpha: 1)
        addChild(bridge)
        view.addSubview(bridge.view)
        bridge.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            bridge.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bridge.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bridge.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bridge.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        bridge.didMove(toParent: self)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
}

/// Capacitor's controller with Capture's own plugin registered.
class CaptureBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CaptureShellPlugin())
    }
}
