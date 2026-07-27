// Draws the app icon and writes an .iconset.
//
// Rendered in code rather than committed as a binary so the mark stays in one
// place: the same five-bar waveform the speech bubble uses. Drawing through
// AppKit keeps the alpha channel, which matters because a macOS icon is a
// rounded rectangle with transparent corners — rendering the SVG through
// qlmanage flattened it onto white and left a halo around every corner.

import AppKit
import Foundation

// Bar heights as a fraction of the usable area, matching ui/bubble.html.
let bars: [CGFloat] = [0.38, 0.74, 1.00, 0.62, 0.44]

func render(size: CGFloat) -> Data? {
    guard
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(size), pixelsHigh: Int(size),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )
    else { return nil }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    defer { NSGraphicsContext.restoreGraphicsState() }

    // Transparent everywhere except the rounded square, so the Dock does not
    // draw a box around it.
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill(using: .copy)

    // Apple's squircle is close to 22% of the side; the inset keeps the mark
    // clear of the curve.
    let inset = size * 0.06
    let plate = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let radius = plate.width * 0.235

    NSColor(calibratedWhite: 0.039, alpha: 1).setFill()
    NSBezierPath(roundedRect: plate, xRadius: radius, yRadius: radius).fill()

    let usable = plate.width * 0.52
    let barWidth = usable * 0.13
    let gap = (usable - barWidth * CGFloat(bars.count)) / CGFloat(bars.count - 1)
    let startX = plate.midX - usable / 2

    for (index, fraction) in bars.enumerated() {
        let height = usable * fraction
        let rect = NSRect(
            x: startX + CGFloat(index) * (barWidth + gap),
            y: plate.midY - height / 2,
            width: barWidth,
            height: height
        )
        // Centre bar brightest, falling away to the edges — the same depth
        // gradient the bubble uses.
        NSColor(calibratedWhite: 0.96, alpha: 0.45 + fraction * 0.5).setFill()
        NSBezierPath(roundedRect: rect, xRadius: barWidth / 2, yRadius: barWidth / 2).fill()
    }

    return rep.representation(using: .png, properties: [:])
}

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Saynow.iconset"
try? FileManager.default.createDirectory(
    atPath: output, withIntermediateDirectories: true
)

let variants: [(CGFloat, String)] = [
    (16, "icon_16x16"), (32, "icon_16x16@2x"),
    (32, "icon_32x32"), (64, "icon_32x32@2x"),
    (128, "icon_128x128"), (256, "icon_128x128@2x"),
    (256, "icon_256x256"), (512, "icon_256x256@2x"),
    (512, "icon_512x512"), (1024, "icon_512x512@2x"),
]

for (size, name) in variants {
    guard let data = render(size: size) else {
        FileHandle.standardError.write("failed to render \(name)\n".data(using: .utf8)!)
        exit(1)
    }
    try? data.write(to: URL(fileURLWithPath: "\(output)/\(name).png"))
}
