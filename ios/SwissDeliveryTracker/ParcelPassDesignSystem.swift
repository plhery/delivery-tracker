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

/// A continuous outline lets the notches reveal the actual surface during a swipe.
struct DeliveryTicketShape: Shape {
    static let stubWidth: CGFloat = 60
    static let cornerRadius: CGFloat = 24
    static let notchRadius: CGFloat = 6

    func path(in rect: CGRect) -> Path {
        let corner = min(Self.cornerRadius, rect.height / 2, rect.width / 2)
        let notch = Self.notchRadius
        let seam = rect.maxX - Self.stubWidth
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + corner, y: rect.minY))
        path.addLine(to: CGPoint(x: seam - notch, y: rect.minY))
        path.addArc(center: CGPoint(x: seam, y: rect.minY), radius: notch,
                    startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
        path.addLine(to: CGPoint(x: rect.maxX - corner, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + corner),
                          control: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - corner))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - corner, y: rect.maxY),
                          control: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: seam + notch, y: rect.maxY))
        path.addArc(center: CGPoint(x: seam, y: rect.maxY), radius: notch,
                    startAngle: .degrees(0), endAngle: .degrees(180), clockwise: true)
        path.addLine(to: CGPoint(x: rect.minX + corner, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - corner),
                          control: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + corner))
        path.addQuadCurve(to: CGPoint(x: rect.minX + corner, y: rect.minY),
                          control: CGPoint(x: rect.minX, y: rect.minY))
        path.closeSubpath()
        return path
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
                .font(.system(size: 27, weight: .regular))
                .foregroundStyle(Brand.onAccent)
                .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
                .symbolEffect(.bounce, options: .nonRepeating, value: reduceMotion ? nil : stage)
        }
        .frame(width: 72, height: 86)
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
