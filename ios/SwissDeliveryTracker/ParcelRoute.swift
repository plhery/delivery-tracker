import Foundation

/// A point on the globe, in degrees.
struct GeoPoint: Hashable, Sendable {
    var longitude: Double
    var latitude: Double
}

extension GeoPoint {
    static let earthKilometres = 6_371.0

    var vector: SIMD3<Double> {
        let lambda = longitude * .pi / 180
        let phi = latitude * .pi / 180
        return SIMD3(cos(phi) * cos(lambda), cos(phi) * sin(lambda), sin(phi))
    }

    init(_ vector: SIMD3<Double>) {
        let length = (vector * vector).sum().squareRoot()
        self.init(
            longitude: atan2(vector.y, vector.x) * 180 / .pi,
            latitude: asin(max(-1, min(1, length > 0 ? vector.z / length : 0))) * 180 / .pi
        )
    }

    /// The great-circle angle to another point, in radians.
    func angle(to other: GeoPoint) -> Double {
        let phi1 = latitude * .pi / 180
        let phi2 = other.latitude * .pi / 180
        let a = pow(sin((phi2 - phi1) / 2), 2)
            + cos(phi1) * cos(phi2) * pow(sin((other.longitude - longitude) * .pi / 360), 2)
        return 2 * asin(min(1, a.squareRoot()))
    }

    func kilometres(to other: GeoPoint) -> Double { angle(to: other) * Self.earthKilometres }

    /// The point `fraction` of the way along the great circle to `other`.
    func interpolated(to other: GeoPoint, _ fraction: Double) -> GeoPoint {
        let angle = angle(to: other)
        guard angle > 1e-9 else { return self }
        return GeoPoint(vector * (sin((1 - fraction) * angle) / sin(angle)) + other.vector * (sin(fraction * angle) / sin(angle)))
    }

    /// The middle of some points on the sphere.
    static func mean(_ points: [GeoPoint]) -> GeoPoint {
        let sum = points.reduce(SIMD3<Double>.zero) { $0 + $1.vector }
        guard (sum * sum).sum() > 1e-12 else { return points.first ?? GeoPoint(longitude: 0, latitude: 0) }
        return GeoPoint(sum)
    }

    /// The widest angle between any two of the points, in radians.
    static func extent(_ points: [GeoPoint]) -> Double {
        var extent = 0.0
        for a in points { for b in points { extent = max(extent, a.angle(to: b)) } }
        return extent
    }
}

/// A scan's place on the map. A country-level place sits on the country's label point.
struct RoutePlace: Hashable, Sendable {
    let id: String
    var name: String
    let country: String
    let point: GeoPoint
    let isCountry: Bool
}

extension RoutePlace {
    /// A place the server found for a scan; scans a kilometre apart are the same stop.
    init(_ place: EventPlace) {
        self.init(
            id: String(format: "%.2f,%.2f", place.latitude, place.longitude),
            name: place.name,
            country: place.country,
            point: GeoPoint(longitude: place.longitude, latitude: place.latitude),
            isCountry: place.precision == .country
        )
    }

    static func country(_ code: String, name: String, at point: GeoPoint) -> RoutePlace {
        RoutePlace(id: code, name: name, country: code, point: point, isCountry: true)
    }
}

/// A parcel's scans as a journey: its stops, the legs between them and what is left to go.
/// It follows the same rules as the web map (`src/components/map/route.ts`).
struct ParcelRoute: Sendable {
    enum Scale: Sendable { case none, point, city, local, region, world }
    enum Mode: Sendable { case journey, now }

    struct Stop: Identifiable, Sendable {
        let id: String
        var place: RoutePlace
    }

    struct Leg: Identifiable, Sendable {
        let id: String
        let from: RoutePlace
        let to: RoutePlace
        let kilometres: Double
        /// A leg to or from a whole country only roughly shows where the parcel went.
        var isApproximate: Bool { from.isCountry || to.isCountry }
    }

    /// Stops closer than this to the current one belong to the close-up.
    static let nearKilometres = 400.0

    let stops: [Stop]
    let legs: [Leg]
    /// False when the newest scan has no place, so the last stop is only the last known one.
    let latestLocated: Bool
    /// Where the parcel is headed, until it gets there.
    let destination: RoutePlace?
    let remainingKilometres: Double?
    let kilometres: Double
    let countries: [String]
    let extentKilometres: Double
    let scale: Scale
    /// The newest stops close to the current one: what the close-up frames.
    let near: [Stop]

    var origin: Stop? { stops.first }
    var current: Stop? { stops.last }

    /// Places oldest first; nil for a scan without one.
    init(places: [RoutePlace?], destination: RoutePlace? = nil) {
        var stops: [Stop] = []
        for case let place? in places {
            if let last = stops.last {
                if last.place.id == place.id { continue }
                // "Germany" after Hamburg adds nothing to the map.
                if last.place.country == place.country && place.isCountry { continue }
                // A city makes an earlier country-level scan precise.
                if last.place.country == place.country && last.place.isCountry {
                    stops[stops.count - 1].place = place
                    continue
                }
            }
            stops.append(Stop(id: "\(place.id):\(stops.count)", place: place))
        }
        let legs = zip(stops, stops.dropFirst()).map { from, to in
            Leg(id: "\(from.id)>\(to.id)", from: from.place, to: to.place,
                kilometres: from.place.point.kilometres(to: to.place.point))
        }
        var remaining: RoutePlace?
        if let current = stops.last, let destination {
            let arrived = current.place.id == destination.id
                || (destination.isCountry && current.place.country == destination.country)
                || current.place.point.kilometres(to: destination.point) < 15
            remaining = arrived ? nil : destination
        }
        let points = stops.map(\.place.point) + (remaining.map { [$0.point] } ?? [])
        let extent = GeoPoint.extent(points) * GeoPoint.earthKilometres
        var near: [Stop] = []
        if let current = stops.last {
            for stop in stops.reversed() {
                guard stop.place.point.kilometres(to: current.place.point) <= Self.nearKilometres else { break }
                near.insert(stop, at: 0)
            }
        }
        var seen = Set<String>()
        self.stops = stops
        self.legs = legs
        latestLocated = places.last.map { $0 != nil } ?? false
        self.destination = remaining
        if let current = stops.last, let remaining {
            remainingKilometres = current.place.point.kilometres(to: remaining.point)
        } else {
            remainingKilometres = nil
        }
        kilometres = legs.reduce(0) { $0 + $1.kilometres }
        countries = stops.map(\.place.country).filter { seen.insert($0).inserted }
        extentKilometres = extent
        scale = points.isEmpty ? .none
            : points.count == 1 ? .point
            : extent > 2_500 ? .world
            : extent > 400 ? .region
            : extent > 30 ? .local : .city
        self.near = near
    }

    /// A parcel's scans, in time order. Country-only places take the reader's name for the country.
    init(events: [TrackingEvent], destination: RoutePlace? = nil, countryName: (String) -> String) {
        let ordered = events.sorted {
            (DateParser.date($0.occurredAt) ?? .distantPast) < (DateParser.date($1.occurredAt) ?? .distantPast)
        }
        self.init(places: ordered.map { event in
            guard let place = event.place else { return nil }
            var located = RoutePlace(place)
            if located.isCountry { located.name = countryName(located.country) }
            return located
        }, destination: destination)
    }

    /// Both views only make sense when part of the journey lies outside the close-up.
    var hasNearView: Bool { (scale == .world || scale == .region) && near.count < stops.count }

    /// The camera follows the parcel: the whole trip while it travels, a close-up for the last mile.
    func defaultMode(for stage: TrackingStage?) -> Mode {
        guard hasNearView else { return .journey }
        switch stage {
        case .outForDelivery, .readyForPickup, .failedAttempt: return .now
        default: return .journey
        }
    }

    /// Kilometres rounded the way a journey is told: "8 km", "450 km", "9,300 km".
    static func formattedKilometres(_ kilometres: Double, locale: Locale) -> String {
        let rounded = kilometres < 100 ? kilometres.rounded()
            : kilometres < 1_000 ? (kilometres / 10).rounded() * 10
            : (kilometres / 100).rounded() * 100
        return Measurement(value: max(rounded, 1), unit: UnitLength.kilometers).formatted(
            .measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(0)))
                .locale(locale)
        )
    }
}
