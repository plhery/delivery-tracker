import Foundation

/// A passport records observed journeys. Adding a parcel or creating a label does
/// not start its delivery clock, and a carrier's home country is not its origin.
struct PassportStatistics {
    struct DeliveryRecord: Identifiable, Equatable {
        let parcelID: UUID
        let label: String
        let duration: TimeInterval
        let deliveredAt: Date
        var id: UUID { parcelID }
    }

    struct OriginCountry: Identifiable, Equatable {
        let code: String
        let count: Int
        var id: String { code }
        var flag: String { TrackingLocation.flag(code) }
    }

    let trackedCount: Int
    let deliveredCount: Int
    let activeCount: Int
    let crossBorderCount: Int
    let domesticDeliveryCount: Int
    let longWaitDeliveryCount: Int
    let pickupDeliveryCount: Int
    let decemberDeliveryCount: Int
    let maxDeliveriesInOneDay: Int
    let durationSampleCount: Int
    let averageDeliveryDuration: TimeInterval?
    let fastestDelivery: DeliveryRecord?
    /// Countries explicitly reported at the first physical scan, across all parcels.
    /// This is "first seen in", which does not guarantee the sender's country.
    let originCountries: [OriginCountry]
    let knownOriginCount: Int
    var unknownOriginCount: Int { trackedCount - knownOriginCount }

    var nextMilestoneCount: Int {
        [1, 5, 10, 25, 50, 100].first(where: { $0 > deliveredCount })
            ?? ((deliveredCount / 100) + 1) * 100
    }

    var milestoneProgress: Double {
        Double(deliveredCount) / Double(nextMilestoneCount)
    }

    init(parcels: [Parcel], timeZone: TimeZone = .current) {
        var delivered = 0
        var active = 0
        var records: [DeliveryRecord] = []
        var countries: [String: Int] = [:]
        var deliveredDays: [Date: Int] = [:]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var crossBorder = 0, domestic = 0, longWait = 0, pickup = 0, december = 0

        for parcel in parcels {
            let meaningful = parcel.trackingEvents.filter { $0.stage != .pending }
            let dated = meaningful.compactMap { event -> DatedEvent? in
                guard let date = DateParser.date(event.occurredAt) else { return nil }
                return DatedEvent(event: event, date: date)
            }.sorted(by: Self.earlier)
            let datesAreComplete = dated.count == meaningful.count
            // A malformed date must not turn a return into an earned delivery.
            // Keep the app's status fallback when chronology cannot be established.
            let currentStage = datesAreComplete ? dated.last?.event.stage : parcel.currentStage
            if currentStage == .delivered { delivered += 1 }
            if parcel.archivedAt == nil && currentStage != .delivered && currentStage != .returned {
                active += 1
            }

            let physical = dated.filter { $0.event.stage != .registered }
            let completion = physical.first(where: { $0.event.stage == .delivered })
            if datesAreComplete, currentStage == .delivered, let completion {
                // Count each parcel once, using the device's Gregorian calendar day.
                deliveredDays[calendar.startOfDay(for: completion.date), default: 0] += 1
                if calendar.component(.month, from: completion.date) == 12 { december += 1 }
                if physical.contains(where: { $0.event.stage == .readyForPickup && $0.date < completion.date }) { pickup += 1 }
                let located = physical.filter { $0.date <= completion.date }.compactMap { scan -> (country: String, date: Date)? in
                    guard let country = TrackingLocation.countryCode(in: scan.event.location) else { return nil }
                    return (country, scan.date)
                }
                if located.enumerated().contains(where: { index, scan in
                    located.prefix(index).contains { $0.date < scan.date && $0.country != scan.country }
                }) { crossBorder += 1 }
            }
            guard datesAreComplete, let first = physical.first,
                  first.event.stage == .accepted || first.event.stage == .inTransit else { continue }

            // Never skip an unknown first scan and promote a destination scan into
            // an origin. City names and tracking-number suffixes are insufficient.
            if let country = TrackingLocation.countryCode(in: first.event.location) {
                countries[country, default: 0] += 1
            }

            guard currentStage == .delivered,
                  let completion else { continue }
            let duration = completion.date.timeIntervalSince(first.date)
            guard duration.isFinite, duration > 0 else { continue }
            if let country = TrackingLocation.countryCode(in: first.event.location),
               country == TrackingLocation.countryCode(in: completion.event.location) { domestic += 1 }
            if duration > 30 * 86_400 { longWait += 1 }
            records.append(DeliveryRecord(
                parcelID: parcel.id, label: parcel.label,
                duration: duration, deliveredAt: completion.date
            ))
        }

        crossBorderCount = crossBorder
        domesticDeliveryCount = domestic
        longWaitDeliveryCount = longWait
        pickupDeliveryCount = pickup
        decemberDeliveryCount = december
        maxDeliveriesInOneDay = deliveredDays.values.max() ?? 0
        trackedCount = parcels.count
        deliveredCount = delivered
        activeCount = active
        durationSampleCount = records.count
        averageDeliveryDuration = records.isEmpty
            ? nil : records.reduce(0) { $0 + $1.duration } / Double(records.count)
        fastestDelivery = records.min {
            if $0.duration != $1.duration { return $0.duration < $1.duration }
            return $0.parcelID.uuidString < $1.parcelID.uuidString
        }
        originCountries = countries.map { OriginCountry(code: $0.key, count: $0.value) }
            .sorted {
                if $0.count != $1.count { return $0.count > $1.count }
                return $0.code < $1.code
            }
        knownOriginCount = countries.values.reduce(0, +)
    }

    private struct DatedEvent {
        let event: TrackingEvent
        let date: Date
    }

    private static func earlier(_ left: DatedEvent, _ right: DatedEvent) -> Bool {
        if left.date != right.date { return left.date < right.date }
        // Carrier timestamps sometimes have minute precision. Put later stages
        // after earlier stages at the same instant, with return taking precedence.
        let stages: [TrackingStage] = [
            .registered, .accepted, .inTransit, .customs, .exception, .outForDelivery,
            .failedAttempt, .readyForPickup, .delivered, .returned,
        ]
        let leftRank = stages.firstIndex(of: left.event.stage) ?? 0
        let rightRank = stages.firstIndex(of: right.event.stage) ?? 0
        if leftRank != rightRank { return leftRank < rightRank }
        return left.event.id.uuidString < right.event.id.uuidString
    }

}

/// Country fields shared by parcel display and first-scan statistics.
enum TrackingLocation {
    private static let regionCodes = Set(Locale.Region.isoRegions.map(\.identifier).filter {
        $0.count == 2 && !["EU", "UN", "QO"].contains($0)
    })

    // A two-letter final address field can instead be a US state, Swiss canton,
    // Canadian province/territory, or Australian state. These require a full
    // country name, or a location containing only the country code.
    private static let ambiguousAddressCodes: Set<String> = [
        "AL", "AZ", "AR", "CA", "CO", "DE", "GA", "ID", "IL", "IN", "KY",
        "LA", "ME", "MD", "MA", "MN", "MS", "MO", "MT", "NE", "NC", "PA",
        "SC", "SD", "TN", "VA", "AG", "AI", "BE", "BL", "BS", "FR", "GE",
        "GL", "GR", "LU", "SG", "SH", "SO", "SZ", "TG", "NL", "NU", "PE",
        "SK", "YT", "SA",
    ]

    // Carrier spellings no region name matches. Display only: Passport evidence
    // stays in step with private.passport_country, which Friends stamps use.
    private static let carrierSpellings: [String: String] = [
        "united states of america": "US", "great britain": "GB", "czech republic": "CZ", "holland": "NL",
        "hong kong": "HK", "macau": "MO", "macao": "MO", "turkey": "TR", "russian federation": "RU",
        "korea": "KR", "republic of korea": "KR",
    ]

    // "Mexico City" is a city, not Mexico followed by one.
    private static let settlementWords: Set<String> = ["city", "town", "ville", "stadt", "ciudad", "cidade", "citta"]

    private static let fieldPattern = try! NSRegularExpression(pattern: "[^,;|()]+")

    private static let countryNames: [String: String] = {
        var names: [String: String] = [:]
        for code in regionCodes.sorted() {
            for language in ["en", "de", "fr", "it", "es", "pt", "pl"] {
                if let name = Locale(identifier: language).localizedString(forRegionCode: code) {
                    names[normalized(name)] = code
                }
            }
        }
        names["usa"] = "US"
        names["uk"] = "GB"
        return names
    }()

    /// A location split into the country its carrier wrote and the rest.
    struct Place: Equatable {
        let country: String?
        /// Empty when the country was all of the location.
        let name: String
    }

    /// Builds the country-name table (about 1,700 localized names) ahead of first use.
    static func prepare() {
        _ = countryNames
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func namedCountry(_ name: String, display: Bool) -> String? {
        let key = normalized(name)
        if let code = countryNames[key] { return code }
        guard display else { return nil }
        let bare = key.hasPrefix("the ") ? String(key.dropFirst(4)) : key
        return countryNames[bare] ?? carrierSpellings[bare]
    }

    private static func fieldCountry(_ field: String, in location: String, display: Bool) -> String? {
        if field.count == 2, field == field.uppercased(), regionCodes.contains(field) {
            return location == field || !ambiguousAddressCodes.contains(field) ? field : nil
        }
        return namedCountry(field, display: display)
    }

    /// Passport evidence: only an explicit final country field; never a country inferred from a city.
    static func countryCode(in location: String?) -> String? {
        guard let location else { return nil }
        // Require a whole country field: "Milano, IT", "Paris, France", or
        // "Berlin (Germany)". A bare city or an undelimited "Buchs AG" is unknown.
        let fields = location.components(separatedBy: CharacterSet(charactersIn: ",;|()"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard let field = fields.last else { return nil }
        return fieldCountry(field, in: location.trimmingCharacters(in: .whitespacesAndNewlines), display: false)
    }

    /// For display, takes an explicit country off a location: the final field ("Zürich, CH",
    /// repeated in "Hebron, KY, US, US") or a leading name ("Switzerland Haerkingen").
    static func place(_ location: String) -> Place {
        let text = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let fields = fieldPattern.matches(in: text, range: NSRange(text.startIndex..., in: text))
            .compactMap { Range($0.range, in: text) }
            .filter { !text[$0].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        var country: String?
        var kept = fields.count
        while kept > 0 {
            let field = text[fields[kept - 1]].trimmingCharacters(in: .whitespacesAndNewlines)
            guard let code = fieldCountry(field, in: text, display: true), country == nil || code == country else { break }
            country = code
            kept -= 1
        }
        if let country {
            let rest = kept > 0 ? String(text[..<fields[kept].lowerBound]) : ""
            return Place(country: country, name: rest.replacingOccurrences(of: "[\\s,;|(]+$", with: "", options: .regularExpression))
        }
        if fields.count == 1, fields[0] == text.startIndex..<text.endIndex {
            let words = text.split(whereSeparator: \.isWhitespace).map(String.init)
            for count in stride(from: min(words.count - 1, 4), to: 0, by: -1) {
                let name = words[count...].joined(separator: " ")
                if let code = namedCountry(words[..<count].joined(separator: " "), display: true),
                   name.first?.isUppercase == true, !settlementWords.contains(normalized(name)) {
                    return Place(country: code, name: name)
                }
            }
        }
        return Place(country: nil, name: text)
    }

    static func flag(_ code: String) -> String {
        String(String.UnicodeScalarView(code.unicodeScalars.compactMap {
            UnicodeScalar(127_397 + $0.value)
        }))
    }
}
