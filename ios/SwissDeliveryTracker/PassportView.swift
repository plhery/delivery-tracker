import SwiftUI

struct PassportView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var totalSize = 54
    @State private var showingAccount = false
    @State private var expandedCard: PassportSelection?
    @State private var touchCount = 0
    @State private var showAllStamps = false

    private var copy: PassportCopy { PassportCopy(localizer: localizer) }
    private var statistics: PassportStatistics { PassportStatistics(parcels: store.parcels) }
    private var carrierCount: Int { Set(store.parcels.map(\.carrier)).count }

    var body: some View {
        let stats = statistics
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    passport(stats)
                    stamps(stats)
                    deliveryTimes(stats)
                    if !stats.originCountries.isEmpty { countries(stats) }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 36)
                .frame(maxWidth: 480)
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
        .sensoryFeedback(.impact(weight: .light, intensity: 0.65), trigger: touchCount)
    }

    private func passport(_ stats: PassportStatistics) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { toggle(.cover) } label: {
                HStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 9) {
                        Text(stats.deliveredCount, format: .number)
                            .font(.system(size: totalSize, weight: .semibold))
                            .tracking(-2)
                            .contentTransition(.numericText())
                        Text(copy.delivered)
                            .font(.subheadline)
                            .foregroundStyle(Brand.onAccent.opacity(0.7))
                    }
                    Spacer(minLength: 0)
                    if !dynamicTypeSize.isAccessibilitySize {
                        PassportSeal(symbol: "shippingbox", tint: Color(hex: "#745300"), surface: .white, earned: true, cancelled: true)
                            .frame(width: 66, height: 80)
                            .rotationEffect(.degrees(-7))
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 118, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(PassportPressStyle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(stats.deliveredCount) \(copy.delivered)")
            .accessibilityValue(expansionValue(.cover, explanation: copy.deliveredExplanation))
            .accessibilityHint(copy.expansionHint(expanded: expandedCard == .cover))
            .popover(isPresented: presentation(.cover)) {
                explanationBubble(title: copy.delivered, explanation: copy.deliveredExplanation)
            }
        }
        .padding(.vertical, 26)
        .padding(.horizontal, 24)
        .foregroundStyle(Brand.onAccent)
        .background(Brand.accent, in: RoundedRectangle(cornerRadius: 20))
    }

    private func stamps(_ stats: PassportStatistics) -> some View {
        let collection = milestones(stats)
        let upcoming = Set(collection.filter { !$0.earned }.prefix(3).map(\.id))
        let visible = showAllStamps ? collection : collection.filter { $0.earned || upcoming.contains($0.id) }
        let hasMore = collection.contains { !$0.earned && !upcoming.contains($0.id) }
        return VStack(alignment: .leading, spacing: 16) {
            Text(copy.stamps).font(.subheadline.weight(.semibold))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: dynamicTypeSize.isAccessibilitySize ? 2 : 4), alignment: .leading, spacing: 16) {
                ForEach(visible) { milestone in
                    let id = PassportSelection.milestone(milestone.id)
                    Button { toggle(id) } label: {
                        VStack(spacing: 10) {
                            PassportSeal(symbol: milestone.symbol, tint: milestone.tint, surface: milestone.surface, earned: milestone.earned)
                                .frame(width: 50, height: 64)
                            Text(milestone.title)
                                .font(.caption2)
                                .foregroundStyle(milestone.earned ? Brand.ink : Brand.ink.opacity(0.6))
                                .fixedSize(horizontal: false, vertical: true)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity, minHeight: 96, alignment: .top)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PassportPressStyle())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(milestone.earned ? milestone.title : "\(milestone.title), \(milestone.progressLabel)")
                    .accessibilityValue(expansionValue(id, explanation: milestone.explanation))
                    .accessibilityHint(copy.expansionHint(expanded: expandedCard == id))
                    .popover(isPresented: presentation(id)) {
                        explanationBubble(title: milestone.title, explanation: milestone.explanation + (milestone.earned ? "" : "\n\(milestone.progressLabel)"))
                    }
                }
            }
            if hasMore {
                Button { showAllStamps.toggle() } label: {
                    Text(localizer.text(showAllStamps ? "passport.showLess" : "passport.showAll"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PassportPressStyle())
                .padding(.vertical, -8)
            }
        }
    }

    private func deliveryTimes(_ stats: PassportStatistics) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider().padding(.bottom, 21)
            if let average = stats.averageDeliveryDuration, let fastest = stats.fastestDelivery {
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 18))
                    : AnyLayout(HStackLayout(alignment: .top, spacing: 18))
                layout {
                    timeCard(id: .average, title: copy.average, duration: average,
                             explanation: "\(copy.timedJourneys(stats.durationSampleCount)). \(copy.timingExplanation)")
                    timeCard(id: .personalBest, title: copy.personalBest, duration: fastest.duration,
                             explanation: fastestExplanation(stats))
                }
            } else {
                Text(copy.waitingForTimes).font(.footnote).foregroundStyle(.secondary)
            }
            Divider().padding(.top, 21)
        }
    }

    private func timeCard(id: PassportSelection, title: String, duration: TimeInterval, explanation: String) -> some View {
        Button { toggle(id) } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(formattedDuration(duration))
                    .font(.title2.weight(.medium).monospacedDigit())
                    .minimumScaleFactor(0.75)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .contentShape(Rectangle())
            .foregroundStyle(Brand.ink)
        }
        .buttonStyle(PassportPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(formattedDuration(duration, full: true))")
        .accessibilityValue(expansionValue(id, explanation: explanation))
        .accessibilityHint(copy.expansionHint(expanded: expandedCard == id))
        .popover(isPresented: presentation(id)) {
            explanationBubble(title: title, explanation: explanation)
        }
    }

    private func countries(_ stats: PassportStatistics) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { toggle(.countries) } label: {
                Text(copy.firstSeenIn)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PassportPressStyle())
            .padding(.vertical, -10)
            .accessibilityValue(copy.expansionState(expanded: expandedCard == .countries))
            .accessibilityHint(copy.expansionHint(expanded: expandedCard == .countries))
            .popover(isPresented: presentation(.countries)) {
                explanationBubble(title: copy.firstSeenIn, explanation: copy.countryExplanation)
            }
            VStack(spacing: 0) {
                ForEach(Array(stats.originCountries.prefix(3).enumerated()), id: \.element.id) { index, country in
                    let name = localizer.language.locale.localizedString(forRegionCode: country.code) ?? country.code
                    if index > 0 { Divider() }
                    HStack(spacing: 11) {
                        Text(country.flag).font(.subheadline).accessibilityHidden(true)
                        Text(name).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Text(country.count, format: .number)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .frame(minHeight: 44)
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(name), \(copy.parcels(country.count))")
                }
            }
        }
    }

    private func milestones(_ stats: PassportStatistics) -> [PassportMilestone] {
        [
            PassportMilestone(id: "first", title: copy.firstArrival, symbol: "shippingbox", tint: ExperimentalPalette.delivered, surface: ExperimentalPalette.deliveredSurface,
                              current: stats.deliveredCount, target: 1, explanation: copy.firstExplanation),
            PassportMilestone(id: "ten", title: copy.doubleDigits, symbol: "10", tint: ExperimentalPalette.lilac, surface: ExperimentalPalette.lilacSurface,
                              current: stats.deliveredCount, target: 10, explanation: copy.tenExplanation),
            PassportMilestone(id: "carriers", title: copy.wellConnected, symbol: "globe", tint: ExperimentalPalette.transit, surface: ExperimentalPalette.transitSurface,
                              current: carrierCount, target: 3, explanation: copy.carrierExplanation),
            PassportMilestone(id: "speed", title: copy.expressArrival, symbol: "bolt", tint: ExperimentalPalette.pickup, surface: ExperimentalPalette.pickupSurface,
                              current: stats.fastestDelivery.map { $0.duration <= 48 * 60 * 60 ? 1 : 0 } ?? 0,
                              target: 1, explanation: copy.expressExplanation, pendingLabel: copy.underTwoDays),
            PassportMilestone(id: "acrossBorders", title: localizer.text("passport.acrossBorders"), symbol: "globe.europe.africa", tint: ExperimentalPalette.transit, surface: ExperimentalPalette.transitSurface,
                              current: stats.crossBorderCount, target: 1, explanation: localizer.text("passport.acrossExplanation")),
            PassportMilestone(id: "aroundWorld", title: localizer.text("passport.aroundWorld"), symbol: "map", tint: ExperimentalPalette.delivered, surface: ExperimentalPalette.deliveredSurface,
                              current: stats.originCountries.count, target: 5, explanation: localizer.text("passport.aroundExplanation")),
            PassportMilestone(id: "theRegular", title: localizer.text("passport.theRegular"), symbol: "25", tint: ExperimentalPalette.lilac, surface: ExperimentalPalette.lilacSurface,
                              current: stats.deliveredCount, target: 25, explanation: localizer.text("passport.regularExplanation")),
            PassportMilestone(id: "rightNextDoor", title: localizer.text("passport.rightNextDoor"), symbol: "house", tint: ExperimentalPalette.delivered, surface: ExperimentalPalette.deliveredSurface,
                              current: stats.domesticDeliveryCount, target: 1, explanation: localizer.text("passport.domesticExplanation")),
            PassportMilestone(id: "worthTheWait", title: localizer.text("passport.worthTheWait"), symbol: "hourglass", tint: ExperimentalPalette.ochre, surface: ExperimentalPalette.ochreSurface,
                              current: stats.longWaitDeliveryCount, target: 1, explanation: localizer.text("passport.waitExplanation")),
            PassportMilestone(id: "busyDoorstep", title: localizer.text("passport.busyDoorstep"), symbol: "parcels", tint: ExperimentalPalette.pickup, surface: ExperimentalPalette.pickupSurface,
                              current: stats.maxDeliveriesInOneDay, target: 3, explanation: localizer.text("passport.busyExplanation")),
            PassportMilestone(id: "pickedUp", title: localizer.text("passport.pickedUp"), symbol: "storefront", tint: ExperimentalPalette.transit, surface: ExperimentalPalette.transitSurface,
                              current: stats.pickupDeliveryCount, target: 1, explanation: localizer.text("passport.pickupExplanation")),
            PassportMilestone(id: "homeForHolidays", title: localizer.text("passport.homeForHolidays"), symbol: "gift", tint: ExperimentalPalette.delivered, surface: ExperimentalPalette.deliveredSurface,
                              current: stats.decemberDeliveryCount, target: 1, explanation: localizer.text("passport.holidayExplanation")),
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


    private func presentation(_ id: PassportSelection) -> Binding<Bool> {
        Binding(get: { expandedCard == id }, set: { presented in
            if presented { expandedCard = id }
            else if expandedCard == id { expandedCard = nil }
        })
    }

    private func explanationBubble(title: String, explanation: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            Text(explanation).font(.subheadline).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(idealWidth: 260, maxWidth: 280, alignment: .leading)
        .padding(20)
        .foregroundStyle(Brand.ink)
        .presentationBackground(Brand.paper)
        .presentationCompactAdaptation(.popover)
    }

    private func expansionValue(_ id: PassportSelection, explanation: String) -> String {
        let expanded = expandedCard == id
        let state = copy.expansionState(expanded: expanded)
        return expanded ? "\(state). \(explanation)" : state
    }

    private func toggle(_ id: PassportSelection) {
        touchCount += 1
        withAnimation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.86)) {
            expandedCard = expandedCard == id ? nil : id
        }
    }
}

private enum PassportSelection: Hashable {
    case cover
    case average
    case personalBest
    case milestone(String)
    case countries
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
    var progressLabel: String { pendingLabel ?? "\(min(current, target)) / \(target)" }
}

struct PassportSeal: View {
    let symbol: String
    let tint: Color
    let surface: Color
    let earned: Bool
    var cancelled = false

    var body: some View {
        ZStack {
            PostageStampShape().fill(surface)
            Rectangle().strokeBorder(tint.opacity(0.4), lineWidth: 0.7).padding(6)
            if symbol == "10" || symbol == "25" {
                Text(symbol).font(.system(size: 20, weight: .light)).foregroundStyle(tint)
            } else if symbol == "parcels" {
                ZStack {
                    Image(systemName: "shippingbox").offset(y: -7)
                    Image(systemName: "shippingbox").offset(x: -7, y: 6)
                    Image(systemName: "shippingbox").offset(x: 7, y: 6)
                }
                .font(.system(size: 13, weight: .ultraLight))
                .foregroundStyle(tint)
            } else {
                Image(systemName: symbol)
                    .font(.system(size: 22, weight: .ultraLight))
                    .foregroundStyle(tint)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if cancelled {
                ZStack {
                    Circle().stroke(tint.opacity(0.2), lineWidth: 0.7)
                    Circle().inset(by: 4).stroke(tint.opacity(0.2), lineWidth: 0.7)
                }
                .frame(width: 31, height: 31)
                .offset(x: 3, y: -5)
            }
        }
        .opacity(earned ? 1 : 0.3)
        .saturation(earned ? 1 : 0)
        .accessibilityHidden(true)
    }
}

struct PassportPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.94 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.75), value: configuration.isPressed)
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
    var firstArrival: String { localizer.text("passport.firstArrival") }
    var doubleDigits: String { localizer.text("passport.doubleDigits") }
    var wellConnected: String { localizer.text("passport.wellConnected") }
    var expressArrival: String { localizer.text("passport.expressArrival") }
    var underTwoDays: String { localizer.text("passport.underTwoDays") }
    var underOneMinute: String { localizer.text("passport.underOneMinute") }
    var lessThanOneMinute: String { localizer.text("passport.lessThanOneMinute") }
    var waitingForTimes: String { localizer.text("passport.waitingForTimes") }
    var deliveredExplanation: String { localizer.text("passport.deliveredExplanation") }
    var timingExplanation: String { localizer.text("passport.timingExplanation") }
    var noTimingExplanation: String { localizer.text("passport.noTimingExplanation") }
    var countryExplanation: String { localizer.text("passport.countryExplanation") }
    var firstExplanation: String { localizer.text("passport.firstExplanation") }
    var tenExplanation: String { localizer.text("passport.tenExplanation") }
    var carrierExplanation: String { localizer.text("passport.carrierExplanation") }
    var expressExplanation: String { localizer.text("passport.expressExplanation") }

    func expansionState(expanded: Bool) -> String {
        localizer.text(expanded ? "passport.expansionState.expanded" : "passport.expansionState.collapsed")
    }

    func expansionHint(expanded: Bool) -> String {
        localizer.text(expanded ? "passport.expansionHint" : "passport.detailsHint")
    }

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
