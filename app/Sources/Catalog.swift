import Foundation

struct SpeechModel: Identifiable, Hashable {
    let id: String
    let price: Double
    let voices: [String]
    var vendor: String { id.split(separator: "/").first.map(String.init) ?? id }

    /// Priced per input token; scale to something a person can compare.
    var pricePerThousand: String {
        price > 0 ? String(format: "$%.4f / 1k tok", price * 1000) : "free"
    }
}

/// Voices come from the API. A hardcoded table was not merely incomplete, it
/// was wrong: Grok's voice is "eve", not "Eve", and Deepgram has 90 voices
/// rather than the 9 that guessing found. This is only a cold-start fallback.
enum Voices {
    static let fallback: [String: [String]] = [
        "google/gemini-3.1-flash-tts-preview": ["Zephyr", "Puck", "Charon", "Kore"],
        "x-ai/grok-voice-tts-1.0": ["eve", "ara", "rex", "sal", "leo"],
        "minimax/speech-2.8-turbo": ["alloy"],
        "minimax/speech-2.8-hd": ["alloy"],
    ]

    static let openai = [
        "alloy", "ash", "ballad", "coral", "echo",
        "fable", "nova", "onyx", "sage", "shimmer",
    ]
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

    /// Voices for a model, from the loaded catalogue.
    func voices(for model: String) -> [String] {
        let published = models.first { $0.id == model }?.voices ?? []
        return published.isEmpty ? (Voices.fallback[model] ?? []) : published
    }

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
                return SpeechModel(
                    id: id,
                    price: price,
                    voices: entry["supported_voices"] as? [String]
                        ?? Voices.fallback[id] ?? []
                )
            }
            .sorted { $0.price < $1.price }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
