import AppKit
import SwiftUI

/// The same palette and geometry as ui/bubble.html, so the app, the bubble and
/// the icon read as one thing rather than three.
enum Theme {
    static let background = Color(white: 0.039)
    static let raised = Color(white: 1, opacity: 0.045)
    static let raisedHover = Color(white: 1, opacity: 0.075)
    static let edge = Color(white: 1, opacity: 0.09)
    static let text = Color(white: 0.96)
    static let muted = Color(white: 0.96, opacity: 0.45)
    static let faint = Color(white: 0.96, opacity: 0.28)
    static let accent = Color(white: 0.96)

    static let radius: CGFloat = 14
    static let rowHeight: CGFloat = 42
}

/// A bordered panel. Every group of settings sits in one of these.
struct Card<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let title {
                Text(title.uppercased())
                    .font(.system(size: 10.5, weight: .semibold))
                    .tracking(0.7)
                    .foregroundStyle(Theme.muted)
                    .padding(.leading, 2)
            }

            VStack(spacing: 0) { content }
                .background(Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                        .strokeBorder(Theme.edge, lineWidth: 1)
                )
        }
    }
}

/// One labelled line inside a Card.
struct Row<Trailing: View>: View {
    let label: String
    var detail: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).foregroundStyle(Theme.text)
                if let detail {
                    Text(detail).font(.system(size: 11)).foregroundStyle(Theme.faint)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
        .font(.system(size: 13))
        .padding(.horizontal, 14)
        .frame(minHeight: Theme.rowHeight)
    }
}

struct Divider1: View {
    var body: some View {
        Rectangle().fill(Theme.edge).frame(height: 1).padding(.leading, 14)
    }
}

/// A dropdown that keeps the app's own look rather than the system's.
struct ThemedPicker: View {
    let options: [String]
    var display: (String) -> String = { $0 }
    @Binding var selection: String

    var body: some View {
        Menu {
            ForEach(options, id: \.self) { option in
                Button(display(option)) { selection = option }
            }
        } label: {
            HStack(spacing: 6) {
                Text(selection.isEmpty ? "—" : display(selection))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.raisedHover)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}

struct ThemedField: View {
    var prompt: String
    @Binding var text: String
    var secure = false

    var body: some View {
        Group {
            if secure {
                SecureField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.faint))
            } else {
                TextField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.faint))
            }
        }
        .textFieldStyle(.plain)
        .multilineTextAlignment(.trailing)
        .foregroundStyle(Theme.text)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Theme.raisedHover)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .frame(maxWidth: 260)
    }
}

/// Filled button, matching the send button in the bubble.
struct PrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(Theme.background)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Theme.accent.opacity(configuration.isPressed ? 0.75 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

struct QuietButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5))
            .foregroundStyle(Theme.text)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(configuration.isPressed ? Theme.raisedHover : Theme.raised)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(Theme.edge, lineWidth: 1)
            )
    }
}

/// The app's own icon — the rounded plate, not the bare bars. Reusing the
/// bundle icon means the header, the Dock and the About box can never disagree.
struct AppIcon: View {
    var size: CGFloat = 26

    var body: some View {
        if let icon = NSApp.applicationIconImage {
            Image(nsImage: icon)
                .resizable()
                .interpolation(.high)
                .frame(width: size, height: size)
        } else {
            // Only reachable before the bundle finishes loading.
            RoundedRectangle(cornerRadius: size * 0.235, style: .continuous)
                .fill(Color(white: 0.039))
                .overlay(Waveform(height: size * 0.5))
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.235, style: .continuous)
                        .strokeBorder(Theme.edge, lineWidth: 1)
                )
                .frame(width: size, height: size)
        }
    }
}

/// The five-bar mark from the icon and the bubble.
struct Waveform: View {
    var height: CGFloat = 15
    var animating = false

    private let bars: [CGFloat] = [0.38, 0.74, 1.0, 0.62, 0.44]
    @State private var phase = false

    var body: some View {
        HStack(alignment: .center, spacing: height * 0.17) {
            ForEach(bars.indices, id: \.self) { index in
                Capsule()
                    .fill(Theme.text.opacity(0.45 + bars[index] * 0.5))
                    .frame(width: height * 0.17, height: height * bars[index] * scale(index))
            }
        }
        .frame(height: height)
        .onAppear {
            guard animating else { return }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) {
                phase = true
            }
        }
    }

    private func scale(_ index: Int) -> CGFloat {
        guard animating else { return 1 }
        return phase ? (index.isMultiple(of: 2) ? 0.7 : 1.0) : 1.0
    }
}

/// A short explanatory line under a card.
struct Note: View {
    let text: String
    var icon: String = "info.circle"
    var tint: Color = Theme.muted

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: icon).font(.system(size: 11))
            Text(text)
        }
        .font(.system(size: 11.5))
        .foregroundStyle(tint)
        .padding(.horizontal, 3)
        .fixedSize(horizontal: false, vertical: true)
    }
}
