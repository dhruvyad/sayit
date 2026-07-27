import AVFoundation
import Foundation

/// Plays archived clips inside the app.
///
/// Handing the file to NSWorkspace launched Music and imported it into a
/// library, which is the wrong thing to do with a throwaway notification clip.
/// AVAudioPlayer keeps playback here, where a second click can stop it.
@MainActor
final class Player: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var playing: String?
    @Published private(set) var durations: [String: TimeInterval] = [:]

    private var player: AVAudioPlayer?

    func toggle(id: String, url: URL) {
        if playing == id {
            stop()
            return
        }
        stop()

        guard let audio = try? AVAudioPlayer(contentsOf: url) else { return }
        audio.delegate = self
        audio.prepareToPlay()
        audio.play()

        player = audio
        playing = id
        durations[id] = audio.duration
    }

    func stop() {
        player?.stop()
        player = nil
        playing = nil
    }

    /// Read durations without playing. Cheap enough for an archive of this
    /// size, and it runs off the main actor so the window never waits on disk.
    func loadDurations(for clips: [(id: String, url: URL)]) async {
        let missing = clips.filter { durations[$0.id] == nil }
        guard !missing.isEmpty else { return }

        let measured = await Task.detached(priority: .utility) { () -> [String: TimeInterval] in
            var found: [String: TimeInterval] = [:]
            for clip in missing {
                let asset = AVURLAsset(url: clip.url)
                if let seconds = try? await asset.load(.duration).seconds, seconds.isFinite {
                    found[clip.id] = seconds
                }
            }
            return found
        }.value

        durations.merge(measured) { _, new in new }
    }

    nonisolated func audioPlayerDidFinishPlaying(_: AVAudioPlayer, successfully _: Bool) {
        Task { @MainActor in self.stop() }
    }

    static func format(_ seconds: TimeInterval?) -> String {
        guard let seconds, seconds > 0 else { return "—" }
        let whole = Int(seconds.rounded())
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}
