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

/// A carrier's pickup point: the first line names it, any further lines give its address.
struct PickupPoint: Equatable, Sendable {
    let name: String
    let address: String?

    init?(_ text: String?) {
        let lines = (text ?? "").components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard let first = lines.first else { return nil }
        name = first
        address = lines.count > 1 ? lines.dropFirst().joined(separator: ", ") : nil
    }

    /// Name and address on one line, for a maps search or the clipboard.
    var query: String { [name, address].compactMap { $0 }.joined(separator: ", ") }

    /// Directions when the carrier gives an address; a search when it only
    /// names the place, so the person can check which one it is.
    var mapsURL: URL? {
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#"))
        guard let value = query.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: "https://maps.apple.com/?\(address == nil ? "q" : "daddr")=\(value)")
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
        case .exception: StageMetadata(symbol: "exclamationmark.circle", tone: .warning, progress: 3)
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
        case .exception: 5
        case .outForDelivery: 6
        case .failedAttempt: 7
        case .readyForPickup: 8
        case .delivered: 9
        case .returned: 10
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
        case .exception: .exception
        default: nil
        }
    }
}

extension Parcel {
    /// The carrier an automatic correction replaced, for 12 hours. A parcel filed
    /// without a carrier only found one: nothing was swapped.
    func automaticallyChangedFrom(at now: Date = Date()) -> CarrierID? {
        guard let from = carrierData?.autoChangedFrom, from != carrier,
              from != .unknown, from != .internationalPost,
              carrierData?.autoChangedTo == carrier,
              let at = carrierData?.autoChangedAt.flatMap(DateParser.date),
              now >= at, now.timeIntervalSince(at) < 12 * 60 * 60 else { return nil }
        return from
    }

    /// A carrier that knows the number but needs this input before it can track the parcel.
    var inputNeeded: CarrierInputNeeded? { carrierData?.routing?.inputNeeded }

    /// Recognition found another carrier that needs the delivery postcode, while
    /// the parcel is still on its way.
    var inputNeededPrompt: CarrierInputNeeded? {
        guard let inputNeeded, inputNeeded.field == .dpdPostcode, inputNeeded.carrier != carrier,
              isActive else { return nil }
        return inputNeeded
    }

    var sortedEvents: [TrackingEvent] {
        trackingEvents.sorted(by: Self.eventPrecedes)
    }

    /// The country code of the first place the parcel was scanned, which is where it was posted.
    var stampOrigin: String? {
        trackingEvents.filter { $0.place != nil }
            .min { (DateParser.date($0.occurredAt) ?? .distantFuture) < (DateParser.date($1.occurredAt) ?? .distantFuture) }?
            .place?.country
    }

    /// The day and month the parcel was delivered, as a postmark shows it: 28.09.
    var stampDeliveryDate: String? {
        guard isDelivered, let event = currentEvent, let date = DateParser.date(event.occurredAt) else { return nil }
        let parts = Calendar.current.dateComponents([.day, .month], from: date)
        return String(format: "%02d.%02d", parts.day ?? 0, parts.month ?? 0)
    }

    /// Whether refreshed parcels bring new tracking: a changed timeline, status
    /// line or delivery date. A parcel that replaced another is compared with it.
    static func trackingChanged(from before: [Parcel], to after: [Parcel]) -> Bool {
        let earlier = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return after.contains { parcel in
            guard let previous = earlier[parcel.id] ?? parcel.carrierData?.originalPackageID.flatMap({ earlier[$0] })
            else { return true }
            return parcel.trackingEvents != previous.trackingEvents
                || parcel.lastStatusText != previous.lastStatusText
                || parcel.expectedDelivery != previous.expectedDelivery
        }
    }

    fileprivate static func eventPrecedes(_ lhs: TrackingEvent, _ rhs: TrackingEvent) -> Bool {
        let left = DateParser.date(lhs.occurredAt)?.timeIntervalSince1970 ?? 0
        let right = DateParser.date(rhs.occurredAt)?.timeIntervalSince1970 ?? 0
        if left == right {
            if lhs.stage != rhs.stage { return lhs.stage.eventOrder > rhs.stage.eventOrder }
            return lhs.id.uuidString > rhs.id.uuidString
        }
        return left > right
    }

    var currentEvent: TrackingEvent? {
        LatestEventCache.shared.latest(of: self)
    }

    var currentStage: TrackingStage? { currentEvent?.stage }
    /// Where a parcel waiting for collection waits, for its status line.
    var pickupPlace: String? { currentStage == .readyForPickup ? PickupPoint(carrierData?.pickupPoint)?.name : nil }
    var hasCarrierUpdate: Bool { currentEvent.map { $0.stage != .pending } ?? false }
    var isUnannounced: Bool { !hasCarrierUpdate && syncStatus == .waiting }
    var isArchived: Bool { archivedAt != nil }
    var isDelivered: Bool { currentStage == .delivered }
    var isReturned: Bool { currentStage == .returned }
    var isActive: Bool { !isArchived && !(currentStage?.isFinal ?? false) }

    /// Distinct numbers, the followed one first, and then the named delivering carrier's own.
    var trackingNumbers: [(carrier: CarrierID, number: String)] {
        let delivery = (carrier: activeTrackingCarrier, number: carrierData?.activeTrackingNumber?.nonEmpty ?? trackingNumber)
        let original = (carrier: carrierData?.originalCarrier ?? carrier, number: carrierData?.originalTrackingNumber?.nonEmpty ?? trackingNumber)
        let numbers = delivery.number == original.number ? [delivery] : [delivery, original]
        guard let named = namedDelivery, let number = named.number else { return numbers }
        return numbers + [(carrier: named.carrier, number: number)]
    }

    var displayedCarrier: CarrierID { carrierData?.originalCarrier ?? activeTrackingCarrier }

    /// The carrier the followed one names as delivering, while the parcel is not followed there yet, and the number it
    /// gave. Once it is followed, the parcel has been handed over and `trackingSource` says so.
    var namedDelivery: (carrier: CarrierID, number: String?)? {
        guard let carrier = carrierData?.deliveryCarrier, carrierData?.originalCarrier == nil, carrier != displayedCarrier,
              CarrierCatalog.shared.definitions[carrier] != nil else { return nil }
        let number = carrierData?.deliveryTrackingNumber?.nonEmpty
        return (carrier, number == trackingNumber ? nil : number)
    }

    /// Who delivers when it isn't the carrier shown: the one the parcel was handed to, else the one its carrier names.
    var deliveringCarrier: CarrierID? {
        activeTrackingCarrier != displayedCarrier ? activeTrackingCarrier : namedDelivery?.carrier
    }

    var amazonShippingHistoryExpired: Bool {
        carrier == .amazonShipping && syncError == "amazon_shipping_history_expired"
    }

    var activeTrackingCarrier: CarrierID {
        if CarrierCatalog.shared.requiresAmazonAccount(carrier, trackingNumber: trackingNumber) { return .amazonLogistics }
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
            return ParcelDisplayStatus(key: carrierData?.routing?.providerInputNeeded != nil ? "status.inputNeeded" : carrier == .unknown ? "status.noHistory" : "status.unannounced", tone: .normal, syncing: false)
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
        case .exception: return .exception
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

    private static let expectedDayPattern = try? NSRegularExpression(pattern: "^(\\d{4}-\\d{2}-\\d{2})(?:$|[ T])")

    var expectedDayKey: String? {
        guard let expectedDelivery else { return nil }
        let range = NSRange(expectedDelivery.startIndex..., in: expectedDelivery)
        guard let match = Self.expectedDayPattern?.firstMatch(in: expectedDelivery, range: range),
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

/// Filters, sorts and every card ask for a parcel's latest event several times
/// per render. Keep each answer until the parcel's history changes: copies of a
/// list share their event arrays, so a hit compares storage, not events.
private final class LatestEventCache: @unchecked Sendable {
    static let shared = LatestEventCache()
    private let lock = NSLock()
    private var entries: [UUID: (events: [TrackingEvent], latest: TrackingEvent?)] = [:]

    func latest(of parcel: Parcel) -> TrackingEvent? {
        let events = parcel.trackingEvents
        if let entry = lock.withLock({ entries[parcel.id] }), entry.events == events {
            return entry.latest
        }
        let carrier = events.filter { $0.stage != .pending }.sorted(by: Parcel.eventPrecedes)
        let latest = Self.current(newestFirst: carrier) ?? events.min(by: Parcel.eventPrecedes)
        lock.withLock { entries[parcel.id] = (events, latest) }
        return latest
    }

    /// Carrier stages before the parcel moves, in order.
    private static let early: [TrackingStage] = [.registered, .accepted]
    /// Stages of a parcel on its way, short of a final one.
    private static let moving: Set<TrackingStage> = [.inTransit, .customs, .outForDelivery, .failedAttempt, .readyForPickup]

    /// An announcement or acceptance after the parcel has moved on is a notice
    /// or a reworded scan, not a step back: the scan before it still says where
    /// the parcel is. After a problem, a return or a delivery, a new label starts over.
    private static func current(newestFirst carrier: [TrackingEvent]) -> TrackingEvent? {
        guard var current = carrier.first else { return nil }
        for event in carrier.dropFirst() {
            guard let rank = early.firstIndex(of: current.stage) else { break }
            if moving.contains(event.stage) { return event }
            guard let earlier = early.firstIndex(of: event.stage) else { break }
            if earlier > rank { current = event }
        }
        return current
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
    case customs, exception, stalled
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
        let today = dayKey(now)
        let matching = parcels
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
                case .today: parcel.isActive && parcel.expectedDayKey == today
                case .delivered: !parcel.isArchived && parcel.isDelivered
                case .archived: parcel.isArchived
                }
            }
            .filter { carrier == nil || $0.carrier == carrier }
        return sorted(matching, by: sort, catalog: catalog)
    }

    /// Reads each parcel's sort fields once, instead of twice per comparison.
    static func sorted(_ parcels: [Parcel], by sort: ParcelSort, catalog: CarrierCatalog = .shared) -> [Parcel] {
        parcels.map { SortKey($0, sort: sort, catalog: catalog) }
            .sorted { $0.precedes($1) }
            .map(\.parcel)
    }

    /// Feature an arrival or pickup. Issues are shown separately as compact notices.
    static func nextDelivery(from parcels: [Parcel], now: Date = Date()) -> Parcel? {
        let today = dayKey(now)
        let candidates = parcels.filter { parcel in
            guard parcel.isActive else { return false }
            let reason = parcel.attention(now: now)
            return reason == nil || reason == .readyForPickup
                || (reason == .syncError && parcel.currentStage == .outForDelivery)
        }
        func urgency(_ parcel: Parcel) -> Int {
            if parcel.currentStage == .readyForPickup { return 0 }
            return parcel.currentStage == .outForDelivery || parcel.expectedDayKey == today ? 1 : 2
        }
        let next = candidates
            .map { (urgency: urgency($0), placed: $0.trackingEvents.contains { $0.place != nil },
                    key: SortKey($0, sort: .priority, catalog: .shared)) }
            .min { left, right in
                if left.urgency != right.urgency { return left.urgency < right.urgency }
                // Next up draws the parcel's route: of two due the same day, the one with places to draw goes first.
                if left.key.expected == right.key.expected, left.placed != right.placed { return left.placed }
                return left.key.precedes(right.key)
            }
        return next?.key.parcel
    }

    static func sections(from parcels: [Parcel], now: Date = Date()) -> [ParcelSection] {
        let today = dayKey(now)
        let active = parcels.filter(\.isActive).map { (parcel: $0, attention: $0.attention(now: now)) }
        let attention = active.filter { $0.attention != nil }.map(\.parcel)
        let arrivingToday = active.filter {
            $0.attention == nil && $0.parcel.expectedDayKey == today
        }.map(\.parcel)
        let onTheWay = active.filter {
            $0.attention == nil && $0.parcel.expectedDayKey != today
        }.map(\.parcel)
        let archived = sortPastParcels(parcels.filter(\.isArchived))
        let values: [(ParcelSectionKind, [Parcel])] = [
            (.attention, attention),
            (.today, arrivingToday),
            (.active, onTheWay),
            (.delivered, sortPastParcels(parcels.filter { !$0.isArchived && $0.isDelivered })),
            (.returned, sortPastParcels(parcels.filter { !$0.isArchived && $0.isReturned })),
            (.archived, archived),
        ]
        return values.compactMap { $0.1.isEmpty ? nil : ParcelSection(kind: $0.0, parcels: $0.1) }
    }

    private struct SortKey {
        let parcel: Parcel
        let sort: ParcelSort
        let expected: String
        let updated: String
        let carrierName: String

        init(_ parcel: Parcel, sort: ParcelSort, catalog: CarrierCatalog) {
            self.parcel = parcel
            self.sort = sort
            expected = sort == .priority || sort == .eta ? parcel.expectedDayKey ?? "9999-99-99" : ""
            updated = sort == .priority || sort == .updated
                ? parcel.currentEvent?.occurredAt ?? parcel.createdAt
                : ""
            carrierName = sort == .carrier ? catalog.info(for: parcel.carrier).displayName : ""
        }

        func precedes(_ other: SortKey) -> Bool {
            let comparison: ComparisonResult
            switch sort {
            case .priority:
                comparison = expected.compare(other.expected) == .orderedSame
                    ? other.updated.compare(updated)
                    : expected.compare(other.expected)
            case .updated:
                comparison = other.updated.compare(updated)
            case .newest:
                comparison = other.parcel.createdAt.compare(parcel.createdAt)
            case .eta:
                comparison = expected.compare(other.expected)
            case .carrier:
                comparison = carrierName.localizedCaseInsensitiveCompare(other.carrierName)
            }
            if comparison != .orderedSame { return comparison == .orderedAscending }
            let label = parcel.label.localizedCaseInsensitiveCompare(other.parcel.label)
            return label == .orderedSame
                ? parcel.id.uuidString < other.parcel.id.uuidString
                : label == .orderedAscending
        }
    }

    private static func sortPastParcels(_ parcels: [Parcel]) -> [Parcel] {
        parcels.map { (parcel: $0, date: completionSortDate($0)) }
            .sorted { left, right in
                if left.date == right.date { return left.parcel.id.uuidString < right.parcel.id.uuidString }
                return left.date > right.date
            }
            .map(\.parcel)
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

    /// The parcels the list last showed on their way that have since been delivered, as the list
    /// showed them: each keeps that place until its card leaves for the past deliveries.
    static func justDelivered(shown: [Parcel], now: [Parcel]) -> [Parcel] {
        let current = Dictionary(now.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return shown.filter { was in
            guard was.isActive, let parcel = current[was.id] else { return false }
            return !parcel.isArchived && parcel.isDelivered
        }
    }

    /// The local calendar day as `yyyy-MM-dd`, without building a formatter per call.
    static func dayKey(_ date: Date) -> String {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

/// A parcel delivered since the list was last shown does not jump to the past deliveries: its
/// card first says so where it stands, then travels there. Until then the list keeps the
/// arrangement it had, whatever else the same news changed.
struct DeliveredHold: Equatable {
    /// The parcels that have just arrived.
    private(set) var ids: Set<UUID> = []
    /// Every parcel as the list showed it before they did.
    private var shown: [UUID: Parcel] = [:]

    var isEmpty: Bool { ids.isEmpty }
    func holds(_ id: UUID) -> Bool { ids.contains(id) }

    /// The list is about to show `next` where it showed `before`. A list that nobody is
    /// looking at holds nothing, and changes at once.
    mutating func receive(shown before: [Parcel], next: [Parcel], watching: Bool) {
        guard watching else {
            release()
            return
        }
        let current = Dictionary(next.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        // A held parcel stays in its place for as long as it is still a delivery to show.
        var holding = ids.filter { id in current[id].map { !$0.isArchived && $0.isDelivered } ?? false }
        let arrivals = ParcelOrganizer.justDelivered(shown: before, now: next)
        if holding.isEmpty, !arrivals.isEmpty {
            shown = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        }
        holding.formUnion(arrivals.map(\.id))
        if holding.isEmpty {
            release()
        } else if holding != ids {
            ids = holding
        }
    }

    mutating func release() {
        if !ids.isEmpty { ids = [] }
        if !shown.isEmpty { shown = [:] }
    }

    /// The parcels as the list arranges them: as they were shown, but for one archived or brought back since.
    func arranged(_ parcels: [Parcel]) -> [Parcel] {
        guard !ids.isEmpty else { return parcels }
        return parcels.map { parcel in
            guard let was = shown[parcel.id], was.isArchived == parcel.isArchived else { return parcel }
            return was
        }
    }
}

/// The card a parcel is shown on in the deliveries.
enum DeliveryCardKind: Equatable {
    case next, attention, onTheWay, past
}

/// Everything the Deliveries list shows, derived in one pass per render.
struct DeliveryListLayout {
    let visible: [Parcel]
    let active: [Parcel]
    let next: Parcel?
    let attention: [Parcel]
    let remaining: [Parcel]
    let sections: [ParcelSection]

    init(
        parcels: [Parcel],
        query: String,
        status: ParcelStatusFilter,
        carrier: CarrierID?,
        sort: ParcelSort,
        featuresNext: Bool,
        now: Date = Date(),
        catalog: CarrierCatalog = .shared
    ) {
        visible = ParcelOrganizer.visible(
            parcels, query: query, status: status, carrier: carrier, sort: sort, now: now, catalog: catalog
        )
        active = visible.filter(\.isActive)
        let next = featuresNext ? ParcelOrganizer.nextDelivery(from: active, now: now) : nil
        self.next = next
        let others = active.filter { $0.id != next?.id }.map { (parcel: $0, attention: $0.attention(now: now)) }
        attention = others.filter { $0.attention != nil }.map(\.parcel)
        remaining = others.filter { $0.attention == nil }.map(\.parcel)
        sections = ParcelOrganizer.sections(from: visible, now: now).filter {
            $0.kind == .delivered || $0.kind == .returned || $0.kind == .archived
        }
    }

    /// The card this parcel is shown on, outside the archive.
    func kind(of id: UUID) -> DeliveryCardKind? {
        if next?.id == id { return .next }
        if attention.contains(where: { $0.id == id }) { return .attention }
        if remaining.contains(where: { $0.id == id }) { return .onTheWay }
        let past = sections.contains { $0.kind != .archived && $0.parcels.contains { $0.id == id } }
        return past ? .past : nil
    }

    /// The parcels whose card is another once the list becomes `next`: those take their new place in front of the reader.
    func changing(into next: DeliveryListLayout) -> [UUID: (was: DeliveryCardKind, becomes: DeliveryCardKind)] {
        var changes: [UUID: (was: DeliveryCardKind, becomes: DeliveryCardKind)] = [:]
        for parcel in visible {
            guard let was = kind(of: parcel.id), let becomes = next.kind(of: parcel.id), was != becomes else { continue }
            changes[parcel.id] = (was, becomes)
        }
        return changes
    }
}
