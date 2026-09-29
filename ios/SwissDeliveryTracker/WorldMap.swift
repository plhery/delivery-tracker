import simd
import SwiftUI
import UIKit

// MARK: - Map data

/// Countries, borders, lakes and cities from `World.json`, the Natural Earth data the web map
/// draws. It ships with the app, so showing a parcel's journey asks no map service anything.
final class WorldAtlas: Sendable {
    enum Detail: Sendable { case coarse, fine }

    /// A shape with the smallest cap around it, so a view can skip what it cannot see.
    /// Points are unit vectors: projecting one takes three dot products.
    struct Part: Sendable {
        let rings: [[SIMD3<Double>]]
        let center: SIMD3<Double>
        let radius: Double
    }

    struct Country: Sendable {
        let code: String
        let name: String
        let label: GeoPoint?
        /// Natural Earth's label rank: 1 for the largest countries, up to 10.
        let rank: Int
        let parts: [Part]
    }

    struct City: Sendable, Decodable {
        let point: GeoPoint
        let name: String
        let rank: Int

        init(from decoder: Decoder) throws {
            var values = try decoder.unkeyedContainer()
            let longitude = try values.decode(Double.self)
            point = GeoPoint(longitude: longitude, latitude: try values.decode(Double.self))
            name = try values.decode(String.self)
            rank = try values.decode(Int.self)
        }
    }

    struct Layer: Sendable {
        let land: [Part]
        let borders: [Part]
        /// In the file's order, which decides which names win when they collide.
        let countries: [Country]
        let byCode: [String: Country]
    }

    let coarse: Layer
    let fine: Layer
    let lakes: [Part]
    /// Major cities, most prominent first.
    let cities: [City]

    /// Parsed once, off the main thread, when a map first needs it.
    static let bundled = Task.detached(priority: .userInitiated) { () -> WorldAtlas? in
        guard let url = Bundle.main.url(forResource: "World", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? WorldAtlas(data: data)
    }

    func layer(_ detail: Detail) -> Layer { detail == .fine ? fine : coarse }

    /// Where a country's name sits: country-only scans and destinations are drawn there.
    func label(of country: String) -> GeoPoint? { coarse.byCode[country]?.label }

    private struct File: Decodable {
        struct Entry: Decodable {
            let code: String?
            let name: String
            let label: [Double]?
            let rank: Int
            let polygons: [[[Int]]]
        }

        let precision: Double
        let arcs: [String: [[Int]]]
        let borders: [Int]
        let countries: [Entry]
        let lakes: [[Int]]
        let cities: [City]
    }

    /// The file stores shared arcs once, so neighbouring borders always line up.
    init(data: Data) throws {
        let file = try JSONDecoder().decode(File.self, from: data)
        let decode = { (flat: [Int]) -> [SIMD3<Double>] in
            var points: [SIMD3<Double>] = []
            points.reserveCapacity(flat.count / 2)
            var x = 0
            var y = 0
            var index = 0
            while index + 1 < flat.count {
                x += flat[index]
                y += flat[index + 1]
                points.append(GeoPoint(longitude: Double(x) / file.precision, latitude: Double(y) / file.precision).vector)
                index += 2
            }
            return points
        }
        let layer = { (detail: String) -> Layer in
            let arcs = (file.arcs[detail] ?? []).map(decode)
            let ring = { (indexes: [Int]) -> [SIMD3<Double>] in
                var points: [SIMD3<Double>] = []
                for index in indexes {
                    let arc = index < 0 ? Array(arcs[~index].reversed()) : arcs[index]
                    points.append(contentsOf: points.isEmpty ? arc[...] : arc.dropFirst())
                }
                return points
            }
            var land: [Part] = []
            var countries: [Country] = []
            for entry in file.countries {
                let parts = entry.polygons
                    .map { $0.map(ring).filter { $0.count >= 4 } }
                    .filter { !$0.isEmpty }
                    .map { Self.part($0, outline: $0[0]) }
                land += parts
                guard let code = entry.code, !code.isEmpty else { continue }
                let label = entry.label.flatMap { $0.count == 2 ? GeoPoint(longitude: $0[0], latitude: $0[1]) : nil }
                countries.append(Country(code: code, name: entry.name, label: label, rank: entry.rank, parts: parts))
            }
            let borders = file.borders.filter { arcs.indices.contains($0) }.map { Self.part([arcs[$0]], outline: arcs[$0]) }
            return Layer(land: land, borders: borders, countries: countries,
                         byCode: Dictionary(countries.map { ($0.code, $0) }, uniquingKeysWith: { first, _ in first }))
        }
        coarse = layer("coarse")
        fine = layer("fine")
        lakes = file.lakes.map { flat in
            let points = decode(flat)
            return Self.part([points], outline: points)
        }
        cities = file.cities
    }

    private static func part(_ rings: [[SIMD3<Double>]], outline: [SIMD3<Double>]) -> Part {
        let sum = outline.reduce(SIMD3<Double>.zero, +)
        let length = simd_length(sum)
        let center = length > 1e-9 ? sum / length : (outline.first ?? SIMD3(1, 0, 0))
        let radius = outline.reduce(0.0) { max($0, acos(max(-1, min(1, simd_dot(center, $1))))) }
        return Part(rings: rings, center: center, radius: radius)
    }
}

// MARK: - Camera

/// Where the map looks from. One orthographic projection serves every scale: zoomed out it is
/// a globe, zoomed in it is a flat map, so the camera moves between the two without a switch.
struct GlobeCamera: Equatable, Sendable {
    var center: GeoPoint
    /// The globe's radius, in points.
    var scale: Double
    /// Where the center sits on screen.
    var offset: CGPoint
}

extension GlobeCamera {
    /// Frames the points in `box`, never closer than `minimumKilometres` across, and shows the
    /// whole globe past `globeAbove` radians. `tilt` looks at a long route from nearer the
    /// equator: seen from the side, a great circle bows toward the pole, the way flights do.
    static func fit(_ points: [GeoPoint], in box: CGRect, minimumKilometres: Double, globeAbove: Double = 2.4,
                    tilt: Bool = false) -> GlobeCamera {
        let mean = GeoPoint.mean(points)
        let center = tilt ? tilted(points, around: mean) : mean
        let radius = min(box.width, box.height) / 2
        let middle = CGPoint(x: box.midX, y: box.midY)
        if GeoPoint.extent(points) > globeAbove {
            return GlobeCamera(center: center, scale: radius * 0.94, offset: middle)
        }
        let unit = GlobeProjection(GlobeCamera(center: center, scale: 1, offset: .zero))
        let projected = points.map { point -> CGPoint in
            let vector = point.vector
            return unit.facing(vector) >= 0 ? unit.screen(vector) : .zero
        }
        let minimum = minimumKilometres / GeoPoint.earthKilometres
        let xs = projected.map(\.x)
        let ys = projected.map(\.y)
        let minX = xs.min() ?? 0, maxX = xs.max() ?? 0, minY = ys.min() ?? 0, maxY = ys.max() ?? 0
        // Never zoom out past the whole globe.
        let scale = max(radius * 0.94, min(box.width / max(maxX - minX, minimum), box.height / max(maxY - minY, minimum)))
        return GlobeCamera(center: center, scale: scale,
                           offset: CGPoint(x: middle.x - scale * (minX + maxX) / 2, y: middle.y - scale * (minY + maxY) / 2))
    }

    private static func tilted(_ points: [GeoPoint], around center: GeoPoint) -> GeoPoint {
        guard var pair = points.first.map({ ($0, $0) }) else { return center }
        var extent = 0.0
        for a in points {
            for b in points {
                let angle = a.angle(to: b)
                if angle > extent {
                    extent = angle
                    pair = (a, b)
                }
            }
        }
        let angle = min(0.5, extent * 0.32)
        guard angle >= 0.05 else { return center }
        var normal = simd_cross(pair.0.vector, pair.1.vector)
        let length = simd_length(normal)
        normal /= length > 0 ? length : 1
        let middle = center.vector
        // Step off the route toward the equator.
        if normal.z * middle.z > 0 { normal = -normal }
        return GeoPoint(middle * cos(angle) + normal * sin(angle))
    }

    /// Flies between cameras, easing out to a wider view when the move is long.
    static func flight(from: GlobeCamera, to: GlobeCamera, viewport: Double) -> (Double) -> GlobeCamera {
        let travel = from.center.angle(to: to.center) * min(from.scale, to.scale)
        let lift = travel > viewport ? min(log(travel / viewport) * 0.8, 2.2) : 0
        let a = log(from.scale)
        let b = log(to.scale)
        return { t in
            GlobeCamera(
                center: from.center.interpolated(to: to.center, t),
                scale: exp(a + (b - a) * t - lift * sin(.pi * t)),
                offset: CGPoint(x: from.offset.x + (to.offset.x - from.offset.x) * t,
                                y: from.offset.y + (to.offset.y - from.offset.y) * t)
            )
        }
    }

    static func flightDuration(from: GlobeCamera, to: GlobeCamera) -> Double {
        min(1.5, 0.7 + from.center.angle(to: to.center) * 0.5 + abs(log(to.scale / from.scale)) * 0.12)
    }

    static func easeInOut(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }

    /// Zooms by `ratio` about a point on screen, from the whole globe down to a town. A globe
    /// that no longer fills the view drifts back to `middle`, so zooming out never loses it.
    func zoomed(by ratio: Double, around anchor: CGPoint, middle: CGPoint, viewport: Double) -> GlobeCamera {
        let whole = viewport / 2
        let scale = max(whole * 0.9, min(viewport / (20 / GeoPoint.earthKilometres), self.scale * ratio))
        let k = scale / self.scale
        let settle = max(0, min(1, (whole * 2.5 - scale) / (whole * 1.5)))
        let x = anchor.x + (offset.x - anchor.x) * k
        let y = anchor.y + (offset.y - anchor.y) * k
        return GlobeCamera(center: center, scale: scale, offset: CGPoint(x: x + (middle.x - x) * settle, y: y + (middle.y - y) * settle))
    }

    /// Where the sun is overhead, accurate to a degree or so: enough for a soft night side.
    static func subsolarPoint(_ date: Date) -> GeoPoint {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let parts = calendar.dateComponents([.year, .hour, .minute], from: date)
        let start = calendar.date(from: DateComponents(year: parts.year, month: 1, day: 1))
            .map { $0.addingTimeInterval(-86_400) } ?? date
        let day = date.timeIntervalSince(start) / 86_400
        let declination = -23.44 * cos(2 * .pi / 365 * (day + 10))
        let hours = Double(parts.hour ?? 0) + Double(parts.minute ?? 0) / 60
        return GeoPoint(longitude: (-15 * (hours - 12) + 540).truncatingRemainder(dividingBy: 360) - 180, latitude: declination)
    }
}

/// The orthographic projection for one camera.
struct GlobeProjection {
    let camera: GlobeCamera
    /// Toward the viewer through the camera's center, and the directions of screen right and up there.
    let forward: SIMD3<Double>
    let east: SIMD3<Double>
    let north: SIMD3<Double>

    init(_ camera: GlobeCamera) {
        self.camera = camera
        let lambda = camera.center.longitude * .pi / 180
        let phi = camera.center.latitude * .pi / 180
        forward = SIMD3(cos(phi) * cos(lambda), cos(phi) * sin(lambda), sin(phi))
        east = SIMD3(-sin(lambda), cos(lambda), 0)
        north = SIMD3(-sin(phi) * cos(lambda), -sin(phi) * sin(lambda), cos(phi))
    }

    /// Above 0 the point faces the viewer; below 0 it is behind the globe.
    func facing(_ vector: SIMD3<Double>) -> Double { simd_dot(vector, forward) }

    func screen(_ vector: SIMD3<Double>) -> CGPoint {
        CGPoint(x: camera.offset.x + camera.scale * simd_dot(vector, east),
                y: camera.offset.y - camera.scale * simd_dot(vector, north))
    }

    func project(_ point: GeoPoint) -> CGPoint { screen(point.vector) }

    /// A point behind the globe moves onto its rim, so an outline crossing the horizon follows it.
    func screenOnFront(_ vector: SIMD3<Double>) -> CGPoint {
        guard facing(vector) < 0 else { return screen(vector) }
        let x = simd_dot(vector, east)
        let y = simd_dot(vector, north)
        let length = (x * x + y * y).squareRoot()
        guard length > 1e-9 else { return screen(vector) }
        return CGPoint(x: camera.offset.x + camera.scale * x / length, y: camera.offset.y - camera.scale * y / length)
    }

    /// On the near side, with a little margin before the rim.
    func sees(_ point: GeoPoint) -> Bool { facing(point.vector) > sin(0.02) }

    /// The place under a screen point, if the globe covers it.
    func invert(_ point: CGPoint) -> GeoPoint? {
        let x = (point.x - camera.offset.x) / camera.scale
        let y = (camera.offset.y - point.y) / camera.scale
        let squared = x * x + y * y
        guard squared <= 1 else { return nil }
        return GeoPoint(east * x + north * y + forward * (1 - squared).squareRoot())
    }
}

// MARK: - Geometry

enum MapGeometry {
    /// A closed outline for an even-odd fill. Points behind the globe follow its rim, which
    /// outlines the visible part of any shape clear of the point straight behind the globe.
    /// A shape around that point would fill its hidden side instead, so it also takes in the
    /// whole `disk`: `around` says whether the shape contains that point.
    static func addRing(_ path: inout Path, _ ring: [SIMD3<Double>], _ projection: GlobeProjection, around: Bool = false,
                        disk: Path) {
        guard let first = ring.first else { return }
        path.move(to: projection.screenOnFront(first))
        for vector in ring.dropFirst() { path.addLine(to: projection.screenOnFront(vector)) }
        path.closeSubpath()
        if around { path.addPath(disk) }
    }

    /// The visible part of a cap `radius` radians around `center`, for an even-odd fill.
    static func cap(around center: SIMD3<Double>, radius: Double, _ projection: GlobeProjection, disk: Path) -> Path {
        var path = Path()
        addRing(&path, circle(around: center, radius: radius), projection, around: projection.facing(center) < -cos(radius), disk: disk)
        return path
    }

    /// A country or lake, each ring outlined as `addRing` describes.
    static func addPart(_ path: inout Path, _ part: WorldAtlas.Part, _ projection: GlobeProjection, disk: Path) {
        // Only a part whose cap reaches the point behind the globe can surround it.
        let reaches = acos(max(-1, min(1, -simd_dot(part.center, projection.forward)))) <= part.radius
        for ring in part.rings {
            addRing(&path, ring, projection, around: reaches && surroundsBack(ring, projection), disk: disk)
        }
    }

    /// Seen from the point behind the globe (a stereographic view), whether the ring winds around it.
    private static func surroundsBack(_ ring: [SIMD3<Double>], _ projection: GlobeProjection) -> Bool {
        let points = ring.compactMap { vector -> SIMD2<Double>? in
            let distance = 1 - projection.facing(vector)
            guard distance > 1e-9 else { return nil }
            return SIMD2(simd_dot(vector, projection.east), simd_dot(vector, projection.north)) / distance
        }
        guard let last = points.last else { return false }
        var turn = 0.0
        var previous = last
        for point in points {
            turn += atan2(previous.x * point.y - previous.y * point.x, simd_dot(previous, point))
            previous = point
        }
        return abs(turn) > .pi
    }

    /// An open line, cut where it passes behind the globe.
    static func addLine(_ path: inout Path, _ line: [SIMD3<Double>], _ projection: GlobeProjection) {
        var previous: (vector: SIMD3<Double>, facing: Double)?
        var drawing = false
        for vector in line {
            let facing = projection.facing(vector)
            if facing >= 0 {
                if drawing {
                    path.addLine(to: projection.screen(vector))
                } else {
                    if let previous, previous.facing < 0 {
                        path.move(to: projection.screen(horizon(previous.vector, previous.facing, vector, facing)))
                        path.addLine(to: projection.screen(vector))
                    } else {
                        path.move(to: projection.screen(vector))
                    }
                    drawing = true
                }
            } else if drawing, let previous {
                path.addLine(to: projection.screen(horizon(previous.vector, previous.facing, vector, facing)))
                drawing = false
            }
            previous = (vector, facing)
        }
    }

    private static func horizon(_ a: SIMD3<Double>, _ facingA: Double, _ b: SIMD3<Double>, _ facingB: Double) -> SIMD3<Double> {
        let point = a + (b - a) * (facingA / (facingA - facingB))
        let length = simd_length(point)
        return length > 0 ? point / length : point
    }

    /// The great circle from `a` to `b`, sampled finely enough to curve smoothly.
    static func greatCircle(_ a: GeoPoint, _ b: GeoPoint) -> [SIMD3<Double>] {
        let steps = max(2, Int((a.angle(to: b) / 0.02).rounded(.up)))
        return (0...steps).map { a.interpolated(to: b, Double($0) / Double(steps)).vector }
    }

    /// A circle on the sphere, `radius` radians around `center`.
    static func circle(around center: SIMD3<Double>, radius: Double, steps: Int = 60) -> [SIMD3<Double>] {
        let helper: SIMD3<Double> = abs(center.z) < 0.9 ? SIMD3(0, 0, 1) : SIMD3(1, 0, 0)
        let u = simd_normalize(simd_cross(center, helper))
        let w = simd_cross(center, u)
        return (0..<steps).map { step in
            let theta = Double(step) / Double(steps) * 2 * .pi
            return center * cos(radius) + (u * cos(theta) + w * sin(theta)) * sin(radius)
        }
    }

    /// Meridians and parallels every 30°, the grid that shows the globe's curve.
    static let graticule: [[SIMD3<Double>]] = {
        var lines: [[SIMD3<Double>]] = []
        for longitude in stride(from: -180.0, to: 180, by: 30) {
            let limit = longitude.truncatingRemainder(dividingBy: 90) == 0 ? 90.0 : 80.0
            lines.append(stride(from: -limit, through: limit, by: 2.5).map { GeoPoint(longitude: longitude, latitude: $0).vector })
        }
        for latitude in stride(from: -60.0, through: 60, by: 30) {
            lines.append(stride(from: -180.0, through: 180, by: 2.5).map { GeoPoint(longitude: $0, latitude: latitude).vector })
        }
        return lines
    }()
}

// MARK: - Colours

/// Every colour the map draws with, so a card can tint it in its own ink.
struct MapPalette {
    /// Nil leaves the card showing through.
    var space: Color?
    var ocean: Color?
    var land: Color
    /// Drawn over the land of countries the parcel passed through.
    var visited: Color
    var border: Color
    var night: Color?
    var grid: Color?
    var limb: Color?
    var shade: Color?
    var route: Color
    var routeMuted: Color
    var accent: Color
    var label: Color
    var labelStrong: Color
    var labelBackground: Color
    var dotRing: Color
    var currentRing: Color

    /// The full map: quiet greens, with the carrier's colour on the parcel.
    static func map(accent: Color) -> MapPalette {
        let ocean = Brand.color(light: "#F4F6F1", dark: "#171C17")
        return MapPalette(
            space: Brand.color(light: "#E9ECE5", dark: "#0E120E"),
            ocean: ocean,
            land: Brand.color(light: "#DFE4D8", dark: "#2D352B"),
            visited: accent.opacity(0.13),
            border: ocean,
            night: adaptive(light: rgb(24, 34, 40, 0.10), dark: rgb(0, 0, 0, 0.34)),
            grid: adaptive(light: rgb(32, 37, 30, 0.06), dark: rgb(245, 246, 242, 0.04)),
            limb: adaptive(light: rgb(32, 37, 30, 0.09), dark: rgb(245, 246, 242, 0.10)),
            shade: adaptive(light: rgb(32, 45, 32, 0.07), dark: rgb(0, 0, 0, 0.26)),
            route: Brand.ink,
            routeMuted: Brand.ink.opacity(0.38),
            accent: accent,
            label: Brand.color(light: "#657060", dark: "#AFB9A9"),
            labelStrong: Brand.ink,
            labelBackground: adaptive(light: rgb(255, 255, 255, 0.84), dark: rgb(32, 38, 31, 0.82)),
            dotRing: ocean,
            currentRing: Brand.paper
        )
    }

    /// The card's engraving: the carrier's ink on the card's own colour.
    static func tint(ink: Color, surface: Color) -> MapPalette {
        MapPalette(
            space: nil, ocean: nil, land: ink.opacity(0.10), visited: ink.opacity(0.17), border: surface.opacity(0.8),
            night: nil, grid: nil, limb: ink.opacity(0.16), shade: nil, route: ink, routeMuted: ink.opacity(0.45),
            accent: ink, label: ink, labelStrong: ink, labelBackground: surface.opacity(0.92), dotRing: surface,
            currentRing: Brand.paper
        )
    }

    private static func rgb(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat) -> UIColor {
        UIColor(red: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
    }

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

// MARK: - Layout

enum MapLabels: Sendable { case all, ends, none }

/// Everything drawn over the land: legs, stops, place names and pointers to far ends.
struct MapOverlay {
    enum LegKind { case travelled, approximate, remaining }
    enum DotKind { case origin, stop, current, lastKnown, area, destination }
    enum LabelKind { case current, end, stop, area, context, city }

    struct Leg { let path: Path; let kind: LegKind }
    struct Dot { let point: CGPoint; let kind: DotKind }
    struct Label { let frame: CGRect; let text: String; let kind: LabelKind }
    struct Pointer { let center: CGPoint; let width: CGFloat; let angle: Double; let name: String; let detail: String }

    private(set) var legs: [Leg] = []
    private(set) var dots: [Dot] = []
    private(set) var labels: [Label] = []
    private(set) var pointers: [Pointer] = []

    enum Fonts {
        static let label = UIFont.systemFont(ofSize: 11.5, weight: .medium)
        static let area = UIFont.systemFont(ofSize: 10.5, weight: .medium)
        static let context = UIFont.systemFont(ofSize: 9.5, weight: .medium)
        static let city = UIFont.systemFont(ofSize: 10, weight: .regular)
        static let pointerName = UIFont.systemFont(ofSize: 11, weight: .semibold)
        static let pointerDetail = UIFont.systemFont(ofSize: 11, weight: .regular)

        static func width(_ text: String, _ font: UIFont, tracking: CGFloat = 0) -> CGFloat {
            ceil((text as NSString).size(withAttributes: [.font: font]).width) + tracking * CGFloat(text.count)
        }
    }

    init(route: ParcelRoute, camera: GlobeCamera, size: CGSize, insets: EdgeInsets, labels labelSet: MapLabels,
         mode: ParcelRoute.Mode, context: Bool, atlas: WorldAtlas, locale: Locale,
         countryName: (String) -> String) {
        let projection = GlobeProjection(camera)
        let visible = { (point: GeoPoint) in projection.sees(point) }
        let at = { (point: GeoPoint) in projection.project(point) }
        let inside = { (point: CGPoint, margin: CGFloat) -> Bool in
            point.x > insets.leading + margin && point.x < size.width - insets.trailing - margin
                && point.y > insets.top + margin && point.y < size.height - insets.bottom - margin
        }
        let fits = { (box: CGRect, margin: CGFloat) -> Bool in
            inside(CGPoint(x: box.minX, y: box.minY), margin) && inside(CGPoint(x: box.maxX, y: box.maxY), margin)
                && inside(CGPoint(x: box.maxX, y: box.minY), margin) && inside(CGPoint(x: box.minX, y: box.maxY), margin)
        }

        let legPath = { (a: GeoPoint, b: GeoPoint, kilometres: Double) -> Path in
            var path = Path()
            if kilometres < 900 && visible(a) && visible(b) {
                // Short hops bow slightly to the left of travel: a hop, not a road.
                let start = at(a)
                let end = at(b)
                let distance = hypot(end.x - start.x, end.y - start.y)
                let length = distance > 0 ? distance : 1
                let bend = min(length * 0.18, 70)
                path.move(to: start)
                path.addQuadCurve(to: end, control: CGPoint(x: (start.x + end.x) / 2 + (end.y - start.y) / length * bend,
                                                            y: (start.y + end.y) / 2 - (end.x - start.x) / length * bend))
            } else {
                MapGeometry.addLine(&path, MapGeometry.greatCircle(a, b), projection)
            }
            return path
        }
        legs = route.legs.map { Leg(path: legPath($0.from.point, $0.to.point, $0.kilometres), kind: $0.isApproximate ? .approximate : .travelled) }
        if let current = route.current, let destination = route.destination {
            legs.insert(Leg(path: legPath(current.place.point, destination.point, route.remainingKilometres ?? 0), kind: .remaining), at: 0)
        }

        for (index, stop) in route.stops.enumerated() where visible(stop.place.point) {
            let last = index == route.stops.count - 1
            var kind: DotKind = last ? (route.latestLocated ? .current : .lastKnown)
                : stop.place.isCountry ? .area : index == 0 ? .origin : .stop
            if last && stop.place.isCountry && !route.latestLocated { kind = .area }
            dots.append(Dot(point: at(stop.place.point), kind: kind))
        }
        if let destination = route.destination, visible(destination.point) {
            dots.insert(Dot(point: at(destination.point), kind: .destination), at: 0)
        }

        // Place names, most important first, skipping any that would collide.
        var placed = dots.map { CGRect(x: $0.point.x - 6, y: $0.point.y - 6, width: 12, height: 12) }
        let overlaps = { (box: CGRect, taken: [CGRect]) -> Bool in
            taken.contains { box.minX < $0.maxX && box.maxX > $0.minX && box.minY < $0.maxY && box.maxY > $0.minY }
        }
        struct Candidate { let id: String; let place: RoutePlace; let kind: LabelKind; let priority: Int }
        var candidates: [Candidate] = []
        if let current = route.current { candidates.append(Candidate(id: current.id, place: current.place, kind: .current, priority: 0)) }
        if let destination = route.destination { candidates.append(Candidate(id: "destination", place: destination, kind: .end, priority: 1)) }
        if let origin = route.origin, origin.id != route.current?.id {
            candidates.append(Candidate(id: origin.id, place: origin.place, kind: .end, priority: 2))
        }
        if route.stops.count > 2 {
            for stop in route.stops[1..<(route.stops.count - 1)] {
                candidates.append(Candidate(id: stop.id, place: stop.place, kind: .stop, priority: 3))
            }
        }
        candidates = candidates.filter { labelSet == .all || (labelSet == .ends && $0.priority < 3) }
        var neighbours: [String: [GeoPoint]] = [:]
        for (index, stop) in route.stops.enumerated() {
            neighbours[stop.id] = [index > 0 ? route.stops[index - 1] : nil, index + 1 < route.stops.count ? route.stops[index + 1] : nil]
                .compactMap { $0?.place.point }
        }
        if let current = route.current, let destination = route.destination {
            neighbours[current.id, default: []].append(destination.point)
            neighbours["destination"] = [current.place.point]
        }
        var seen = Set<String>()
        for candidate in labelSet == .none ? [] : candidates {
            let point = candidate.place.point
            guard visible(point), !seen.contains(candidate.place.id) else { continue }
            let spot = at(point)
            guard inside(spot, -2) else { continue }
            seen.insert(candidate.place.id)
            let area = candidate.place.isCountry
            let text = area ? candidate.place.name.uppercased(with: locale) : candidate.place.name
            let width = area ? Fonts.width(text, Fonts.area, tracking: 0.84) + 10 : Fonts.width(text, Fonts.label) + 14
            let height: CGFloat = 22
            var awayX = 0.0
            var awayY = 0.0
            for other in neighbours[candidate.id] ?? [] where visible(other) {
                let target = at(other)
                let distance = hypot(target.x - spot.x, target.y - spot.y)
                let length = distance > 0 ? distance : 1
                awayX += (target.x - spot.x) / length
                awayY += (target.y - spot.y) / length
            }
            let options: [(x: CGFloat, y: CGFloat, dx: Double, dy: Double)] = area
                ? [(spot.x - width / 2, spot.y + 8, 0, 1), (spot.x - width / 2, spot.y - 30, 0, -1),
                   (spot.x + 8, spot.y + 6, 1, 1), (spot.x - width - 8, spot.y + 6, -1, 1)]
                : [(spot.x + 9, spot.y - height / 2, 1, 0), (spot.x - 9 - width, spot.y - height / 2, -1, 0),
                   (spot.x - width / 2, spot.y - 29, 0, -1), (spot.x - width / 2, spot.y + 8, 0, 1)]
            let ordered = options.enumerated()
                .map { index, option in (option, option.dx * awayX + option.dy * awayY + Double(index) * 0.01) }
                .sorted { $0.1 < $1.1 }
                .map { CGRect(x: $0.0.x, y: $0.0.y, width: width, height: height) }
            let taken = placed
            guard let frame = ordered.first(where: { !overlaps($0, taken) && fits($0, 2) }) ?? (candidate.priority == 0 ? ordered.first : nil)
            else { continue }
            placed.append(frame)
            labels.append(Label(frame: frame, text: text, kind: area ? .area : candidate.kind))
        }

        // In a close-up, far ends of the journey stay on the edge, pointing the way.
        let viewCenter = CGPoint(x: (insets.leading + size.width - insets.trailing) / 2, y: (insets.top + size.height - insets.bottom) / 2)
        if mode == .now, let current = route.current, let middle = projection.invert(viewCenter) {
            for place in [route.origin?.place, route.destination].compactMap({ $0 }) {
                if visible(place.point) && inside(at(place.point), 12) { continue }
                let toward = middle.interpolated(to: place.point, min(1, 0.01 / max(middle.angle(to: place.point), 1e-6)))
                let from = at(middle)
                let next = at(toward)
                let distance = hypot(next.x - from.x, next.y - from.y)
                let length = distance > 0 ? distance : 1
                let dx = (next.x - from.x) / length
                let dy = (next.y - from.y) / length
                let margin: CGFloat = 30
                let reach = min(
                    dx > 0 ? (size.width - insets.trailing - margin - viewCenter.x) / dx
                        : dx < 0 ? (insets.leading + margin - viewCenter.x) / dx : .infinity,
                    dy > 0 ? (size.height - insets.bottom - margin - viewCenter.y) / dy
                        : dy < 0 ? (insets.top + margin - viewCenter.y) / dy : .infinity
                )
                let detail = ParcelRoute.formattedKilometres(current.place.point.kilometres(to: place.point), locale: locale)
                let width = Fonts.width(place.name, Fonts.pointerName) + Fonts.width(" " + detail, Fonts.pointerDetail) + 34
                let half = width / 2
                // Keep the whole chip inside the frame, whichever edge it points past.
                let x = max(insets.leading + half + 8, min(size.width - insets.trailing - half - 8, viewCenter.x + dx * reach))
                let y = max(insets.top + 21, min(size.height - insets.bottom - 21, viewCenter.y + dy * reach))
                placed.append(CGRect(x: x - half, y: y - 13, width: width, height: 26))
                pointers.append(Pointer(center: CGPoint(x: x, y: y), width: width, angle: atan2(dy, dx), name: place.name, detail: detail))
            }
        }

        // Faint country names for orientation, fewer as the view widens.
        let spanKilometres = min(size.width, size.height) / camera.scale * GeoPoint.earthKilometres
        let maxRank = !context || labelSet == .none || spanKilometres < 180 || spanKilometres > 10_000 ? 0
            : spanKilometres > 6_000 ? 2 : spanKilometres > 3_000 ? 3 : spanKilometres > 1_200 ? 4 : 5
        for country in maxRank > 0 ? atlas.coarse.countries : [] {
            // Names near the rim of the globe read as clutter.
            guard country.rank <= maxRank, let label = country.label, !seen.contains(country.code),
                  label.angle(to: camera.center) <= 1.15 else { continue }
            let spot = at(label)
            let text = countryName(country.code).uppercased(with: locale)
            let width = Fonts.width(text, Fonts.context, tracking: 0.95) + 8
            let box = CGRect(x: spot.x - width / 2, y: spot.y - 9, width: width, height: 18)
            guard !overlaps(box, placed), fits(box, 6) else { continue }
            placed.append(box)
            labels.append(Label(frame: box, text: text, kind: .context))
        }

        // In a close-up, a few big cities give bearings.
        let maxCityRank = !context || labelSet == .none || spanKilometres > 1_600 ? -1
            : spanKilometres > 800 ? 3 : spanKilometres > 400 ? 6 : 7
        var shown = 0
        for city in maxCityRank < 0 ? [] : atlas.cities {
            if shown >= 7 { break }
            guard city.rank <= maxCityRank, visible(city.point) else { continue }
            if route.stops.contains(where: { $0.place.point.kilometres(to: city.point) < 12 })
                || (route.destination.map { $0.point.kilometres(to: city.point) < 12 } ?? false) { continue }
            let spot = at(city.point)
            let box = CGRect(x: spot.x - 3, y: spot.y - 8, width: Fonts.width(city.name, Fonts.city) + 12, height: 16)
            guard !overlaps(box, placed), fits(box, 4) else { continue }
            placed.append(box)
            labels.append(Label(frame: box, text: city.name, kind: .city))
            shown += 1
        }
    }
}

// MARK: - Drawing

enum MapPainter {
    /// Space, ocean, land, visited countries, lakes, night, borders and the globe's shading.
    static func drawBase(_ context: inout GraphicsContext, size: CGSize, atlas: WorldAtlas, route: ParcelRoute,
                         camera: GlobeCamera, palette: MapPalette, night: Date?) {
        let projection = GlobeProjection(camera)
        let span = min(size.width, size.height) / camera.scale
        let detail: WorldAtlas.Detail = span < 0.45 ? .fine : .coarse
        let layer = atlas.layer(detail)
        let corners = [CGPoint.zero, CGPoint(x: size.width, y: 0), CGPoint(x: 0, y: size.height), CGPoint(x: size.width, y: size.height)]
        let reach = (corners.map { hypot($0.x - camera.offset.x, $0.y - camera.offset.y) }.max() ?? 0) / camera.scale
        // Only shapes whose cap reaches the view: a close-up draws a few countries, not all of them.
        let view = reach >= 1 ? Double.pi / 2 : asin(reach) + 0.02
        let inView = { (part: WorldAtlas.Part) in acos(max(-1, min(1, simd_dot(part.center, projection.forward)))) - part.radius < view }
        // 0 in a close-up, 1 once the curve of the Earth shows.
        let globe = max(0, min(1, (span - 0.5) / 0.9))
        let bounds = CGRect(origin: .zero, size: size)
        let disk = Path(ellipseIn: CGRect(x: camera.offset.x - camera.scale, y: camera.offset.y - camera.scale,
                                          width: camera.scale * 2, height: camera.scale * 2))

        if let space = palette.space { context.fill(Path(bounds), with: .color(space)) }
        if let ocean = palette.ocean { context.fill(reach < 1 ? Path(bounds) : disk, with: .color(ocean)) }
        if globe > 0, let grid = palette.grid {
            var lines = Path()
            for line in MapGeometry.graticule { MapGeometry.addLine(&lines, line, projection) }
            var faded = context
            faded.opacity = globe
            faded.stroke(lines, with: .color(grid), lineWidth: 0.6)
        }
        let visited = max(0, min(1, (span * GeoPoint.earthKilometres - 800) / 1600))
        let evenOdd = FillStyle(eoFill: true)
        context.drawLayer { land in
            var shapes = Path()
            for part in layer.land where inView(part) { MapGeometry.addPart(&shapes, part, projection, disk: disk) }
            land.fill(shapes, with: .color(palette.land), style: evenOdd)
            // Countries the parcel passed through, once the view is wide enough to hold several.
            if visited > 0 {
                var countries = Path()
                for code in route.countries {
                    for part in layer.byCode[code]?.parts ?? [] where inView(part) { MapGeometry.addPart(&countries, part, projection, disk: disk) }
                }
                var faded = land
                faded.opacity = visited
                faded.fill(countries, with: .color(palette.visited), style: evenOdd)
            }
            if detail == .fine {
                var lakes = Path()
                for part in atlas.lakes where inView(part) { MapGeometry.addPart(&lakes, part, projection, disk: disk) }
                if let ocean = palette.ocean {
                    land.fill(lakes, with: .color(ocean), style: evenOdd)
                } else {
                    var cut = land
                    cut.blendMode = .destinationOut
                    cut.fill(lakes, with: .color(.black), style: evenOdd)
                }
            }
        }
        if let night, globe > 0, let shadow = palette.night {
            // The night side darkens over 24° past the terminator, like dusk: twenty rings, each drawn
            // once at its own depth, since stacking twenty faint fills rounds them away.
            let sun = GlobeCamera.subsolarPoint(night)
            let antipode = GeoPoint(longitude: sun.longitude + 180, latitude: -sun.latitude).vector
            for band in 0..<20 {
                let outer = (92 - 1.2 * Double(band)) * .pi / 180
                var ring = MapGeometry.cap(around: antipode, radius: outer, projection, disk: disk)
                if band < 19 { ring.addPath(MapGeometry.cap(around: antipode, radius: outer - 1.2 * .pi / 180, projection, disk: disk)) }
                var faded = context
                faded.opacity = globe * Double(band + 1) / 20
                faded.fill(ring, with: .color(shadow), style: evenOdd)
            }
        }
        var borders = Path()
        for part in layer.borders where inView(part) {
            for line in part.rings { MapGeometry.addLine(&borders, line, projection) }
        }
        context.stroke(borders, with: .color(palette.border), lineWidth: detail == .fine ? 0.8 : 0.55)
        if globe > 0, let shade = palette.shade {
            // A soft falloff toward the rim makes the globe read as a sphere.
            var faded = context
            faded.opacity = globe
            faded.fill(disk, with: .radialGradient(Gradient(colors: [.clear, shade]), center: camera.offset,
                                                   startRadius: camera.scale * 0.55, endRadius: camera.scale))
        }
        if globe > 0, let limb = palette.limb {
            var faded = context
            faded.opacity = globe
            faded.stroke(disk, with: .color(limb), lineWidth: 1)
        }
    }

    static func drawLegs(_ context: inout GraphicsContext, _ overlay: MapOverlay, palette: MapPalette) {
        for leg in overlay.legs {
            switch leg.kind {
            case .travelled:
                context.stroke(leg.path, with: .color(palette.route), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
            case .approximate:
                var faded = context
                faded.opacity = 0.75
                faded.stroke(leg.path, with: .color(palette.route),
                             style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round, dash: [0.1, 5]))
            case .remaining:
                context.stroke(leg.path, with: .color(palette.routeMuted),
                               style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round, dash: [3, 5]))
            }
        }
    }

    /// Stops, place names and pointers. Faint names and pointers wait for the camera to land.
    static func drawMarks(_ context: inout GraphicsContext, _ overlay: MapOverlay, palette: MapPalette, moving: Bool) {
        for dot in overlay.dots {
            let radius: CGFloat = switch dot.kind {
            case .current: 5
            case .origin: 3.5
            case .stop: 2.6
            case .lastKnown, .area, .destination: 4.5
            }
            let circle = Path(ellipseIn: CGRect(x: dot.point.x - radius, y: dot.point.y - radius, width: radius * 2, height: radius * 2))
            switch dot.kind {
            case .current:
                context.fill(circle, with: .color(palette.accent))
                context.stroke(circle, with: .color(palette.currentRing), lineWidth: 2)
            case .lastKnown:
                context.fill(circle, with: .color(palette.currentRing))
                context.stroke(circle, with: .color(palette.accent), lineWidth: 2)
            case .destination:
                context.fill(circle, with: .color(palette.dotRing))
                context.stroke(circle, with: .color(palette.routeMuted), lineWidth: 1.5)
            case .area:
                context.stroke(circle, with: .color(palette.route), style: StrokeStyle(lineWidth: 1.4, dash: [1.6, 2.4]))
            case .origin, .stop:
                context.fill(circle, with: .color(palette.route))
                context.stroke(circle, with: .color(palette.dotRing), lineWidth: 1.5)
            }
        }
        for label in overlay.labels where !(moving && (label.kind == .context || label.kind == .city)) {
            let middle = label.frame.midY
            switch label.kind {
            case .current, .end, .stop:
                context.fill(Path(roundedRect: label.frame, cornerRadius: 7), with: .color(palette.labelBackground))
                context.draw(Text(label.text).font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(label.kind == .current ? palette.labelStrong : palette.label),
                             at: CGPoint(x: label.frame.minX + 7, y: middle), anchor: .leading)
            case .area:
                context.draw(Text(label.text).font(.system(size: 10.5, weight: .medium)).tracking(0.84).foregroundStyle(palette.label),
                             at: CGPoint(x: label.frame.minX + 5, y: middle), anchor: .leading)
            case .context:
                context.draw(Text(label.text).font(.system(size: 9.5, weight: .medium)).tracking(0.95)
                    .foregroundStyle(palette.label.opacity(0.72)), at: CGPoint(x: label.frame.minX + 4, y: middle), anchor: .leading)
            case .city:
                context.fill(Path(ellipseIn: CGRect(x: label.frame.minX + 1, y: label.frame.minY + 6, width: 4, height: 4)),
                             with: .color(palette.label.opacity(0.44)))
                context.draw(Text(label.text).font(.system(size: 10)).foregroundStyle(palette.label.opacity(0.8)),
                             at: CGPoint(x: label.frame.minX + 9, y: middle), anchor: .leading)
            }
        }
        guard !moving else { return }
        for pointer in overlay.pointers {
            let frame = CGRect(x: pointer.center.x - pointer.width / 2, y: pointer.center.y - 13, width: pointer.width, height: 26)
            context.fill(Path(roundedRect: frame, cornerRadius: 13), with: .color(palette.labelBackground))
            var arrow = Path()
            arrow.move(to: CGPoint(x: 2, y: 6))
            arrow.addLine(to: CGPoint(x: 10, y: 6))
            arrow.move(to: CGPoint(x: 7, y: 3))
            arrow.addLine(to: CGPoint(x: 10, y: 6))
            arrow.addLine(to: CGPoint(x: 7, y: 9))
            let transform = CGAffineTransform(translationX: frame.minX + 13.5, y: frame.midY)
                .rotated(by: pointer.angle)
                .scaledBy(x: 11 / 12, y: 11 / 12)
                .translatedBy(x: -6, y: -6)
            context.stroke(arrow.applying(transform), with: .color(palette.label),
                           style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            let nameX = frame.minX + 24
            context.draw(Text(pointer.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(palette.labelStrong),
                         at: CGPoint(x: nameX, y: frame.midY), anchor: .leading)
            let detailX = nameX + MapOverlay.Fonts.width(pointer.name, MapOverlay.Fonts.pointerName)
                + MapOverlay.Fonts.width(" ", MapOverlay.Fonts.pointerDetail)
            context.draw(Text(pointer.detail).font(.system(size: 11)).foregroundStyle(palette.label),
                         at: CGPoint(x: detailX, y: frame.midY), anchor: .leading)
        }
    }
}

// MARK: - View

/// A parcel's journey on the globe: the whole trip, or the last mile up close. The camera flies
/// between the two, and an interactive map can be dragged and pinched.
struct WorldMapView: View {
    let atlas: WorldAtlas
    let route: ParcelRoute
    let mode: ParcelRoute.Mode
    let palette: MapPalette
    var labels: MapLabels = .all
    /// Faint country and city names for orientation.
    var showsContext = true
    var interactive = false
    /// Pinching zooms for a moment; the map settles back when the fingers lift.
    var peek = false
    /// When the scene happens, to shade the night side; nil draws no night.
    var night: Date?
    /// Pulses the parcel's current position.
    var live = false
    var insets = EdgeInsets()
    /// Changes to bring a moved map back to the parcel.
    var recenter = 0
    var language: AppLanguage = .en
    var onFreeChange: (Bool) -> Void = { _ in }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var camera: GlobeCamera?
    @State private var flight: Flight?
    @State private var gestureStart: GlobeCamera?
    @State private var zooming = false
    @State private var free = false

    private struct Flight {
        let id = UUID()
        let path: (Double) -> GlobeCamera
        let start: Date
        let duration: Double

        func progress(at date: Date) -> Double { min(1, max(0, date.timeIntervalSince(start) / duration)) }
        func camera(at date: Date) -> GlobeCamera { path(GlobeCamera.easeInOut(progress(at: date))) }
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let target = targetCamera(in: size)
            TimelineView(.animation(paused: flight == nil)) { timeline in
                let shown = flight?.camera(at: timeline.date) ?? camera ?? target
                let moving = flight.map { $0.progress(at: timeline.date) < 1 } ?? false
                let overlay = MapOverlay(
                    route: route, camera: shown, size: size, insets: insets, labels: labels, mode: mode, context: showsContext,
                    atlas: atlas, locale: language.locale, countryName: { TrackingLocation.countryName($0, language: language) }
                )
                ZStack(alignment: .topLeading) {
                    Canvas { context, size in
                        MapPainter.drawBase(&context, size: size, atlas: atlas, route: route, camera: shown, palette: palette, night: night)
                        MapPainter.drawLegs(&context, overlay, palette: palette)
                    }
                    if live, !reduceMotion, let dot = overlay.dots.first(where: { $0.kind == .current }) {
                        PulsingHalo(color: palette.accent).position(dot.point)
                    }
                    Canvas { context, _ in
                        MapPainter.drawMarks(&context, overlay, palette: palette, moving: moving)
                    }
                }
            }
            .onAppear { if camera == nil { camera = target } }
            // Only a change of view, or recentering, brings a moved map back; a new frame or scan leaves it where it was put.
            // Otherwise the view buttons that appear when it moves would resize the frame, pull it back and vanish.
            .onChange(of: target) { _, next in if !free { fly(to: next, size: size) } }
            .onChange(of: mode) { _, _ in fly(to: target, size: size) }
            .onChange(of: recenter) { _, _ in fly(to: target, size: size) }
            .contentShape(Rectangle())
            .gesture(moveGesture(size: size), including: interactive ? .all : .subviews)
            .simultaneousGesture(peekGesture(size: size, target: target), including: peek && !interactive ? .all : .subviews)
        }
    }

    private func targetCamera(in size: CGSize) -> GlobeCamera {
        let inner = min(size.width - insets.leading - insets.trailing, size.height - insets.top - insets.bottom)
        let pad = min(40, inner * 0.12)
        let box = CGRect(x: insets.leading + pad, y: insets.top + pad,
                         width: max(size.width - insets.leading - insets.trailing - pad * 2, 40),
                         height: max(size.height - insets.top - insets.bottom - pad * 2, 40))
        let destination = route.destination?.point
        if mode == .now, let current = route.current?.place.point {
            var points = route.near.map(\.place.point)
            if let destination, destination.kilometres(to: current) < ParcelRoute.nearKilometres { points.append(destination) }
            return .fit(points, in: box, minimumKilometres: 260)
        }
        let ends = route.stops.map(\.place.point) + (destination.map { [$0] } ?? [])
        // Frame the arcs as well as their ends, so a bowed route never leaves the view.
        var arcs = route.legs.map { ($0.from.point, $0.to.point, $0.kilometres) }
        if let current = route.current?.place.point, let destination { arcs.append((current, destination, route.remainingKilometres ?? 0)) }
        let middles = arcs.filter { $0.2 > 300 }.flatMap { from, to, _ in [0.25, 0.5, 0.75].map { from.interpolated(to: to, $0) } }
        let minimum: Double = switch route.scale {
        case .world: 400
        case .region: 300
        case .local: 120
        case .city: 24
        case .point: 260
        case .none: 0
        }
        // A route of countries only frames the countries, not a town-sized window on their label points.
        let countriesOnly = !route.stops.isEmpty && route.stops.allSatisfy(\.place.isCountry)
        guard !ends.isEmpty else {
            return .fit([GeoPoint(longitude: 8.2, latitude: 42)], in: box, minimumKilometres: 1e5, globeAbove: -1)
        }
        return .fit(ends + middles, in: box, minimumKilometres: countriesOnly ? max(minimum, 1_500) : minimum, tilt: route.scale == .world)
    }

    private func fly(to target: GlobeCamera, size: CGSize) {
        // Already there or on the way, as when a new view also changes the target.
        if !free, camera == target { return }
        let from = flight?.camera(at: .now) ?? camera
        if free {
            free = false
            onFreeChange(false)
        }
        camera = target
        guard let from, from != target, !reduceMotion else {
            flight = nil
            return
        }
        let next = Flight(path: GlobeCamera.flight(from: from, to: target, viewport: max(size.width, size.height)), start: .now,
                          duration: GlobeCamera.flightDuration(from: from, to: target))
        flight = next
        DispatchQueue.main.asyncAfter(deadline: .now() + next.duration) {
            if flight?.id == next.id { flight = nil }
        }
    }

    /// Where zooming settles a globe that no longer fills the view, and how much view there is.
    private func zoomArea(_ size: CGSize) -> (middle: CGPoint, viewport: Double) {
        (CGPoint(x: (insets.leading + size.width - insets.trailing) / 2, y: (insets.top + size.height - insets.bottom) / 2),
         min(size.width - insets.leading - insets.trailing, size.height - insets.top - insets.bottom))
    }

    /// The camera the gesture starts from: wherever a flight has got to.
    private func beginGesture() {
        guard gestureStart == nil else { return }
        gestureStart = flight?.camera(at: .now) ?? camera
        flight = nil
    }

    /// Pinching zooms about the fingers; one finger turns the globe.
    private func moveGesture(size: CGSize) -> some Gesture {
        SimultaneousGesture(DragGesture(minimumDistance: 4), MagnifyGesture())
            .onChanged { value in
                beginGesture()
                if let zoom = value.second {
                    // A pinch starts from where the map is now, even mid-drag.
                    if !zooming {
                        zooming = true
                        gestureStart = camera ?? gestureStart
                    }
                    guard let start = gestureStart else { return }
                    let view = zoomArea(size)
                    camera = start.zoomed(by: zoom.magnification, around: zoom.startLocation, middle: view.middle, viewport: view.viewport)
                } else if let drag = value.first, !zooming, let start = gestureStart {
                    let degrees = 180 / .pi / start.scale
                    camera = GlobeCamera(
                        center: GeoPoint(longitude: start.center.longitude - drag.translation.width * degrees,
                                         latitude: max(-80, min(80, start.center.latitude + drag.translation.height * degrees))),
                        scale: start.scale, offset: start.offset
                    )
                } else {
                    return
                }
                if !free {
                    free = true
                    onFreeChange(true)
                }
            }
            .onEnded { _ in
                gestureStart = nil
                zooming = false
            }
    }

    /// A card's map zooms under the fingers, then settles back.
    private func peekGesture(size: CGSize, target: GlobeCamera) -> some Gesture {
        MagnifyGesture()
            .onChanged { zoom in
                beginGesture()
                guard let start = gestureStart else { return }
                let view = zoomArea(size)
                camera = start.zoomed(by: zoom.magnification, around: zoom.startLocation, middle: view.middle, viewport: view.viewport)
            }
            .onEnded { _ in
                gestureStart = nil
                fly(to: target, size: size)
            }
    }
}

private struct PulsingHalo: View {
    let color: Color
    @State private var expanded = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .scaleEffect(expanded ? 3.4 : 1)
            .opacity(expanded ? 0 : 0.35)
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.easeOut(duration: 2.4).repeatForever(autoreverses: false)) { expanded = true }
            }
    }
}
