import Foundation

/// Where the CLI writes archived clips. Deliberately outside the @MainActor
/// store so value types can resolve their own path without hopping actors.
enum Archive {
    static let directory: URL = {
        if let override = ProcessInfo.processInfo.environment["SAYNOW_HISTORY_DIR"] {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/saynow/history")
    }()

    static var index: URL { directory.appendingPathComponent("index.json") }
}

struct Clip: Identifiable, Hashable {
    let file: String
    let at: Date?
    let bytes: Int
    let provider: String
    let model: String?
    let voice: String?
    let cost: Double?
    let text: String

    var id: String { file }
    var url: URL { Archive.directory.appendingPathComponent(file) }

    var source: String {
        [provider, model, voice].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " / ")
    }

    var size: String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    var when: String {
        guard let at else { return "" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: at)
    }

    var price: String { cost.map { String(format: "$%.4f", $0) } ?? "—" }
}

/// Reads the archive the CLI writes. Read-only by design: the CLI owns the
/// index, and two writers would be a needless way to lose clips.
@MainActor
final class HistoryStore: ObservableObject {
    @Published private(set) var clips: [Clip] = []

    var totalBytes: Int { clips.reduce(0) { $0 + $1.bytes } }
    var totalCost: Double { clips.reduce(0) { $0 + ($1.cost ?? 0) } }

    var totalSize: String {
        ByteCountFormatter.string(fromByteCount: Int64(totalBytes), countStyle: .file)
    }

    func reload() {
        guard
            let data = try? Data(contentsOf: Archive.index),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            clips = []
            return
        }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        clips = raw.compactMap { entry in
            guard let file = entry["file"] as? String else { return nil }
            let stamp = entry["at"] as? String ?? ""
            return Clip(
                file: file,
                at: iso.date(from: stamp) ?? ISO8601DateFormatter().date(from: stamp),
                bytes: entry["bytes"] as? Int ?? 0,
                provider: entry["provider"] as? String ?? "",
                model: entry["model"] as? String,
                voice: entry["voice"] as? String,
                cost: entry["cost"] as? Double,
                text: entry["text"] as? String ?? ""
            )
        }
    }
}
