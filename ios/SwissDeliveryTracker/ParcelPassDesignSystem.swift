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
        case .customs, .failedAttempt, .readyForPickup, .returned: pickupSurface
        case .outForDelivery: ochreSurface
        case .pending, .registered, .none: lilacSurface
        default: transitSurface
        }
    }

    static func tint(for parcel: Parcel) -> Color {
        switch parcel.currentStage {
        case .delivered:
            delivered
        case .customs, .failedAttempt, .readyForPickup, .returned:
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

/// Cut-out perforations make this read as a paper stamp, even at card size.
struct PostageStampShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let radius: CGFloat = 2.3
        let horizontalCount = max(1, Int(rect.width / 9))
        let verticalCount = max(1, Int(rect.height / 9))
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        for index in 0..<horizontalCount {
            let x = rect.minX + (CGFloat(index) + 0.5) * rect.width / CGFloat(horizontalCount)
            path.addLine(to: CGPoint(x: x - radius, y: rect.minY))
            path.addArc(center: CGPoint(x: x, y: rect.minY), radius: radius,
                        startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        for index in 0..<verticalCount {
            let y = rect.minY + (CGFloat(index) + 0.5) * rect.height / CGFloat(verticalCount)
            path.addLine(to: CGPoint(x: rect.maxX, y: y - radius))
            path.addArc(center: CGPoint(x: rect.maxX, y: y), radius: radius,
                        startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: true)
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        for index in 0..<horizontalCount {
            let x = rect.maxX - (CGFloat(index) + 0.5) * rect.width / CGFloat(horizontalCount)
            path.addLine(to: CGPoint(x: x + radius, y: rect.maxY))
            path.addArc(center: CGPoint(x: x, y: rect.maxY), radius: radius,
                        startAngle: .degrees(0), endAngle: .degrees(180), clockwise: true)
        }
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        for index in 0..<verticalCount {
            let y = rect.maxY - (CGFloat(index) + 0.5) * rect.height / CGFloat(verticalCount)
            path.addLine(to: CGPoint(x: rect.minX, y: y + radius))
            path.addArc(center: CGPoint(x: rect.minX, y: y), radius: radius,
                        startAngle: .degrees(90), endAngle: .degrees(270), clockwise: true)
        }
        path.closeSubpath()
        return path
    }
}

struct DeliveryPostageStamp: View {
    let stage: TrackingStage?
    let appeared: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            PostageStampShape()
                .fill(Color(hex: "#FFF9E8"))
                .shadow(color: .black.opacity(0.1), radius: 2, y: 2)
            Rectangle()
                .fill(Brand.accent.opacity(0.24))
                .overlay(Rectangle().stroke(Brand.onAccent.opacity(0.3), lineWidth: 0.75))
                .padding(9)
            Image(systemName: stage?.metadata.symbol ?? "shippingbox")
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(Brand.onAccent)
                .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
                .symbolEffect(.bounce, options: .nonRepeating, value: reduceMotion ? nil : stage)
        }
        .frame(width: 55, height: 67)
        .overlay(alignment: .bottomTrailing) {
            // A partial cancellation mark crosses the printed frame and paper edge.
            ZStack {
                Circle().stroke(Brand.onAccent.opacity(0.3), lineWidth: 1)
                Circle().inset(by: 4).stroke(Brand.onAccent.opacity(0.18), lineWidth: 0.7)
            }
            .frame(width: 32, height: 32)
            .offset(x: 8, y: 5)
        }
        .rotationEffect(.degrees(reduceMotion || appeared ? -3 : -10))
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

/// The approved Fleet palettes; catalog colors cover other and newly added carriers.
struct CarrierVisualIdentity {
    let family: String
    let name: String
    let fullName: String
    private let colors: [String]

    init(id: String, carrier: CarrierDefinition) {
        family = id.hasPrefix("gls-") ? "gls" : id
        fullName = carrier.displayName
        switch family {
        case "dhl":
            name = "DHL"
            colors = ["#f7e8aa", "#514727", "#6c5419", "#ead695", "#d40511", "#ffe274", "#ffcc00", "#b88d16", "#d40511"]
        case "gls":
            name = "GLS"
            colors = ["#dfebfa", "#293e57", "#355e8a", "#b7d1ee", "#1634a7", "#abc7ff", "#1634a7", "#1634a7", "#ffcf00"]
        case "ups":
            name = "ups"
            colors = ["#ede3d5", "#463a2c", "#78573e", "#dbc2a4", "#573626", "#ebca99", "#573626", "#573626", "#f5c86b"]
        default:
            name = carrier.displayName
            let color = carrier.color
            colors = [Self.mix(color, "#ffffff", 0.86), Self.mix(color, "#20261f", 0.8),
                      Self.mix(color, "#000000", 0.55), Self.mix(color, "#ffffff", 0.65),
                      Self.mix(color, "#000000", 0.3), Self.mix(color, "#ffffff", 0.6),
                      Self.mix(color, "#000000", 0), Self.mix(color, "#000000", 0.2), "#ffffff"]
        }
    }

    var surface: Color { Brand.color(light: colors[0], dark: colors[1]) }
    var ink: Color { Brand.color(light: colors[2], dark: colors[3]) }
    var brand: Color { Brand.color(light: colors[4], dark: colors[5]) }
    var truck: Color { Color(hex: colors[6]) }
    var edge: Color { Color(hex: colors[7]) }
    var accent: Color { Color(hex: colors[8]) }

    private static func mix(_ color: String, _ base: String, _ amount: Double) -> String {
        let value = color.count == 7 ? UInt32(color.dropFirst(), radix: 16) ?? 0x657060 : 0x657060
        let background = UInt32(base.dropFirst(), radix: 16) ?? 0
        let channels = [16, 8, 0].map { shift in
            Int((Double((value >> shift) & 255) * (1 - amount) + Double((background >> shift) & 255) * amount).rounded())
        }
        return String(format: "#%02x%02x%02x", channels[0], channels[1], channels[2])
    }
}

struct CarrierFleetMark: View {
    let identity: CarrierVisualIdentity

    var body: some View {
        HStack(spacing: 7) {
            Canvas { context, size in
                context.scaleBy(x: size.width / 32, y: size.height / 21)
                let body = Path(roundedRect: CGRect(x: 2, y: 3, width: 18, height: 13), cornerRadius: 1.3)
                context.fill(body, with: .color(identity.truck))
                context.stroke(body, with: .color(identity.edge), lineWidth: 0.6)
                let cab = polygon([CGPoint(x: 20, y: 8), CGPoint(x: 25, y: 8), CGPoint(x: 30, y: 13), CGPoint(x: 30, y: 16), CGPoint(x: 20, y: 16)])
                context.fill(cab, with: .color(identity.truck))
                context.stroke(cab, with: .color(identity.edge), lineWidth: 0.6)
                context.fill(polygon([CGPoint(x: 22, y: 9.5), CGPoint(x: 24.5, y: 9.5), CGPoint(x: 27.5, y: 12.5), CGPoint(x: 22, y: 12.5)]), with: .color(Color(hex: "#edf1ee")))
                if identity.family == "dhl" {
                    var stripes = Path()
                    stripes.move(to: CGPoint(x: 4, y: 8)); stripes.addLine(to: CGPoint(x: 16, y: 8))
                    stripes.move(to: CGPoint(x: 3, y: 10)); stripes.addLine(to: CGPoint(x: 15, y: 10))
                    context.stroke(stripes, with: .color(identity.accent), lineWidth: 1.1)
                } else if identity.family == "ups" {
                    context.fill(polygon([CGPoint(x: 8, y: 5), CGPoint(x: 13, y: 5), CGPoint(x: 13, y: 10), CGPoint(x: 10.5, y: 12), CGPoint(x: 8, y: 10)]), with: .color(identity.accent))
                } else {
                    context.fill(Path(CGRect(x: 5, y: 8, width: 8, height: 2)), with: .color(identity.accent))
                    context.fill(Path(ellipseIn: CGRect(x: 13.9, y: 7.9, width: 2.2, height: 2.2)), with: .color(identity.accent))
                }
                for x in [8.0, 25.0] {
                    context.fill(Path(ellipseIn: CGRect(x: x - 2.4, y: 14.1, width: 4.8, height: 4.8)), with: .color(Color(hex: "#42483d")))
                    context.fill(Path(ellipseIn: CGRect(x: x - 0.9, y: 15.6, width: 1.8, height: 1.8)), with: .color(Color(hex: "#d2d4c7")))
                }
            }
            .frame(width: 27, height: 18)
            .accessibilityHidden(true)
            Text(identity.name + (identity.family == "gls" ? "." : ""))
                .font(.caption.weight(.bold))
                .italic(identity.family == "dhl")
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(identity.brand)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(identity.fullName)
    }

    private func polygon(_ points: [CGPoint]) -> Path {
        Path { path in
            guard let first = points.first else { return }
            path.move(to: first)
            for point in points.dropFirst() { path.addLine(to: point) }
            path.closeSubpath()
        }
    }
}
