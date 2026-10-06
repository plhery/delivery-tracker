import SwiftUI
import UIKit

/// The deliveries' own space: where a card stands in the list, wherever the list is scrolled.
enum DeliveryListSpace {
    static let name = "deliveries"
}

/// Where each card stands in the list, and the scroll view the list is drawn in. A card that
/// leaves for another place is first pictured as it shows, so that the picture can fly there.
@MainActor final class DeliveryCardPlaces {
    /// A card's frame in the list, and the middle of the parcel's name from the card's top.
    struct Place: Equatable {
        var frame: CGRect
        var title: CGFloat
    }

    private var frames: [UUID: CGRect] = [:]
    private var names: [UUID: CGFloat] = [:]
    /// Where Pip shows on the screen, and on whose card.
    private var pip: (id: UUID, frame: CGRect)?
    weak var scrollView: UIScrollView?

    func stand(_ id: UUID, at frame: CGRect) { frames[id] = frame }
    func name(_ id: UUID, at middle: CGFloat) { names[id] = middle }

    /// A card that leaves its place is asked again where it stands once it has another.
    func forget(_ id: UUID) {
        frames[id] = nil
        names[id] = nil
    }

    func place(of id: UUID) -> Place? {
        frames[id].map { Place(frame: $0, title: (names[id] ?? $0.midY) - $0.minY) }
    }

    /// The part of the list that shows.
    var visible: CGRect? {
        scrollView.map { CGRect(origin: $0.contentOffset, size: $0.bounds.size) }
    }

    func see(pip frame: CGRect, on id: UUID) { pip = (id, frame) }

    /// Where on the screen something comes out of a parcel's card: the mouth of Pip's box when he is on it,
    /// else the end of the card where its route and stamp are. Nil for a card whose place does not show.
    func mouth(of id: UUID) -> CGPoint? {
        guard let scrollView, let frame = frames[id], let visible else { return nil }
        let shown = scrollView.convert(scrollView.bounds, to: nil)
        if let pip, pip.id == id {
            let mouth = CGPoint(x: pip.frame.midX, y: pip.frame.minY + pip.frame.height * 0.38)
            if shown.contains(mouth) { return mouth }
        }
        let end = CGPoint(x: frame.maxX - 52, y: frame.minY + min(frame.height / 2, 64))
        return visible.contains(end) ? scrollView.convert(end, to: nil) : nil
    }

    /// A picture of what the list shows in `frame`.
    func picture(of frame: CGRect) -> UIImage? {
        guard let scrollView, frame.width >= 1, frame.height >= 1 else { return nil }
        let format = UIGraphicsImageRendererFormat.preferred()
        format.opaque = false
        return UIGraphicsImageRenderer(size: frame.size, format: format).image { context in
            context.cgContext.translateBy(x: scrollView.contentOffset.x - frame.minX, y: scrollView.contentOffset.y - frame.minY)
            scrollView.drawHierarchy(in: CGRect(origin: .zero, size: scrollView.bounds.size), afterScreenUpdates: false)
        }
    }
}

/// Finds the scroll view the list is drawn in.
struct DeliveryScrollProbe: UIViewRepresentable {
    let places: DeliveryCardPlaces

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.places = places
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        view.places = places
        view.find()
    }

    final class ProbeView: UIView {
        weak var places: DeliveryCardPlaces?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            find()
        }

        func find() {
            var view = superview
            while let current = view, !(current is UIScrollView) { view = current.superview }
            places?.scrollView = view as? UIScrollView
        }
    }
}

/// One card on its way to another place in the list.
struct DeliveredFlight: Identifiable {
    /// The parcel's.
    let id: UUID
    /// The parcel as it is now.
    let parcel: Parcel
    let was: DeliveryCardKind
    let becomes: DeliveryCardKind
    /// The card it was, as it showed.
    let picture: UIImage
    let from: DeliveryCardPlaces.Place
    /// Where the card it becomes stands, once the list has laid it out.
    var to: DeliveryCardPlaces.Place?
    /// A delivered parcel's card is carried over the others; the one that takes its place is not.
    let lifted: Bool
}

/// How a flying card changes on its way, from how far along its flight is.
struct DeliveredFlightPose: Equatable {
    var frame: CGRect
    var cornerRadius: CGFloat
    /// How far the card it was has slid, and how far the card it becomes still has to.
    var leaving: CGFloat
    var arriving: CGFloat
    /// How much of the card it becomes shows over the picture of the one it was.
    var arrival: CGFloat
    var shadow: CGFloat

    static func radius(of kind: DeliveryCardKind) -> CGFloat { kind == .next ? 24 : 16 }

    init(from: DeliveryCardPlaces.Place, to: DeliveryCardPlaces.Place, was: DeliveryCardKind, becomes: DeliveryCardKind, lifted: Bool, progress: CGFloat) {
        let part = { (value: CGFloat) in min(1, max(0, value)) }
        let ramp = { (value: CGFloat, start: CGFloat, end: CGFloat) in part((value - start) / (end - start)) }
        let between = { (start: CGFloat, end: CGFloat, share: CGFloat) in start + (end - start) * share }
        // A card that shrinks does so early in its flight and one that grows does so late, so two tall cards never cross.
        let share: CGFloat = to.frame.height < from.frame.height ? ramp(progress, 0, 0.72)
            : to.frame.height > from.frame.height ? ramp(progress, 0.28, 1) : part(progress)
        // The names stay on one line: each card slides by as much as the name stands higher or lower in it.
        let shift = from.title - to.title
        frame = CGRect(
            x: between(from.frame.minX, to.frame.minX, progress), y: between(from.frame.minY, to.frame.minY, progress),
            width: between(from.frame.width, to.frame.width, share), height: between(from.frame.height, to.frame.height, share)
        )
        cornerRadius = between(Self.radius(of: was), Self.radius(of: becomes), share)
        leaving = -shift * share
        arriving = shift * (1 - share)
        arrival = ramp(share, 0.2, 0.72)
        shadow = lifted ? min(ramp(progress, 0, 0.22), 1 - ramp(progress, 0.7, 1)) : 0
    }
}

// MARK: - Paper

/// Numbers that follow from a seed, so a burst can be told in advance.
struct SeededNumbers: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var mixed = state
        mixed = (mixed ^ (mixed >> 30)) &* 0xBF58_476D_1CE4_E5B9
        mixed = (mixed ^ (mixed >> 27)) &* 0x94D0_49BB_1331_11EB
        return mixed ^ (mixed >> 31)
    }
}

/// Paper thrown when a parcel has arrived: a sharp pop against the air, then a tumbling fall.
/// Where every piece is follows from where it came out, a seed and the time since.
struct DeliveredConfetti: Equatable {
    /// More paper from the large card than from a row of the list.
    static let next = 58, other = 38
    /// How many colours the paper comes in.
    static let tones = 7

    struct Piece: Equatable {
        var size: CGSize
        var round: Bool
        var tone: Int
        var angle: Double, speed: Double, drag: Double, life: Double, spin: Double
        var tumble: Double, sway: Double, beat: Double, phase: Double, delay: Double
    }

    /// A glint that flies out a little way and goes.
    struct Glint: Equatable {
        var size: Double, angle: Double, reach: Double, life: Double, delay: Double
        var tone: Int
    }

    struct Pose: Equatable {
        var center: CGPoint
        /// Its turn in degrees, and how much of its face shows as it tumbles.
        var turn: Double
        var scale: CGSize
        var opacity: Double
    }

    let origin: CGPoint
    let pieces: [Piece]
    let glints: [Glint]

    init(origin: CGPoint, count: Int, seed: UInt64) {
        var numbers = SeededNumbers(seed: seed)
        self.origin = origin
        pieces = (0..<count).map { _ in Piece(&numbers) }
        glints = (0..<6).map { Glint($0, &numbers) }
    }

    /// Seconds until the last piece has gone.
    var duration: Double {
        let paper: Double = pieces.map { $0.delay + $0.life }.max() ?? 0
        let stars: Double = glints.map { $0.delay + $0.life }.max() ?? 0
        return max(paper, stars)
    }

    /// Where a piece is so long after the burst; nil before it is thrown and once it has gone.
    func pose(of piece: Piece, at seconds: Double) -> Pose? {
        let time: Double = seconds - piece.delay
        guard time >= 0, time < piece.life else { return nil }
        let terminal: Double = 980 / piece.drag
        let slowed: Double = 1 - exp(-piece.drag * time)
        let thrown: Double = piece.speed * cos(piece.angle) / piece.drag * slowed
        let swayed: Double = piece.sway * sin(piece.beat * time + piece.phase) * min(1, time / 0.5)
        let risen: Double = (piece.speed * sin(piece.angle) - terminal) / piece.drag * slowed
        let fallen: Double = terminal * time
        let turn: Double = piece.spin * (1 - exp(-1.3 * time)) / 1.3
        let face: Double = cos(piece.tumble * time + piece.phase)
        let fade: Double = (1 - time / piece.life) / 0.3
        return Pose(
            center: CGPoint(x: Double(origin.x) + thrown + swayed, y: Double(origin.y) + fallen + risen),
            turn: turn, scale: CGSize(width: 1, height: face), opacity: min(1, time / 0.04, fade)
        )
    }

    private static let burst = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.2, y: 0.7), endControlPoint: UnitPoint(x: 0.3, y: 1))

    /// The same for a glint: out, a turn, and gone.
    func pose(of glint: Glint, at seconds: Double) -> Pose? {
        let time: Double = seconds - glint.delay
        guard time >= 0, time < glint.life else { return nil }
        let part: Double = Self.burst.value(at: time / glint.life)
        // It swells on the first part of its way, and shrinks to nothing on the rest.
        let early: Double = min(1, part / 0.45)
        let late: Double = max(0, (part - 0.45) / 0.55)
        let out: Double = glint.reach * (early * 0.7 + late * 0.3)
        let swell: Double = part < 0.45 ? early * 1.1 : 1.1 * (1 - late)
        return Pose(
            center: CGPoint(x: Double(origin.x) + cos(glint.angle) * out, y: Double(origin.y) + sin(glint.angle) * out),
            turn: early * 50 + late * 60, scale: CGSize(width: swell, height: swell), opacity: min(1, swell)
        )
    }
}

extension DeliveredConfetti.Piece {
    /// A dot, a streamer or a sheet, thrown up and out at its own speed.
    fileprivate init(_ numbers: inout SeededNumbers) {
        func next() -> Double { Double.random(in: 0..<1, using: &numbers) }
        let kind: Double = next()
        let width: Double = kind < 0.18 ? 5 + next() * 4 : kind < 0.36 ? 3 : 5 + next() * 6
        let height: Double = kind < 0.18 ? width : kind < 0.36 ? 11 + next() * 7 : width * (1.25 + next() * 0.8)
        size = CGSize(width: width, height: height)
        round = kind < 0.18
        tone = Int(next() * Double(DeliveredConfetti.tones))
        let degrees: Double = -90 + (next() - 0.5) * 140
        angle = degrees * .pi / 180
        speed = 430 + next() * 740
        drag = 2.5 + next() * 1.1
        life = 1.5 + next() * 0.8
        spin = (next() - 0.5) * 1500
        tumble = 7 + next() * 11
        sway = 5 + next() * 15
        beat = 3 + next() * 4
        phase = next() * 6.28
        delay = next() * 0.07
    }
}

extension DeliveredConfetti.Glint {
    /// The glints fan out above the box, each a little off its place in the fan.
    fileprivate init(_ index: Int, _ numbers: inout SeededNumbers) {
        func next() -> Double { Double.random(in: 0..<1, using: &numbers) }
        size = 9 + next() * 9
        let fan: Double = (Double(index) / 5 - 0.5) * 190
        let degrees: Double = -90 + fan + (next() - 0.5) * 18
        angle = degrees * .pi / 180
        reach = 30 + next() * 34
        life = 0.52 + next() * 0.18
        delay = next() * 0.08
        tone = index % 3 == 1 ? 2 : 0
    }
}

/// A burst of paper as the screen shows it: in a card's colours, since a moment.
struct DeliveredPaperBurst: Equatable {
    let confetti: DeliveredConfetti
    let colors: [Color]
    let started: Date

    /// The card's ink, its carrier's colour and the app's yellow, with a lighter and a deeper mix, and white.
    static func colors(ink: Color, surface: Color, brand: Color) -> [Color] {
        [ink, brand, Brand.accent, Brand.accent, ink.mix(with: surface, by: 0.45, in: .device),
         Brand.color(light: "#FFFFFF", dark: "#F5F6F2"), ink.mix(with: Brand.accent, by: 0.3, in: .device)]
    }

    func draw(_ context: GraphicsContext, at seconds: Double) {
        for piece in confetti.pieces {
            guard let pose = confetti.pose(of: piece, at: seconds), abs(pose.scale.height) > 0.02 else { continue }
            let box = CGRect(x: -piece.size.width / 2, y: -piece.size.height / 2, width: piece.size.width, height: piece.size.height)
            Self.place(context, pose).fill(piece.round ? Path(ellipseIn: box) : Path(roundedRect: box, cornerRadius: 1.5),
                                           with: .color(colors[piece.tone]))
        }
        for glint in confetti.glints {
            guard let pose = confetti.pose(of: glint, at: seconds), pose.scale.width > 0.02 else { continue }
            var star = Self.place(context, pose)
            star.scaleBy(x: glint.size / 2, y: glint.size / 2)
            star.fill(PipGeometry.glint, with: .color(colors[glint.tone]))
        }
    }

    private static func place(_ context: GraphicsContext, _ pose: DeliveredConfetti.Pose) -> GraphicsContext {
        var layer = context
        layer.opacity = max(0, pose.opacity)
        layer.translateBy(x: pose.center.x, y: pose.center.y)
        layer.rotate(by: .degrees(pose.turn))
        layer.scaleBy(x: pose.scale.width, y: pose.scale.height)
        return layer
    }
}

/// The paper, over the whole screen and never in the way of a finger.
struct DeliveredPaper: View {
    let burst: DeliveredPaperBurst?

    var body: some View {
        if let burst {
            GeometryReader { proxy in
                let corner = proxy.frame(in: .global).origin
                TimelineView(.animation) { timeline in
                    Canvas { context, _ in
                        // The burst is told where it is on the screen.
                        context.translateBy(x: -corner.x, y: -corner.y)
                        burst.draw(context, at: timeline.date.timeIntervalSince(burst.started))
                    }
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}
