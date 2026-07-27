// A borderless, transparent, always-on-top panel hosting a WKWebView.
//
// This is the window shell only — every pixel of the UI comes from the page it
// loads. Using the system WebKit rather than bundling a browser keeps the
// binary around a megabyte, against the hundreds of megabytes an Electron app
// spends to ship its own Chromium.
//
// Usage: saynow-panel <url> [width] [height]
// Exits when the parent closes stdin, or when the page asks it to.

import AppKit
import WebKit

// visibleFrame already excludes the Dock, which is commonly 90pt tall. A large
// margin on top of that leaves the bubble stranded well clear of the corner, so
// keep it tight and let the Dock provide the breathing room.
let MARGIN: CGFloat = 10

/// A borderless NSWindow refuses key status, which would leave the reply field
/// untypeable and swallow Escape. A panel may accept keys without activating
/// the app, which is exactly what we want.
final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class Panel: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var panel: FloatingPanel!
    private var web: WKWebView!
    private let url: URL
    private var size: NSSize

    init(url: URL, size: NSSize) {
        self.url = url
        self.size = size
    }

    func applicationDidFinishLaunching(_: Notification) {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "size")
        // The page plays the speech itself so the transcript can follow the
        // audio clock. Without this it would be blocked as unsolicited
        // autoplay and the bubble would sit there silent.
        config.mediaTypesRequiringUserActionForPlayback = []
        // Let the page paint its own background so the panel stays transparent.
        config.setValue(false, forKey: "drawsBackground")

        web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.layer?.backgroundColor = .clear

        panel = FloatingPanel(
            contentRect: NSRect(origin: .zero, size: size),
            // .nonactivatingPanel is the important one: clicking the bubble must
            // not steal focus from whatever the user is actually working in.
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = web
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false // the page draws its own, so corners stay round
        panel.level = .floating
        panel.isMovableByWindowBackground = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        reposition()
        web.load(URLRequest(url: url))
        // Deliberately not shown yet. The initial height is only a guess, so
        // showing now would flash a clipped bubble until the page reports its
        // real size. presentWhenSized() takes over.
        watchForParentExit()

        // Safety net: if the page never reports a size, show it anyway rather
        // than leaving the user with silence and no window.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.present()
        }
    }

    private var shown = false

    private func present() {
        guard !shown else { return }
        shown = true
        panel.orderFrontRegardless()
        // Take keys so the reply field is typeable, without activating the app
        // and pulling the user out of whatever they were doing.
        panel.makeKey()
    }

    /// Bottom-right of the screen holding the pointer, clear of the Dock.
    private func reposition() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main
        guard let visible = screen?.visibleFrame else { return }

        panel.setFrame(
            NSRect(
                x: visible.maxX - size.width - MARGIN,
                y: visible.minY + MARGIN,
                width: size.width,
                height: size.height
            ),
            display: true
        )
    }

    // The page reports its rendered height so the panel hugs the bubble. Without
    // this the transparent remainder would still swallow clicks meant for the
    // window underneath.
    func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let payload = message.body as? [String: Any],
            let height = payload["height"] as? Double,
            height > 0
        else { return }

        size = NSSize(width: size.width, height: CGFloat(height))
        web.setFrameSize(size)
        reposition()
        // Now that the panel hugs the content, it is safe to show.
        present()
    }

    func webView(_: WKWebView, didFinish _: WKNavigation!) {
        if shown { panel.orderFrontRegardless() }
    }

    /// The CLI holds our stdin open; EOF means it is done with us.
    private func watchForParentExit() {
        let stdinSource = DispatchSource.makeReadSource(
            fileDescriptor: FileHandle.standardInput.fileDescriptor,
            queue: .main
        )
        stdinSource.setEventHandler {
            let data = FileHandle.standardInput.availableData
            if data.isEmpty { NSApp.terminate(nil) }
        }
        stdinSource.resume()
        self.stdinSource = stdinSource
    }

    private var stdinSource: DispatchSourceRead?
}

let arguments = CommandLine.arguments
guard arguments.count > 1, let url = URL(string: arguments[1]) else {
    FileHandle.standardError.write("usage: saynow-panel <url> [width] [height]\n".data(using: .utf8)!)
    exit(64)
}

let width = arguments.count > 2 ? Double(arguments[2]) ?? 420 : 420
let height = arguments.count > 3 ? Double(arguments[3]) ?? 200 : 200

let app = NSApplication.shared
// .accessory is the programmatic equivalent of LSUIElement: no Dock icon, no
// menu bar, never appears in the app switcher.
app.setActivationPolicy(.accessory)

let delegate = Panel(url: url, size: NSSize(width: width, height: height))
app.delegate = delegate
app.run()
