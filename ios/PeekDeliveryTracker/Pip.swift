import SwiftUI

// MARK: - Mood

/// How Pip, the parcel with a face, feels about the parcel's stage.
enum PipMood: Equatable, Sendable, CaseIterable {
    case look, eager, wait, worry, joy

    /// A pending parcel has no map, so no Pip.
    init?(stage: TrackingStage?) {
        switch stage {
        case .registered, .accepted, .inTransit: self = .look
        case .outForDelivery: self = .eager
        case .customs, .readyForPickup: self = .wait
        case .failedAttempt, .exception, .returned: self = .worry
        case .delivered: self = .joy
        case .pending, nil: return nil
        }
    }

    /// Widths to try, largest first: he is bigger when the parcel has arrived, unless only a small Pip fits.
    var widths: [CGFloat] { self == .joy ? [66, 62, 54, 48] : [48, 44] }
}

/// Where a card wants Pip: beside the parcel's place, in this mood.
struct PipRequest: Equatable {
    var mood: PipMood
    /// Where the card's top row ends; the top inset when absent.
    var ceiling: CGFloat?
    /// Where the card starts writing over the bottom of the map; the map's bottom edge when absent.
    var floor: CGFloat?
}

/// Where Pip stands on a map.
struct PipPlacement: Equatable {
    /// The top left of his 300 × 310 frame, scaled to `width`.
    var origin: CGPoint
    var width: CGFloat
    var mood: PipMood
    /// Which side of him the parcel's dot is on: -1 to his left, 1 to his right, 0 straight above or below.
    var side: Int
    /// He stands straight below the dot, and looks up at it.
    var below: Bool
    /// What he takes on the map, for the names to keep off.
    var box: CGRect
}

// MARK: - Geometry

/// The box in its 300 × 310 frame, shared by the kraft parcel and by Pip on the card maps.
enum PipGeometry {
    static let frame = CGSize(width: 300, height: 310)
    /// Pip stands on this point of the frame.
    static let ground = CGPoint(x: 150, y: 282)
    /// How far an eager Pip is lifted off the ground.
    static let eagerLift: CGFloat = 16
    /// Where Pip may stand: his ground point, as offsets from the dot in Pip widths, best first.
    static let spots = [CGPoint(x: 0.66, y: 0.32), CGPoint(x: -0.66, y: 0.32), CGPoint(x: 0.62, y: -0.02), CGPoint(x: -0.62, y: -0.02),
                        CGPoint(x: 0.4, y: 0.78), CGPoint(x: -0.4, y: 0.78), CGPoint(x: 0, y: -0.26)]
    /// The last resort, straight below the dot: for a dot at the frame's edge, with its route and its name on the open sides.
    static let spotBelow = CGPoint(x: 0, y: 1.08)
    /// The left side's plane, where the face is drawn.
    static let facePlane = CGAffineTransform(a: 1, b: 0.505263, c: 0, d: 1, tx: 55, ty: 142)
    /// The right side's plane, where the carrier's label sits: just below where the open front flap reaches.
    static let labelPlane = CGAffineTransform(a: 1, b: -0.505263, c: 0, d: 1, tx: 160, ty: 209)

    /// The label's own measures, as the web draws it. A name or a number too long for its line is set narrower to fit.
    enum Label {
        static let size = CGSize(width: 74, height: 48)
        static let scale: CGFloat = 0.97
        static let cornerRadius: CGFloat = 2.5
        static let margin: CGFloat = 6
        /// The truck at half its size, and the name beside it.
        static let truck = CGPoint(x: 5, y: 5)
        static let nameStart = CGPoint(x: 23, y: 13)
        static let nameSize: CGFloat = 7
        /// The barcode's bars, down from 20 to 34.
        static let bars: [CGFloat] = [6, 8.2, 11.2, 12.8, 16.2, 18.2, 21.2, 22.6, 26.2, 28.2, 30.8, 32.6, 35.8, 37.8, 40.2, 43.2, 44.8]
        static let barWidth: CGFloat = 1.05
        static let numberBaseline: CGFloat = 43
        static let numberSize: CGFloat = 5.6
        static let numberSpacing: CGFloat = 0.3

        /// A point of the label, in Pip's frame.
        static func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x * scale, y: y * scale).applying(labelPlane)
        }
    }

    static let inside = points([(55, 142), (150, 95), (245, 142), (150, 190)])
    static let leftSide = points([(55, 142), (150, 190), (150, 277), (55, 229)])
    static let rightSide = points([(150, 190), (245, 142), (245, 229), (150, 277)])
    static let tape = points([(96, 122), (109, 115), (204, 163), (191, 170)])
    static let seam = points([(103, 119), (197, 166)])

    /// A flap closed on the box, and folded open on its hinge.
    struct Flap {
        let closed: [CGPoint]
        let opened: [CGPoint]
        /// A flap that swings up through upright to open, rather than folding straight over:
        /// how far it turns on its hinge, in degrees.
        var swing: CGFloat? = nil

        /// The flap part of the way open: 0 closed, 1 open, and a little more while it goes too far.
        func points(at progress: CGFloat) -> [CGPoint] {
            guard let swing else {
                return zip(closed, opened).map { from, to in
                    CGPoint(x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress)
                }
            }
            // Each corner turns about its end of the hinge: at a turn of `a` it stands at cos(a) of where
            // it lies closed, plus sin(a) of where it would stand upright.
            let full = swing * .pi / 180
            let turn = full * max(0, progress)
            let hinge = [closed[0], closed[1], closed[1], closed[0]]
            return closed.indices.map { index in
                let from = CGPoint(x: closed[index].x - hinge[index].x, y: closed[index].y - hinge[index].y)
                let to = CGPoint(x: opened[index].x - hinge[index].x, y: opened[index].y - hinge[index].y)
                let upright = CGPoint(x: (to.x - cos(full) * from.x) / sin(full), y: (to.y - cos(full) * from.y) / sin(full))
                return CGPoint(x: hinge[index].x + cos(turn) * from.x + sin(turn) * upright.x,
                               y: hinge[index].y + cos(turn) * from.y + sin(turn) * upright.y)
            }
        }
    }
    static let backLeft = Flap(closed: points([(55, 142), (150, 95), (190, 143), (95, 190)]),
                               opened: points([(55, 142), (150, 95), (112, 48), (17, 95)]))
    static let backRight = Flap(closed: points([(150, 95), (245, 142), (197.5, 166), (102.5, 118.5)]),
                                opened: points([(150, 95), (245, 142), (270, 88), (174.24, 41.32)]))
    // The front flaps rest just above level, clear of the sides: the left one is a brim over Pip's eyes.
    static let frontRight = Flap(closed: points([(245, 142), (150, 190), (102.5, 166), (197.5, 118.5)]),
                                 opened: points([(245, 142), (150, 190), (193, 189), (287.06, 141.26)]), swing: 154)
    static let frontLeft = Flap(closed: points([(55, 142), (150, 190), (197.5, 166), (102.5, 118.5)]),
                                opened: points([(55, 142), (150, 190), (107, 189), (12.94, 141.26)]), swing: 154)

    /// A flap thrown open goes a little too far, then settles: its share of the turn, over the time it is given.
    /// That time is a stretch of the box's opening, which is eased already, so the swing is spread wide over it.
    static func settle(_ progress: CGFloat) -> CGFloat {
        let swing = { (time: CGFloat) in 1 - exp(-5 * time) * cos(5.6 * time) }
        return swing(min(1, max(0, progress))) / swing(1)
    }

    /// The glints around an open box: where, and how wide.
    static let glints: [(center: CGPoint, size: CGFloat)] = [
        (CGPoint(x: 43, y: 96), 23), (CGPoint(x: 91, y: 57), 16), (CGPoint(x: 151, y: 36), 24),
        (CGPoint(x: 216, y: 55), 18), (CGPoint(x: 261, y: 96), 25), (CGPoint(x: 233, y: 145), 13),
    ]

    static var hairlines: Path {
        var path = Path()
        path.addLines(points([(56, 144), (56, 228), (149, 275)]))
        path.addLines(points([(151, 275), (243, 229), (243, 145)]))
        return path
    }

    static var edges: Path {
        var path = Path()
        path.addLines(points([(55, 142), (150, 190), (245, 142)]))
        path.addLines(points([(150, 190), (150, 277)]))
        return path
    }

    /// A four-pointed glint, one unit from its centre to its tips.
    static var glint: Path {
        polygon(points([(0, -1), (0.24, -0.24), (1, 0), (0.24, 0.24), (0, 1), (-0.24, 0.24), (-1, 0), (-0.24, -0.24)]))
    }

    static func polygon(_ points: [CGPoint]) -> Path {
        var path = Path()
        path.addLines(points)
        path.closeSubpath()
        return path
    }

    private static func points(_ pairs: [(Double, Double)]) -> [CGPoint] { pairs.map { CGPoint(x: $0.0, y: $0.1) } }

    private static let box = points([(55, 142), (150, 95), (245, 142), (245, 229), (150, 277), (55, 229)])
    private static let openBox = points([(17, 95), (91, 45), (151, 24), (216, 46), (274, 92), (288, 141), (245, 229), (150, 277), (55, 229), (12, 141)])
    private static let speedLines = CGRect(x: 0, y: 166, width: 44, height: 60)

    /// The frame's box that holds Pip: the box itself, its open flaps, or the speed lines trailing away from the dot.
    static func extents(_ mood: PipMood, side: Int) -> CGRect {
        switch mood {
        // The open flaps reach a little further than the box they are hinged on.
        case .joy: CGRect(x: 12, y: 24, width: 276, height: 264)
        case .eager: CGRect(x: side < 0 ? 52 : 0, y: 92 - eagerLift, width: 248, height: 196 + eagerLift)
        case .look, .wait, .worry: CGRect(x: 52, y: 92, width: 196, height: 196)
        }
    }

    /// What Pip actually covers, as convex outlines in the frame: the corners of his box are empty.
    static func outlines(_ mood: PipMood, side: Int) -> [[CGPoint]] {
        switch mood {
        case .joy: return [openBox]
        case .look, .wait, .worry: return [box]
        case .eager:
            let lines = speedLines.offsetBy(dx: side < 0 ? frame.width - speedLines.width : 0, dy: 0)
            return [box.map { CGPoint(x: $0.x, y: $0.y - eagerLift) },
                    [CGPoint(x: lines.minX, y: lines.minY), CGPoint(x: lines.maxX, y: lines.minY),
                     CGPoint(x: lines.maxX, y: lines.maxY), CGPoint(x: lines.minX, y: lines.maxY)]]
        }
    }

    /// How far a point is from a convex outline: 0 inside it.
    static func distance(from point: CGPoint, to outline: [CGPoint]) -> CGFloat {
        var nearest = CGFloat.infinity
        var turns = 0
        for (index, a) in outline.enumerated() {
            let b = outline[(index + 1) % outline.count]
            let cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
            turns += cross > 0 ? 1 : cross < 0 ? -1 : 0
            let length = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)
            let along = max(0, min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length > 0 ? length : 1)))
            nearest = min(nearest, hypot(point.x - a.x - along * (b.x - a.x), point.y - a.y - along * (b.y - a.y)))
        }
        // Inside, every edge turns the same way.
        return abs(turns) == outline.count ? 0 : nearest
    }
}

/// The carrier's label on the kraft parcel's right side, in place of the arrow and the seal:
/// whose parcel it is, and its number as the reader may see it.
struct PipLabel {
    let identity: CarrierVisualIdentity
    /// Whole or masked; none for a parcel whose number is not shown.
    var number: String?
}

// MARK: - Colours

/// Every colour Pip is drawn with: kraft paper, or a card's ink mixed toward its surface.
struct PipPalette {
    var inside: Color
    var right: Color
    var left: Color
    var backLeft: Color
    var backRight: Color
    var frontRight: Color
    var frontLeft: Color
    var tape: Color
    var seam: Color
    var hairline: Color
    var highlight: Color
    var eyeWhite: Color
    /// Pupils and mouth.
    var features: Color
    var catchlight: Color
    var blush: Color
    /// The three tones the glints alternate between.
    var glints: [Color]
    var shadow: Color
    var speedLines: Color

    static let kraft = PipPalette(
        inside: Color(hex: "#806345"), right: Color(hex: "#B78F66"), left: Color(hex: "#C9A47B"),
        backLeft: Color(hex: "#C4A078"), backRight: Color(hex: "#D8B997"), frontRight: Color(hex: "#D1AE85"),
        frontLeft: Color(hex: "#DDBD96"), tape: Color(hex: "#EBDDCA"), seam: Color(hex: "#AF9474"),
        hairline: Color(hex: "#987450"), highlight: Color(hex: "#FFF2CF"), eyeWhite: Color(hex: "#FFFDF6"),
        features: Color(hex: "#20251E"), catchlight: .white, blush: Color(hex: "#E9958F"),
        glints: [Color(hex: "#C99B35"), Color(hex: "#D6AE48"), Color(hex: "#B594BE")],
        shadow: .black.opacity(0.08), speedLines: Color(hex: "#B78F66").opacity(0.45)
    )

    /// The card's own colours. On a dark card the surface is the darker of the two, so the eyes keep
    /// their white and the pupils their depth.
    static func ink(_ ink: Color, on surface: Color, dark: Bool) -> PipPalette {
        let mix = { (amount: Double) in surface.mix(with: ink, by: amount, in: .device) }
        let deep = (dark ? surface : ink).mix(with: .black, by: 0.18, in: .device)
        let paper = (dark ? ink : surface).mix(with: .white, by: 0.62, in: .device)
        return PipPalette(
            inside: deep, right: mix(0.84), left: mix(0.56), backLeft: mix(0.62), backRight: mix(0.40),
            frontRight: mix(0.50), frontLeft: mix(0.36), tape: mix(0.20), seam: mix(0.70), hairline: ink,
            highlight: paper, eyeWhite: paper, features: deep, catchlight: paper,
            blush: mix(0.56).mix(with: Color(hex: "#F0707E"), by: 0.55, in: .device),
            glints: [ink, mix(0.72), mix(0.86)],
            shadow: dark ? .black.opacity(0.26) : deep.opacity(0.14), speedLines: ink.opacity(0.32)
        )
    }
}

// MARK: - Drawing

/// Draws Pip in his 300 × 310 frame: scale the context to the size wanted first.
enum PipArtwork {
    private static func flap(_ context: GraphicsContext, _ palette: PipPalette, _ paper: PipGeometry.Flap, _ color: Color, open: Bool) {
        let path = PipGeometry.polygon(open ? paper.opened : paper.closed)
        context.fill(path, with: .color(color))
        context.stroke(path, with: .color(palette.hairline.opacity(0.24)), lineWidth: 0.7)
    }

    /// The box up to its sides: closed, or with its rear flaps folded open. The face goes on next, then `frontFlaps`.
    static func box(_ context: GraphicsContext, _ palette: PipPalette, open: Bool) {
        context.fill(PipGeometry.polygon(PipGeometry.inside), with: .color(palette.inside))
        if open { flap(context, palette, PipGeometry.backLeft, palette.backLeft, open: open) }
        flap(context, palette, PipGeometry.backRight, palette.backRight, open: open)
        context.fill(PipGeometry.polygon(PipGeometry.leftSide), with: .color(palette.left))
        context.fill(PipGeometry.polygon(PipGeometry.rightSide), with: .color(palette.right))
        context.fill(PipGeometry.polygon(PipGeometry.leftSide), with: .color(palette.highlight.opacity(0.07)))
        context.stroke(PipGeometry.hairlines, with: .color(palette.hairline.opacity(0.25)), lineWidth: 0.8)
        context.stroke(PipGeometry.edges, with: .color(palette.highlight.opacity(0.4)), lineWidth: 1)
    }

    /// The front flaps, over the face: closed on the lid, or open just above level, the left one a brim over the eyes.
    static func frontFlaps(_ context: GraphicsContext, _ palette: PipPalette, open: Bool) {
        if open { flap(context, palette, PipGeometry.frontRight, palette.frontRight, open: open) }
        flap(context, palette, PipGeometry.frontLeft, palette.frontLeft, open: open)
    }

    /// The carrier's label on the box's right side: its truck, its name in its own colour, a barcode and the
    /// tracking number. The label's paper is light in either appearance, so the name takes the brand's light colour.
    static func label(_ context: GraphicsContext, _ label: PipLabel) {
        let measures = PipGeometry.Label.self
        let ink = Color(hex: "#20251E")
        var paper = context
        paper.concatenate(PipGeometry.labelPlane)
        paper.scaleBy(x: measures.scale, y: measures.scale)
        paper.fill(Path(roundedRect: CGRect(origin: .zero, size: measures.size), cornerRadius: measures.cornerRadius),
                   with: .color(Color(hex: "#FFFEFA")))
        var truck = paper
        truck.translateBy(x: measures.truck.x, y: measures.truck.y)
        truck.scaleBy(x: 0.5, y: 0.5)
        CarrierTruckGeometry.draw(truck, label.identity)
        let name = Text(label.identity.name)
            .font(.system(size: measures.nameSize, weight: .heavy))
            .italic(label.identity.family == "dhl")
            .foregroundStyle(Color(hex: label.identity.colors[4]))
        line(paper, name, from: measures.nameStart, room: measures.size.width - measures.nameStart.x - 4)
        var bars = Path()
        for x in measures.bars {
            bars.move(to: CGPoint(x: x, y: 20))
            bars.addLine(to: CGPoint(x: x, y: 34))
        }
        paper.stroke(bars, with: .color(ink), lineWidth: measures.barWidth)
        if let number = label.number?.nonEmpty {
            let digits = Text(number)
                .font(.system(size: measures.numberSize, design: .monospaced))
                .kerning(measures.numberSpacing)
                .foregroundStyle(ink)
            line(paper, digits, from: CGPoint(x: measures.margin, y: measures.numberBaseline), room: measures.size.width - 2 * measures.margin)
        }
    }

    /// One line of the label, from the start of its baseline, set narrower when it is too long for its room.
    private static func line(_ context: GraphicsContext, _ text: Text, from start: CGPoint, room: CGFloat) {
        let resolved = context.resolve(text)
        let size = resolved.measure(in: CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
        var line = context
        line.translateBy(x: start.x, y: start.y - resolved.firstBaseline(in: size))
        if size.width > room { line.scaleBy(x: room / size.width, y: 1) }
        line.draw(resolved, in: CGRect(origin: .zero, size: size))
    }

    /// The tape and its dashed seam, across a closed box.
    static func tape(_ context: GraphicsContext, _ palette: PipPalette) {
        context.fill(PipGeometry.polygon(PipGeometry.tape), with: .color(palette.tape))
        var seam = Path()
        seam.addLines(PipGeometry.seam)
        context.stroke(seam, with: .color(palette.seam.opacity(0.6)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
    }

    /// Pip in a card's ink, with the face and the pose of his mood. `time` moves him; nil keeps him still.
    static func ink(_ context: GraphicsContext, _ palette: PipPalette, mood: PipMood, side: Int, below: Bool, time: Double?) {
        let eager = mood == .eager
        let open = mood == .joy
        context.fill(Path(ellipseIn: CGRect(x: 150 - (eager ? 69 : 84), y: 276, width: eager ? 138 : 168, height: 20)),
                     with: .color(palette.shadow))
        if eager {
            // He hurries toward the dot, so his speed lines trail on the far side.
            var lines = Path()
            for (from, to, y) in [(14.0, 40.0, 170.0), (2, 36, 196), (18, 40, 222)] {
                let mirrored = side < 0
                lines.move(to: CGPoint(x: mirrored ? PipGeometry.frame.width - from : from, y: y))
                lines.addLine(to: CGPoint(x: mirrored ? PipGeometry.frame.width - to : to, y: y))
            }
            context.stroke(lines, with: .color(palette.speedLines), style: StrokeStyle(lineWidth: 7, lineCap: .round))
        }

        var body = context
        // Lifted and tilted as the mood has it, then moved about the bottom of the box.
        body.translateBy(x: 0, y: eager ? -PipGeometry.eagerLift : 0)
        body.concatenate(rotation(degrees: eager ? -5 : mood == .worry ? 3 : 0, around: CGPoint(x: 150, y: 230)))
        if let time { body.concatenate(motion(mood, at: time)) }

        box(body, palette, open: open)
        var face = body
        face.concatenate(PipGeometry.facePlane)
        inkFace(face, palette, mood: mood, side: side, below: below)
        frontFlaps(body, palette, open: open)
        if open {
            for (index, glint) in PipGeometry.glints.enumerated() {
                let twinkle = time.map { Self.twinkle(index, at: $0) } ?? (opacity: 1, scale: 1, degrees: 0)
                var star = body
                star.opacity = twinkle.opacity
                star.concatenate(CGAffineTransform(translationX: glint.center.x, y: glint.center.y)
                    .rotated(by: twinkle.degrees * .pi / 180)
                    .scaledBy(x: glint.size / 2 * twinkle.scale, y: glint.size / 2 * twinkle.scale))
                star.fill(PipGeometry.glint, with: .color(palette.glints[[0, 1, 0, 2, 1, 0][index]]))
            }
        } else {
            tape(body, palette)
        }
    }

    /// The kraft parcel at sticker size: closed and still, with a face large enough to read,
    /// and its carrier's label when it has one.
    static func sticker(_ context: GraphicsContext, label: PipLabel? = nil) {
        box(context, .kraft, open: false)
        if let label { Self.label(context, label) }
        kraftFace(context, k: 1.3, happy: 0)
        frontFlaps(context, .kraft, open: false)
        tape(context, .kraft)
    }

    /// The kraft parcel's face. `k` scales the features: 1 at full size, larger on a small parcel.
    /// `happy` turns the open eyes into arcs as the box opens. `blink` is the time on the blink's clock;
    /// nil keeps the eyes open. `smile` fades the mouth, which a gift's ribbon runs over.
    static func kraftFace(_ context: GraphicsContext, k: CGFloat, look: CGPoint = CGPoint(x: 0.5, y: -0.2), happy: Double, blink: Double? = nil, smile: Double = 1) {
        var face = context
        face.concatenate(PipGeometry.facePlane)
        let palette = PipPalette.kraft
        for (index, x) in [48 - 15.5 * k, 48 + 15.5 * k].enumerated() {
            if happy < 1 {
                var eye = face
                eye.opacity = 1 - happy
                if let blink {
                    // The white, the pupil and the catchlight close together, about the eye's own centre.
                    eye.translateBy(x: 0, y: 36)
                    eye.scaleBy(x: 1, y: PipBlink.eyeScale(at: blink, eye: index))
                    eye.translateBy(x: 0, y: -36)
                }
                eye.fill(ellipse(x, 36, 10 * k, 11.5 * k), with: .color(palette.eyeWhite))
                eye.fill(ellipse(x + look.x * 7 * k, 36 + look.y * 7 * k, 5.4 * k, 5.4 * k), with: .color(palette.features))
                eye.fill(ellipse(x + (look.x * 7 - 1.8) * k, 36 + (look.y * 7 - 2) * k, 1.6 * k, 1.6 * k), with: .color(palette.catchlight))
            }
            if happy > 0 {
                var arc = Path()
                arc.move(to: CGPoint(x: x - 8 * k, y: 36 + 3 * k))
                arc.addQuadCurve(to: CGPoint(x: x + 8 * k, y: 36 + 3 * k), control: CGPoint(x: x, y: 36 - 8 * k))
                var eye = face
                eye.opacity = happy
                eye.stroke(arc, with: .color(palette.features), style: StrokeStyle(lineWidth: 3 * k, lineCap: .round))
            }
            face.fill(ellipse(x - 1, 36 + 15 * k, 6.5 * k, 3.2 * k), with: .color(palette.blush.opacity(0.55)))
        }
        guard smile > 0 else { return }
        let mouth = 47 + 4 * k
        var curve = Path()
        curve.move(to: CGPoint(x: 48 - 6 * k, y: mouth))
        curve.addQuadCurve(to: CGPoint(x: 48 + 6 * k, y: mouth), control: CGPoint(x: 48, y: mouth + 7 * k))
        face.opacity = smile
        face.stroke(curve, with: .color(palette.features), style: StrokeStyle(lineWidth: 2.4 * k, lineCap: .round))
    }

    /// A gift's ribbon: over the lid and down both sides, between Pip's eyes, tied in a bow.
    static func ribbon(_ context: GraphicsContext) {
        var bands = Path()
        var sheen = Path()
        for (from, to) in [(CGPoint(x: 102.5, y: 118.5), CGPoint(x: 197.5, y: 166)), (CGPoint(x: 197.5, y: 118.5), CGPoint(x: 102.5, y: 166))] {
            bands.move(to: from)
            bands.addLine(to: to)
            sheen.move(to: from)
            sheen.addLine(to: to)
        }
        for x in [102.5, 197.5] {
            bands.move(to: CGPoint(x: x, y: 166))
            bands.addLine(to: CGPoint(x: x, y: 253))
        }
        context.stroke(bands, with: .color(Color(hex: "#A286B5")), lineWidth: 9)
        context.stroke(sheen, with: .color(Color(hex: "#CDB8DB").opacity(0.7)), lineWidth: 2)

        let knot = CGPoint(x: 150, y: 142)
        var loops = Path()
        for side in [-1.0, 1.0] {
            loops.move(to: knot)
            loops.addCurve(to: CGPoint(x: 150 + 26 * side, y: 142), control1: CGPoint(x: 150 + 14 * side, y: 126), control2: CGPoint(x: 150 + 34 * side, y: 130))
            loops.addCurve(to: knot, control1: CGPoint(x: 150 + 21 * side, y: 149), control2: CGPoint(x: 150 + 6 * side, y: 146))
            loops.closeSubpath()
        }
        context.fill(loops, with: .color(Color(hex: "#B99BCB")))
        context.stroke(loops, with: .color(Color(hex: "#7C6787").opacity(0.5)), lineWidth: 1)
        var tails = Path()
        tails.move(to: knot)
        tails.addCurve(to: CGPoint(x: 130, y: 164), control1: CGPoint(x: 144, y: 152), control2: CGPoint(x: 138, y: 160))
        tails.move(to: knot)
        tails.addCurve(to: CGPoint(x: 172, y: 162), control1: CGPoint(x: 156, y: 152), control2: CGPoint(x: 163, y: 159))
        context.stroke(tails, with: .color(Color(hex: "#A286B5")), style: StrokeStyle(lineWidth: 5, lineCap: .round))
        context.fill(ellipse(knot.x, knot.y, 6, 4.5), with: .color(Color(hex: "#8E6FA3")))
    }

    // The ink face is drawn at card size: eyes 21.75 either side of the middle, at 33 down the side.
    private static let eyes: [CGFloat] = [26.25, 69.75]
    private static let eyeLevel: CGFloat = 33

    private static func inkFace(_ face: GraphicsContext, _ palette: PipPalette, mood: PipMood, side: Int, below: Bool) {
        let features = GraphicsContext.Shading.color(palette.features)
        let round = { (width: CGFloat) in StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round) }
        // In these moods he watches the dot: sideways, or straight up or down when he stands below or above it.
        let toward = { (y: CGFloat) in side == 0 ? CGPoint(x: 0, y: below ? -0.45 : 0.3) : CGPoint(x: 0.44 * CGFloat(side), y: y) }
        let openEyes = { (rx: CGFloat, ry: CGFloat, pupil: CGFloat, look: CGPoint) in
            for x in eyes {
                let center = CGPoint(x: x + look.x * 10.5, y: eyeLevel + look.y * 10.5)
                face.fill(ellipse(x, eyeLevel, rx, ry), with: .color(palette.eyeWhite))
                face.fill(ellipse(center.x, center.y, pupil, pupil), with: features)
                face.fill(ellipse(center.x - 2.7, center.y - 3, 2.4, 2.4), with: .color(palette.catchlight))
            }
        }
        let blush = {
            for x in eyes { face.fill(ellipse(x - 1, 55.5, 9.75, 4.8), with: .color(palette.blush.opacity(0.55))) }
        }
        // An open mouth with its tongue: the corners, how deep it opens, and where the tongue sits.
        let openMouth = { (half: CGFloat, top: CGFloat, depth: CGFloat, line: CGFloat, tongue: (half: CGFloat, y: CGFloat, above: CGFloat, under: CGFloat)) in
            var mouth = Path()
            mouth.move(to: CGPoint(x: 48 - half, y: top))
            mouth.addQuadCurve(to: CGPoint(x: 48 + half, y: top), control: CGPoint(x: 48, y: depth))
            mouth.closeSubpath()
            face.fill(mouth, with: features)
            face.stroke(mouth, with: features, style: round(line))
            var shape = Path()
            shape.move(to: CGPoint(x: 48 - tongue.half, y: tongue.y))
            shape.addQuadCurve(to: CGPoint(x: 48 + tongue.half, y: tongue.y), control: CGPoint(x: 48, y: tongue.above))
            shape.addQuadCurve(to: CGPoint(x: 48 - tongue.half, y: tongue.y), control: CGPoint(x: 48, y: tongue.under))
            face.fill(shape, with: .color(palette.blush))
        }
        let curve = { (from: CGPoint, control: CGPoint, to: CGPoint, width: CGFloat) in
            var path = Path()
            path.move(to: from)
            path.addQuadCurve(to: to, control: control)
            face.stroke(path, with: features, style: round(width))
        }
        let line = { (from: CGPoint, to: CGPoint) in
            var path = Path()
            path.move(to: from)
            path.addLine(to: to)
            face.stroke(path, with: features, style: round(3.6))
        }
        switch mood {
        case .look:
            openEyes(15, 17.25, 8.1, toward(0.06))
            curve(CGPoint(x: 39, y: 57), CGPoint(x: 48, y: 67.5), CGPoint(x: 57, y: 57), 3.6)
        case .eager:
            openEyes(17.25, 19.5, 6.3, toward(-0.12))
            blush()
            openMouth(10.5, 55.5, 72, 2.4, (5.4, 63.9, 60.3, 68.1))
        case .wait:
            openEyes(15, 17.25, 8.1, CGPoint(x: -0.24, y: -0.52))
            line(CGPoint(x: 41.25, y: 59.25), CGPoint(x: 54.75, y: 59.25))
        case .worry:
            openEyes(15, 17.25, 8.1, CGPoint(x: 0, y: 0.16))
            line(CGPoint(x: 12.75, y: 9), CGPoint(x: 36.75, y: 8.5))
            line(CGPoint(x: 56.25, y: 7), CGPoint(x: 80.25, y: 4.5))
            curve(CGPoint(x: 39, y: 60), CGPoint(x: 48, y: 55), CGPoint(x: 57, y: 60), 3.6)
        case .joy:
            for x in eyes {
                curve(CGPoint(x: x - 12, y: 37.5), CGPoint(x: x, y: 21), CGPoint(x: x + 12, y: 37.5), 4.5)
            }
            blush()
            openMouth(14.25, 53.25, 78, 2.7, (6.9, 66, 61.5, 71.4))
        }
    }

    private static func ellipse(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: x - rx, y: y - ry, width: rx * 2, height: ry * 2))
    }

    private static func rotation(degrees: Double, around pivot: CGPoint) -> CGAffineTransform {
        CGAffineTransform(translationX: pivot.x, y: pivot.y).rotated(by: degrees * .pi / 180).translatedBy(x: -pivot.x, y: -pivot.y)
    }

    private static let spring = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.22, y: 1), endControlPoint: UnitPoint(x: 0.36, y: 1))

    /// How the mood moves him, about the bottom of the box: an eager bob, or a joyful jump.
    static func motion(_ mood: PipMood, at time: Double) -> CGAffineTransform {
        // Rise, turn in degrees, and stretch across and up.
        var pose: (rise: Double, turn: Double, across: Double, up: Double) = (0, 0, 1, 1)
        switch mood {
        case .eager:
            let phase = (time / 1.1).truncatingRemainder(dividingBy: 1)
            let swing = UnitCurve.easeInOut.value(at: phase < 0.5 ? phase * 2 : (1 - phase) * 2)
            pose = (-3 * swing, -2 + 4.5 * swing, 1, 1)
        case .joy:
            let keys: [(at: Double, rise: Double, turn: Double, across: Double, up: Double)] = [
                (0, 0, 0, 1, 1), (0.12, 0, 0, 1.07, 0.9), (0.28, -10, -5, 0.96, 1.05), (0.44, 0, 2, 1.05, 0.95), (0.58, 0, 0, 1, 1), (1, 0, 0, 1, 1),
            ]
            let phase = (time / 2.2).truncatingRemainder(dividingBy: 1)
            let next = keys.firstIndex { $0.at > phase } ?? keys.count - 1
            let from = keys[next - 1], to = keys[next]
            let t = spring.value(at: (phase - from.at) / (to.at - from.at))
            pose = (from.rise + (to.rise - from.rise) * t, from.turn + (to.turn - from.turn) * t,
                    from.across + (to.across - from.across) * t, from.up + (to.up - from.up) * t)
        case .look, .wait, .worry:
            return .identity
        }
        let pivot = CGPoint(x: 150, y: 277)
        return CGAffineTransform(translationX: pivot.x, y: pivot.y + pose.rise)
            .rotated(by: pose.turn * .pi / 180)
            .scaledBy(x: pose.across, y: pose.up)
            .translatedBy(x: -pivot.x, y: -pivot.y)
    }

    /// Each glint twinkles on its own clock.
    private static func twinkle(_ index: Int, at time: Double) -> (opacity: Double, scale: CGFloat, degrees: Double) {
        let period = 2.2 + Double(index % 3) * 0.5
        let phase = ((time - Double(index) * 0.37) / period).truncatingRemainder(dividingBy: 1)
        let wrapped = phase < 0 ? phase + 1 : phase
        let glow = UnitCurve.easeInOut.value(at: wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2)
        return (0.2 + 0.8 * glow, 0.6 + 0.5 * glow, -10 + 18 * glow)
    }
}

// MARK: - Blink

/// The kraft parcel blinks while it waits: once a period, each open eye flattens and reopens.
enum PipBlink {
    static let period = 4.6
    /// How tall a closed eye is, as a share of the open one.
    static let closed = 0.08
    /// The second eye follows the first.
    static let lag = 0.02
    /// The share of the period after which the eyes start to close, and the one at which they are closed.
    private static let closing = 0.93, shut = 0.96
    private static let frame = 1.0 / 60

    /// How tall an eye is, `time` seconds on the blink's clock: 1 when open.
    static func eyeScale(at time: Double, eye: Int = 0) -> Double {
        let local = time - Double(eye) * lag
        guard local > 0 else { return 1 }
        let phase = (local / period).truncatingRemainder(dividingBy: 1)
        if phase <= closing { return 1 }
        if phase < shut { return 1 - (1 - closed) * UnitCurve.easeInOut.value(at: (phase - closing) / (shut - closing)) }
        return closed + (1 - closed) * UnitCurve.easeInOut.value(at: (phase - shut) / (1 - shut))
    }

    /// When the eyes next need drawing after `time`: every frame of a blink, and nothing between two blinks.
    static func nextFrame(after time: Double) -> Double {
        let time = max(0, time)
        let cycle = (time / period).rounded(.down)
        // The second eye is still reopening as the next period starts.
        let reopened = cycle * period + lag
        if cycle > 0, time < reopened { return min(time + frame, reopened) }
        let closes = (cycle + closing) * period
        return time < closes ? closes : min(time + frame, (cycle + 1) * period + lag)
    }
}

/// Wakes a timeline for the frames of each blink only.
struct PipBlinkSchedule: TimelineSchedule {
    /// When the blink's clock started.
    let start: Date
    var paused = false

    func entries(from startDate: Date, mode: TimelineScheduleMode) -> Entries {
        Entries(start: start, time: max(0, startDate.timeIntervalSince(start)), still: paused || mode == .lowFrequency)
    }

    struct Entries: Sequence, IteratorProtocol {
        let start: Date
        var time: Double
        let still: Bool
        private var begun = false

        init(start: Date, time: Double, still: Bool) {
            self.start = start
            self.time = time
            self.still = still
        }

        mutating func next() -> Date? {
            if !begun { begun = true }
            else if still { return nil }
            else { time = PipBlink.nextFrame(after: time) }
            return start.addingTimeInterval(time)
        }
    }
}

// MARK: - Views

/// The kraft parcel's face at full size, in Pip's 300 × 310 frame. Its open eyes blink while it waits;
/// the happy arcs don't, and nothing does when motion is reduced.
struct KraftPipFace: View {
    /// 0 for open eyes, 1 for happy arcs.
    var happy: Double
    /// How much of the mouth shows: none under a gift's ribbon.
    var smile: Double = 1

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = Date()

    var body: some View {
        let blinks = !reduceMotion && happy == 0
        TimelineView(PipBlinkSchedule(start: appeared, paused: !blinks)) { timeline in
            let blink = blinks ? timeline.date.timeIntervalSince(appeared) : nil
            Canvas { context, _ in
                PipArtwork.kraftFace(context, k: 1, happy: happy, blink: blink, smile: smile)
            }
        }
        .frame(width: PipGeometry.frame.width, height: PipGeometry.frame.height)
    }
}

/// Pip in the card's own ink, beside the parcel's place on its map. Decorative.
struct InkPip: View {
    let mood: PipMood
    let side: Int
    let below: Bool
    let ink: Color
    let surface: Color

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arrived = false

    var body: some View {
        let palette = PipPalette.ink(ink, on: surface, dark: colorScheme == .dark)
        let moves = !reduceMotion && (mood == .eager || mood == .joy)
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !moves)) { timeline in
            Canvas { context, size in
                context.scaleBy(x: size.width / PipGeometry.frame.width, y: size.width / PipGeometry.frame.width)
                PipArtwork.ink(context, palette, mood: mood, side: side, below: below,
                               time: moves ? timeline.date.timeIntervalSinceReferenceDate : nil)
            }
        }
        .aspectRatio(PipGeometry.frame.width / PipGeometry.frame.height, contentMode: .fit)
        // He fades in while rising into place.
        .opacity(arrived ? 1 : 0)
        .offset(y: arrived || reduceMotion ? 0 : 7)
        .onAppear { withAnimation(reduceMotion ? nil : .spring(duration: 0.6)) { arrived = true } }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The kraft parcel at sticker size, cropped to the box. Decorative.
struct SmallPip: View {
    /// The carrier's label on its right side, for a parcel whose carrier is known.
    var label: PipLabel? = nil

    private static let crop = CGRect(x: 48, y: 88, width: 204, height: 196)

    var body: some View {
        Canvas { context, size in
            let scale = size.width / Self.crop.width
            context.scaleBy(x: scale, y: scale)
            context.translateBy(x: -Self.crop.minX, y: -Self.crop.minY)
            PipArtwork.sticker(context, label: label)
        }
        .aspectRatio(Self.crop.width / Self.crop.height, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
