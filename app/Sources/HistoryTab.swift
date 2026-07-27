import AppKit
import SwiftUI

struct HistoryTab: View {
    @ObservedObject var config: ConfigStore
    @StateObject private var store = HistoryStore()
    @State private var selection: Clip.ID?

    var body: some View {
        VStack(spacing: 0) {
            if store.clips.isEmpty {
                empty
            } else {
                Table(store.clips, selection: $selection) {
                    TableColumn("When") { Text($0.when).foregroundStyle(.secondary) }
                        .width(min: 130, ideal: 150)
                    TableColumn("Text") { Text($0.text).lineLimit(1) }
                        .width(min: 180, ideal: 300)
                    TableColumn("Source") { Text($0.source).foregroundStyle(.secondary) }
                        .width(min: 150, ideal: 220)
                    TableColumn("Size") { Text($0.size).monospacedDigit() }
                        .width(70)
                    TableColumn("Cost") { Text($0.price).monospacedDigit() }
                        .width(70)
                }
                .contextMenu(forSelectionType: Clip.ID.self) { ids in
                    Button("Play") { ids.compactMap(clip).forEach(play) }
                    Button("Show in Finder") { reveal(ids.compactMap(clip)) }
                } primaryAction: { ids in
                    ids.compactMap(clip).forEach(play)
                }
            }

            Divider()
            toolbar
        }
        .onAppear { store.reload() }
    }

    private var empty: some View {
        VStack(spacing: 10) {
            Image(systemName: "waveform")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.tertiary)
            Text("No clips yet").font(.title3)
            Text(
                "Speech from a cloud provider is archived here so you can replay "
                    + "or share it without paying to generate it again.\n"
                    + "The system voice is not archived — it never produces a file."
            )
            .font(.callout)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
            .frame(maxWidth: 380)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var toolbar: some View {
        HStack(spacing: 12) {
            Text(summary).font(.callout).foregroundStyle(.secondary)

            Spacer()

            Stepper(value: $config.historyLimit, in: 0...500, step: 10) {
                Text("Keep \(config.historyLimit == 0 ? "none" : "\(config.historyLimit)")")
                    .font(.callout)
            }
            .fixedSize()

            Button("Reveal") { reveal(store.clips.isEmpty ? [] : [store.clips[0]]) }
                .disabled(store.clips.isEmpty)
            Button("Refresh") { store.reload() }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
    }

    private var summary: String {
        guard !store.clips.isEmpty else { return "Archive empty" }
        let count = store.clips.count
        let spent = store.totalCost > 0 ? String(format: ", $%.4f spent", store.totalCost) : ""
        return "\(count) clip\(count == 1 ? "" : "s"), \(store.totalSize)\(spent)"
    }

    private func clip(_ id: Clip.ID) -> Clip? { store.clips.first { $0.id == id } }

    private func play(_ clip: Clip) { NSWorkspace.shared.open(clip.url) }

    private func reveal(_ clips: [Clip]) {
        guard !clips.isEmpty else {
            NSWorkspace.shared.open(Archive.directory)
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting(clips.map(\.url))
    }
}
