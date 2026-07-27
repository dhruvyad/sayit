import AppKit
import SwiftUI

struct HistoryTab: View {
    @ObservedObject var config: ConfigStore
    @StateObject private var store = HistoryStore()
    @StateObject private var player = Player()
    @State private var hovered: Clip.ID?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Card(title: summary) {
                if store.clips.isEmpty {
                    empty
                } else {
                    ForEach(Array(store.clips.enumerated()), id: \.element.id) { index, clip in
                        if index > 0 { Divider1() }
                        row(for: clip)
                    }
                }
            }

            Card(title: "Archive") {
                Row(
                    label: "Clips to keep",
                    detail: config.historyLimit == 0 ? "archiving is off" : nil
                ) {
                    HStack(spacing: 8) {
                        Text(config.historyLimit == 0 ? "None" : "\(config.historyLimit)")
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.muted)
                            .monospacedDigit()
                        Stepper("", value: $config.historyLimit, in: 0...500, step: 10)
                            .labelsHidden()
                    }
                }
                Divider1()
                Row(label: "Location", detail: Archive.directory.path) {
                    Button("Open") { NSWorkspace.shared.open(Archive.directory) }
                        .buttonStyle(QuietButton())
                }
            }

            Note(
                text: "Only cloud providers are archived. The system voice speaks directly "
                    + "and never produces a file, so there is nothing to keep.",
                icon: "info.circle"
            )
        }
        .onAppear { store.reload() }
        .onDisappear { player.stop() }
        .task {
            store.reload()
            await player.loadDurations(for: store.clips.map { (id: $0.id, url: $0.url) })
            if let key = config.key(for: "openrouter") {
                await store.resolveCosts(key: key)
                // A clip made seconds ago genuinely has no price yet —
                // OpenRouter reports null for the first few seconds — so ask
                // once more rather than leaving a dash on the newest row.
                if store.clips.contains(where: { $0.cost == nil && $0.generationId != nil }) {
                    try? await Task.sleep(for: .seconds(8))
                    await store.resolveCosts(key: key)
                }
            }
        }
    }

    private var summary: String {
        guard !store.clips.isEmpty else { return "Clips" }
        let count = store.clips.count
        let spent = store.totalCost > 0 ? String(format: " · $%.4f", store.totalCost) : ""
        return "\(count) clip\(count == 1 ? "" : "s") · \(store.totalSize)\(spent)"
    }

    private var empty: some View {
        VStack(spacing: 8) {
            Waveform(height: 22)
                .opacity(0.35)
                .padding(.bottom, 2)
            Text("Nothing archived yet")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.text)
            Text("Speech from a cloud provider is kept here so you can replay or share it.")
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 34)
    }

    private func row(for clip: Clip) -> some View {
        HStack(spacing: 12) {
            Button { player.toggle(id: clip.id, url: clip.url) } label: {
                Image(systemName: player.playing == clip.id ? "stop.fill" : "play.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(Theme.background)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(Theme.accent))
            }
            .buttonStyle(.plain)
            .help(player.playing == clip.id ? "Stop" : "Play")

            VStack(alignment: .leading, spacing: 2) {
                Text(clip.text)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("\(clip.when)  ·  \(Player.format(player.durations[clip.id]))  ·  \(clip.source)")
                    .font(.system(size: 10.5))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(clip.price)
                    .font(.system(size: 11.5))
                    .foregroundStyle(clip.cost == nil ? Theme.faint : Theme.muted)
                    .monospacedDigit()
                Text(clip.size)
                    .font(.system(size: 10.5))
                    .foregroundStyle(Theme.faint)
                    .monospacedDigit()
            }

            Button {
                NSWorkspace.shared.activateFileViewerSelecting([clip.url])
            } label: {
                Image(systemName: "folder")
                    .font(.system(size: 11))
                    .foregroundStyle(hovered == clip.id ? Theme.text : Theme.faint)
            }
            .buttonStyle(.plain)
            .help("Show in Finder")
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .background(hovered == clip.id ? Theme.raisedHover : Color.clear)
        .onHover { hovered = $0 ? clip.id : nil }
    }
}
