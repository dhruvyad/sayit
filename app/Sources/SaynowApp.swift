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
        .defaultSize(width: 660, height: 560)
        .windowStyle(.hiddenTitleBar)
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

enum Tab: String, CaseIterable {
    case speech, keys, history

    var title: String { rawValue.capitalized }

    var icon: String {
        switch self {
        case .speech: return "waveform"
        case .keys: return "key.fill"
        case .history: return "clock.arrow.circlepath"
        }
    }
}

struct RootView: View {
    @ObservedObject var config: ConfigStore
    @ObservedObject var catalog: Catalog

    // Lets a screenshot or a bug report open straight to a tab:
    //   SAYNOW_APP_TAB=history open -a Saynow
    @State private var tab: Tab =
        ProcessInfo.processInfo.environment["SAYNOW_APP_TAB"]
        .flatMap(Tab.init(rawValue:)) ?? .speech

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch tab {
                    case .speech: SpeechTab(config: config, catalog: catalog)
                    case .keys: KeysTab(config: config)
                    case .history: HistoryTab(config: config)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 20)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minWidth: 620, minHeight: 520)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        // Loaded once for the whole window: every tab reads model names,
        // prices and voices from it.
        .task { if catalog.models.isEmpty { await catalog.load() } }
    }

    private var header: some View {
        VStack(spacing: 0) {
            // The hidden title bar still draws the traffic lights over the
            // content, so give them a strip of their own. That frees the row
            // below to start at the true left edge instead of being pushed in.
            Color.clear.frame(height: 26)

            HStack(spacing: 11) {
                AppIcon(size: 30)

                Text("saynow")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)

                Spacer(minLength: 16)

                HStack(spacing: 2) {
                    ForEach(Tab.allCases, id: \.self) { item in
                        TabButton(tab: item, selected: tab == item) {
                            withAnimation(.easeOut(duration: 0.14)) { tab = item }
                        }
                    }
                }
                .padding(3)
                .background(Theme.raised)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(Theme.edge, lineWidth: 1))
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 13)

            Rectangle().fill(Theme.edge).frame(height: 1)
        }
        .background(Theme.background)
    }
}

private struct TabButton: View {
    let tab: Tab
    let selected: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: tab.icon).font(.system(size: 10.5, weight: .medium))
                Text(tab.title).font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(selected ? Theme.background : Theme.muted)
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(
                Capsule().fill(
                    selected
                        ? Theme.accent
                        : (hovering ? Theme.raisedHover : Color.clear)
                )
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
