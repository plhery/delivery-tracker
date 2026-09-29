import SwiftUI
import XCTest
@testable import SwissDeliveryTracker

private func city(_ name: String, _ country: String, _ longitude: Double, _ latitude: Double) -> RoutePlace {
    RoutePlace(id: name, name: name, country: country, point: GeoPoint(longitude: longitude, latitude: latitude), isCountry: false)
}

private let kyoto = city("Kyoto", "JP", 135.77, 35.01)
private let leipzig = city("Leipzig", "DE", 12.37, 51.34)
private let basel = city("Basel", "CH", 7.59, 47.56)
private let zurich = city("Zürich", "CH", 8.54, 47.38)
private let bern = city("Bern", "CH", 7.45, 46.95)
private let mulligen = city("Mülligen", "CH", 8.46, 47.39)
private let switzerland = RoutePlace.country("CH", name: "Switzerland", at: GeoPoint(longitude: 7.46, latitude: 46.72))

final class ParcelRouteTests: XCTestCase {
    func testScansBecomeStopsLegsAndDistances() {
        let route = ParcelRoute(places: [kyoto, kyoto, nil, leipzig, basel, zurich])
        XCTAssertEqual(route.stops.map(\.place.name), ["Kyoto", "Leipzig", "Basel", "Zürich"])
        XCTAssertEqual(route.legs.count, 3)
        XCTAssertGreaterThan(route.kilometres, 9_000)
        XCTAssertEqual(route.countries, ["JP", "DE", "CH"])
        XCTAssertEqual(route.scale, .world)
        XCTAssertEqual(route.origin?.place, kyoto)
        XCTAssertEqual(route.current?.place, zurich)
        XCTAssertTrue(route.latestLocated)
        // Leipzig is 530 km from Zürich, so only the Swiss stops are near.
        XCTAssertEqual(route.near.map(\.place.name), ["Basel", "Zürich"])
    }

    func testCountryOnlyScansStayHonest() {
        let germany = RoutePlace.country("DE", name: "Germany", at: GeoPoint(longitude: 10.4, latitude: 51.1))
        let china = RoutePlace.country("CN", name: "China", at: GeoPoint(longitude: 106.34, latitude: 32.5))
        // A country after a city in it adds nothing; a city after its country replaces it.
        XCTAssertEqual(ParcelRoute(places: [leipzig, germany]).stops.count, 1)
        let upgraded = ParcelRoute(places: [china, city("Shenzhen", "CN", 114.06, 22.54)])
        XCTAssertEqual(upgraded.stops.map(\.place.name), ["Shenzhen"])
        XCTAssertFalse(ParcelRoute(places: [china, switzerland, nil]).latestLocated)
        XCTAssertTrue(ParcelRoute(places: [china, germany]).legs[0].isApproximate)
    }

    func testTheRemainingLegLastsUntilArrival() {
        let travelling = ParcelRoute(places: [kyoto, leipzig], destination: switzerland)
        XCTAssertEqual(travelling.destination, switzerland)
        XCTAssertGreaterThan(travelling.remainingKilometres ?? 0, 500)
        XCTAssertNil(ParcelRoute(places: [kyoto, basel], destination: switzerland).destination)
        XCTAssertNil(ParcelRoute(places: [bern], destination: city("Bern centre", "CH", 7.451, 46.949)).destination)
    }

    func testScalesAndViews() {
        XCTAssertEqual(ParcelRoute(places: []).scale, ParcelRoute.Scale.none)
        XCTAssertEqual(ParcelRoute(places: [zurich]).scale, .point)
        XCTAssertEqual(ParcelRoute(places: [zurich, mulligen]).scale, .city)
        XCTAssertEqual(ParcelRoute(places: [bern, zurich]).scale, .local)
        XCTAssertEqual(ParcelRoute(places: [leipzig, zurich]).scale, .region)
        let world = ParcelRoute(places: [kyoto, basel, zurich])
        XCTAssertTrue(world.hasNearView)
        XCTAssertFalse(ParcelRoute(places: [bern, zurich]).hasNearView)
        // The camera follows the parcel: a close-up for the last mile, the whole trip otherwise.
        XCTAssertEqual(world.defaultMode(for: .inTransit), .journey)
        XCTAssertEqual(world.defaultMode(for: .outForDelivery), .now)
        XCTAssertEqual(world.defaultMode(for: .readyForPickup), .now)
        XCTAssertEqual(world.defaultMode(for: .delivered), .journey)
        XCTAssertEqual(ParcelRoute(places: [bern, zurich]).defaultMode(for: .outForDelivery), .journey)
    }

    func testEventsAreOrderedByTimeAndCountriesNamedForTheReader() {
        func event(_ day: Int, _ place: EventPlace?) -> TrackingEvent {
            TrackingEvent(id: UUID(), packageID: UUID(), stage: .inTransit, description: "Scan", location: nil,
                          occurredAt: "2026-09-\(day)T08:00:00Z", place: place)
        }
        let route = ParcelRoute(events: [
            event(28, EventPlace(latitude: 47.37, longitude: 8.55, precision: .city, country: "CH", name: "Zürich")),
            event(20, EventPlace(latitude: 32.5, longitude: 106.34, precision: .country, country: "CN", name: "China")),
            event(24, nil),
        ], countryName: { $0 == "CN" ? "Chine" : $0 })
        XCTAssertEqual(route.stops.map(\.place.name), ["Chine", "Zürich"])
        XCTAssertTrue(route.latestLocated)
        XCTAssertEqual(route.stops.last?.place.id, "47.37,8.55")
    }

    func testDistancesAreRoundedTheWayAJourneyIsTold() {
        func text(_ kilometres: Double, _ locale: String = "en") -> String {
            ParcelRoute.formattedKilometres(kilometres, locale: Locale(identifier: locale))
                .replacingOccurrences(of: "\u{00A0}", with: " ")
                .replacingOccurrences(of: "\u{202F}", with: " ")
        }
        XCTAssertEqual(text(0.2), "1 km")
        XCTAssertEqual(text(8.4), "8 km")
        XCTAssertEqual(text(447), "450 km")
        XCTAssertEqual(text(9_321), "9,300 km")
        XCTAssertEqual(text(9_321, "de"), "9.300 km")
    }

    func testTheCameraFramesTheRouteAndSeesWhatItShows() {
        let box = CGRect(x: 20, y: 20, width: 360, height: 260)
        let camera = GlobeCamera.fit([kyoto.point, zurich.point], in: box, minimumKilometres: 400)
        let projection = GlobeProjection(camera)
        for place in [kyoto, zurich] {
            XCTAssertTrue(box.insetBy(dx: -1, dy: -1).contains(projection.project(place.point)), place.name)
        }
        let single = GlobeCamera.fit([zurich.point], in: box, minimumKilometres: 260)
        let centre = GlobeProjection(single).project(zurich.point)
        XCTAssertEqual(centre.x, box.midX, accuracy: 0.5)
        XCTAssertEqual(centre.y, box.midY, accuracy: 0.5)
        // Looking from nearer the equator makes a long route bow toward the pole.
        let tilted = GlobeCamera.fit([kyoto.point, zurich.point], in: box, minimumKilometres: 400, tilt: true)
        XCTAssertLessThan(tilted.center.latitude, camera.center.latitude)
        let back = projection.invert(projection.project(basel.point))
        XCTAssertEqual(back?.longitude ?? 0, basel.point.longitude, accuracy: 1e-6)
        XCTAssertEqual(back?.latitude ?? 0, basel.point.latitude, accuracy: 1e-6)
        XCTAssertNil(projection.invert(CGPoint(x: camera.offset.x + camera.scale * 2, y: camera.offset.y)))
        // The sun stands over Greenwich at noon, and over the tropic of Cancer in June.
        let sun = GlobeCamera.subsolarPoint(Date(timeIntervalSince1970: 1_782_043_200))
        XCTAssertEqual(sun.longitude, 0, accuracy: 0.5)
        XCTAssertGreaterThan(sun.latitude, 23)
    }

    func testZoomKeepsThePlaceUnderTheFingers() throws {
        let camera = GlobeCamera(center: zurich.point, scale: 2_000, offset: CGPoint(x: 200, y: 150))
        let closer = camera.zoomed(by: 2, around: CGPoint(x: 100, y: 100), middle: CGPoint(x: 200, y: 150), viewport: 300)
        XCTAssertEqual(closer.scale, 4_000, accuracy: 1e-9)
        let place = try XCTUnwrap(GlobeProjection(camera).invert(CGPoint(x: 100, y: 100)))
        let after = GlobeProjection(closer).project(place)
        XCTAssertEqual(after.x, 100, accuracy: 1e-6)
        XCTAssertEqual(after.y, 100, accuracy: 1e-6)
        // Zooming out stops at the whole globe, back in the middle.
        let globe = camera.zoomed(by: 1e-6, around: CGPoint(x: 20, y: 20), middle: CGPoint(x: 200, y: 150), viewport: 300)
        XCTAssertEqual(globe.scale, 135, accuracy: 1e-9)
        XCTAssertEqual(globe.offset, CGPoint(x: 200, y: 150))
    }

    func testShapesAroundTheFarSideFillOnlyWhatShows() {
        let disk = { (camera: GlobeCamera) in
            Path(ellipseIn: CGRect(x: camera.offset.x - camera.scale, y: camera.offset.y - camera.scale,
                                   width: camera.scale * 2, height: camera.scale * 2))
        }
        // Seen from above Kazakhstan with the sun over Japan, the night covers Europe, not Japan.
        let asia = GlobeCamera(center: GeoPoint(longitude: 70, latitude: 40), scale: 150, offset: CGPoint(x: 200, y: 200))
        let view = GlobeProjection(asia)
        let antipode = GeoPoint(longitude: 127 - 180, latitude: 2).vector
        let night = MapGeometry.cap(around: antipode, radius: 80 * .pi / 180, view, disk: disk(asia))
        XCTAssertTrue(night.contains(view.project(GeoPoint(longitude: 5, latitude: 45)), eoFill: true))
        XCTAssertFalse(night.contains(view.project(GeoPoint(longitude: 130, latitude: 35)), eoFill: true))
        // A cap around the south pole shows its northern edge from the tropics, and nothing from the north.
        let ring = stride(from: 0.0, to: 360, by: 5).map { GeoPoint(longitude: $0, latitude: -50).vector }
        let south = WorldAtlas.Part(rings: [ring], center: GeoPoint(longitude: 0, latitude: -90).vector, radius: 40 * .pi / 180)
        let tropics = GlobeCamera(center: GeoPoint(longitude: 0, latitude: -20), scale: 150, offset: CGPoint(x: 200, y: 200))
        var visible = Path()
        MapGeometry.addPart(&visible, south, GlobeProjection(tropics), disk: disk(tropics))
        XCTAssertTrue(visible.contains(GlobeProjection(tropics).project(GeoPoint(longitude: 0, latitude: -70)), eoFill: true))
        XCTAssertFalse(visible.contains(CGPoint(x: 200, y: 200), eoFill: true))
        let north = GlobeCamera(center: GeoPoint(longitude: 0, latitude: 60), scale: 150, offset: CGPoint(x: 200, y: 200))
        var hidden = Path()
        MapGeometry.addPart(&hidden, south, GlobeProjection(north), disk: disk(north))
        for point in [CGPoint(x: 200, y: 200), CGPoint(x: 200, y: 340), CGPoint(x: 60, y: 200)] {
            XCTAssertFalse(hidden.contains(point, eoFill: true), "\(point)")
        }
    }

    @MainActor
    func testTheNightSideIsDrawnWhereItIsNight() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "World", withExtension: "json"))
        let atlas = try WorldAtlas(data: Data(contentsOf: url))
        let camera = GlobeCamera(center: GeoPoint(longitude: 70, latitude: 30), scale: 180, offset: CGPoint(x: 200, y: 200))
        // The real, faint night colour, without the rim's shading.
        var palette = MapPalette.map(accent: .red)
        palette.shade = nil
        palette.limb = nil
        palette.grid = nil
        // 03:53 UTC: the sun is over China, and Europe is in the dark.
        let time = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-29T03:53:00Z"))
        let route = ParcelRoute(places: [kyoto, zurich])
        let canvas = Canvas { context, size in
            MapPainter.drawBase(&context, size: size, atlas: atlas, route: route, camera: camera, palette: palette, night: time)
        }
        .frame(width: 400, height: 400)
        let renderer = ImageRenderer(content: canvas)
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        var pixels = [UInt8](repeating: 0, count: 400 * 400 * 4)
        let context = try XCTUnwrap(CGContext(data: &pixels, width: 400, height: 400, bitsPerComponent: 8, bytesPerRow: 1_600,
                                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image, in: CGRect(x: 0, y: 0, width: 400, height: 400))
        let projection = GlobeProjection(camera)
        func brightness(_ place: GeoPoint) -> Int {
            let point = projection.project(place)
            let index = (Int(point.y) * 400 + Int(point.x)) * 4
            return Int(pixels[index]) + Int(pixels[index + 1]) + Int(pixels[index + 2])
        }
        let africa = brightness(GeoPoint(longitude: 3, latitude: 28))
        let europe = brightness(GeoPoint(longitude: 30, latitude: 50))
        let china = brightness(GeoPoint(longitude: 105, latitude: 35))
        // Deep night over the Sahara, dusk over Eastern Europe, day in China.
        XCTAssertLessThan(africa, europe - 20, "Africa \(africa), Europe \(europe)")
        XCTAssertLessThan(europe, china - 5, "Europe \(europe), China \(china)")
    }

    func testTheBundledAtlasHasCountriesBordersAndCities() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "World", withExtension: "json"))
        let atlas = try WorldAtlas(data: Data(contentsOf: url))
        let label = try XCTUnwrap(atlas.label(of: "CH"))
        XCTAssertEqual(label.longitude, 8, accuracy: 1)
        XCTAssertEqual(label.latitude, 46.8, accuracy: 1)
        XCTAssertNil(atlas.label(of: "XX"))
        XCTAssertGreaterThan(atlas.coarse.countries.count, 200)
        XCTAssertGreaterThan(atlas.fine.borders.count, 100)
        XCTAssertFalse(atlas.lakes.isEmpty)
        XCTAssertTrue(atlas.cities.contains { $0.name == "Tokyo" })
    }

    func testCloseUpNamesThePlaceAndPointsToTheFarOrigin() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "World", withExtension: "json"))
        let atlas = try WorldAtlas(data: Data(contentsOf: url))
        let route = ParcelRoute(places: [kyoto, basel, zurich])
        let size = CGSize(width: 400, height: 300)
        let box = CGRect(x: 40, y: 40, width: 320, height: 220)
        let camera = GlobeCamera.fit(route.near.map(\.place.point), in: box, minimumKilometres: 260)
        let overlay = MapOverlay(route: route, camera: camera, size: size, insets: EdgeInsets(), labels: .all, mode: .now,
                                 context: true, atlas: atlas, locale: Locale(identifier: "en"), countryName: { $0 })
        XCTAssertTrue(overlay.labels.contains { $0.text == "Zürich" && $0.kind == .current })
        let pointer = try XCTUnwrap(overlay.pointers.first)
        XCTAssertEqual(pointer.name, "Kyoto")
        XCTAssertTrue(pointer.detail.hasSuffix("km"))
        XCTAssertTrue(CGRect(origin: .zero, size: size).contains(pointer.center))
        XCTAssertTrue(overlay.dots.contains { $0.kind == .current })
    }

    func testDemoParcelsCarryPlaces() {
        let parcels = DemoRepository.seed()
        let matcha = parcels.first { $0.label.hasPrefix("Matcha") }
        XCTAssertNotNil(matcha)
        let route = ParcelRoute(events: matcha?.trackingEvents ?? [], countryName: { $0 })
        XCTAssertEqual(route.origin?.place.name, "Kyoto")
        XCTAssertEqual(route.scale, .world)
    }
}
