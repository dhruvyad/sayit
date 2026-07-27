import SwiftUI

struct KeysTab: View {
    @ObservedObject var config: ConfigStore

    private let credentials: [(name: String, variable: String)] = [
        ("OpenAI", "OPENAI_API_KEY"),
        ("ElevenLabs", "ELEVENLABS_API_KEY"),
        ("OpenRouter", "OPENROUTER_API_KEY"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Card(title: "API keys") {
                ForEach(Array(credentials.enumerated()), id: \.offset) { index, credential in
                    if index > 0 { Divider1() }
                    Row(label: credential.name, detail: source(for: credential.variable)) {
                        ThemedField(
                            prompt: "$\(credential.variable)",
                            text: binding(for: credential.variable),
                            secure: true
                        )
                    }
                }
            }

            Note(
                text: "Stored in \(ConfigStore.file.path) with 0600 permissions — the same file "
                    + "the command line tool reads, so both stay in step.",
                icon: "lock.fill"
            )
            Note(
                text: "Leave a field blank to use its environment variable instead. "
                    + "The environment always wins over what is saved here.",
                icon: "terminal"
            )
        }
    }

    /// Says where the credential is actually coming from, which matters when a
    /// blank field still works because the shell exports one.
    private func source(for variable: String) -> String? {
        let stored = !binding(for: variable).wrappedValue.isEmpty
        if stored { return "saved here" }

        let environment = ProcessInfo.processInfo.environment[variable]
        return (environment?.isEmpty ?? true) ? "not set" : "from the environment"
    }

    private func binding(for variable: String) -> Binding<String> {
        switch variable {
        case "OPENAI_API_KEY": return $config.openaiKey
        case "ELEVENLABS_API_KEY": return $config.elevenlabsKey
        default: return $config.openrouterKey
        }
    }
}
