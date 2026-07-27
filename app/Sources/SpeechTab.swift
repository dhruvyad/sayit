import SwiftUI

struct SpeechTab: View {
    @ObservedObject var config: ConfigStore
    @ObservedObject var catalog: Catalog
    @StateObject private var speaker = Speaker()

    private let providers = ["system", "openai", "elevenlabs", "openrouter"]

    private var usesModels: Bool { config.provider == "openrouter" }

    private var effectiveModel: String {
        config.model.isEmpty ? "google/gemini-3.1-flash-tts-preview" : config.model
    }

    private var voiceOptions: [String] {
        switch config.provider {
        case "openai": return Voices.openai
        case "openrouter": return catalog.voices(for: effectiveModel)
        default: return []
        }
    }

    private var selected: SpeechModel? { catalog.models.first { $0.id == effectiveModel } }

    private var missingKey: Bool {
        config.provider != "system" && config.key(for: config.provider) == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Card(title: "Voice") {
                Row(label: "Provider", detail: providerNote) {
                    ThemedPicker(options: providers, display: label(for:), selection: $config.provider)
                }

                if usesModels {
                    Divider1()
                    Row(label: "Model", detail: selected?.pricePerThousand) {
                        if catalog.loading {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small)
                                Text("Loading…").foregroundStyle(Theme.muted)
                            }
                        } else if catalog.models.isEmpty {
                            ThemedField(prompt: "model id", text: $config.model)
                        } else {
                            ThemedPicker(
                                options: catalog.models.map(\.id),
                                selection: $config.model
                            )
                            .onChange(of: config.model) { _, _ in reconcileVoice() }
                        }
                    }
                }

                Divider1()
                Row(label: "Voice", detail: voiceNote) {
                    if voiceOptions.isEmpty {
                        ThemedField(prompt: "provider default", text: $config.voice)
                    } else {
                        ThemedPicker(options: voiceOptions, selection: $config.voice)
                    }
                }
            }

            if missingKey {
                Note(
                    text: "No API key for \(config.provider). saynow speaks with the system voice until one is set.",
                    icon: "exclamationmark.triangle.fill",
                    tint: .orange
                )
            }

            Card(title: "Preview") {
                HStack(spacing: 12) {
                    Button {
                        speaker.speaking
                            ? speaker.stop()
                            : speaker.preview(
                                provider: config.provider,
                                model: config.model,
                                voice: config.voice,
                                text: "This is how saynow will sound."
                            )
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: speaker.speaking ? "stop.fill" : "play.fill")
                                .font(.system(size: 10))
                            Text(speaker.speaking ? "Stop" : "Play sample")
                        }
                    }
                    .buttonStyle(PrimaryButton())
                    .disabled(!speaker.available)

                    if speaker.speaking {
                        Waveform(height: 14, animating: true)
                    }

                    Text("“This is how saynow will sound.”")
                        .font(.system(size: 12))
                        .italic()
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: Theme.rowHeight + 6)
            }

            if !speaker.available {
                Note(
                    text: "The saynow command line tool was not found, so preview is unavailable. Install it with: npm install -g saynow",
                    icon: "terminal"
                )
            }
            if let problem = speaker.problem {
                Note(text: problem, icon: "xmark.octagon.fill", tint: .red)
            }

            if usesModels, let model = selected {
                Card(title: "This model") {
                    Row(label: "Vendor") { value(model.vendor) }
                    Divider1()
                    Row(label: "Price") { value(model.pricePerThousand) }
                    Divider1()
                    Row(label: "Voices published") {
                        value(model.voices.isEmpty ? "none" : "\(model.voices.count)")
                    }
                    Divider1()
                    Row(label: "A 1,000-word article") { value(estimate(for: model)) }
                }
            }
        }
        .onChange(of: catalog.models.count) { _, _ in reconcileVoice() }
        .onChange(of: config.provider) { _, _ in reconcileVoice() }
        .onAppear { reconcileVoice() }
    }

    /// Keep the stored voice valid for the chosen model.
    ///
    /// Voices are vendor-specific, so one left over from another model is not
    /// merely cosmetic — the API rejects the request outright. Runs whenever
    /// the model changes and once the catalogue arrives, since before that the
    /// list of valid names is not yet known.
    private func reconcileVoice() {
        let options = voiceOptions
        guard !options.isEmpty else { return }
        if !options.contains(config.voice) {
            config.voice = options[0]
        }
    }

    private func value(_ text: String) -> some View {
        Text(text).font(.system(size: 12.5)).foregroundStyle(Theme.muted)
    }

    private var providerNote: String? {
        config.provider == "system" ? "offline, no key, no cost" : nil
    }

    private var voiceNote: String? {
        guard usesModels, voiceOptions.isEmpty else { return nil }
        return "OpenRouter publishes none for this model"
    }

    /// Roughly 1.3 tokens a word, which is the useful end of the pricing table:
    /// "$0.0010 / 1k tok" means little until it is a number of articles.
    private func estimate(for model: SpeechModel) -> String {
        let cost = model.price * 1300
        if cost == 0 { return "free" }
        return cost < 0.01
            ? String(format: "about $%.4f", cost)
            : String(format: "about $%.2f", cost)
    }

    private func label(for name: String) -> String {
        switch name {
        case "system": return "System"
        case "openai": return "OpenAI"
        case "elevenlabs": return "ElevenLabs"
        case "openrouter": return "OpenRouter"
        default: return name
        }
    }
}
