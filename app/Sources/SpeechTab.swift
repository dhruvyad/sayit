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

    private var knownVoices: [String]? {
        switch config.provider {
        case "openai": return Voices.openai
        case "openrouter": return Voices.known(for: effectiveModel)
        default: return nil
        }
    }

    private var selected: SpeechModel? {
        catalog.models.first { $0.id == effectiveModel }
    }

    private var missingKey: Bool {
        config.provider != "system" && config.key(for: config.provider) == nil
    }

    var body: some View {
        Form {
            Section {
                Picker("Provider", selection: $config.provider) {
                    ForEach(providers, id: \.self) { Text(label(for: $0)).tag($0) }
                }

                if usesModels {
                    if catalog.loading {
                        LabeledContent("Model") {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text("Loading…").foregroundStyle(.secondary)
                            }
                        }
                    } else if catalog.error != nil {
                        LabeledContent("Model") {
                            TextField("", text: $config.model, prompt: Text("model id"))
                                .multilineTextAlignment(.trailing)
                        }
                    } else {
                        Picker("Model", selection: $config.model) {
                            ForEach(catalog.models) { model in
                                Text(model.id).tag(model.id)
                            }
                        }
                        .onChange(of: config.model) { _, _ in resetVoice() }
                    }
                }

                if let voices = knownVoices {
                    Picker("Voice", selection: $config.voice) {
                        ForEach(voices, id: \.self) { Text($0).tag($0) }
                    }
                } else {
                    LabeledContent("Voice") {
                        TextField("", text: $config.voice, prompt: Text("provider default"))
                            .multilineTextAlignment(.trailing)
                    }
                }
            } footer: {
                if usesModels && knownVoices == nil {
                    notice(
                        "No verified voice list for this model. OpenRouter rejects a "
                            + "request without a voice, so enter one.",
                        icon: "questionmark.circle",
                        tint: .secondary
                    )
                }
                if missingKey {
                    notice(
                        "No API key for \(config.provider). saynow speaks with the system "
                            + "voice until one is set.",
                        icon: "exclamationmark.triangle",
                        tint: .orange
                    )
                }
            }

            Section("Preview") {
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
                        Label(
                            speaker.speaking ? "Stop" : "Play sample",
                            systemImage: speaker.speaking ? "stop.fill" : "play.fill"
                        )
                        .fixedSize()
                        .frame(width: 100)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!speaker.available)

                    Text("“This is how saynow will sound.”")
                        .foregroundStyle(.secondary)
                        .italic()

                    Spacer()
                }

                if !speaker.available {
                    notice(
                        "The saynow command line tool was not found, so preview is "
                            + "unavailable. Install it with: npm install -g saynow",
                        icon: "terminal",
                        tint: .secondary
                    )
                }
                if let problem = speaker.problem {
                    notice(problem, icon: "xmark.octagon", tint: .red)
                }
            }

            if usesModels, let model = selected {
                Section("This model") {
                    LabeledContent("Vendor", value: model.vendor)
                    LabeledContent("Price", value: model.pricePerThousand)
                    LabeledContent(
                        "Voices",
                        value: Voices.known(for: model.id).map { "\($0.count)" }
                            ?? "not catalogued"
                    )
                    LabeledContent("A 1,000-word article", value: estimate(for: model))
                }
            }
        }
        .formStyle(.grouped)
        .task { if catalog.models.isEmpty { await catalog.load() } }
    }

    /// Voices do not carry across vendors, so a stale one would be rejected by
    /// the API rather than quietly ignored.
    private func resetVoice() {
        config.voice = Voices.known(for: effectiveModel)?.first ?? ""
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

    private func notice(_ text: String, icon: String, tint: Color) -> some View {
        Label(text, systemImage: icon)
            .font(.callout)
            .foregroundStyle(tint)
            .padding(.top, 3)
    }

    private func label(for name: String) -> String {
        switch name {
        case "system": return "System — offline, free"
        case "openai": return "OpenAI"
        case "elevenlabs": return "ElevenLabs"
        case "openrouter": return "OpenRouter — 15+ models"
        default: return name
        }
    }
}
