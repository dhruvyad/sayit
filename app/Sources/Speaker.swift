import AppKit
import Foundation

/// Previews a voice by invoking the saynow CLI.
///
/// The app deliberately does not reimplement the provider layer: that would be
/// a second copy of the same request quirks to keep in sync, and they would
/// drift. If the CLI is not installed, preview is simply unavailable and says
/// so, rather than the app pretending to be a synthesiser.
@MainActor
final class Speaker: ObservableObject {
    @Published private(set) var speaking = false
    @Published private(set) var problem: String?

    private var running: Process?

    /// Where `saynow` lives, if anywhere. Checked once per launch.
    static let executable: URL? = {
        let candidates =
            ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
            .map { URL(fileURLWithPath: $0).appendingPathComponent("saynow") }

        if let found = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) {
            return found
        }

        // Fall back to asking the login shell, which knows about nvm, asdf and
        // anywhere else a user's node might live.
        let which = Process()
        which.executableURL = URL(fileURLWithPath: "/bin/sh")
        which.arguments = ["-lc", "command -v saynow"]
        let pipe = Pipe()
        which.standardOutput = pipe
        which.standardError = FileHandle.nullDevice
        try? which.run()
        which.waitUntilExit()

        let path = String(
            data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let path, !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path)
    }()

    var available: Bool { Self.executable != nil }

    func preview(provider: String, model: String, voice: String, text: String) {
        guard let executable = Self.executable else {
            problem = "The saynow command line tool was not found."
            return
        }

        stop()
        problem = nil
        speaking = true

        var arguments = ["--no-ui", "--quiet", "-p", provider]
        if !model.isEmpty { arguments += ["-m", model] }
        if !voice.isEmpty { arguments += ["-v", voice] }
        arguments.append(text)

        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice

        let errors = Pipe()
        process.standardError = errors

        process.terminationHandler = { [weak self] finished in
            let message = String(
                data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8
            )?.trimmingCharacters(in: .whitespacesAndNewlines)

            Task { @MainActor in
                self?.speaking = false
                self?.running = nil
                if finished.terminationStatus != 0, let message, !message.isEmpty {
                    self?.problem = message
                }
            }
        }

        do {
            try process.run()
            running = process
        } catch {
            speaking = false
            problem = error.localizedDescription
        }
    }

    func stop() {
        running?.terminate()
        running = nil
        speaking = false
    }
}
