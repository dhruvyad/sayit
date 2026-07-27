import Foundation

struct SpeechModel: Identifiable, Hashable {
    let id: String
    let price: Double
    var vendor: String { id.split(separator: "/").first.map(String.init) ?? id }

    /// Priced per input token; scale to something a person can compare.
    var pricePerThousand: String {
        price > 0 ? String(format: "$%.4f / 1k tok", price * 1000) : "free"
    }
}

/// Voice names are vendor-specific and OpenRouter rejects a request without
/// one, so the picker needs a list per model. These were verified against the
/// live API; models absent here fall back to a free-text field, because an
/// empty dropdown is worse than a text box.
enum Voices {
    static let table: [String: [String]] = [
        "google/gemini-3.1-flash-tts-preview": [
            "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus",
            "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
            "Despina", "Erinome", "Laomedeia", "Schedar", "Achird", "Sadachbia",
        ],
        "deepgram/aura-2": [
            "aura-2-thalia-en", "aura-2-andromeda-en", "aura-2-apollo-en",
            "aura-2-arcas-en", "aura-2-asteria-en", "aura-2-athena-en",
            "aura-2-helena-en", "aura-2-orion-en", "aura-2-zeus-en",
        ],
        "x-ai/grok-voice-tts-1.0": ["Eve"],
        "hexgrad/kokoro-82m": ["af_heart", "af_bella", "am_michael"],
        "canopylabs/orpheus-3b-0.1-ft": [
            "tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe",
        ],
        "sesame/csm-1b": ["conversational_a", "conversational_b", "read_speech_a"],
        "minimax/speech-2.8-turbo": ["alloy"],
        "minimax/speech-2.8-hd": ["alloy"],
    ]

    static let openai = [
        "alloy", "ash", "ballad", "coral", "echo",
        "fable", "nova", "onyx", "sage", "shimmer",
    ]

    static func known(for model: String) -> [String]? { table[model] }
}

/// Loads the speech-model catalog from OpenRouter.
@MainActor
final class Catalog: ObservableObject {
    @Published private(set) var models: [SpeechModel] = []
    @Published private(set) var loading = false
    @Published private(set) var error: String?

    // The plain /models endpoint omits the entire speech category; these only
    // appear under this filter.
    private static let url = URL(
        string: "https://openrouter.ai/api/v1/models?output_modalities=speech"
    )!

    func load() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }

        do {
            let (data, response) = try await URLSession.shared.data(from: Self.url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                error = "OpenRouter returned an unexpected response."
                return
            }
            let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let entries = payload?["data"] as? [[String: Any]] ?? []

            models = entries.compactMap { entry in
                guard let id = entry["id"] as? String else { return nil }
                let pricing = entry["pricing"] as? [String: Any]
                let prompt = pricing?["prompt"]
                let price = Double("\(prompt ?? 0)") ?? 0
                return SpeechModel(id: id, price: price)
            }
            .sorted { $0.price < $1.price }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
