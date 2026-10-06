import simd
import SwiftUI

// MARK: - Tiles

/// What the map shows up close: rivers, lakes, built-up areas, main roads and towns, cut into tiles of a few
/// degrees. It follows the same rules as the web map (`src/components/map/detail.ts`).
struct DetailTile: Sendable {
    /// A line or an outline as unit vectors, with the smallest cap around it.
    struct Shape: Sendable {
        /// 0 for what shows first as the map closes in, 2 for what shows last.
        let level: Int
        let points: [SIMD3<Double>]
        /// The points where the shape was cut at its tile's edge: its outline keeps its corner there, to meet the rest of the shape.
        let cut: [Bool]
        let center: SIMD3<Double>
        /// In radians.
        let radius: Double
    }

    struct Town: Sendable, Equatable {
        let point: GeoPoint
        let name: String
        /// Its inhabitants, in thousands.
        let thousands: Int
    }

    let rivers: [Shape]
    let lakes: [Shape]
    let urban: [Shape]
    let roads: [Shape]
    /// The largest first.
    let towns: [Town]
}

extension DetailTile {
    private struct File: Decodable {
        struct Town: Decodable {
            let longitude: Int
            let latitude: Int
            let name: String
            let thousands: Int

            init(from decoder: Decoder) throws {
                var values = try decoder.unkeyedContainer()
                longitude = try values.decode(Int.self)
                latitude = try values.decode(Int.self)
                name = try values.decode(String.self)
                thousands = try values.decode(Int.self)
            }
        }

        let rivers: [[Int]]
        let lakes: [[Int]]
        let urban: [[Int]]
        let roads: [[Int]]
        let towns: [Town]
    }

    /// A tile as its file holds it: each shape a level, then its points as steps from one to the next.
    init(json: Data, precision: Double, degrees: Double) throws {
        let file = try JSONDecoder().decode(File.self, from: json)
        let edge = Int(degrees * precision)
        let shape = { (flat: [Int]) -> Shape in
            var points: [SIMD3<Double>] = []
            var cut: [Bool] = []
            points.reserveCapacity(flat.count / 2)
            cut.reserveCapacity(flat.count / 2)
            var longitude = 0
            var latitude = 0
            var index = 1
            while index + 1 < flat.count {
                longitude += flat[index]
                latitude += flat[index + 1]
                points.append(GeoPoint(longitude: Double(longitude) / precision, latitude: Double(latitude) / precision).vector)
                cut.append(longitude % edge == 0 || latitude % edge == 0)
                index += 2
            }
            let sum = points.reduce(SIMD3<Double>.zero, +)
            let length = simd_length(sum)
            let center = length > 1e-9 ? sum / length : (points.first ?? SIMD3(1, 0, 0))
            let radius = points.reduce(0.0) { max($0, acos(max(-1, min(1, simd_dot(center, $1))))) }
            return Shape(level: flat.first ?? 0, points: points, cut: cut, center: center, radius: radius)
        }
        rivers = file.rivers.map(shape)
        lakes = file.lakes.map(shape)
        urban = file.urban.map(shape)
        roads = file.roads.map(shape)
        towns = file.towns.map {
            Town(point: GeoPoint(longitude: Double($0.longitude) / precision, latitude: Double($0.latitude) / precision), name: $0.name,
                 thousands: $0.thousands)
        }
    }
}

/// The tiles as they ship with the app, in `WorldDetail.pack`: a first line that says where each tile starts,
/// then the tiles the web map reads one by one, each one compressed. A close-up reads the few it shows, so
/// showing it asks no map service anything.
struct WorldDetailPack: Sendable {
    /// How wide a view may be, across its shorter side, to count as a close-up: under it the opened map shows what is in the tiles.
    static let closeUpKilometres = 560.0
    /// Where each level starts to show, in kilometres across the view, and where it is fully there.
    private static let levels: [(from: Double, full: Double)] = [(closeUpKilometres, 440), (400, 320), (230, 170)]

    let degrees: Double
    let precision: Double
    /// The tiles there are: the open sea has none.
    let keys: Set<String>
    private let data: Data
    private let start: Int
    private let index: [String: [Int]]

    private struct Header: Decodable {
        let degrees: Double
        let precision: Double
        let tiles: [String: [Int]]
    }

    /// Read once, off the main thread, when an opened map first closes in.
    static let bundled = Task.detached(priority: .userInitiated) { () -> WorldDetailPack? in
        guard let url = Bundle.main.url(forResource: "WorldDetail", withExtension: "pack"),
              let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return try? WorldDetailPack(data: data)
    }

    init(data: Data) throws {
        guard let end = data.firstIndex(of: 0x0A) else { throw CocoaError(.fileReadCorruptFile) }
        let header = try JSONDecoder().decode(Header.self, from: data[data.startIndex..<end])
        degrees = header.degrees
        precision = header.precision
        index = header.tiles
        keys = Set(header.tiles.keys)
        self.data = data
        start = end + 1
    }

    /// One tile, or nil where there is none.
    func tile(_ key: String) throws -> DetailTile? {
        guard let place = index[key], place.count == 2, place[0] >= 0, place[1] > 0, start + place[0] + place[1] <= data.endIndex else { return nil }
        let packed = data.subdata(in: (start + place[0])..<(start + place[0] + place[1]))
        let json = try (packed as NSData).decompressed(using: .zlib) as Data
        return try DetailTile(json: json, precision: precision, degrees: degrees)
    }

    /// How wide the view is across its shorter side, in kilometres.
    static func spanKilometres(_ camera: GlobeCamera, in size: CGSize) -> Double {
        min(size.width, size.height) / camera.scale * GeoPoint.earthKilometres
    }

    /// The tiles a close-up shows; none while the view is too wide for them.
    func keys(in camera: GlobeCamera, size: CGSize) -> [String] {
        guard Self.spanKilometres(camera, in: size) < Self.closeUpKilometres else { return [] }
        let projection = GlobeProjection(camera)
        var found = Set<String>()
        // The view is far smaller than a tile, so a few points across it find every tile it touches.
        for column in 0...6 {
            for row in 0...8 {
                guard let point = projection.invert(CGPoint(x: size.width * Double(column) / 6, y: size.height * Double(row) / 8)) else { continue }
                let x = min(Int(360 / degrees) - 1, Int(((point.longitude + 180) / degrees).rounded(.down)))
                let y = min(Int(180 / degrees) - 1, Int(((point.latitude + 90) / degrees).rounded(.down)))
                let key = "\(x)_\(y)"
                if keys.contains(key) { found.insert(key) }
            }
        }
        return found.sorted()
    }

    /// How strongly each level shows in a view this wide: 0 not at all, 1 fully.
    static func strengths(_ kilometres: Double) -> [Double] {
        levels.map { max(0, min(1, ($0.from - kilometres) / ($0.from - $0.full))) }
    }
}

/// The tiles one opened map has read so far.
@MainActor
final class WorldDetailStore: ObservableObject {
    @Published private(set) var tiles: [String: DetailTile] = [:]
    /// Nil until the pack's first line has been read.
    @Published private(set) var pack: WorldDetailPack?
    private var asked = Set<String>()
    /// The tiles in the order they were last shown, the oldest first.
    private var shown: [String] = []
    /// Tiles kept once read: a few journeys' worth.
    private static let kept = 16

    func open() async {
        if pack == nil { pack = await WorldDetailPack.bundled.value }
    }

    /// Reads the tiles that are not read yet, off the main thread.
    func need(_ keys: [String]) {
        guard let pack else { return }
        shown = shown.filter { !keys.contains($0) } + keys
        for key in keys where tiles[key] == nil && !asked.contains(key) {
            asked.insert(key)
            Task {
                let tile = await Task.detached(priority: .userInitiated) { try? pack.tile(key) }.value
                asked.remove(key)
                guard let tile else { return }
                tiles[key] = tile
                for oldest in shown where tiles.count > Self.kept && !keys.contains(oldest) { tiles[oldest] = nil }
            }
        }
    }
}

/// What an opened map knows of its close-ups: the tiles read so far, and how to ask for more.
struct MapDetail {
    var pack: WorldDetailPack
    var tiles: [String: DetailTile]
    var need: ([String]) -> Void
}

// MARK: - Drawing

extension MapPainter {
    /// Draws the tiles over the land: built-up areas, then roads, then water. A shape the view cannot hold is
    /// skipped whole. The shapes are drawn for a far wider view than the closest one, so their corners are
    /// rounded: a river bends, it does not turn.
    static func drawDetail(_ context: inout GraphicsContext, tiles: [DetailTile], camera: GlobeCamera, size: CGSize, palette: MapPalette) {
        let kilometres = WorldDetailPack.spanKilometres(camera, in: size)
        let strengths = WorldDetailPack.strengths(kilometres)
        guard !tiles.isEmpty, strengths[0] > 0 else { return }
        let projection = GlobeProjection(camera)
        let corners = [CGPoint.zero, CGPoint(x: size.width, y: 0), CGPoint(x: 0, y: size.height), CGPoint(x: size.width, y: size.height)]
        let reach = (corners.map { hypot($0.x - camera.offset.x, $0.y - camera.offset.y) }.max() ?? 0) / camera.scale
        let view = asin(min(1, reach)) + 0.01
        var points: [CGPoint] = []
        var sharp: [Bool] = []

        /// Every shape of one level of a layer that the view holds, as one path.
        func path(_ layer: KeyPath<DetailTile, [DetailTile.Shape]>, level: Int, closed: Bool) -> Path {
            var path = Path()
            for tile in tiles {
                for shape in tile[keyPath: layer] {
                    // Shapes come sorted by level, and one too small to see is not worth its points.
                    if shape.level > level { break }
                    guard shape.level == level, !(closed && shape.radius * camera.scale < 0.6),
                          acos(max(-1, min(1, simd_dot(shape.center, projection.forward)))) - shape.radius < view else { continue }
                    trace(&path, shape, projection, closed: closed, points: &points, sharp: &sharp)
                }
            }
            return path
        }
        /// One path for each level of a layer, as strong as the level shows.
        func layer(_ layer: KeyPath<DetailTile, [DetailTile.Shape]>, closed: Bool, in context: GraphicsContext,
                   paint: (GraphicsContext, Path, Int) -> Void) {
            for level in strengths.indices where strengths[level] > 0 {
                let shapes = path(layer, level: level, closed: closed)
                guard !shapes.isEmpty else { continue }
                var faded = context
                faded.opacity = strengths[level]
                paint(faded, shapes, level)
            }
        }
        // Lines grow a little as the map closes in, like the map itself.
        let zoom = max(1, min(1.8, pow(260 / kilometres, 0.4)))
        let line = { (width: Double) in StrokeStyle(lineWidth: width * zoom, lineCap: .butt, lineJoin: .bevel) }
        layer(\.urban, closed: true, in: context) { faded, shapes, _ in faded.fill(shapes, with: .color(palette.urban)) }
        layer(\.roads, closed: false, in: context) { faded, shapes, level in
            faded.stroke(shapes, with: .color(palette.road), style: line([1.15, 0.85, 0.65][level]))
        }
        // On a see-through map, water is cut out of the land.
        var water = context
        if palette.ocean == nil { water.blendMode = .destinationOut }
        let colour = palette.ocean ?? .black
        layer(\.rivers, closed: false, in: water) { faded, shapes, level in
            faded.stroke(shapes, with: .color(colour), style: line([1.4, 1.05, 0.8][level]))
        }
        layer(\.lakes, closed: true, in: water) { faded, shapes, _ in faded.fill(shapes, with: .color(colour)) }
    }

    /// One shape, each corner rounded between the middles of the two sides that meet there.
    private static func trace(_ path: inout Path, _ shape: DetailTile.Shape, _ projection: GlobeProjection, closed: Bool,
                              points: inout [CGPoint], sharp: inout [Bool]) {
        points.removeAll(keepingCapacity: true)
        sharp.removeAll(keepingCapacity: true)
        let last = shape.points.count - 1
        // A point that falls on the one before it adds nothing to the line: a wide view keeps one point in three.
        for (index, vector) in shape.points.enumerated() {
            let point = projection.screen(vector)
            if let previous = points.last, !shape.cut[index], index < last, abs(point.x - previous.x) + abs(point.y - previous.y) < 1.6 { continue }
            points.append(point)
            sharp.append(shape.cut[index])
        }
        let count = points.count
        guard count >= (closed ? 3 : 2) else { return }
        let middle = { (a: CGPoint, b: CGPoint) in CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2) }
        path.move(to: closed ? middle(points[count - 1], points[0]) : points[0])
        // An open line keeps its two ends as they are.
        var index = closed ? 0 : 1
        while index < (closed ? count : count - 1) {
            let next = middle(points[index], points[(index + 1) % count])
            if sharp[index] {
                path.addLine(to: points[index])
                path.addLine(to: next)
            } else {
                path.addQuadCurve(to: next, control: points[index])
            }
            index += 1
        }
        if closed {
            path.closeSubpath()
        } else {
            path.addLine(to: points[count - 1])
        }
    }
}
