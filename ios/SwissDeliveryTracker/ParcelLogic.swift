import Foundation
import SwiftUI

enum ParcelTone: Sendable {
    case normal, warning, complete

    var color: Color {
        switch self {
        case .normal: Brand.accent
        case .warning: Brand.warning
        case .complete: ExperimentalPalette.delivered
        }
    }
}

struct StageMetadata: Sendable {
    let symbol: String
    let tone: ParcelTone
    let progress: Int
}

extension TrackingStage {
    static let core: [TrackingStage] = [
        .pending, .registered, .accepted, .inTransit, .outForDelivery, .delivered,
    ]

    var metadata: StageMetadata {
        switch self {
        case .pending: StageMetadata(symbol: "magnifyingglass", tone: .normal, progress: 0)
        case .registered: StageMetadata(symbol: "doc.text", tone: .normal, progress: 1)
        case .accepted: StageMetadata(symbol: "shippingbox", tone: .normal, progress: 2)
        case .inTransit: StageMetadata(symbol: "truck.box", tone: .normal, progress: 3)
        case .customs: StageMetadata(symbol: "building.columns", tone: .warning, progress: 3)
        case .outForDelivery: StageMetadata(symbol: "bicycle", tone: .normal, progress: 4)
        case .failedAttempt: StageMetadata(symbol: "exclamationmark.triangle", tone: .warning, progress: 4)
        case .readyForPickup: StageMetadata(symbol: "storefront", tone: .warning, progress: 4)
        case .delivered: StageMetadata(symbol: "checkmark.circle.fill", tone: .complete, progress: 5)
        case .returned: StageMetadata(symbol: "arrow.uturn.backward.circle", tone: .warning, progress: 5)
        }
    }

    var eventOrder: Int {
        switch self {
        case .pending: 0
        case .registered: 1
        case .accepted: 2
        case .inTransit: 3
        case .customs: 4
        case .outForDelivery: 5
        case .failedAttempt: 6
        case .readyForPickup: 7
        case .delivered: 8
        case .returned: 9
        }
    }

    var localizationKey: String { "stage.\(rawValue)" }
    var isFinal: Bool { self == .delivered || self == .returned }

    var deliveryActivityPhase: DeliveryActivityPhase? {
        switch self {
        case .outForDelivery: .outForDelivery
        case .delivered: .delivered
        case .failedAttempt: .failedAttempt
        case .readyForPickup: .readyForPickup
        case .returned: .returned
        default: nil
        }
    }
}

extension Parcel {
    var sortedEvents: [TrackingEvent] {
        trackingEvents.sorted(by: Self.eventPrecedes)
    }

    private static func eventPrecedes(_ lhs: TrackingEvent, _ rhs: TrackingEvent) -> Bool {
        let left = DateParser.date(lhs.occurredAt)?.timeIntervalSince1970 ?? 0
        let right = DateParser.date(rhs.occurredAt)?.timeIntervalSince1970 ?? 0
        if left == right {
            if lhs.stage != rhs.stage { return lhs.stage.eventOrder > rhs.stage.eventOrder }
            return lhs.id.uuidString > rhs.id.uuidString
        }
        return left > right
    }

    var currentEvent: TrackingEvent? {
        // Status checks need only the latest carrier event, not a sorted history.
        trackingEvents.lazy.filter { $0.stage != .pending }.min(by: Self.eventPrecedes)
            ?? trackingEvents.min(by: Self.eventPrecedes)
    }

    var currentStage: TrackingStage? { currentEvent?.stage }
    var hasCarrierUpdate: Bool { currentEvent.map { $0.stage != .pending } ?? false }
    var isUnannounced: Bool { !hasCarrierUpdate && syncStatus == .waiting }
    var isArchived: Bool { archivedAt != nil }
    var isDelivered: Bool { currentStage == .delivered }
    var isReturned: Bool { currentStage == .returned }
    var isActive: Bool { !isArchived && !(currentStage?.isFinal ?? false) }

    var displayedCarrier: CarrierID { carrierData?.originalCarrier ?? activeTrackingCarrier }

    var activeTrackingCarrier: CarrierID {
        if let trackingSource { return trackingSource }
        return CarrierCatalog.supportsSwissPostHandoff(trackingNumber) ? .aliexpress : carrier
    }

    var displayStatus: ParcelDisplayStatus {
        if !hasCarrierUpdate && !CarrierCatalog.shared.tracksAutomatically(activeTrackingCarrier) {
            return ParcelDisplayStatus(key: "status.unsupported", tone: .warning, syncing: false)
        }
        if !hasCarrierUpdate && (syncStatus == .pending || syncStatus == .syncing) {
            return ParcelDisplayStatus(key: "status.syncing", tone: .normal, syncing: true)
        }
        if !hasCarrierUpdate && syncStatus == .error {
            return ParcelDisplayStatus(key: "status.failed", tone: .warning, syncing: false)
        }
        if !hasCarrierUpdate && syncStatus == .unsupported {
            return ParcelDisplayStatus(key: "status.unsupported", tone: .warning, syncing: false)
        }
        if isUnannounced {
            return ParcelDisplayStatus(key: "status.unannounced", tone: .normal, syncing: false)
        }
        guard let currentStage else {
            return ParcelDisplayStatus(key: "status.unannounced", tone: .normal, syncing: false)
        }
        return ParcelDisplayStatus(
            key: currentStage.localizationKey,
            tone: currentStage.metadata.tone,
            syncing: false
        )
    }

    func attention(now: Date = Date()) -> ParcelAttention? {
        switch currentStage {
        case .failedAttempt: return .failedAttempt
        case .readyForPickup: return .readyForPickup
        case .customs: return .customs
        default: break
        }
        if syncStatus == .error { return .syncError }
        if let event = currentEvent,
           [.registered, .accepted, .inTransit].contains(event.stage),
           let update = DateParser.date(event.occurredAt),
           now.timeIntervalSince(update) >= 4 * 86_400 {
            return .stalled
        }
        if isUnannounced,
           let created = DateParser.date(createdAt),
           now.timeIntervalSince(created) >= 2 * 86_400 {
            return .notAnnounced
        }
        return nil
    }

    var expectedDayKey: String? {
        guard let expectedDelivery else { return nil }
        let expression = try? NSRegularExpression(pattern: "^(\\d{4}-\\d{2}-\\d{2})(?:$|[ T])")
        let range = NSRange(expectedDelivery.startIndex..., in: expectedDelivery)
        guard let match = expression?.firstMatch(in: expectedDelivery, range: range),
              let swiftRange = Range(match.range(at: 1), in: expectedDelivery) else { return nil }
        return String(expectedDelivery[swiftRange])
    }

    var searchText: String {
        ([label, trackingNumber, lastStatusText ?? ""]
            + trackingEvents.flatMap { [$0.description, $0.location ?? ""] })
            .joined(separator: " ")
            .lowercased()
    }
}

struct ParcelDisplayStatus: Sendable {
    let key: String
    let tone: ParcelTone
    let syncing: Bool
}

enum ParcelAttention: String, Sendable {
    case syncError = "sync_error"
    case failedAttempt = "failed_attempt"
    case readyForPickup = "ready_for_pickup"
    case customs, stalled
    case notAnnounced = "not_announced"

    var localizationKey: String { "attention.\(rawValue)" }
}

enum ParcelStatusFilter: String, CaseIterable, Identifiable {
    case all, active, attention, today, delivered, archived
    var id: String { rawValue }
    var localizationKey: String { "view.filter.\(rawValue)" }
}

enum ParcelSort: String, CaseIterable, Identifiable {
    case priority, updated, newest, eta, carrier
    var id: String { rawValue }
    var localizationKey: String { "view.sort.\(rawValue)" }
}

enum ParcelSectionKind: String, Identifiable {
    case attention, today, active, delivered, returned, archived
    var id: String { rawValue }
}

struct ParcelSection: Identifiable {
    let kind: ParcelSectionKind
    let parcels: [Parcel]
    var id: String { kind.id }
}

enum ParcelOrganizer {
    static func visible(
        _ parcels: [Parcel],
        query: String,
        status: ParcelStatusFilter,
        carrier: CarrierID?,
        sort: ParcelSort,
        now: Date = Date(),
        catalog: CarrierCatalog = .shared
    ) -> [Parcel] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let compact = trimmed.replacingOccurrences(of: "[\\s.-]", with: "", options: .regularExpression)
        return parcels
            .filter { parcel in
                guard !trimmed.isEmpty else { return true }
                let carrierName = catalog.info(for: parcel.carrier).displayName.lowercased()
                let compactTracking = parcel.trackingNumber.lowercased()
                    .replacingOccurrences(of: "[\\s.-]", with: "", options: .regularExpression)
                return parcel.searchText.contains(trimmed)
                    || carrierName.contains(trimmed)
                    || (!compact.isEmpty && compactTracking.contains(compact))
            }
            .filter { parcel in
                switch status {
                case .all: true
                case .active: parcel.isActive
                case .attention: parcel.isActive && parcel.attention(now: now) != nil
                case .today: parcel.isActive && parcel.expectedDayKey == dayKey(now)
                case .delivered: !parcel.isArchived && parcel.isDelivered
                case .archived: parcel.isArchived
                }
            }
            .filter { carrier == nil || $0.carrier == carrier }
            .sorted { compare($0, $1, by: sort, catalog: catalog) }
    }

    /// Feature an arrival or pickup. Issues are shown separately as compact notices.
    static func nextDelivery(from parcels: [Parcel], now: Date = Date()) -> Parcel? {
        let candidates = parcels.filter { parcel in
            guard parcel.isActive else { return false }
            let reason = parcel.attention(now: now)
            return reason == nil || reason == .readyForPickup
                || (reason == .syncError && parcel.currentStage == .outForDelivery)
        }
        func urgency(_ parcel: Parcel) -> Int {
            if parcel.currentStage == .readyForPickup { return 0 }
            return parcel.currentStage == .outForDelivery || parcel.expectedDayKey == dayKey(now) ? 1 : 2
        }
        return candidates.sorted { left, right in
            if urgency(left) != urgency(right) { return urgency(left) < urgency(right) }
            return compare(left, right, by: .priority)
        }.first
    }

    static func sections(from parcels: [Parcel], now: Date = Date()) -> [ParcelSection] {
        let active = parcels.filter(\.isActive)
        let attention = active.filter { $0.attention(now: now) != nil }
        let today = active.filter {
            $0.attention(now: now) == nil && $0.expectedDayKey == dayKey(now)
        }
        let onTheWay = active.filter {
            $0.attention(now: now) == nil && $0.expectedDayKey != dayKey(now)
        }
        let archived = sortPastParcels(parcels.filter(\.isArchived))
        let values: [(ParcelSectionKind, [Parcel])] = [
            (.attention, attention),
            (.today, today),
            (.active, onTheWay),
            (.delivered, sortPastParcels(parcels.filter { !$0.isArchived && $0.isDelivered })),
            (.returned, sortPastParcels(parcels.filter { !$0.isArchived && $0.isReturned })),
            (.archived, archived),
        ]
        return values.compactMap { $0.1.isEmpty ? nil : ParcelSection(kind: $0.0, parcels: $0.1) }
    }

    static func compare(
        _ lhs: Parcel,
        _ rhs: Parcel,
        by sort: ParcelSort,
        catalog: CarrierCatalog = .shared
    ) -> Bool {
        let comparison: ComparisonResult
        switch sort {
        case .priority:
            let left = lhs.expectedDayKey ?? "9999-99-99"
            let right = rhs.expectedDayKey ?? "9999-99-99"
            comparison = left.compare(right) == .orderedSame
                ? updated(rhs).compare(updated(lhs))
                : left.compare(right)
        case .updated:
            comparison = updated(rhs).compare(updated(lhs))
        case .newest:
            comparison = rhs.createdAt.compare(lhs.createdAt)
        case .eta:
            comparison = (lhs.expectedDayKey ?? "9999-99-99").compare(rhs.expectedDayKey ?? "9999-99-99")
        case .carrier:
            comparison = catalog.info(for: lhs.carrier).displayName
                .localizedCaseInsensitiveCompare(catalog.info(for: rhs.carrier).displayName)
        }
        if comparison != .orderedSame { return comparison == .orderedAscending }
        let label = lhs.label.localizedCaseInsensitiveCompare(rhs.label)
        return label == .orderedSame ? lhs.id.uuidString < rhs.id.uuidString : label == .orderedAscending
    }

    private static func updated(_ parcel: Parcel) -> String {
        parcel.currentEvent?.occurredAt ?? parcel.createdAt
    }

    private static func sortPastParcels(_ parcels: [Parcel]) -> [Parcel] {
        parcels.sorted { left, right in
            let leftDate = completionSortDate(left)
            let rightDate = completionSortDate(right)
            if leftDate == rightDate { return left.id.uuidString < right.id.uuidString }
            return leftDate > rightDate
        }
    }

    private static func completionSortDate(_ parcel: Parcel) -> Date {
        if let event = parcel.currentEvent,
           event.stage.isFinal,
           let completionDate = DateParser.date(event.occurredAt) {
            return completionDate
        }
        if let archivedAt = parcel.archivedAt.flatMap(DateParser.date) {
            return archivedAt
        }
        if let eventDate = parcel.currentEvent.flatMap({ DateParser.date($0.occurredAt) }) {
            return eventDate
        }
        return DateParser.date(parcel.createdAt) ?? .distantPast
    }

    static func dayKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
