import SwiftUI

extension ParcelRoute {
    /// A parcel's route, with its destination country when the carrier gave one.
    init(parcel: Parcel, atlas: WorldAtlas, language: AppLanguage) {
        let name = { (code: String) in TrackingLocation.countryName(code, language: language) }
        let destination = parcel.carrierData?.destinationCountry.flatMap { code in
            atlas.label(of: code).map { RoutePlace.country(code, name: name(code), at: $0) }
        }
        self.init(events: parcel.trackingEvents, destination: destination, countryName: name)
    }
}

/// The route, drawn in the card's own ink across the top of the parcel's card, with Pip beside the parcel's place.
struct RouteEngraving: View {
    let atlas: WorldAtlas
    let route: ParcelRoute
    let stage: TrackingStage?
    let identity: CarrierVisualIdentity
    /// Off on the Next up card, which is one tap target in a scrolling list.
    var peek = true
    var insets = EdgeInsets(top: 40, leading: 16, bottom: 44, trailing: 16)
    /// Where the card starts writing over the bottom of the map, which Pip stays above.
    var floor: CGFloat?
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        WorldMapView(
            atlas: atlas, route: route, mode: route.defaultMode(for: stage),
            palette: .tint(ink: identity.ink, surface: identity.surface), labels: .ends, showsContext: false, peek: peek,
            // The parcel's dot pulses until the journey is over.
            live: stage != .delivered && stage != .returned,
            // Pip keeps below the top row of the parcel's page, and of Next up alike, so both show the same picture.
            pip: PipMood(stage: stage).map { PipRequest(mood: $0, ceiling: 52, floor: floor) },
            fades: true, insets: insets, language: localizer.language
        )
        // The globe button beside the bell is the accessible way in.
        .accessibilityHidden(true)
    }
}

/// A parcel's whole journey, small, at the end of its card. It belongs to the card's picture and is not there to be
/// read: no names, no Pip, no pulse, and a line and dots as pale as the map they lie on.
struct CardRoute: View {
    let atlas: WorldAtlas
    let route: ParcelRoute
    let ink: Color
    /// The card's own colour, which is paler on a past delivery.
    let surface: Color
    @EnvironmentObject private var localizer: Localizer

    /// How wide the picture is: the same on every card, however wide the card.
    static func width(in card: CGFloat) -> CGFloat { min(card * 0.58, 210) }
    /// How far from the card's trailing edge its words end, so they keep clear of the route.
    static let clearance: CGFloat = 120

    var body: some View {
        WorldMapView(
            atlas: atlas, route: route, mode: .journey, palette: .quietTint(ink: ink, surface: surface), labels: .none, showsContext: false,
            fadesIn: true, quiet: true,
            // Room for the date in the card's top row, and for the land to fade in from under the words.
            insets: EdgeInsets(top: 36, leading: 78, bottom: 16, trailing: 20), language: localizer.language
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The whole map over the parcel: the journey on a globe, or the last mile up close.
struct ParcelMapScreen: View {
    let atlas: WorldAtlas
    let route: ParcelRoute
    let stage: TrackingStage?
    /// The carrier's colour marks where the parcel is now.
    let accent: Color

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @State private var chosen: ParcelRoute.Mode?
    @State private var free = false
    @State private var recenter = 0
    @State private var barHeight: CGFloat = 220
    @State private var time = Date()
    @StateObject private var tiles = WorldDetailStore()

    private var mode: ParcelRoute.Mode { chosen ?? route.defaultMode(for: stage) }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                // The route is framed in the space the summary leaves.
                WorldMapView(
                    atlas: atlas, route: route, mode: mode, palette: .map(accent: accent), sites: true, interactive: true, night: time,
                    live: stage != .delivered && stage != .returned,
                    // Pip came along from the card. Here he keeps clear of what lies over the map: the summary and the button that closes it.
                    pip: PipMood(stage: stage).map { PipRequest(mood: $0, inset: true) },
                    insets: EdgeInsets(top: proxy.safeAreaInsets.top + 52, leading: 0,
                                       bottom: proxy.safeAreaInsets.bottom + barHeight + 24, trailing: 0),
                    recenter: recenter, language: localizer.language,
                    detail: tiles.pack.map { MapDetail(pack: $0, tiles: tiles.tiles, need: tiles.need) },
                    onFreeChange: { free = $0 }
                )
                .ignoresSafeArea()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
                .accessibilityAddTraits(.isImage)

                bar
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
            }
            .overlay(alignment: .topTrailing) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .glassSurface(in: Circle())
                .padding(.trailing, 14)
                .padding(.top, 4)
                .accessibilityLabel(localizer.text("map.close"))
            }
        }
        .background(Brand.background)
        .task { await tiles.open() }
    }

    /// The opened map has room for a facility's own name, so it says "Zürich-Mülligen" where the card says "Zürich".
    private var label: String {
        let origin = route.origin?.place.name(sites: true) ?? ""
        let end = (route.destination ?? route.current?.place)?.name(sites: true) ?? origin
        return end == origin ? localizer.text("map.labelOne", ["place": origin]) : localizer.text("map.label", ["from": origin, "to": end])
    }

    private var bar: some View {
        VStack(alignment: .leading, spacing: 14) {
            summary
            // With every place close by there is only one view: no buttons, even once the map is moved.
            if route.hasNearView {
                HStack(spacing: 2) {
                    viewButton(.journey, key: "map.journey", symbol: "globe")
                    viewButton(.now, key: "map.nearby", symbol: "location")
                }
                .padding(3)
                .background(Color.primary.opacity(0.06), in: Capsule())
                .accessibilityElement(children: .contain)
                .accessibilityLabel(localizer.text("map.view"))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassSurface(in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    @ViewBuilder private var summary: some View {
        if let origin = route.origin, let current = route.current {
            let delivered = stage == .delivered
            // A finished journey has a length, not a distance "so far".
            let finished = delivered || stage == .returned
            let end = route.destination ?? current.place
            let endLabel = delivered ? "map.delivered" : route.destination != nil ? "map.to" : route.latestLocated ? "map.now" : "map.lastSeen"
            let single = route.stops.count == 1 && route.destination == nil
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 14) {
                    if !single { endpoint(localizer.text("map.from"), origin.place, alignment: .leading) }
                    endpoint(localizer.text(endLabel), end, alignment: single ? .leading : .trailing)
                }
                if let line = route.line(arrived: delivered) {
                    RouteLine(line: line, tint: accent, live: stage != .delivered && stage != .returned)
                }
                if !single {
                    HStack(spacing: 16) {
                        if route.kilometres >= 1 {
                            let distance = kilometres(route.kilometres)
                            Text(finished ? distance : localizer.text("map.soFar", ["distance": distance]))
                        }
                        if !finished, let remaining = route.remainingKilometres {
                            Text(localizer.text("map.toGo", ["distance": kilometres(remaining)]))
                        }
                        if route.countries.count > 1 {
                            Text(localizer.text("map.countries.many", ["count": route.countries.count]))
                        }
                    }
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func kilometres(_ value: Double) -> String {
        ParcelRoute.formattedKilometres(value, locale: localizer.language.locale)
    }

    private func endpoint(_ title: String, _ place: RoutePlace, alignment: HorizontalAlignment) -> some View {
        let country = TrackingLocation.countryName(place.country, language: localizer.language)
        let name = place.name(sites: true)
        return VStack(alignment: alignment, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.medium))
                .textCase(.uppercase)
                .tracking(1.4)
                .foregroundStyle(.secondary)
            Text(name)
                .font(.title2.weight(.semibold))
                .lineLimit(1)
            Text("\(TrackingLocation.flag(place.country)) \(country)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
        .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name == country ? "\(title), \(country)" : "\(title), \(name), \(country)")
    }

    private func viewButton(_ target: ParcelRoute.Mode, key: String, symbol: String) -> some View {
        let selected = mode == target && !free
        return Button {
            if target == mode { recenter += 1 }
            chosen = target
        } label: {
            Label(localizer.text(key), systemImage: symbol)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .foregroundStyle(selected ? Brand.paper : Color.secondary)
                .background(selected ? Brand.ink : Color.clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// How far along the parcel is, from the first place to the last or to its destination.
/// The journey in small, under the two names: a dot for each place passed, a flag where a border was crossed, the parcel's
/// own dot where it is now and, dashed, the way still to go. It is drawn as the map opens, in a time that grows with its
/// places. The map above names them, so the line is not read aloud.
private struct RouteLine: View {
    let line: ParcelRoute.Line
    let tint: Color
    /// The parcel's dot pulses until the journey is over, as it does on the map.
    let live: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pen = 0.0
    @State private var arrived = false

    var body: some View {
        RouteLineDrawing(line: line, tint: tint, pen: reduceMotion ? 1 : pen, ahead: reduceMotion || arrived ? 1 : 0)
            .background {
                if live, arrived, !reduceMotion {
                    GeometryReader { proxy in
                        PulsingHalo(color: tint)
                            .position(x: RouteLineDrawing.x(line.now, in: proxy.size.width), y: proxy.size.height / 2)
                    }
                }
            }
            // Taller than its place in the summary, so that no flag is cut.
            .frame(height: 22)
            .padding(.vertical, -4)
            .accessibilityHidden(true)
            .task {
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled, pen == 0 else { return }
                let time = min(1.5, 0.7 + Double(line.stops.count) * 0.11)
                withAnimation(.timingCurve(0.45, 0, 0.2, 1, duration: time)) {
                    pen = 1
                } completion: {
                    // The way still to go, and the pulse, wait for the pen.
                    withAnimation(.easeOut(duration: 0.5)) { arrived = true }
                }
            }
    }
}

/// One frame of the line. The summary lies on glass, so a mark is kept clear of the line by cutting the line away around it.
private struct RouteLineDrawing: View, Animatable {
    let line: ParcelRoute.Line
    let tint: Color
    /// How much of the way to the parcel is drawn.
    var pen: Double
    /// How far the way still to go has shown.
    var ahead: Double

    /// Room at both ends for the dots that stand there.
    private static let inset = 5.0

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(pen, ahead) }
        set {
            pen = newValue.first
            ahead = newValue.second
        }
    }

    static func x(_ share: Double, in width: Double) -> Double {
        inset + share * (width - inset * 2)
    }

    var body: some View {
        Canvas { context, size in
            let middle = size.height / 2
            let drawn = pen * line.now
            let point = { (share: Double) in CGPoint(x: Self.x(share, in: size.width), y: middle) }
            let stroke = { (from: CGPoint, to: CGPoint) in
                Path { path in
                    path.move(to: from)
                    path.addLine(to: to)
                }
            }
            context.stroke(stroke(point(0), point(line.now)), with: .color(.primary.opacity(0.11)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            if line.now < 1, ahead > 0 {
                var faint = context
                faint.opacity = ahead
                let end = point(1)
                // The dashes stop at the ring that marks the destination.
                faint.stroke(stroke(point(line.now), CGPoint(x: end.x - 4, y: middle)), with: .color(.primary.opacity(0.28)), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                faint.stroke(Path(ellipseIn: CGRect(x: end.x - 3.25, y: middle - 3.25, width: 6.5, height: 6.5)), with: .color(.primary.opacity(0.4)), lineWidth: 1.5)
            }
            context.stroke(stroke(point(0), point(drawn)), with: .color(tint), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            for stop in line.stops {
                dot(&context, at: point(stop), radius: 3 * shown(stop, drawn: drawn), clear: 2)
            }
            for border in line.borders {
                flag(&context, border.country, at: point(border.at), scale: shown(border.at, drawn: drawn))
            }
            dot(&context, at: point(drawn), radius: 5, clear: 3)
        }
    }

    /// A mark shows as the pen reaches it: from nothing to its full size over the last stretch before it.
    private func shown(_ at: Double, drawn: Double) -> Double {
        min(1, max(0, (drawn - at) * 26 + 1))
    }

    private func dot(_ context: inout GraphicsContext, at centre: CGPoint, radius: Double, clear: Double) {
        guard radius > 0 else { return }
        let circle = { (radius: Double) in Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2)) }
        context.blendMode = .destinationOut
        context.fill(circle(radius + clear), with: .color(.black))
        context.blendMode = .normal
        context.fill(circle(radius), with: .color(tint))
    }

    private func flag(_ context: inout GraphicsContext, _ country: String, at centre: CGPoint, scale: Double) {
        guard scale > 0 else { return }
        let text = context.resolve(Text(TrackingLocation.flag(country)).font(.system(size: 13)))
        let size = text.measure(in: CGSize(width: 40, height: 40))
        let width = (size.width + 4) * scale
        let height = 14 * scale
        context.blendMode = .destinationOut
        context.fill(Path(roundedRect: CGRect(x: centre.x - width / 2, y: centre.y - height / 2, width: width, height: height), cornerRadius: 4 * scale), with: .color(.black))
        context.blendMode = .normal
        var flag = context
        flag.translateBy(x: centre.x, y: centre.y)
        flag.scaleBy(x: scale, y: scale)
        flag.draw(text, at: .zero)
    }
}
