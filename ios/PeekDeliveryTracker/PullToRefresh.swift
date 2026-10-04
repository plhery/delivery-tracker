import SwiftUI
import UIKit

/// What the list's scroll view reports for pull-to-refresh. It only changes
/// while the content is pulled below the top or the top inset moves, so
/// ordinary scrolling does no work.
struct PullGeometry: Equatable {
    var overscroll: CGFloat
    var inset: CGFloat
    var height: CGFloat

    init(overscroll: CGFloat, inset: CGFloat, height: CGFloat) {
        self.overscroll = overscroll
        self.inset = inset
        self.height = height
    }

    init(_ geometry: ScrollGeometry) {
        self.init(
            overscroll: max(0, -(geometry.contentOffset.y + geometry.contentInsets.top)),
            inset: geometry.contentInsets.top,
            height: geometry.containerSize.height
        )
    }
}

/// Pull-to-refresh state shared by the list, which drives it, and the seal,
/// the only view that reads the pull distance on every frame.
@MainActor @Observable
final class PullToRefreshModel {
    enum Phase: Equatable { case idle, refreshing, settling }
    enum Result: Equatable { case succeeded, failed }

    private(set) var phase = Phase.idle
    private(set) var result: Result?
    /// How far the content sits below its resting position.
    private(set) var distance: CGFloat = 0
    /// The system starts refreshing after a pull of about a fifth of the screen.
    private(set) var threshold: CGFloat = 175
    /// The gap the system holds open while refreshing.
    private(set) var holdDistance: CGFloat = 60
    private(set) var label: String?
    /// Counts refreshes, so the seal pops once each time one starts.
    private(set) var starts = 0
    /// After a refresh the system waits for the content to return to the top
    /// before it can refresh again, so the seal stays hidden until then.
    private(set) var awaitingRest = false

    @ObservationIgnored private var restingInset: CGFloat?
    @ObservationIgnored private var settleTask: Task<Void, Never>?

    var progress: CGFloat { phase == .idle ? min(1, distance / threshold) : 1 }

    func track(_ geometry: PullGeometry) {
        // While refreshing, the system adds its gap to the top inset, so the pull
        // is measured from the inset the list had at rest.
        if geometry.overscroll == 0 {
            if phase == .idle { restingInset = geometry.inset }
            if awaitingRest { awaitingRest = false }
        }
        let added = max(0, geometry.inset - (restingInset ?? geometry.inset))
        let next = geometry.overscroll + added
        if next != distance { distance = next }
        if phase == .refreshing, added > 20, added != holdDistance { holdDistance = added }
        let nextThreshold = max(80, geometry.height * 0.2)
        if nextThreshold != threshold { threshold = nextThreshold }
    }

    func begin(label: String) {
        settleTask?.cancel()
        phase = .refreshing
        result = nil
        self.label = label
        starts += 1
    }

    func update(label: String) {
        if phase == .refreshing, result == nil { self.label = label }
    }

    func finish(succeeded: Bool, label: String) {
        guard phase == .refreshing else { return }
        result = succeeded ? .succeeded : .failed
        self.label = label
    }

    /// Called as the refresh returns: the system closes the gap while the seal fades.
    func settle() {
        phase = .settling
        settleTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(450))
            guard let self, !Task.isCancelled, self.phase == .settling else { return }
            self.phase = .idle
            self.result = nil
            self.label = nil
            self.awaitingRest = self.distance > 0
        }
    }
}

enum PullToRefreshPalette {
    static let inkSoft = Brand.color(light: "#657060", dark: "#AFB9A9")
}

/// Stands in for the system spinner, like the web app's seal: neutral ink while
/// pulling and refreshing, green only once every parcel has been checked.
struct PullToRefreshIndicator: View {
    let model: PullToRefreshModel
    let pullLabel: String

    static let height: CGFloat = 48

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let pulling = model.phase == .idle
        let progress = model.progress
        // Kept a little under halfway down the gap, so it stays centred as it grows.
        let gap = pulling ? model.distance : max(model.holdDistance, model.distance)
        VStack(spacing: 4) {
            PullToRefreshSeal(model: model, progress: progress)
                .scaleEffect(reduceMotion ? 1 : 0.82 + 0.18 * progress)
            Text(model.label ?? pullLabel)
                .font(.caption2.weight(.medium))
                .foregroundStyle(PullToRefreshPalette.inkSoft)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                .padding(.horizontal, 12)
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.height)
        .opacity(model.phase == .settling || (pulling && model.awaitingRest) ? 0
            : pulling ? min(1, max(0, progress * 2 - 0.15)) : 1)
        .animation(.easeOut(duration: 0.22), value: model.phase)
        .offset(y: -0.55 * gap - 21)
        .background { NativeRefreshSpinnerHider(pulling: model.distance > 0) }
        .sensoryFeedback(.impact(weight: .light), trigger: model.starts)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct PullToRefreshSeal: View {
    let model: PullToRefreshModel
    let progress: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let result = model.result
        let active = model.phase != .idle
        let pops = !reduceMotion
        ZStack {
            Circle()
                .fill(discColor(result))
                .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
            PullToRefreshArrow(
                degrees: reduceMotion ? 0 : 270 * progress,
                spinning: active && !reduceMotion,
                color: active ? Brand.ink : PullToRefreshPalette.inkSoft
            )
            .frame(width: 18, height: 18)
            .opacity(result == nil ? 1 : 0)
            .animation(.easeOut(duration: 0.18), value: result)
            PullToRefreshGlyph(cross: result == .failed)
                .trim(from: 0, to: result == nil ? 0 : 1)
                .stroke(result == .failed ? Brand.warning : ExperimentalPalette.delivered,
                        style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                .frame(width: 15, height: 15)
                .animation(result == nil ? nil : .easeOut(duration: 0.26).delay(0.08), value: result)
                .opacity(result == nil ? 0 : 1)
                .scaleEffect(result == nil && !reduceMotion ? 0.65 : 1)
                .animation(result == nil ? nil : .spring(duration: 0.3, bounce: 0.2), value: result)
        }
        .frame(width: 32, height: 32)
        .animation(result == nil ? nil : .easeOut(duration: 0.2), value: result)
        .keyframeAnimator(initialValue: 1.0, trigger: model.starts) { content, scale in
            content.scaleEffect(pops ? scale : 1)
        } keyframes: { _ in
            // A short pop when the refresh starts, where the web seal pops as it arms.
            KeyframeTrack {
                LinearKeyframe(1.06, duration: 0.12, timingCurve: .easeOut)
                SpringKeyframe(1, duration: 0.4, spring: Spring(duration: 0.4, bounce: 0.5))
            }
        }
    }

    private func discColor(_ result: PullToRefreshModel.Result?) -> Color {
        switch result {
        case .succeeded: ExperimentalPalette.deliveredSurface
        case .failed: ExperimentalPalette.pickupSurface
        case nil: Brand.paper
        }
    }
}

/// The check or cross drawn on the seal, from the web app's icon paths.
private struct PullToRefreshGlyph: Shape {
    var cross: Bool

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * scale, y: rect.minY + y * scale)
        }
        var path = Path()
        if cross {
            path.move(to: point(6, 6))
            path.addLine(to: point(18, 18))
            path.move(to: point(6, 18))
            path.addLine(to: point(18, 6))
        } else {
            path.move(to: point(5, 12))
            path.addLine(to: point(9, 16))
            path.addLine(to: point(19, 6))
        }
        return path
    }
}

/// The refresh arrow turns with the pull, then spins as a Core Animation
/// animation, which keeps turning while the refreshed list renders.
private struct PullToRefreshArrow: UIViewRepresentable {
    let degrees: Double
    let spinning: Bool
    let color: Color

    func makeUIView(context: Context) -> ArrowView { ArrowView() }

    func updateUIView(_ view: ArrowView, context: Context) {
        view.update(radians: degrees * .pi / 180, spinning: spinning, color: UIColor(color))
    }

    final class ArrowView: UIView {
        private static let turn: CFTimeInterval = 0.85
        private let glyph = UIImageView(image: UIImage(
            systemName: "arrow.clockwise",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 13.5, weight: .medium)
        ))
        private var spinning = false

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            glyph.contentMode = .center
            addSubview(glyph)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { nil }

        override func layoutSubviews() {
            super.layoutSubviews()
            // The glyph is rotated, so it is placed by bounds and center, not frame.
            glyph.bounds = bounds
            glyph.center = CGPoint(x: bounds.midX, y: bounds.midY)
        }

        func update(radians: Double, spinning next: Bool, color: UIColor) {
            glyph.tintColor = color
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            glyph.layer.transform = CATransform3DMakeRotation(radians, 0, 0, 1)
            CATransaction.commit()
            guard next != spinning else { return }
            spinning = next
            if next { spin(from: radians) } else {
                glyph.layer.removeAnimation(forKey: "firstTurn")
                glyph.layer.removeAnimation(forKey: "turns")
            }
        }

        private func spin(from start: Double) {
            // Eases out of the pulled angle, then turns at a constant speed.
            let first = CABasicAnimation(keyPath: "transform.rotation.z")
            first.fromValue = start
            first.toValue = start + 2 * .pi
            first.duration = Self.turn
            first.timingFunction = CAMediaTimingFunction(controlPoints: 0.45, 0, 0.75, 0.75)
            let turns = CABasicAnimation(keyPath: "transform.rotation.z")
            turns.fromValue = start + 2 * .pi
            turns.toValue = start + 4 * .pi
            turns.duration = Self.turn
            turns.repeatCount = .infinity
            turns.beginTime = glyph.layer.convertTime(CACurrentMediaTime(), from: nil) + Self.turn
            glyph.layer.add(first, forKey: "firstTurn")
            glyph.layer.add(turns, forKey: "turns")
        }
    }
}

/// `.refreshable` shows the system spinner in the gap; the seal replaces it.
private struct NativeRefreshSpinnerHider: UIViewRepresentable {
    let pulling: Bool

    func makeUIView(context: Context) -> HiderView {
        let view = HiderView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: HiderView, context: Context) { view.hideSpinner() }

    final class HiderView: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            hideSpinner()
            // SwiftUI can attach its refresh control just after this view appears.
            DispatchQueue.main.async { [weak self] in self?.hideSpinner() }
        }

        func hideSpinner() {
            var view = superview
            while let current = view, !(current is UIScrollView) { view = current.superview }
            guard let control = (view as? UIScrollView)?.refreshControl, control.tintColor != .clear else { return }
            control.tintColor = .clear
        }
    }
}
