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
        var flag: String {
            String(String.UnicodeScalarView(code.unicodeScalars.compactMap {
                UnicodeScalar(127_397 + $0.value)
            }))
        }
    }

    let trackedCount: Int
    let deliveredCount: Int
    let activeCount: Int
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

    init(parcels: [Parcel]) {
        var delivered = 0
        var active = 0
        var records: [DeliveryRecord] = []
        var countries: [String: Int] = [:]

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
            guard datesAreComplete, let first = physical.first,
                  first.event.stage == .accepted || first.event.stage == .inTransit else { continue }

            // Never skip an unknown first scan and promote a destination scan into
            // an origin. City names and tracking-number suffixes are insufficient.
            if let country = TrackingLocation.countryCode(in: first.event.location) {
                countries[country, default: 0] += 1
            }

            guard currentStage == .delivered,
                  let completion = physical.first(where: { $0.event.stage == .delivered }) else { continue }
            let duration = completion.date.timeIntervalSince(first.date)
            guard duration.isFinite, duration > 0 else { continue }
            records.append(DeliveryRecord(
                parcelID: parcel.id, label: parcel.label,
                duration: duration, deliveredAt: completion.date
            ))
        }

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
            .registered, .accepted, .inTransit, .customs, .outForDelivery,
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

    private static let countryNames: [String: String] = {
        var names: [String: String] = [:]
        for code in regionCodes.sorted() {
            for language in ["en", "de", "fr", "it"] {
                if let name = Locale(identifier: language).localizedString(forRegionCode: code) {
                    names[normalized(name)] = code
                }
            }
        }
        names["usa"] = "US"
        names["uk"] = "GB"
        return names
    }()

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    static func countryCode(in location: String?) -> String? {
        guard let location else { return nil }
        // Require a whole country field: "Milano, IT", "Paris, France", or
        // "Berlin (Germany)". A bare city or an undelimited "Buchs AG" is unknown.
        let fields = location.components(separatedBy: CharacterSet(charactersIn: ",;|()"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard let field = fields.last else { return nil }
        if field.count == 2, field == field.uppercased(), regionCodes.contains(field) {
            let standalone = location.trimmingCharacters(in: .whitespacesAndNewlines) == field
            return standalone || !ambiguousAddressCodes.contains(field) ? field : nil
        }
        return countryNames[normalized(field)]
    }

    static func label(_ location: String) -> String {
        guard let country = countryCode(in: location),
              let expression = try? NSRegularExpression(pattern: "[^,;|()]+") else { return location }
        let matches = expression.matches(in: location, range: NSRange(location.startIndex..., in: location))
        guard let field = matches.compactMap({ Range($0.range, in: location) }).last(where: {
            !location[$0].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }) else { return location }
        let name = location[field].trimmingCharacters(in: .whitespacesAndNewlines)
        guard let range = location.range(of: name, range: field) else { return location }
        let flag = String(String.UnicodeScalarView(country.unicodeScalars.compactMap {
            UnicodeScalar(127_397 + $0.value)
        }))
        return location.replacingCharacters(in: range, with: flag)
    }
}
