import SwiftUI

struct PassportView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .largeTitle) private var totalSize = 68

    @State private var showingAccount = false
    @State private var detail: PassportDetail?
    @State private var touchCount = 0

    private var copy: PassportCopy { PassportCopy(language: localizer.language) }
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

private struct PassportCopy {
    let language: AppLanguage

    var passport: String { value("Passport", "Reisepass", "Passeport", "Passaporto") }
    var allTime: String { value("All time", "Insgesamt", "Depuis le début", "Dall’inizio") }
    var delivered: String { value("Delivered", "Zugestellt", "Livrés", "Consegnati") }
    var onTheWay: String { value("active", "aktiv", "actifs", "attivi") }
    var carriers: String { value("carriers", "Paketdienste", "transporteurs", "corrieri") }
    var deliveryTimes: String { value("Delivery times", "Lieferzeiten", "Délais de livraison", "Tempi di consegna") }
    var average: String { value("On average", "Im Durchschnitt", "En moyenne", "In media") }
    var personalBest: String { value("Personal best", "Persönlicher Rekord", "Record personnel", "Record personale") }
    var firstSeenIn: String { value("First scanned in", "Erster Scan in", "Premiers scans", "Primi rilevamenti") }
    var stamps: String { value("Your stamps", "Deine Stempel", "Vos tampons", "I tuoi timbri") }
    var unlocked: String { value("Unlocked", "Freigeschaltet", "Débloqué", "Sbloccato") }
    var firstArrival: String { value("First arrival", "Erste Ankunft", "Première arrivée", "Primo arrivo") }
    var doubleDigits: String { value("Double digits", "Zweistellig", "Deux chiffres", "Doppia cifra") }
    var wellConnected: String { value("Well connected", "Gut vernetzt", "Bien connecté", "Ben collegato") }
    var expressArrival: String { value("Express arrival", "Expressankunft", "Arrivée express", "Arrivo express") }
    var underTwoDays: String { value("Within 48 hours", "In 48 Stunden", "En 48 heures", "Entro 48 ore") }
    var underOneMinute: String { value("< 1 min", "< 1 Min.", "< 1 min", "< 1 min") }
    var lessThanOneMinute: String { value("Less than one minute", "Weniger als eine Minute", "Moins d’une minute", "Meno di un minuto") }
    var detailsHint: String { value("Shows details", "Zeigt Details", "Affiche les détails", "Mostra i dettagli") }
    var waitingForTimes: String {
        value("Waiting for a complete journey", "Warten auf eine vollständige Reise", "En attente d’un trajet complet", "In attesa di un viaggio completo")
    }
    var deliveredExplanation: String {
        value("Every delivered parcel in your collection counts, including archived parcels.", "Jedes zugestellte Paket in deiner Sammlung zählt, auch archivierte Pakete.", "Chaque colis livré de votre collection compte, y compris les colis archivés.", "Ogni pacco consegnato nella tua raccolta conta, inclusi quelli archiviati.")
    }
    var timingExplanation: String {
        value("Measured from the carrier’s first acceptance or transit scan to delivery. Parcels without both timestamps are left out.", "Gemessen vom ersten Annahme- oder Transitscan bis zur Zustellung. Pakete ohne beide Zeitangaben werden nicht berücksichtigt.", "Du premier scan de prise en charge ou de transit à la livraison. Les colis sans ces deux horodatages sont exclus.", "Dal primo rilevamento di presa in carico o transito alla consegna. I pacchi senza entrambi gli orari sono esclusi.")
    }
    var noTimingExplanation: String {
        value("Once a delivered parcel has both a carrier acceptance or transit scan and a delivery timestamp, its journey will count here.", "Sobald ein zugestelltes Paket einen Annahme- oder Transitscan und eine Zustellzeit hat, zählt seine Reise hier.", "Dès qu’un colis livré possède un scan de prise en charge ou de transit et une heure de livraison, son trajet compte ici.", "Quando un pacco consegnato ha un rilevamento di presa in carico o transito e un orario di consegna, il suo viaggio verrà incluso qui.")
    }
    var countryExplanation: String {
        value("The country named in the carrier’s first acceptance or transit scan. It may differ from the sender’s country. Parcels without an explicit country are left out.", "Das im ersten Annahme- oder Transitscan genannte Land. Es kann vom Absenderland abweichen. Pakete ohne eindeutige Länderangabe werden nicht berücksichtigt.", "Le pays indiqué dans le premier scan de prise en charge ou de transit. Il peut différer du pays de l’expéditeur. Les colis sans pays explicite sont exclus.", "Il paese indicato nel primo rilevamento di presa in carico o transito. Può differire dal paese del mittente. I pacchi senza un paese esplicito sono esclusi.")
    }
    var firstExplanation: String {
        value("Your first delivered parcel earns this stamp. A small beginning for your passport.", "Dein erstes zugestelltes Paket bringt dir diesen Stempel. Der Anfang deines Passes.", "Votre premier colis livré vous offre ce tampon. Le début de votre passeport.", "Il tuo primo pacco consegnato ti regala questo timbro. L’inizio del tuo passaporto.")
    }
    var tenExplanation: String {
        value("Ten delivered parcels in your collection. Archived arrivals count too.", "Zehn zugestellte Pakete in deiner Sammlung. Archivierte Ankünfte zählen auch.", "Dix colis livrés dans votre collection. Les arrivées archivées comptent aussi.", "Dieci pacchi consegnati nella tua raccolta. Contano anche gli arrivi archiviati.")
    }
    var carrierExplanation: String {
        value("Track parcels with three different carriers to earn this stamp.", "Verfolge Pakete mit drei verschiedenen Paketdiensten, um diesen Stempel zu bekommen.", "Suivez des colis avec trois transporteurs différents pour obtenir ce tampon.", "Traccia pacchi con tre corrieri diversi per ottenere questo timbro.")
    }
    var expressExplanation: String {
        value("A parcel delivered within 48 hours of its first acceptance or transit scan earns this stamp.", "Ein Paket, das innerhalb von 48 Stunden nach dem ersten Annahme- oder Transitscan zugestellt wird, bringt dir diesen Stempel.", "Un colis livré dans les 48 heures suivant son premier scan de prise en charge ou de transit vous offre ce tampon.", "Un pacco consegnato entro 48 ore dal primo rilevamento di presa in carico o transito ti regala questo timbro.")
    }
    func timedJourneys(_ count: Int) -> String {
        count == 1
            ? value("From 1 timed journey", "Aus 1 erfassten Reise", "Sur 1 trajet chronométré", "Da 1 viaggio misurato")
            : value("From \(count) timed journeys", "Aus \(count) erfassten Reisen", "Sur \(count) trajets chronométrés", "Da \(count) viaggi misurati")
    }
    func parcels(_ count: Int) -> String {
        count == 1
            ? value("1 parcel", "1 Paket", "1 colis", "1 pacco")
            : value("\(count) parcels", "\(count) Pakete", "\(count) colis", "\(count) pacchi")
    }
    func stampsEarned(_ count: Int, total: Int) -> String {
        value("\(count) of \(total) stamps unlocked", "\(count) von \(total) Stempeln freigeschaltet", "\(count) tampons débloqués sur \(total)", "\(count) timbri sbloccati su \(total)")
    }
    private func value(_ en: String, _ de: String, _ fr: String, _ it: String) -> String {
        switch language {
        case .en: en
        case .de: de
        case .fr: fr
        case .it: it
        }
    }
}
