import SwiftUI

struct KeysTab: View {
    @ObservedObject var config: ConfigStore

    var body: some View {
        Form {
            Section {
                field("OpenAI", binding: $config.openaiKey, variable: "OPENAI_API_KEY")
                field("ElevenLabs", binding: $config.elevenlabsKey, variable: "ELEVENLABS_API_KEY")
                field("OpenRouter", binding: $config.openrouterKey, variable: "OPENROUTER_API_KEY")
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(
                        "Keys are stored in \(ConfigStore.file.path) with 0600 permissions, "
                            + "the same file the command line tool reads."
                    )
                    Text(
                        "Leave a field blank to use its environment variable instead. "
                            + "The environment always wins over what is saved here."
                    )
                }
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder
    private func field(_ name: String, binding: Binding<String>, variable: String) -> some View {
        // SecureField, because a settings window is exactly the sort of thing
        // people leave open while screen sharing.
        SecureField(name, text: binding, prompt: Text("$\(variable)"))

        if binding.wrappedValue.isEmpty,
            let fromEnvironment = ProcessInfo.processInfo.environment[variable],
            !fromEnvironment.isEmpty
        {
            Label("Using \(variable) from the environment", systemImage: "checkmark.circle")
                .font(.callout)
                .foregroundStyle(.green)
        }
    }
}
