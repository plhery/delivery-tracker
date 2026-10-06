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
