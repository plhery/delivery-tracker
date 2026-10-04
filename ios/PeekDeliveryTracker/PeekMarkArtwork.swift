import CoreGraphics

/// The mark, two eyes on a postal-yellow tile, in a 512-unit frame. It is one drawing at every size.
/// Core Graphics only, so the app, the widget and the Share extension draw the same paths.
enum PeekMarkArtwork {
    static let frame: CGFloat = 512
    static let cornerRadius: CGFloat = 116

    struct Layer {
        let path: CGPath
        let color: CGColor
    }

    /// The rounded tile.
    static let tile = CGPath(roundedRect: CGRect(x: 0, y: 0, width: frame, height: frame),
                             cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)

    /// The fills of the drawing, back to front: the tile, the whites of both eyes, then the pupil and the
    /// catchlight of the left eye and of the right one. The whites overlap, so both lie under the pupils.
    static let layers: [Layer] = [Layer(path: tile, color: yellow)]
        + eyes.map { Layer(path: ellipse(190 + $0, 262, 70, 77), color: paper) }
        + eyes.flatMap(pupil)

    /// Draws the mark from the context's origin, with y pointing down.
    static func draw(in context: CGContext, size: CGFloat) {
        context.saveGState()
        context.scaleBy(x: size / frame, y: size / frame)
        for layer in layers {
            context.addPath(layer.path)
            context.setFillColor(layer.color)
            context.fillPath()
        }
        context.restoreGState()
    }

    // MARK: Parts

    private static let yellow = color(0xF3CF48)
    private static let paper = color(0xFFFAF0)
    private static let ink = color(0x171714)
    private static let white = color(0xFFFFFF)

    /// How far right of the left eye each eye stands.
    private static let eyes: [CGFloat] = [0, 132]

    /// The left eye's pupil, looking down to the right, and the catchlight at its upper left,
    /// moved right by a distance.
    private static func pupil(movedRight distance: CGFloat) -> [Layer] {
        [Layer(path: ellipse(219.4 + distance, 269, 35, 35), color: ink),
         Layer(path: ellipse(207.5 + distance, 255, 10.5, 10.5), color: white)]
    }

    private static func ellipse(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat) -> CGPath {
        CGPath(ellipseIn: CGRect(x: x - rx, y: y - ry, width: rx * 2, height: ry * 2), transform: nil)
    }

    private static func color(_ hex: UInt32) -> CGColor {
        CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
