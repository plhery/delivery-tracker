import SwiftUI

struct PassportView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .largeTitle) private var totalSize = 68

    @State private var showingAccount = false
    @State private var detail: PassportDetail?
    @State private var touchCount = 0

    private var copy: PassportCopy { PassportCopy(localizer: localizer) }
    private var statistics: PassportStatistics { PassportStatistics(parcels: store.parcels) }
    private var carrierCount: Int { Set(store.parcels.map(\.carrier)).count }

    var body: some View {
        let stats = statistics
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    passport(stats)
                    deliveryTimes(stats)
                    stamps(stats)
                    if !stats.originCountries.isEmpty { countries(stats) }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 36)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .background(Brand.background)
            .safeAreaInset(edge: .top, spacing: 0) { DemoModeBar() }
            .navigationTitle(copy.passport)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    AccountToolbarButton { showingAccount = true }
                }
            }
        }
        .sheet(isPresented: $showingAccount) { AccountView() }
        .sheet(item: $detail) { value in
            PassportDetailSheet(detail: value, closeTitle: localizer.text("common.close"))
        }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.65), trigger: touchCount)
    }

    private func passport(_ stats: PassportStatistics) -> some View {
        Button {
            reveal(PassportDetail(
                title: copy.delivered,
                value: stats.deliveredCount.formatted(),
                explanation: copy.deliveredExplanation,
                symbol: "shippingbox",
                tint: ExperimentalPalette.delivered,
                earned: stats.deliveredCount > 0
            ))
        } label: {
            VStack(alignment: .leading, spacing: 23) {
                HStack {
                    Text(copy.allTime.uppercased())
                        .font(.caption2.weight(.semibold).monospaced())
                        .tracking(1.8)
                        .foregroundStyle(Brand.onAccent.opacity(0.75))
                    Spacer()
                    Image(systemName: "globe.europe.africa")
                        .font(.title3.weight(.light))
                        .foregroundStyle(Brand.onAccent.opacity(0.75))
                }

                HStack(alignment: .center, spacing: 16) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(stats.deliveredCount, format: .number)
                            .font(.system(size: totalSize, weight: .bold, design: .rounded))
                            .tracking(-3)
                            .contentTransition(.numericText())
                        Text(copy.delivered)
                            .font(.title3.weight(.medium))
                            .foregroundStyle(Brand.onAccent.opacity(0.75))
                    }
                    Spacer(minLength: 0)
                    if !dynamicTypeSize.isAccessibilitySize {
                        PassportSeal(symbol: "shippingbox", tint: Brand.onAccent, earned: stats.deliveredCount > 0)
                            .frame(width: 106, height: 106)
                            .rotationEffect(.degrees(-11))
                            .accessibilityHidden(true)
                    }
                }

                Rectangle()
                    .fill(Brand.onAccent.opacity(0.22))
                    .frame(height: 0.7)

                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 24))
                layout {
                    summaryValue(stats.activeCount, title: copy.onTheWay)
                    summaryValue(carrierCount, title: copy.carriers)
                }
            }
            .padding(24)
            .foregroundStyle(Brand.onAccent)
            .experimentalSurface(fill: Brand.accent, cornerRadius: 24)
        }
        .buttonStyle(PassportPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("\(copy.passport), \(stats.deliveredCount) \(copy.delivered), \(stats.activeCount) \(copy.onTheWay), \(carrierCount) \(copy.carriers)")
        .accessibilityHint(copy.detailsHint)
    }

    private func summaryValue(_ count: Int, title: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text(count, format: .number)
                .font(.headline.monospacedDigit())
            Text(title)
                .font(.subheadline)
                .foregroundStyle(Brand.onAccent.opacity(0.75))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func deliveryTimes(_ stats: PassportStatistics) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(copy.deliveryTimes).font(.title3.weight(.semibold))
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 12))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            layout {
                timeCard(
                    title: copy.average,
                    duration: stats.averageDeliveryDuration,
                    symbol: "clock",
                    tint: ExperimentalPalette.transit,
                    surface: ExperimentalPalette.transitSurface,
                    explanation: stats.durationSampleCount > 0
                        ? "\(copy.timedJourneys(stats.durationSampleCount)). \(copy.timingExplanation)"
                        : copy.noTimingExplanation
                )
                timeCard(
                    title: copy.personalBest,
                    duration: stats.fastestDelivery?.duration,
                    symbol: "hare",
                    tint: ExperimentalPalette.pickup,
                    surface: ExperimentalPalette.pickupSurface,
                    explanation: fastestExplanation(stats)
                )
            }
            Text(stats.durationSampleCount > 0 ? copy.timedJourneys(stats.durationSampleCount) : copy.waitingForTimes)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 2)
        }
    }

    private func timeCard(title: String, duration: TimeInterval?, symbol: String, tint: Color, surface: Color, explanation: String) -> some View {
        Button {
            reveal(PassportDetail(
                title: title,
                value: duration.map { formattedDuration($0) } ?? "—",
                explanation: explanation,
                symbol: symbol,
                tint: tint,
                earned: duration != nil
            ))
        } label: {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: symbol)
                        .font(.title3.weight(.medium))
                        .foregroundStyle(tint)
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.tertiary)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text(duration.map { formattedDuration($0) } ?? "—")
                        .font(.title2.weight(.bold).monospacedDigit())
                        .minimumScaleFactor(0.75)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    Text(title)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(17)
            .experimentalSurface(fill: surface, cornerRadius: 20, shadow: false)
            .foregroundStyle(Brand.ink)
        }
        .buttonStyle(PassportPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("\(title), \(duration.map { formattedDuration($0, full: true) } ?? copy.waitingForTimes)")
        .accessibilityHint(copy.detailsHint)
    }

    private func countries(_ stats: PassportStatistics) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Text(copy.firstSeenIn).font(.title3.weight(.semibold))
                Spacer()
                Text(stats.originCountries.count, format: .number)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            VStack(spacing: 18) {
                ForEach(Array(stats.originCountries.prefix(3).enumerated()), id: \.element.id) { index, country in
                    let countryName = localizer.language.locale.localizedString(forRegionCode: country.code) ?? country.code
                    let tint = [ExperimentalPalette.transit, ExperimentalPalette.lilac, ExperimentalPalette.pickup][index]
                    Button {
                        reveal(PassportDetail(
                            title: countryName,
                            value: copy.parcels(country.count),
                            explanation: copy.countryExplanation,
                            symbol: "globe.europe.africa",
                            tint: tint
                        ))
                    } label: {
                        VStack(spacing: 8) {
                            HStack(spacing: 10) {
                                Text(String(format: "%02d", index + 1))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                Text(country.flag).font(.title3)
                                    .accessibilityHidden(true)
                                Text(countryName).font(.subheadline.weight(.medium))
                                Spacer(minLength: 8)
                                Text(country.count, format: .number)
                                    .font(.subheadline.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            GeometryReader { geometry in
                                Capsule().fill(tint.opacity(0.1))
                                Capsule().fill(tint)
                                    .frame(width: geometry.size.width * CGFloat(country.count) / CGFloat(max(1, stats.originCountries.first?.count ?? 1)))
                            }
                            .frame(height: 5)
                            .accessibilityHidden(true)
                        }
                        .foregroundStyle(Brand.ink)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PassportPressStyle())
                    .accessibilityElement(children: .ignore)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel("\(countryName), \(copy.parcels(country.count))")
                    .accessibilityHint(copy.detailsHint)
                }
            }
            .padding(19)
            .background(Brand.paper, in: RoundedRectangle(cornerRadius: 20))
        }
    }

    private func stamps(_ stats: PassportStatistics) -> some View {
        let collection = milestones(stats)
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(copy.stamps).font(.title3.weight(.semibold))
                Spacer()
                Text("\(collection.filter(\.earned).count) / \(collection.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(copy.stampsEarned(collection.filter(\.earned).count, total: collection.count))
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: dynamicTypeSize.isAccessibilitySize ? 1 : 2), spacing: 12) {
                ForEach(Array(collection.enumerated()), id: \.element.id) { index, milestone in
                    Button {
                        reveal(PassportDetail(
                            title: milestone.title,
                            value: milestone.earned ? copy.unlocked : milestone.progressLabel,
                            explanation: milestone.explanation,
                            symbol: milestone.symbol,
                            tint: milestone.tint,
                            earned: milestone.earned,
                            progress: milestone.progress
                        ))
                    } label: {
                        VStack(spacing: 13) {
                            PassportSeal(symbol: milestone.symbol, tint: milestone.tint, earned: milestone.earned)
                                .frame(width: 84, height: 84)
                                .rotationEffect(.degrees(milestone.earned ? (index.isMultiple(of: 2) ? -7 : 6) : 0))
                                .accessibilityHidden(true)
                            VStack(spacing: 5) {
                                Text(milestone.title)
                                    .font(.subheadline.weight(.semibold))
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(milestone.earned ? copy.unlocked : milestone.progressLabel)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                        .padding(.horizontal, 12)
                        .experimentalSurface(
                            fill: milestone.earned ? milestone.surface : Brand.paper,
                            cornerRadius: 20,
                            shadow: false
                        )
                        .foregroundStyle(Brand.ink)
                        .contentShape(RoundedRectangle(cornerRadius: 20))
                    }
                    .buttonStyle(PassportPressStyle())
                    .accessibilityElement(children: .ignore)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel("\(milestone.title), \(milestone.earned ? copy.unlocked : milestone.progressLabel)")
                    .accessibilityHint(copy.detailsHint)
                }
            }
        }
    }

    private func milestones(_ stats: PassportStatistics) -> [PassportMilestone] {
        [
            PassportMilestone(id: "first", title: copy.firstArrival, symbol: "shippingbox", tint: ExperimentalPalette.delivered, surface: ExperimentalPalette.deliveredSurface,
                              current: stats.deliveredCount, target: 1, explanation: copy.firstExplanation),
            PassportMilestone(id: "ten", title: copy.doubleDigits, symbol: "10.circle", tint: ExperimentalPalette.lilac, surface: ExperimentalPalette.lilacSurface,
                              current: stats.deliveredCount, target: 10, explanation: copy.tenExplanation),
            PassportMilestone(id: "carriers", title: copy.wellConnected, symbol: "point.3.connected.trianglepath.dotted", tint: ExperimentalPalette.rose, surface: ExperimentalPalette.roseSurface,
                              current: carrierCount, target: 3, explanation: copy.carrierExplanation),
            PassportMilestone(id: "speed", title: copy.expressArrival, symbol: "hare", tint: ExperimentalPalette.ochre, surface: ExperimentalPalette.ochreSurface,
                              current: stats.fastestDelivery.map { $0.duration <= 48 * 60 * 60 ? 1 : 0 } ?? 0,
                              target: 1, explanation: copy.expressExplanation, pendingLabel: copy.underTwoDays),
        ]
    }

    private func fastestExplanation(_ stats: PassportStatistics) -> String {
        guard let record = stats.fastestDelivery else { return copy.noTimingExplanation }
        let title = record.label.nonEmpty ?? localizer.text("common.parcel")
        return "\(title) · \(localizer.shortDate(record.deliveredAt))\n\n\(copy.timingExplanation)"
    }

    private func formattedDuration(_ duration: TimeInterval, full: Bool = false) -> String {
        if duration < 60 { return full ? copy.lessThanOneMinute : copy.underOneMinute }
        let formatter = DateComponentsFormatter()
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = localizer.language.locale
        formatter.calendar = calendar
        formatter.allowedUnits = duration >= 86400 ? [.day, .hour] : [.hour, .minute]
        formatter.maximumUnitCount = 2
        formatter.unitsStyle = full ? .full : .abbreviated
        formatter.zeroFormattingBehavior = .dropAll
        return formatter.string(from: duration) ?? "—"
    }

    private func reveal(_ value: PassportDetail) {
        touchCount += 1
        detail = value
    }
}

private struct PassportMilestone: Identifiable {
    let id: String
    let title: String
    let symbol: String
    let tint: Color
    let surface: Color
    let current: Int
    let target: Int
    let explanation: String
    var pendingLabel: String? = nil

    var earned: Bool { current >= target }
    var progress: Double { min(1, Double(current) / Double(target)) }
    var progressLabel: String { pendingLabel ?? "\(min(current, target)) / \(target)" }
}

private struct PassportSeal: View {
    let symbol: String
    let tint: Color
    let earned: Bool

    var body: some View {
        ZStack {
            Circle().fill(tint.opacity(earned ? 0.12 : 0.04))
            Circle().strokeBorder(tint.opacity(earned ? 0.88 : 0.35), style: StrokeStyle(lineWidth: 1.5, dash: [2, 3]))
            Circle().inset(by: 7).strokeBorder(tint.opacity(earned ? 0.55 : 0.22), lineWidth: 0.8)
            Image(systemName: symbol)
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(earned ? tint : .secondary.opacity(0.45))
            if earned {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(tint)
                    .offset(y: 28)
            }
        }
    }
}

private struct PassportPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .rotationEffect(.degrees(configuration.isPressed && !reduceMotion ? -0.5 : 0))
            .opacity(configuration.isPressed ? 0.94 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.75), value: configuration.isPressed)
    }
}

private struct PassportDetail: Identifiable {
    let id = UUID()
    let title: String
    let value: String
    let explanation: String
    let symbol: String
    let tint: Color
    var earned = true
    var progress: Double? = nil
}

private struct PassportDetailSheet: View {
    let detail: PassportDetail
    let closeTitle: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    PassportSeal(symbol: detail.symbol, tint: detail.tint, earned: detail.earned)
                        .frame(width: 106, height: 106)
                        .rotationEffect(.degrees(appeared || reduceMotion ? -8 : -22))
                        .scaleEffect(appeared || reduceMotion ? 1 : 0.8)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(detail.title).font(.title3.weight(.medium)).foregroundStyle(.secondary)
                        Text(detail.value).font(.largeTitle.weight(.semibold).monospacedDigit())
                    }
                    if let progress = detail.progress {
                        ProgressView(value: progress)
                            .tint(detail.tint)
                            .accessibilityHidden(true)
                    }
                    Text(detail.explanation)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Brand.background)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(closeTitle) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear {
            withAnimation(reduceMotion ? nil : .spring(response: 0.48, dampingFraction: 0.55)) { appeared = true }
        }
    }
}

@MainActor
private struct PassportCopy {
    let localizer: Localizer

    var passport: String { localizer.text("passport.title") }
    var allTime: String { localizer.text("passport.allTime") }
    var delivered: String { localizer.text("passport.delivered") }
    var onTheWay: String { localizer.text("passport.onTheWay") }
    var carriers: String { localizer.text("passport.carriers") }
    var deliveryTimes: String { localizer.text("passport.deliveryTimes") }
    var average: String { localizer.text("passport.average") }
    var personalBest: String { localizer.text("passport.personalBest") }
    var firstSeenIn: String { localizer.text("passport.firstSeenIn") }
    var stamps: String { localizer.text("passport.stamps") }
    var unlocked: String { localizer.text("passport.unlocked") }
    var firstArrival: String { localizer.text("passport.firstArrival") }
    var doubleDigits: String { localizer.text("passport.doubleDigits") }
    var wellConnected: String { localizer.text("passport.wellConnected") }
    var expressArrival: String { localizer.text("passport.expressArrival") }
    var underTwoDays: String { localizer.text("passport.underTwoDays") }
    var underOneMinute: String { localizer.text("passport.underOneMinute") }
    var lessThanOneMinute: String { localizer.text("passport.lessThanOneMinute") }
    var detailsHint: String { localizer.text("passport.detailsHint") }
    var waitingForTimes: String { localizer.text("passport.waitingForTimes") }
    var deliveredExplanation: String { localizer.text("passport.deliveredExplanation") }
    var timingExplanation: String { localizer.text("passport.timingExplanation") }
    var noTimingExplanation: String { localizer.text("passport.noTimingExplanation") }
    var countryExplanation: String { localizer.text("passport.countryExplanation") }
    var firstExplanation: String { localizer.text("passport.firstExplanation") }
    var tenExplanation: String { localizer.text("passport.tenExplanation") }
    var carrierExplanation: String { localizer.text("passport.carrierExplanation") }
    var expressExplanation: String { localizer.text("passport.expressExplanation") }

    func timedJourneys(_ count: Int) -> String {
        localizer.text(count == 1 ? "passport.timedJourneys.one" : "passport.timedJourneys.many", ["count": count])
    }

    func parcels(_ count: Int) -> String {
        localizer.text(count == 1 ? "passport.parcels.one" : "passport.parcels.many", ["count": count])
    }

    func stampsEarned(_ count: Int, total: Int) -> String {
        localizer.text("passport.stampsEarned", ["count": count, "total": total])
    }
}
