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
    var cost: Double?
    let generationId: String?
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

    /// Fill in prices the CLI has not resolved yet.
    ///
    /// Held in memory rather than written back: the CLI owns index.json, and a
    /// second writer is a needless way to lose clips. The cost of that is a
    /// few requests per launch, which is cheaper than a corrupted archive.
    func resolveCosts(key: String) async {
        let pending = clips.filter { $0.cost == nil && $0.generationId != nil }
        guard !pending.isEmpty else { return }

        // Fetched concurrently: an archive of fifty clips resolved one at a
        // time leaves most of the list showing a dash for several seconds.
        let found = await withTaskGroup(of: (String, Double)?.self) { group in
            for clip in pending {
                guard let id = clip.generationId else { continue }
                group.addTask { await Self.cost(of: id, key: key).map { (clip.id, $0) } }
            }
            var results: [String: Double] = [:]
            for await result in group {
                if let (id, cost) = result { results[id] = cost }
            }
            return results
        }

        for (index, clip) in clips.enumerated() where found[clip.id] != nil {
            clips[index].cost = found[clip.id]
        }
    }

    private static func cost(of generationId: String, key: String) async -> Double? {
        let escaped =
            generationId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
            ?? generationId
        guard let url = URL(string: "https://openrouter.ai/api/v1/generation?id=\(escaped)")
        else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")

        guard
            let (data, _) = try? await URLSession.shared.data(for: request),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let entry = payload["data"] as? [String: Any]
        else { return nil }

        return entry["total_cost"] as? Double
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
                // Either spelling: older clips used a snake_case key.
                generationId: entry["generationId"] as? String
                    ?? entry["generation_id"] as? String,
                text: entry["text"] as? String ?? ""
            )
        }
    }
}
