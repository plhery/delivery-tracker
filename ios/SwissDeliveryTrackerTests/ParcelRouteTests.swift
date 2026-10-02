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
        // The way still to go counts too, when it leads out of the close-up.
        XCTAssertTrue(ParcelRoute(places: [kyoto], destination: switzerland).hasNearView)
        XCTAssertFalse(ParcelRoute(places: [bern], destination: zurich).hasNearView)
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
        // Probe points stay off the disk's axes, where its curve segments meet.
        let ring = stride(from: 0.0, to: 360, by: 5).map { GeoPoint(longitude: $0, latitude: -50).vector }
        let south = WorldAtlas.Part(rings: [ring], center: GeoPoint(longitude: 0, latitude: -90).vector, radius: 40 * .pi / 180)
        let tropics = GlobeCamera(center: GeoPoint(longitude: 0, latitude: -20), scale: 150, offset: CGPoint(x: 200, y: 200))
        var visible = Path()
        MapGeometry.addPart(&visible, south, GlobeProjection(tropics), disk: disk(tropics))
        XCTAssertTrue(visible.contains(GlobeProjection(tropics).project(GeoPoint(longitude: 0, latitude: -70)), eoFill: true))
        XCTAssertFalse(visible.contains(CGPoint(x: 203.1, y: 196.7), eoFill: true))
        let north = GlobeCamera(center: GeoPoint(longitude: 0, latitude: 60), scale: 150, offset: CGPoint(x: 200, y: 200))
        var hidden = Path()
        MapGeometry.addPart(&hidden, south, GlobeProjection(north), disk: disk(north))
        for point in [CGPoint(x: 203.1, y: 196.7), CGPoint(x: 207.3, y: 338.2), CGPoint(x: 61.9, y: 211.4)] {
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

    func testAFacilityIsNamedByItsTownOnACardAndInFullOnTheOpenedMap() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "World", withExtension: "json"))
        let atlas = try WorldAtlas(data: Data(contentsOf: url))
        let centre = RoutePlace(EventPlace(latitude: 47.3959, longitude: 8.4695, precision: .city, country: "CH", name: "Zürich",
                                           site: "Zürich-Mülligen"))
        XCTAssertEqual([centre.name(sites: false), centre.name(sites: true)], ["Zürich", "Zürich-Mülligen"])
        XCTAssertEqual(zurich.name(sites: true), "Zürich")
        let size = CGSize(width: 400, height: 300)
        let box = CGRect(x: 40, y: 40, width: 320, height: 220)
        func names(_ route: ParcelRoute, sites: Bool, mode: ParcelRoute.Mode = .journey) -> (labels: [String], pointers: [String]) {
            let points = mode == .now ? route.near.map(\.place.point) : route.stops.map(\.place.point)
            let overlay = MapOverlay(route: route, camera: GlobeCamera.fit(points, in: box, minimumKilometres: 120), size: size,
                                     insets: EdgeInsets(), labels: .all, sites: sites, mode: mode, context: false, atlas: atlas,
                                     locale: Locale(identifier: "en"), countryName: { $0 })
            return (overlay.labels.map(\.text), overlay.pointers.map(\.name))
        }
        // The town and the centre 7 km from it are both "Zürich": the name is written once, at the parcel.
        let route = ParcelRoute(places: [basel, centre, zurich])
        XCTAssertEqual(names(route, sites: false).labels.sorted(), ["Basel", "Zürich"])
        XCTAssertEqual(names(route, sites: true).labels.sorted(), ["Basel", "Zürich", "Zürich-Mülligen"])
        // Far from the centre, the pointer to it follows the same rule.
        let far = ParcelRoute(places: [centre, kyoto])
        XCTAssertEqual(names(far, sites: false, mode: .now).pointers, ["Zürich"])
        XCTAssertEqual(names(far, sites: true, mode: .now).pointers, ["Zürich-Mülligen"])
    }

    func testThePlaceOfTheParcelIsNamedInsideTheFrame() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "World", withExtension: "json"))
        let atlas = try WorldAtlas(data: Data(contentsOf: url))
        let size = CGSize(width: 350, height: 160)
        func overlay(_ route: ParcelRoute, _ camera: GlobeCamera, _ insets: EdgeInsets) -> MapOverlay {
            MapOverlay(route: route, camera: camera, size: size, insets: insets, labels: .ends, mode: .journey,
                       context: false, atlas: atlas, locale: Locale(identifier: "en"), countryName: { $0 })
        }
        // On a card, the parcel's place lands at the west end and the destination's ring takes the one side with room.
        let card = EdgeInsets(top: 40, leading: 16, bottom: 28, trailing: 16)
        let paris = city("Paris", "FR", 2.55, 49.01)
        let middles = [0.25, 0.5, 0.75].flatMap { [kyoto.point.interpolated(to: paris.point, $0), paris.point.interpolated(to: switzerland.point, $0)] }
        let far = GlobeCamera.fit([kyoto.point, paris.point, switzerland.point] + middles,
                                  in: CGRect(x: 16, y: 40, width: 318, height: 92).insetBy(dx: 11, dy: 11), minimumKilometres: 400, tilt: true)
        let name = try XCTUnwrap(overlay(ParcelRoute(places: [kyoto, paris], destination: switzerland), far, card).labels.first { $0.text == "Paris" })
        XCTAssertEqual(name.kind, .current)
        XCTAssertGreaterThanOrEqual(name.frame.minX, card.leading)
        XCTAssertLessThanOrEqual(name.frame.maxX, size.width - card.trailing)

        // In the corner of a small frame no side of the dot has room: the name moves in from the edge.
        let small = EdgeInsets(top: 32, leading: 125, bottom: 32, trailing: 125)
        let bergamo = city("Bergamo", "IT", 9.67, 45.7)
        let mulhouse = city("Mulhouse", "FR", 7.34, 47.75)
        let corner = GlobeCamera.fit([bergamo.point, mulhouse.point], in: CGRect(x: 125, y: 32, width: 100, height: 96).insetBy(dx: 11.52, dy: 11.52),
                                     minimumKilometres: 120)
        let moved = try XCTUnwrap(overlay(ParcelRoute(places: [bergamo, mulhouse]), corner, small).labels.first { $0.text == "Mulhouse" })
        let frame = CGRect(x: small.leading, y: small.top, width: size.width - small.leading - small.trailing,
                           height: size.height - small.top - small.bottom)
        XCTAssertTrue(frame.contains(moved.frame), "\(moved.frame)")
    }

    func testPipHasAMoodForEveryStageWithAMap() {
        let moods = Dictionary(uniqueKeysWithValues: TrackingStage.allCases.map { ($0, PipMood(stage: $0)) })
        XCTAssertEqual(moods, [
            .pending: nil, .registered: .look, .accepted: .look, .inTransit: .look, .outForDelivery: .eager, .customs: .wait,
            .readyForPickup: .wait, .failedAttempt: .worry, .exception: .worry, .returned: .worry, .delivered: .joy,
        ])
        XCTAssertNil(PipMood(stage: nil))
        for mood in PipMood.allCases {
            let extents = PipGeometry.extents(mood, side: 1)
            let away = { (point: CGPoint) in PipGeometry.outlines(mood, side: 1).map { PipGeometry.distance(from: point, to: $0) }.min() ?? 0 }
            // The middle of his box is on him; its top corner on the dot's side is not.
            XCTAssertEqual(away(CGPoint(x: extents.midX, y: extents.midY)), 0, "\(mood)")
            XCTAssertGreaterThan(away(CGPoint(x: extents.maxX, y: extents.minY)), 10, "\(mood)")
        }
        // An eager Pip's speed lines trail on the far side from the dot.
        XCTAssertEqual(PipGeometry.extents(.eager, side: 1).minX, 0)
        XCTAssertEqual(PipGeometry.extents(.eager, side: -1).maxX, 300)
        // Still unless the mood moves him: a bob that comes back to where it started, and a jump that lands.
        XCTAssertEqual(PipArtwork.motion(.look, at: 3), .identity)
        XCTAssertNotEqual(PipArtwork.motion(.joy, at: 0.28 * 2.2), .identity)
        XCTAssertEqual(PipArtwork.motion(.joy, at: 0.8 * 2.2).ty, 0, accuracy: 0.001)
        XCTAssertEqual(PipArtwork.motion(.eager, at: 0).b, PipArtwork.motion(.eager, at: 1.1).b, accuracy: 0.001)
    }

    func testPipBlinksAtTheEndOfEachPeriodAndIsLeftAloneBetween() {
        let period = PipBlink.period
        for time in [0, 1, 0.93 * period, period, period + 2] {
            XCTAssertEqual(PipBlink.eyeScale(at: time), 1, accuracy: 0.0001, "\(time)")
        }
        XCTAssertEqual(PipBlink.eyeScale(at: 0.945 * period), 0.54, accuracy: 0.001)
        XCTAssertEqual(PipBlink.eyeScale(at: 0.96 * period), PipBlink.closed, accuracy: 0.001)
        XCTAssertEqual(PipBlink.eyeScale(at: 0.98 * period), 0.54, accuracy: 0.001)
        XCTAssertEqual(PipBlink.eyeScale(at: 3.96 * period), PipBlink.closed, accuracy: 0.001)
        // The second eye follows the first, and waits for its first turn.
        XCTAssertEqual(PipBlink.eyeScale(at: 0.96 * period + PipBlink.lag, eye: 1), PipBlink.closed, accuracy: 0.001)
        XCTAssertGreaterThan(PipBlink.eyeScale(at: 0.96 * period, eye: 1), PipBlink.eyeScale(at: 0.96 * period))
        XCTAssertEqual(PipBlink.eyeScale(at: 0.01, eye: 1), 1)

        // The face is drawn for the frames of a blink only, and both eyes are open whenever it rests.
        XCTAssertEqual(PipBlink.nextFrame(after: 0), 0.93 * period, accuracy: 0.0001)
        var frames: [Double] = []
        var time = 0.0
        while time < 3 * period {
            let next = PipBlink.nextFrame(after: time)
            XCTAssertGreaterThan(next, time)
            if next - time > 1 {
                XCTAssertEqual(PipBlink.eyeScale(at: time), 1, accuracy: 0.0001, "\(time)")
                XCTAssertEqual(PipBlink.eyeScale(at: time, eye: 1), 1, accuracy: 0.0001, "\(time)")
                XCTAssertEqual(next - time, 0.93 * period - (time > 0 ? PipBlink.lag : 0), accuracy: 0.0001)
            }
            frames.append(next)
            time = next
        }
        XCTAssertLessThan(frames.count, 3 * 25)
        XCTAssertTrue(frames.contains { PipBlink.eyeScale(at: $0) < 0.2 })
        XCTAssertTrue(frames.contains { PipBlink.eyeScale(at: $0, eye: 1) < 0.2 })
    }

    func testPipStandsBesideTheDotOffItsNameAndTheRoute() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "World", withExtension: "json"))
        let atlas = try WorldAtlas(data: Data(contentsOf: url))
        let card = EdgeInsets(top: 40, leading: 16, bottom: 28, trailing: 16)
        let hamburg = city("Hamburg", "DE", 9.99, 53.55)
        let regensdorf = city("Regensdorf", "CH", 8.47, 47.43)
        // The last flag: the journey ends at the frame's edge with a stop close by, which can leave no clear spot.
        let journeys: [(name: String, route: ParcelRoute, mode: ParcelRoute.Mode, edge: Bool)] = [
            ("a last mile", ParcelRoute(places: [hamburg, regensdorf, zurich]), .now, false),
            ("a journey across a country", ParcelRoute(places: [city("Berlin", "DE", 13.4, 52.52), city("Neuenstein", "DE", 9.58, 49.2)]), .journey, false),
            ("a journey with the way still to go", ParcelRoute(places: [city("Lyon", "FR", 4.83, 45.76), basel], destination: switzerland), .journey, false),
            ("a journey across the world", ParcelRoute(places: [kyoto, leipzig, zurich]), .journey, true),
            ("a journey that ends in the east", ParcelRoute(places: [zurich, leipzig, kyoto]), .journey, true),
            ("a single place", ParcelRoute(places: [zurich]), .journey, false),
        ]
        // Next up, and the parcel's page. Both write their title over the bottom of the map.
        let frames: [(size: CGSize, floor: CGFloat, nextUp: Bool)] = [(CGSize(width: 350, height: 160), 140, true), (CGSize(width: 358, height: 176), 160, false)]
        func overlay(_ route: ParcelRoute, _ mode: ParcelRoute.Mode, _ size: CGSize, _ request: PipRequest?, _ insets: EdgeInsets) -> MapOverlay {
            MapOverlay(route: route, camera: .framing(route, mode: mode, in: size, insets: insets), size: size, insets: insets, labels: .ends,
                       mode: mode, context: false, atlas: atlas, locale: Locale(identifier: "en"), countryName: { $0 }, pip: request)
        }

        for journey in journeys {
            for frame in frames {
                // A delivered parcel is never Next up, so the open box is only drawn on the parcel's page.
                for mood in PipMood.allCases where mood != .joy || !frame.nextUp {
                    let drawn = overlay(journey.route, journey.mode, frame.size, PipRequest(mood: mood, ceiling: 52, floor: frame.floor), card)
                    let place = "\(mood) on \(journey.name) in \(Int(frame.size.width)) × \(Int(frame.size.height))"
                    let pip = try XCTUnwrap(drawn.pip, place)
                    let unit = pip.width / PipGeometry.frame.width
                    let away = { (point: CGPoint) -> CGFloat in
                        let local = CGPoint(x: (point.x - pip.origin.x) / unit, y: (point.y - pip.origin.y) / unit)
                        return (PipGeometry.outlines(pip.mood, side: pip.side).map { PipGeometry.distance(from: local, to: $0) }.min() ?? 0) * unit
                    }
                    XCTAssertEqual(pip.mood, mood)
                    // Inside the map, below the card's top row and above what the card writes over the map.
                    XCTAssertGreaterThanOrEqual(pip.box.minX, 4, place)
                    XCTAssertLessThanOrEqual(pip.box.maxX, frame.size.width - 4, place)
                    XCTAssertGreaterThanOrEqual(pip.box.minY, 52, place)
                    XCTAssertLessThanOrEqual(pip.box.maxY, frame.floor, place)
                    let dot = try XCTUnwrap(drawn.dots.first { $0.kind == .current }, place).point
                    XCTAssertGreaterThanOrEqual(away(dot), 9.99, place)
                    XCTAssertTrue(drawn.labels.contains { $0.kind == .current }, place)
                    for label in drawn.labels {
                        XCTAssertTrue(label.frame.intersection(pip.box).isNull || label.frame.intersection(pip.box).width < 0.01
                            || label.frame.intersection(pip.box).height < 0.01, "\(place): \(label.text)")
                    }
                    // He looks toward the dot from the side he stands on.
                    XCTAssertTrue(pip.side == 0 || (dot.x < pip.box.midX) == (pip.side < 0), place)
                    // With no clear spot he takes the one with the fewest overlaps: at most the stop beside the dot and the leg between them.
                    let crossed = drawn.legs.contains { leg in
                        stride(from: 0.0, through: 1, by: 1.0 / 80).contains { away(leg.path.trimmedPath(from: 0, to: $0).currentPoint ?? dot) < 1.4 }
                    }
                    XCTAssertLessThanOrEqual(drawn.dots.filter { away($0.point) < 5.9 }.count + (crossed ? 1 : 0), journey.edge ? 2 : 0, place)
                }
            }
        }

        // The parcel ends at the frame's edge: only a smaller Pip finds a clear spot.
        let world = journeys[3].route
        let delivered = try XCTUnwrap(overlay(world, .journey, frames[1].size, PipRequest(mood: .joy, ceiling: 52, floor: 160), card).pip)
        XCTAssertLessThan(delivered.width, 66)
        // With no room beside the dot he stays away, and the place keeps its name.
        let cramped = overlay(world, .journey, CGSize(width: 120, height: 70), PipRequest(mood: .joy), EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
        XCTAssertNil(cramped.pip)
        XCTAssertTrue(cramped.labels.contains { $0.text == "Zürich" })
        // Without him the map is as it was, and names keep off the route when a side allows it.
        let plain = overlay(journeys[1].route, .journey, frames[1].size, nil, card)
        XCTAssertNil(plain.pip)
        for label in plain.labels {
            XCTAssertFalse(plain.legs.contains { leg in
                stride(from: 0.0, through: 1, by: 1.0 / 80).contains { label.frame.contains(leg.path.trimmedPath(from: 0, to: $0).currentPoint ?? .zero) }
            }, label.text)
        }
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
