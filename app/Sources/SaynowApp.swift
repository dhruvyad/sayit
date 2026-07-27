import AppKit
import SwiftUI

@main
struct SaynowApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var config = ConfigStore()
    @StateObject private var catalog = Catalog()

    var body: some Scene {
        Window("saynow", id: "settings") {
            RootView(config: config, catalog: catalog)
                // Reload on focus: the CLI may have changed the file while the
                // window sat in the background, and the two must not disagree.
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: NSApplication.didBecomeActiveNotification
                    )
                ) { _ in config.load() }
        }
        .defaultSize(width: 720, height: 520)
        .windowResizability(.contentSize)
        .commands { CommandGroup(replacing: .newItem) {} }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    // A settings window with nothing else running has no reason to linger.
    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { true }

    func applicationDidFinishLaunching(_: Notification) {
        NSApp.setActivationPolicy(.regular) // shows in the Dock, as intended
        NSApp.activate(ignoringOtherApps: true)
    }
}

enum Tab: String { case speech, keys, history }

struct RootView: View {
    @ObservedObject var config: ConfigStore
    @ObservedObject var catalog: Catalog

    // Lets a screenshot or a bug report open straight to a tab:
    //   SAYNOW_APP_TAB=history open -a Saynow
    @State private var tab: Tab =
        ProcessInfo.processInfo.environment["SAYNOW_APP_TAB"]
        .flatMap(Tab.init(rawValue:)) ?? .speech

    var body: some View {
        TabView(selection: $tab) {
            SpeechTab(config: config, catalog: catalog)
                .tabItem { Label("Speech", systemImage: "waveform") }
                .tag(Tab.speech)

            KeysTab(config: config)
                .tabItem { Label("Keys", systemImage: "key") }
                .tag(Tab.keys)

            HistoryTab(config: config)
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                .tag(Tab.history)
        }
        .frame(minWidth: 680, minHeight: 460)
    }
}
