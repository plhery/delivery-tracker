import CoreGraphics

/// Which drawing of the mark a rendered size gets: the smaller it is, the less it carries.
enum PeekMarkVariant: CaseIterable, Sendable {
    /// Only the eyes over the rim and the lid.
    case glyph
    /// No tape and no label, with bigger eyes.
    case simple
    /// The taped box.
    case full
    /// The taped box with its address label, at icon sizes.
    case fullWithLabel

    init(size: CGFloat) {
        if size < 24 { self = .glyph }
        else if size <= 40 { self = .simple }
        else if size < 128 { self = .full }
        else { self = .fullWithLabel }
    }
}

/// The mark, a parcel peeking over its rim on a postal-yellow tile, in a 512-unit frame.
/// Core Graphics only, so the app, the widget and the Share extension draw the same paths.
enum PeekMarkArtwork {
    static let frame: CGFloat = 512
    static let cornerRadius: CGFloat = 116

    struct Layer {
        let path: CGPath
        let color: CGColor
    }

    /// The rounded tile. Everything is clipped to it.
    static let tile = CGPath(roundedRect: CGRect(x: 0, y: 0, width: frame, height: frame),
                             cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)

    /// The fills of a drawing, back to front: the tile, the dark inside, the eyes, the box front
    /// over the bottom of the eyes, then the lid over their top.
    static func layers(_ variant: PeekMarkVariant) -> [Layer] {
        switch variant {
        case .glyph: glyph
        case .simple: simple
        case .full: full
        case .fullWithLabel: fullWithLabel
        }
    }

    /// Draws the mark from the context's origin, with y pointing down.
    static func draw(_ variant: PeekMarkVariant, in context: CGContext, size: CGFloat) {
        context.saveGState()
        context.scaleBy(x: size / frame, y: size / frame)
        context.addPath(tile)
        context.clip()
        for layer in layers(variant) {
            context.addPath(layer.path)
            context.setFillColor(layer.color)
            context.fillPath()
        }
        context.restoreGState()
    }

    // MARK: Drawings

    private static let glyph: [Layer] = [Layer(path: tile, color: yellow),
                                         Layer(path: polygon([(60, 150), (452, 70), (452, 330), (60, 330)]), color: inside)]
        + eye(176, 300, white: (84, 89.9), pupil: (28.6, 8.4, 43.7), catchlight: (13.4, -8.4, 13.4))
        + eye(336, 290, white: (84, 89.9), pupil: (28.6, 8.4, 43.7), catchlight: (13.4, -8.4, 13.4))
        + [Layer(path: CGPath(rect: CGRect(x: 40, y: 330, width: 432, height: 182), transform: nil), color: paper),
           Layer(path: polygon([(29.0, 94.5), (447.2, 13.2), (462.5, 91.8), (44.3, 173.1)]), color: lid)]

    private static let simple: [Layer] = opening
        + eye(196, 268, white: (66, 70.6), pupil: (22.4, 6.6, 34.3), catchlight: (10.6, -6.6, 10.6))
        + eye(316, 262, white: (66, 70.6), pupil: (22.4, 6.6, 34.3), catchlight: (10.6, -6.6, 10.6))
        + [Layer(path: front, color: paper)]
        + softened(polygon([(59.4, 128.3), (378.9, 12.1), (403.5, 79.7), (84.0, 196.0)]))

    private static let full = taped(label: false)
    private static let fullWithLabel = taped(label: true)

    private static func taped(label: Bool) -> [Layer] {
        var layers = opening
            + eye(196, 268, white: (58, 62.1), pupil: (19.7, 5.8, 30.2), catchlight: (9.3, -5.8, 9.3))
            + eye(316, 262, white: (58, 62.1), pupil: (19.7, 5.8, 30.2), catchlight: (9.3, -5.8, 9.3))
            + [Layer(path: front, color: paper),
               Layer(path: CGPath(rect: CGRect(x: 236, y: 300, width: 40, height: 150), transform: nil), color: frontTape)]
        if label {
            let lines = CGMutablePath()
            lines.addLines(between: [CGPoint(x: 304, y: 381), CGPoint(x: 364, y: 381)])
            lines.addLines(between: [CGPoint(x: 304, y: 398), CGPoint(x: 342, y: 398)])
            layers += [Layer(path: CGPath(roundedRect: CGRect(x: 286, y: 362, width: 104, height: 54),
                                          cornerWidth: 10, cornerHeight: 10, transform: nil), color: ink),
                       Layer(path: lines.copy(strokingWithWidth: 9, lineCap: .round, lineJoin: .round, miterLimit: 10), color: yellow)]
        }
        return layers
            + softened(polygon([(61.8, 127.5), (385.1, 22.5), (407.4, 90.9), (84.0, 196.0)]))
            + [Layer(path: polygon([(206.3, 80.6), (244.4, 68.2), (266.6, 136.7), (228.6, 149.0)]), color: lidTape)]
    }

    // MARK: Parts

    private static let yellow = color(0xF3CF48)
    private static let inside = color(0x2B241B)
    private static let paper = color(0xFFFAF0)
    private static let ink = color(0x171714)
    private static let white = color(0xFFFFFF)
    private static let lid = color(0xF1E9E0)
    private static let frontTape = color(0xECE3D6)
    private static let lidTape = color(0xE0D5C8)

    /// The tile and the dark inside of the box, as the larger drawings share them.
    private static let opening = [Layer(path: tile, color: yellow),
                                  Layer(path: polygon([(92, 180), (420, 95), (420, 310), (92, 310)]), color: inside)]
    private static let front = CGPath(roundedRect: CGRect(x: 72, y: 300, width: 368, height: 150),
                                      cornerWidth: 36, cornerHeight: 36, transform: nil)

    /// An eye: its white, then the pupil and the catchlight as offsets from its centre with their radii.
    private static func eye(_ x: CGFloat, _ y: CGFloat, white radii: (CGFloat, CGFloat),
                            pupil: (CGFloat, CGFloat, CGFloat), catchlight: (CGFloat, CGFloat, CGFloat)) -> [Layer] {
        [Layer(path: ellipse(x, y, radii.0, radii.1), color: paper),
         Layer(path: ellipse(x + pupil.0, y + pupil.1, pupil.2, pupil.2), color: ink),
         Layer(path: ellipse(x + catchlight.0, y + catchlight.1, catchlight.2, catchlight.2), color: white)]
    }

    /// The lid with its corners rounded by 20 units.
    private static func softened(_ path: CGPath) -> [Layer] {
        [Layer(path: path, color: lid),
         Layer(path: path.copy(strokingWithWidth: 40, lineCap: .round, lineJoin: .round, miterLimit: 10), color: lid)]
    }

    private static func polygon(_ points: [(CGFloat, CGFloat)]) -> CGPath {
        let path = CGMutablePath()
        path.addLines(between: points.map { CGPoint(x: $0.0, y: $0.1) })
        path.closeSubpath()
        return path
    }

    private static func ellipse(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat) -> CGPath {
        CGPath(ellipseIn: CGRect(x: x - rx, y: y - ry, width: rx * 2, height: ry * 2), transform: nil)
    }

    private static func color(_ hex: UInt32) -> CGColor {
        CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
