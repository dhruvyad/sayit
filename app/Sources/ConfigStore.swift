import Foundation

/// The same `~/.config/saynow/config.json` the CLI reads.
///
/// The app and the CLI are deliberately independent processes that meet only
/// at this file, so everything here preserves keys it does not understand —
/// a newer CLI must never lose settings just because an older app saved.
@MainActor
final class ConfigStore: ObservableObject {
    static let directory: URL = {
        if let override = ProcessInfo.processInfo.environment["SAYNOW_CONFIG_DIR"] {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/saynow")
    }()

    static let file = directory.appendingPathComponent("config.json")

    @Published var provider: String = "system" { didSet { save() } }
    @Published var model: String = "" { didSet { save() } }
    @Published var voice: String = "" { didSet { save() } }
    @Published var historyLimit: Int = 50 { didSet { save() } }
    @Published var openaiKey: String = "" { didSet { save() } }
    @Published var elevenlabsKey: String = "" { didSet { save() } }
    @Published var openrouterKey: String = "" { didSet { save() } }

    /// Anything in the file we do not model, kept so saving cannot drop it.
    private var passthrough: [String: Any] = [:]
    private var loading = false

    init() { load() }

    func load() {
        loading = true
        defer { loading = false }

        guard
            let data = try? Data(contentsOf: Self.file),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        provider = raw["provider"] as? String ?? "system"
        model = raw["model"] as? String ?? ""
        voice = raw["voice"] as? String ?? ""
        historyLimit = raw["historyLimit"] as? Int ?? 50
        openaiKey = raw["openaiApiKey"] as? String ?? ""
        elevenlabsKey = raw["elevenlabsApiKey"] as? String ?? ""
        openrouterKey = raw["openrouterApiKey"] as? String ?? ""

        let known: Set<String> = [
            "provider", "model", "voice", "historyLimit",
            "openaiApiKey", "elevenlabsApiKey", "openrouterApiKey",
        ]
        passthrough = raw.filter { !known.contains($0.key) }
    }

    func save() {
        guard !loading else { return }

        var raw = passthrough
        raw["provider"] = provider
        raw["model"] = model.isEmpty ? NSNull() : model
        raw["voice"] = voice.isEmpty ? NSNull() : voice
        raw["historyLimit"] = historyLimit
        for (key, value) in [
            ("openaiApiKey", openaiKey),
            ("elevenlabsApiKey", elevenlabsKey),
            ("openrouterApiKey", openrouterKey),
        ] where !value.isEmpty {
            raw[key] = value
        }

        do {
            try FileManager.default.createDirectory(
                at: Self.directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let data = try JSONSerialization.data(
                withJSONObject: raw, options: [.prettyPrinted, .sortedKeys]
            )
            // Write then rename, so a crash mid-write cannot truncate the file
            // the CLI is about to read.
            let temporary = Self.file.appendingPathExtension("tmp")
            try data.write(to: temporary)
            _ = try FileManager.default.replaceItemAt(Self.file, withItemAt: temporary)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600], ofItemAtPath: Self.file.path
            )
        } catch {
            NSLog("saynow: could not save config: \(error.localizedDescription)")
        }
    }

    /// The credential the chosen provider needs, or nil when it needs none.
    func key(for provider: String) -> String? {
        switch provider {
        case "openai": return openaiKey.isEmpty ? environment("OPENAI_API_KEY") : openaiKey
        case "elevenlabs":
            return elevenlabsKey.isEmpty ? environment("ELEVENLABS_API_KEY") : elevenlabsKey
        case "openrouter":
            return openrouterKey.isEmpty ? environment("OPENROUTER_API_KEY") : openrouterKey
        default: return nil
        }
    }

    /// A key may live only in the shell environment, which the CLI honours too.
    private func environment(_ name: String) -> String? {
        let value = ProcessInfo.processInfo.environment[name]
        return (value?.isEmpty ?? true) ? nil : value
    }
}
