import SwiftUI

enum ExperimentalPalette {
    static let transit = Brand.color(light: "#22588A", dark: "#9BCBFF")
    static let pickup = Brand.warning
    static let delivered = Brand.color(light: "#24613E", dark: "#9BE0B5")
    static let lilac = Brand.color(light: "#654299", dark: "#D1B5FF")
    static let rose = Brand.color(light: "#9A3D5C", dark: "#FFADC8")
    static let ochre = Brand.color(light: "#745300", dark: "#FFD65F")

    static let transitSurface = Brand.color(light: "#DAEAFE", dark: "#213A51")
    static let pickupSurface = Brand.color(light: "#FFDDC7", dark: "#4C3123")
    static let deliveredSurface = Brand.color(light: "#DCF0D7", dark: "#243D2E")
    static let lilacSurface = Brand.color(light: "#E9DEFF", dark: "#382D4C")
    static let roseSurface = Brand.color(light: "#FADDE7", dark: "#482C39")
    static let ochreSurface = Brand.color(light: "#FFEBAB", dark: "#443918")

    static func surface(for parcel: Parcel) -> Color {
        switch parcel.currentStage {
        case .delivered: deliveredSurface
        case .customs, .exception, .failedAttempt, .readyForPickup, .returned: pickupSurface
        case .outForDelivery: ochreSurface
        case .pending, .registered, .none: lilacSurface
        default: transitSurface
        }
    }

    static func tint(for parcel: Parcel) -> Color {
        switch parcel.currentStage {
        case .delivered:
            delivered
        case .customs, .exception, .failedAttempt, .readyForPickup, .returned:
            pickup
        case .inTransit:
            transit
        case .outForDelivery:
            ochre
        case .pending, .registered, .none:
            lilac
        default:
            transit
        }
    }
}

struct ExperimentalBackdrop: View {
    var body: some View {
        Brand.background.ignoresSafeArea()
    }
}

/// A self-adhesive stamp's serpentine die cut: every edge dips into the paper in
/// even waves that meet at the corners, where each edge starts and ends at full width.
struct DieCutStampShape: Shape {
    /// The parcel's stamp is designed 44 wide and scales its waves with its width.
    static let designWidth: CGFloat = 44
    /// The length and depth of one wave. The other stamps keep these at any size.
    var wavelength: CGFloat = 3.6
    var depth: CGFloat = 1.1

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        let corners = [CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
                       CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY)]
        let inward = [CGVector(dx: 0, dy: 1), CGVector(dx: -1, dy: 0), CGVector(dx: 0, dy: -1), CGVector(dx: 1, dy: 0)]
        for side in 0..<4 {
            let from = corners[side], to = corners[(side + 1) % 4]
            let length = hypot(to.x - from.x, to.y - from.y)
            let waves = max(1, Int((length / wavelength).rounded()))
            let steps = waves * 10
            for step in 1...steps {
                let t = CGFloat(step) / CGFloat(steps)
                let dip = depth * (1 - cos(2 * .pi * CGFloat(waves) * t)) / 2
                path.addLine(to: CGPoint(x: from.x + (to.x - from.x) * t + inward[side].dx * dip,
                                         y: from.y + (to.y - from.y) * t + inward[side].dy * dip))
            }
        }
        path.closeSubpath()
        return path
    }
}

/// A globe's meridians and parallels, inside its bounding square.
struct StampGlobeLines: Shape {
    func path(in rect: CGRect) -> Path {
        let radius = rect.width / 2
        let center = CGPoint(x: rect.midX, y: rect.midY)
        var path = Path()
        path.addEllipse(in: CGRect(x: center.x - radius * 0.42, y: rect.minY, width: radius * 0.84, height: rect.height))
        path.move(to: CGPoint(x: center.x, y: rect.minY))
        path.addLine(to: CGPoint(x: center.x, y: rect.maxY))
        path.move(to: CGPoint(x: rect.minX, y: center.y))
        path.addLine(to: CGPoint(x: rect.maxX, y: center.y))
        // The two parallels, half way to each pole.
        let band = radius / 2
        let chord = (radius * radius - band * band).squareRoot()
        for y in [center.y - band, center.y + band] {
            path.move(to: CGPoint(x: center.x - chord, y: y))
            path.addLine(to: CGPoint(x: center.x + chord, y: y))
        }
        return path
    }
}

/// The parcel's stamp: the same globe on every parcel, printed in the card's own
/// colours, with the country it was posted in. The postmark lands with the delivery.
struct DeliveryPostageStamp: View {
    let parcel: Parcel
    let identity: CarrierVisualIdentity
    var width: CGFloat = 46
    let appeared: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        // Every measure below is in the stamp's 44 by 56 design, scaled to `width`.
        let unit = width / DieCutStampShape.designWidth
        let origin = parcel.stampOrigin
        // Without a caption the globe sits in the middle of the print.
        let globeY = (origin == nil ? 28 : 25) * unit
        let ink = identity.ink
        let paper = colorScheme == .dark ? identity.surface.mix(with: ink, by: 0.22) : Color(hex: "#FFFEFA")
        ZStack {
            DieCutStampShape(wavelength: 3.6 * unit, depth: 1.1 * unit)
                .fill(paper)
                .shadow(color: .black.opacity(0.16), radius: 1.2 * unit, y: 0.8 * unit)
            Rectangle()
                .fill(identity.surface)
                .padding(4.5 * unit)
            Group {
                Circle().fill(identity.surface.mix(with: ink, by: 0.14))
                StampGlobeLines().stroke(ink, lineWidth: 0.7 * unit)
                Circle().stroke(ink, lineWidth: 0.9 * unit)
            }
            .frame(width: 22 * unit, height: 22 * unit)
            .position(x: 22 * unit, y: globeY)
            Rectangle()
                .stroke(ink.opacity(0.28), lineWidth: 0.6 * unit)
                .padding(6.2 * unit)
            if let origin {
                Text(origin)
                    .font(.system(size: 5.2 * unit, weight: .bold))
                    .tracking(0.5 * unit)
                    .foregroundStyle(ink)
                    .position(x: 22 * unit, y: 45 * unit)
            }
        }
        .frame(width: width, height: 56 * unit)
        .overlay {
            if let date = parcel.stampDeliveryDate {
                ZStack {
                    Circle().stroke(ink, lineWidth: 0.9 * unit)
                    Circle().stroke(ink, lineWidth: 0.55 * unit).padding(2.8 * unit)
                    Text(date)
                        .font(.system(size: 5.2 * unit, weight: .heavy))
                        .monospacedDigit()
                        .foregroundStyle(ink)
                }
                .frame(width: 23 * unit, height: 23 * unit)
                .rotationEffect(.degrees(-12))
                .opacity(0.8)
                .position(x: 38 * unit, y: 36 * unit)
                .allowsHitTesting(false)
            }
        }
        .rotationEffect(.degrees(reduceMotion || appeared ? -2 : -10))
        .scaleEffect(reduceMotion || appeared ? 1 : 1.12)
        .animation(reduceMotion ? nil : .spring(response: 0.48, dampingFraction: 0.6).delay(0.08), value: appeared)
        .accessibilityHidden(true)
    }
}

extension View {
    func experimentalSurface(
        tint: Color = .clear,
        fill: Color = Brand.paper,
        cornerRadius: CGFloat = 26,
        shadow: Bool = true
    ) -> some View {
        background {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(fill)
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(tint.opacity(0.12))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(Brand.separator.opacity(0.42), lineWidth: 0.6)
                }
                .shadow(
                    color: shadow ? .black.opacity(0.035) : .clear,
                    radius: shadow ? 10 : 0,
                    y: shadow ? 4 : 0
                )
        }
    }

}

struct ExperimentalLiftButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .offset(y: configuration.isPressed && !reduceMotion ? 1.5 : 0)
            .brightness(configuration.isPressed ? -0.025 : 0)
            .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: configuration.isPressed)
    }
}

struct ExperimentalCarrierToken: View {
    let carrier: CarrierDefinition
    let tint: Color

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "shippingbox.fill")
                .font(.caption2.weight(.bold))
            Text(carrier.displayName)
                .lineLimit(1)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.primary)
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(tint.opacity(0.14), in: Capsule())
        .overlay(Capsule().stroke(tint.opacity(0.22), lineWidth: 0.7))
    }
}

struct ExperimentalJourneyRail: View {
    let stage: TrackingStage?
    let tint: Color
    var compact = false

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let current = max(0, min(stage?.metadata.progress ?? 0, TrackingStage.core.count - 1))

        HStack(spacing: compact ? 4 : 5) {
            ForEach(Array(TrackingStage.core.enumerated()), id: \.offset) { index, _ in
                Capsule()
                    .fill(index <= current ? tint : Color.secondary.opacity(0.15))
                    .frame(height: 3)
            }
        }
        .frame(height: 3)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: current)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(localizer.text("native.deliveryProgress"))
        .accessibilityValue(
            localizer.text("progress.step", [
                "step": current + 1,
                "total": TrackingStage.core.count,
                "stage": localizer.text(stage?.localizationKey ?? "status.pending"),
            ])
        )
    }
}

@MainActor
struct ExperimentalCopy {
    let localizer: Localizer

    var passport: String { localizer.text("passport.title") }
    var active: String { localizer.text("design.active") }
    var showArchive: String { localizer.text("design.showArchive") }
    var hideArchive: String { localizer.text("design.hideArchive") }
    var currentUpdate: String { localizer.text("design.currentUpdate") }
    var fullJourney: String { localizer.text("design.fullJourney") }
    var lessJourney: String { localizer.text("design.lessJourney") }
    var shipmentDetails: String { localizer.text("design.shipmentDetails") }
    var smartCapture: String { localizer.text("design.smartCapture") }
    var scanOrEnter: String { localizer.text("design.scanOrEnter") }
    var quickAddIntro: String { localizer.text("design.quickAddIntro") }
    var parcelTitle: String { localizer.text("design.parcelTitle") }
    var trackingReady: String { localizer.text("design.trackingReady") }
    var oneMoreDetail: String { localizer.text("design.oneMoreDetail") }
    var ready: String { localizer.text("design.ready") }
    var chooseNext: String { localizer.text("design.chooseNext") }
    var continueTitle: String { localizer.text("design.continueTitle") }
    var scanTitle: String { localizer.text("design.scanTitle") }
}

extension Parcel {
    var experimentalLatestLocation: String? {
        sortedEvents.compactMap { $0.location?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }.first
    }
}

/// The same bundled identities and decorations the web reads from core/brand.
/// Load once so a palette or family added to carrier.json also reaches iPhone.
struct CarrierBrandAssets: Decodable {
    struct Step: Decodable {
        let property: String
        let base: String
        let amount: Double
    }

    struct DecalShape: Decodable {
        enum Kind: String, Decodable { case line, polygon, circle }
        let type: Kind
        let points: [[Double]]?
        let segments: [[[Double]]]?
        let stroke: String?
        let strokeWidth: Double?
        let fill: String?
        let cx: Double?
        let cy: Double?
        let r: Double?

        var paint: String { type == .line ? stroke! : fill! }

        var path: Path {
            if type == .circle {
                return Path(ellipseIn: CGRect(x: cx! - r!, y: cy! - r!, width: r! * 2, height: r! * 2))
            }
            return Path { path in
                for line in type == .line ? segments! : [points!] {
                    guard let first = line.first else { continue }
                    path.move(to: CGPoint(x: first[0], y: first[1]))
                    for point in line.dropFirst() { path.addLine(to: CGPoint(x: point[0], y: point[1])) }
                    if type == .polygon { path.closeSubpath() }
                }
            }
        }
    }

    struct Truck: Decodable { let decals: [String: [DecalShape]] }
    let defaultColor: String
    let fallbackColor: String
    let properties: [String]
    let derivation: [Step]
    let families: [String: String]
    let palettes: [String: [String: String]]
    let decals: [String: String]
    let truck: Truck

    static let shared: CarrierBrandAssets = {
        guard let url = Bundle.main.url(forResource: "Brand", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let assets = try? JSONDecoder().decode(CarrierBrandAssets.self, from: data) else {
            preconditionFailure("Missing or invalid bundled carrier brand data")
        }
        return assets
    }()
}

struct CarrierVisualIdentity {
    static let defaultCarrierColor = CarrierBrandAssets.shared.defaultColor
    static let fallbackColor = CarrierBrandAssets.shared.fallbackColor

    let family: String
    let name: String
    let fullName: String
    let colors: [String]
    let decal: String

    private final class Cached {
        let identity: CarrierVisualIdentity
        init(_ identity: CarrierVisualIdentity) { self.identity = identity }
    }
    private static let cache = NSCache<NSString, Cached>()

    /// Cards rebuild whenever the list changes; derive each carrier's livery once.
    static func of(_ carrier: CarrierID, catalog: CarrierCatalog = .shared, language: AppLanguage) -> CarrierVisualIdentity {
        let definition = catalog.info(for: carrier, language: language)
        let key = "\(carrier.rawValue)|\(definition.displayName)|\(definition.color)" as NSString
        if let cached = cache.object(forKey: key) { return cached.identity }
        let identity = CarrierVisualIdentity(id: carrier.rawValue, carrier: definition)
        cache.setObject(Cached(identity), forKey: key)
        return identity
    }

    init(id: String, carrier: CarrierDefinition) {
        let assets = CarrierBrandAssets.shared
        family = assets.families[id] ?? id
        fullName = carrier.displayName
        name = ["dhl": "DHL", "gls": "GLS", "ups": "ups"][family] ?? carrier.displayName
        decal = assets.decals[id] ?? "default"
        colors = assets.derivation.map { step in
            assets.palettes[id]?[step.property] ?? Self.mix(carrier.color, step.base, step.amount)
        }
    }

    func paint(_ value: String) -> Color {
        guard let index = CarrierBrandAssets.shared.properties.firstIndex(of: value) else {
            return Color(hex: value)
        }
        return Color(hex: colors[index])
    }

    var surface: Color { Brand.color(light: colors[0], dark: colors[1]) }
    var ink: Color { Brand.color(light: colors[2], dark: colors[3]) }
    var brand: Color { Brand.color(light: colors[4], dark: colors[5]) }
    var truck: Color { Color(hex: colors[6]) }
    var edge: Color { Color(hex: colors[7]) }
    var accent: Color { Color(hex: colors[8]) }

    static func mix(_ color: String, _ base: String, _ amount: Double) -> String {
        let fallback = UInt32(fallbackColor.dropFirst(), radix: 16) ?? 0
        let value = color.count == 7 ? UInt32(color.dropFirst(), radix: 16) ?? fallback : fallback
        let background = UInt32(base.dropFirst(), radix: 16) ?? 0
        let channels = [16, 8, 0].map { shift in
            Int((Double((value >> shift) & 255) * (1 - amount) + Double((background >> shift) & 255) * amount).rounded())
        }
        return String(format: "#%02x%02x%02x", channels[0], channels[1], channels[2])
    }
}

/// The one truck, as `packages/carriers/core/brand/truck.json` states it. The web
/// draws the same numbers as an SVG; `BrandParityTests` asserts every value here
/// against `Resources/Brand.json`, so neither drawing can drift.
///
/// The canvas fills straight-line outlines where the SVG uses a path: the UPS
/// shield approximates its curve with five points. Decorations are loaded from
/// the bundled geometry rather than retyped as per-carrier constants.
enum CarrierTruckGeometry {
    static let viewBox = CGSize(width: 32, height: 21)
    static let strokeWidth: CGFloat = 0.6
    static let body = CGRect(x: 2, y: 3, width: 18, height: 13)
    static let bodyCornerRadius: CGFloat = 1.3
    static let cab = [CGPoint(x: 20, y: 8), CGPoint(x: 25, y: 8), CGPoint(x: 30, y: 13),
                      CGPoint(x: 30, y: 16), CGPoint(x: 20, y: 16)]
    static let windshield = [CGPoint(x: 22, y: 9.5), CGPoint(x: 24.5, y: 9.5),
                             CGPoint(x: 27.5, y: 12.5), CGPoint(x: 22, y: 12.5)]
    static let windshieldColor = "#edf1ee"
    static let wheelCenters = [CGPoint(x: 8, y: 16.5), CGPoint(x: 25, y: 16.5)]
    static let tireRadius: CGFloat = 2.4
    static let tireColor = "#42483d"
    static let hubRadius: CGFloat = 0.9
    static let hubColor = "#d2d4c7"

}

/// The carrier's truck alone, in its livery, beside a name written elsewhere.
struct CarrierTruckMark: View {
    let identity: CarrierVisualIdentity

    var body: some View {
        Canvas { context, size in
            let truck = CarrierTruckGeometry.self
            context.scaleBy(x: size.width / truck.viewBox.width, y: size.height / truck.viewBox.height)
            let body = Path(roundedRect: truck.body, cornerRadius: truck.bodyCornerRadius)
            context.fill(body, with: .color(identity.truck))
            context.stroke(body, with: .color(identity.edge), lineWidth: truck.strokeWidth)
            let cab = polygon(truck.cab)
            context.fill(cab, with: .color(identity.truck))
            context.stroke(cab, with: .color(identity.edge), lineWidth: truck.strokeWidth)
            context.fill(polygon(truck.windshield), with: .color(Color(hex: truck.windshieldColor)))
            let decals = CarrierBrandAssets.shared.truck.decals
            for shape in decals[identity.decal] ?? decals["default"]! {
                let paint = GraphicsContext.Shading.color(identity.paint(shape.paint))
                if shape.type == .line {
                    context.stroke(shape.path, with: paint, lineWidth: shape.strokeWidth!)
                } else {
                    context.fill(shape.path, with: paint)
                }
            }
            for center in truck.wheelCenters {
                context.fill(disc(center, truck.tireRadius), with: .color(Color(hex: truck.tireColor)))
                context.fill(disc(center, truck.hubRadius), with: .color(Color(hex: truck.hubColor)))
            }
        }
        .frame(width: 27, height: 18)
        .accessibilityHidden(true)
    }

    private func polygon(_ points: [CGPoint]) -> Path {
        Path { path in
            guard let first = points.first else { return }
            path.move(to: first)
            for point in points.dropFirst() { path.addLine(to: point) }
            path.closeSubpath()
        }
    }

    private func disc(_ center: CGPoint, _ radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    }
}

struct CarrierFleetMark: View {
    let identity: CarrierVisualIdentity

    var body: some View {
        HStack(spacing: 7) {
            CarrierTruckMark(identity: identity)
            Text(identity.name + (identity.family == "gls" ? "." : ""))
                .font(.caption.weight(.bold))
                .italic(identity.family == "dhl")
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(identity.brand)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(identity.fullName)
    }
}
