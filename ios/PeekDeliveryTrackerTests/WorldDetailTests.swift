import simd
import SwiftUI
import XCTest
@testable import PeekDeliveryTracker

private func city(_ name: String, _ country: String, _ longitude: Double, _ latitude: Double) -> RoutePlace {
    RoutePlace(id: name, name: name, country: country, point: GeoPoint(longitude: longitude, latitude: latitude), isCountry: false)
}

private func town(_ name: String, _ longitude: Double, _ latitude: Double, _ thousands: Int) -> DetailTile.Town {
    DetailTile.Town(point: GeoPoint(longitude: longitude, latitude: latitude), name: name, thousands: thousands)
}

private let zurich = city("Zürich", "CH", 8.55, 47.37)
private let wide = CGSize(width: 800, height: 600)
private let small = CGSize(width: 400, height: 300)
private let towns = [town("Winterthur", 8.72, 47.5, 112), town("Zug", 8.52, 47.17, 31), town("Rapperswil", 8.82, 47.23, 27), town("Baden", 8.31, 47.47, 19)]

/// A view `kilometres` across its shorter side, around Zürich unless told otherwise.
private func close(_ kilometres: Double, in size: CGSize, around center: GeoPoint = zurich.point) -> GlobeCamera {
    GlobeCamera(center: center, scale: min(size.width, size.height) / (kilometres / GeoPoint.earthKilometres),
                offset: CGPoint(x: size.width / 2, y: size.height / 2))
}

final class WorldDetailTests: XCTestCase {
    private func atlas() throws -> WorldAtlas {
        try WorldAtlas(data: Data(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "World", withExtension: "json"))))
    }

    private func pack() throws -> WorldDetailPack {
        try WorldDetailPack(data: Data(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "WorldDetail", withExtension: "pack"))))
    }

    /// The towns a close-up names for bearings.
    private func bearings(_ route: ParcelRoute, _ kilometres: Double, _ given: [DetailTile.Town]?, in size: CGSize = wide) throws -> [String] {
        MapOverlay(route: route, camera: close(kilometres, in: size), size: size, insets: EdgeInsets(), labels: .all, sites: true, mode: .now,
                   context: true, atlas: try atlas(), locale: Locale(identifier: "en"), countryName: { $0 }, towns: given)
            .labels.filter { $0.kind == .city }.map(\.text)
    }

    func testTheBundledPackHoldsTheTilesOfACloseUp() throws {
        let pack = try pack()
        XCTAssertEqual(pack.degrees, 5)
        XCTAssertGreaterThan(pack.keys.count, 800)
        // 300 km across, around Zürich, reaches into the tile to the east; half as wide, around Bern, one tile holds it.
        let around = GeoPoint(longitude: 8.5, latitude: 47.4)
        XCTAssertEqual(WorldDetailPack.spanKilometres(close(300, in: small), in: small), 300, accuracy: 1e-6)
        XCTAssertEqual(pack.keys(in: close(300, in: small, around: around), size: small), ["37_27", "38_27"])
        XCTAssertEqual(pack.keys(in: close(150, in: small, around: GeoPoint(longitude: 7.5, latitude: 47)), size: small), ["37_27"])
        // A wide view asks for none, and the open ocean has none.
        XCTAssertEqual(pack.keys(in: close(800, in: small, around: around), size: small), [])
        XCTAssertEqual(pack.keys(in: close(300, in: small, around: GeoPoint(longitude: -150, latitude: -40)), size: small), [])
        // At the date line the view reaches both ends of the world.
        XCTAssertEqual(pack.keys(in: close(500, in: small, around: GeoPoint(longitude: 179.9, latitude: -17)), size: small), ["0_15", "71_14"])

        let tile = try XCTUnwrap(pack.tile("37_27"))
        XCTAssertTrue(tile.towns.contains { $0.name == "Winterthur" })
        XCTAssertTrue(tile.towns.contains { $0.name == "Konstanz" })
        // The largest towns come first, and the cities the wide map names are left to it.
        XCTAssertEqual(tile.towns.map(\.thousands), tile.towns.map(\.thousands).sorted(by: >))
        XCTAssertFalse(tile.towns.contains { $0.name == "Zürich" })
        for layer in [tile.rivers, tile.lakes, tile.urban, tile.roads] {
            XCTAssertGreaterThan(layer.count, 10)
            XCTAssertEqual(layer.map(\.level), layer.map(\.level).sorted())
            for shape in layer {
                XCTAssertEqual(shape.points.count, shape.cut.count)
                // The cap around a shape reaches every one of its points.
                XCTAssertTrue(shape.points.allSatisfy { acos(max(-1, min(1, simd_dot(shape.center, $0)))) <= shape.radius + 1e-9 })
            }
        }
        XCTAssertNil(try pack.tile("nowhere"))
        XCTAssertThrowsError(try WorldDetailPack(data: Data("no first line".utf8)))
    }

    func testATileIsReadAsLevelsStepsAndTowns() throws {
        // The Limmat, more or less: a river in three points, the last on the edge of its tile.
        let json = Data(#"{"rivers":[[1,8540,47370,-140,40,-1600,2590]],"lakes":[],"urban":[],"roads":[[0,8300,47400,400,20],[2,8500,47300,60,60]],"towns":[[8724,47506,"Winterthur",112]]}"#.utf8)
        let tile = try DetailTile(json: json, precision: 1_000, degrees: 5)
        let river = try XCTUnwrap(tile.rivers.first)
        XCTAssertEqual(river.level, 1)
        XCTAssertEqual(river.points.count, 3)
        XCTAssertEqual(GeoPoint(river.points[0]).longitude, 8.54, accuracy: 1e-6)
        XCTAssertEqual(GeoPoint(river.points[0]).latitude, 47.37, accuracy: 1e-6)
        XCTAssertEqual(GeoPoint(river.points[2]).longitude, 6.8, accuracy: 1e-6)
        XCTAssertEqual(GeoPoint(river.points[2]).latitude, 50, accuracy: 1e-6)
        // Only the point on the tile's edge is one the river was cut at.
        XCTAssertEqual(river.cut, [false, false, true])
        XCTAssertGreaterThan(river.radius, 0.02)
        XCTAssertLessThan(river.radius, 0.06)
        XCTAssertEqual(tile.roads.map(\.level), [0, 2])
        XCTAssertEqual(tile.towns, [town("Winterthur", 8.724, 47.506, 112)])
    }

    func testEachLevelComesInAsTheViewClosesIn() {
        XCTAssertEqual(WorldDetailPack.strengths(700), [0, 0, 0])
        XCTAssertEqual(WorldDetailPack.strengths(500), [0.5, 0, 0])
        XCTAssertEqual(WorldDetailPack.strengths(360), [1, 0.5, 0])
        XCTAssertEqual(WorldDetailPack.strengths(200), [1, 1, 0.5])
        XCTAssertEqual(WorldDetailPack.strengths(60), [1, 1, 1])
    }

    func testACloseUpNamesSmallerTownsTheCloserTheView() throws {
        let route = ParcelRoute(places: [zurich])
        XCTAssertFalse(try bearings(route, 500, towns).contains("Winterthur"))
        XCTAssertTrue(try bearings(route, 300, towns).contains("Winterthur"))
        XCTAssertFalse(try bearings(route, 300, towns).contains("Zug"))
        XCTAssertTrue(Set(try bearings(route, 200, towns)).isSuperset(of: ["Winterthur", "Zug", "Rapperswil"]))
        XCTAssertFalse(try bearings(route, 200, towns).contains("Baden"))
        XCTAssertTrue(Set(try bearings(route, 100, towns)).isSuperset(of: ["Winterthur", "Zug", "Rapperswil", "Baden"]))
        // A map that was given no towns names the large cities, a few of them, as before.
        XCTAssertEqual(try bearings(route, 100, nil), ["Luzern"])
        XCTAssertLessThanOrEqual(try bearings(route, 300, nil).count, 7)
        XCTAssertGreaterThan(try bearings(route, 300, []).count, 7)
    }

    func testAPlaceTheParcelPassedThroughKeepsItsOwnName() throws {
        let mulligen = RoutePlace(EventPlace(latitude: 47.39, longitude: 8.49, precision: .city, country: "CH", name: "Zürich", site: "Zürich-Mülligen"))
        let route = ParcelRoute(places: [city("Regensdorf", "CH", 8.47, 47.43), mulligen])
        let given = towns + [town("Regensdorf", 8.468, 47.434, 18), town("Zürich", 8.55, 47.37, 400), town("Zürich-Mülligen", 8.6, 47.4, 20),
                             town("Adliswil", 8.52, 47.31, 19)]
        let names = try bearings(route, 60, given)
        // The town of a stop, by its place or by either of its names; a town of its own a few kilometres on is named.
        XCTAssertFalse(names.contains("Regensdorf"))
        XCTAssertFalse(names.contains("Zürich"))
        XCTAssertFalse(names.contains("Zürich-Mülligen"))
        XCTAssertTrue(names.contains("Adliswil"))
    }

    func testACloseUpNamesAsManyPlacesAsItHasRoomFor() throws {
        let route = ParcelRoute(places: [zurich])
        let many = (0..<60).map { town("Town \($0)", 8.05 + Double($0 % 10) * 0.1, 47.05 + Double($0 / 10) * 0.11, 60 - $0) }
        let few = try bearings(route, 100, many, in: small)
        let more = try bearings(route, 120, many, in: CGSize(width: 1_200, height: 900))
        // 400 × 300 has room for eight names; a screen nine times the size stops at twenty-four.
        XCTAssertGreaterThan(few.count, 4)
        XCTAssertLessThanOrEqual(few.count, 8)
        XCTAssertEqual(more.count, 24)
        // The largest towns are the first to be named.
        XCTAssertTrue(few.contains("Town 0"))
    }

    func testPipStandsClearOfWhatCoversTheMapAndKeepsHisSpotWhileItIsMoved() throws {
        let atlas = try atlas()
        let route = ParcelRoute(places: [city("Hamburg", "DE", 9.99, 53.55), zurich])
        let insets = EdgeInsets(top: 40, leading: 130, bottom: 120, trailing: 10)
        func show(_ camera: GlobeCamera, _ request: PipRequest) -> MapOverlay {
            MapOverlay(route: route, camera: camera, size: small, insets: insets, labels: .all, sites: true, mode: .now, context: true,
                       atlas: atlas, locale: Locale(identifier: "en"), countryName: { $0 }, pip: request)
        }
        func dot(_ overlay: MapOverlay) throws -> CGPoint { try XCTUnwrap(overlay.dots.first { $0.kind == .current }).point }
        var view = close(300, in: small)
        view.offset = CGPoint(x: 280, y: 110)
        let first = show(view, PipRequest(mood: .look, inset: true))
        let pip = try XCTUnwrap(first.pip)
        XCTAssertEqual(pip.origin.x - (try dot(first)).x, pip.spot.offset.width, accuracy: 1e-9)
        XCTAssertEqual(pip.origin.y - (try dot(first)).y, pip.spot.offset.height, accuracy: 1e-9)
        // Inside the room the summary and the buttons leave.
        XCTAssertGreaterThanOrEqual(pip.box.minX, insets.leading + 4)
        XCTAssertLessThanOrEqual(pip.box.maxX, small.width - insets.trailing - 4)
        XCTAssertGreaterThanOrEqual(pip.box.minY, insets.top)
        XCTAssertLessThanOrEqual(pip.box.maxY, small.height - insets.bottom)
        // Moved a little, he moves with the dot, wherever the best spot would now be.
        var moved = view
        moved.offset = CGPoint(x: 300, y: 120)
        let held = show(moved, PipRequest(mood: .look, inset: true, held: pip.spot))
        let kept = try XCTUnwrap(held.pip)
        XCTAssertEqual(kept.spot, pip.spot)
        XCTAssertEqual(kept.origin.x, (try dot(held)).x + pip.spot.offset.width, accuracy: 1e-9)
        XCTAssertEqual(kept.origin.y, (try dot(held)).y + pip.spot.offset.height, accuracy: 1e-9)
        // Moved until he would stand past the room there is, he steps out, where a Pip who had just come would pick the other side.
        var edge = view
        edge.offset.x = pip.box.midX >= (try dot(first)).x ? 388 : 132
        XCTAssertNil(show(edge, PipRequest(mood: .look, inset: true, held: pip.spot)).pip)
        XCTAssertNotNil(show(edge, PipRequest(mood: .look, inset: true)).pip)
    }

    @MainActor func testUpCloseTheTilesAreDrawnOverTheLand() throws {
        let atlas = try atlas()
        let pack = try pack()
        let route = ParcelRoute(places: [zurich])
        func picture(_ kilometres: Double, tiles: [DetailTile], palette: MapPalette = .map(accent: .red)) throws -> [UInt8] {
            let camera = close(kilometres, in: small)
            let map = Canvas { context, size in
                MapPainter.drawBase(&context, size: size, atlas: atlas, route: route, camera: camera, palette: palette, night: nil,
                                    tiles: tiles, tiled: !tiles.isEmpty)
            }
            let renderer = ImageRenderer(content: map.frame(width: small.width, height: small.height))
            renderer.scale = 1
            let image = try XCTUnwrap(renderer.cgImage)
            var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
            let context = try XCTUnwrap(CGContext(
                data: &bytes, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return bytes
        }
        func changed(_ a: [UInt8], _ b: [UInt8]) -> Int {
            stride(from: 0, to: min(a.count, b.count), by: 4).filter { a[$0] != b[$0] || a[$0 + 1] != b[$0 + 1] || a[$0 + 2] != b[$0 + 2] || a[$0 + 3] != b[$0 + 3] }.count
        }
        let tiles = try pack.keys(in: close(200, in: small), size: small).compactMap { try pack.tile($0) }
        XCTAssertFalse(tiles.isEmpty)
        // Rivers, roads and built-up areas take a fair share of a close-up, and more of a closer one.
        let near = changed(try picture(200, tiles: tiles), try picture(200, tiles: []))
        let nearer = changed(try picture(100, tiles: tiles), try picture(100, tiles: []))
        XCTAssertGreaterThan(near, 2_000)
        XCTAssertGreaterThan(nearer, 2_000)
        // A wide view is drawn as it always was.
        XCTAssertEqual(changed(try picture(700, tiles: tiles), try picture(700, tiles: [])), 0)
        // On a see-through map, water is cut out of the land rather than painted over it.
        let ink = Color(red: 0.2, green: 0.1, blue: 0.4)
        XCTAssertGreaterThan(changed(try picture(200, tiles: tiles, palette: .tint(ink: ink, surface: .white)),
                                     try picture(200, tiles: [], palette: .tint(ink: ink, surface: .white))), 500)
    }

    @MainActor func testAnOpenedMapReadsItsTilesOnceAndKeepsTheLastOnesShown() async throws {
        let store = WorldDetailStore()
        // Before the pack is open there is nothing to read from.
        store.need(["37_27"])
        XCTAssertNil(store.pack)
        await store.open()
        let pack = try XCTUnwrap(store.pack)
        store.need(["37_27", "nowhere"])
        store.need(["37_27"])
        try await eventually { store.tiles["37_27"] != nil }
        XCTAssertEqual(store.tiles.keys.sorted(), ["37_27"])
        let keys = Array(pack.keys.sorted().filter { $0 != "37_27" }.prefix(20))
        for key in keys {
            store.need([key])
            try await eventually { store.tiles[key] != nil }
            // The first tile is shown again and again, so it is never the oldest.
            store.need([keys[0]])
        }
        XCTAssertEqual(store.tiles.count, 16)
        XCTAssertNotNil(store.tiles[keys[0]])
        XCTAssertNil(store.tiles["37_27"])
        XCTAssertNil(store.tiles[keys[1]])
        XCTAssertNotNil(store.tiles[keys[19]])
    }

    @MainActor private func eventually(_ met: () -> Bool) async throws {
        for _ in 0..<500 where !met() { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(met())
    }
}
