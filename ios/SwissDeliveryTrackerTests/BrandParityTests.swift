import SwiftUI
import XCTest
@testable import SwissDeliveryTracker

/// The carrier livery is declared once, in `packages/carriers/core/brand`, and
/// shipped to the app as `Resources/Brand.json`. The SwiftUI identity and canvas
/// keep their own code — a `Canvas` is not an SVG — so this replays the shared
/// definition against every constant they draw. Drift fails here, not on screen.
final class BrandParityTests: XCTestCase {
    private struct BrandDefinition: Decodable {
        struct Step: Decodable {
            let property: String
            let base: String
            let amount: Double
        }

        struct Truck: Decodable {
            struct ViewBox: Decodable {
                let width: Double
                let height: Double
            }

            struct Body: Decodable {
                let x: Double
                let y: Double
                let width: Double
                let height: Double
                let rx: Double
                let fill: String
                let stroke: String
            }

            struct Panel: Decodable {
                let d: String
                let points: [[Double]]
                let fill: String
                let stroke: String?
            }

            struct Wheels: Decodable {
                struct Disc: Decodable {
                    let r: Double
                    let fill: String
                }

                let centers: [[Double]]
                let tire: Disc
                let hub: Disc
            }

            struct Shape: Decodable {
                let type: String
                let d: String?
                let points: [[Double]]?
                let segments: [[[Double]]]?
                let stroke: String?
                let strokeWidth: Double?
                let fill: String?
                let cx: Double?
                let cy: Double?
                let r: Double?
            }

            let viewBox: ViewBox
            let strokeWidth: Double
            let body: Body
            let cab: Panel
            let windshield: Panel
            let wheels: Wheels
            let decals: [String: [Shape]]
        }

        let defaultColor: String
        let fallbackColor: String
        let properties: [String]
        let derivation: [Step]
        let families: [String: String]
        let palettes: [String: [String: String]]
        let decals: [String: String]
        let truck: Truck
    }

    // The bundled rules, without inheriting a previously cached live catalog.
    private let catalog = CarrierCatalog(cacheURL: nil)

    private func brand() throws -> BrandDefinition {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "Brand", withExtension: "json"))
        return try JSONDecoder().decode(BrandDefinition.self, from: Data(contentsOf: url))
    }

    private func identity(_ id: String) throws -> CarrierVisualIdentity {
        let definition = try XCTUnwrap(catalog.definitions[CarrierID(rawValue: id)], "\(id) is not in the catalog")
        return CarrierVisualIdentity(id: id, carrier: definition)
    }

    private func point(_ pair: [Double]) -> CGPoint {
        CGPoint(x: pair[0], y: pair[1])
    }

    private func points(_ pairs: [[Double]]) -> [CGPoint] {
        pairs.map(point)
    }

    func testDeclaredPalettesFamiliesAndLiveriesMatchTheCarrierFolders() throws {
        let brand = try brand()
        XCTAssertEqual(brand.properties.count, 9)
        XCTAssertFalse(brand.palettes.isEmpty)
        for (id, palette) in brand.palettes {
            let colors = try identity(id).colors
            XCTAssertEqual(colors.count, brand.properties.count, "\(id) resolves \(colors.count) colors")
            for (index, property) in brand.properties.enumerated() {
                guard let declared = palette[property] else { continue }
                XCTAssertEqual(colors[index], declared, "\(id) \(property)")
            }
        }
        for id in brand.palettes.keys {
            XCTAssertEqual(try identity(id).decal, brand.decals[id] ?? "default", "\(id) livery")
        }
        for (id, family) in brand.families {
            XCTAssertEqual(try identity(id).family, family, "\(id) family")
        }
        for name in brand.decals.values {
            XCTAssertNotNil(brand.truck.decals[name], "\(name) is not a truck livery")
        }
    }

    func testCarriersWithoutAPaletteUseTheSharedMixAmounts() throws {
        let brand = try brand()
        let sampled = ["swiss-post", "fedex", "dpd", "la-poste"].filter { brand.palettes[$0] == nil }
        XCTAssertFalse(sampled.isEmpty)
        for id in sampled {
            let color = try XCTUnwrap(catalog.definitions[CarrierID(rawValue: id)]).color
            let colors = try identity(id).colors
            XCTAssertEqual(colors.count, brand.derivation.count)
            for (index, step) in brand.derivation.enumerated() {
                XCTAssertEqual(colors[index], CarrierVisualIdentity.mix(color, step.base, step.amount), "\(id) \(step.property)")
                XCTAssertEqual(step.property, brand.properties[index])
            }
        }
    }

    func testNamedColorsMatchTheSharedBrand() throws {
        let brand = try brand()
        XCTAssertEqual(CarrierVisualIdentity.defaultCarrierColor, brand.defaultColor)
        XCTAssertEqual(CarrierVisualIdentity.fallbackColor, brand.fallbackColor)
        // A catalog color that is not a #rrggbb literal resolves to the fallback, not to black.
        XCTAssertEqual(CarrierVisualIdentity.mix("not-a-color", "#000000", 0), brand.fallbackColor)
        XCTAssertEqual(catalog.definitions[.unknown]?.color, brand.defaultColor)
    }

    func testTruckGeometryMatchesTheSharedDefinition() throws {
        let truck = try brand().truck
        XCTAssertEqual(CarrierTruckGeometry.viewBox, CGSize(width: truck.viewBox.width, height: truck.viewBox.height))
        XCTAssertEqual(CarrierTruckGeometry.strokeWidth, CGFloat(truck.strokeWidth))
        XCTAssertEqual(
            CarrierTruckGeometry.body,
            CGRect(x: truck.body.x, y: truck.body.y, width: truck.body.width, height: truck.body.height)
        )
        XCTAssertEqual(CarrierTruckGeometry.bodyCornerRadius, CGFloat(truck.body.rx))
        XCTAssertEqual(CarrierTruckGeometry.cab, points(truck.cab.points))
        XCTAssertEqual(CarrierTruckGeometry.windshield, points(truck.windshield.points))
        XCTAssertEqual(CarrierTruckGeometry.windshieldColor, truck.windshield.fill)
        XCTAssertEqual(CarrierTruckGeometry.wheelCenters, points(truck.wheels.centers))
        XCTAssertEqual(CarrierTruckGeometry.tireRadius, CGFloat(truck.wheels.tire.r))
        XCTAssertEqual(CarrierTruckGeometry.tireColor, truck.wheels.tire.fill)
        XCTAssertEqual(CarrierTruckGeometry.hubRadius, CGFloat(truck.wheels.hub.r))
        XCTAssertEqual(CarrierTruckGeometry.hubColor, truck.wheels.hub.fill)
        // The body and cab wear the identity's own colors; the glass is a literal.
        XCTAssertEqual([truck.body.fill, truck.body.stroke, truck.cab.fill, truck.cab.stroke], ["truck", "edge", "truck", "edge"])
    }

    func testDecalGeometryMatchesTheSharedDefinition() throws {
        let decals = try brand().truck.decals

        let dhl = try XCTUnwrap(decals["dhl"]?.first)
        XCTAssertEqual(dhl.type, "line")
        XCTAssertEqual(CarrierTruckGeometry.dhlStripes, try XCTUnwrap(dhl.segments).map(points))
        XCTAssertEqual(CarrierTruckGeometry.dhlStripeWidth, CGFloat(try XCTUnwrap(dhl.strokeWidth)))

        let ups = try XCTUnwrap(decals["ups"]?.first)
        XCTAssertEqual(ups.type, "polygon")
        XCTAssertEqual(CarrierTruckGeometry.upsShield, points(try XCTUnwrap(ups.points)))

        let fallback = try XCTUnwrap(decals["default"])
        XCTAssertEqual(fallback.map(\.type), ["line", "circle"])
        XCTAssertEqual(CarrierTruckGeometry.defaultStripe, points(try XCTUnwrap(fallback[0].segments).first ?? []))
        XCTAssertEqual(CarrierTruckGeometry.defaultStripeWidth, CGFloat(try XCTUnwrap(fallback[0].strokeWidth)))
        XCTAssertEqual(
            CarrierTruckGeometry.defaultDotCenter,
            CGPoint(x: try XCTUnwrap(fallback[1].cx), y: try XCTUnwrap(fallback[1].cy))
        )
        XCTAssertEqual(CarrierTruckGeometry.defaultDotRadius, CGFloat(try XCTUnwrap(fallback[1].r)))

        // Every livery paints with the accent, whatever the carrier's palette says.
        for shapes in decals.values {
            for shape in shapes {
                XCTAssertEqual(shape.type == "line" ? shape.stroke : shape.fill, "accent")
            }
        }
    }
}
