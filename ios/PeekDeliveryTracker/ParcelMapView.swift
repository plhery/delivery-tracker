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
