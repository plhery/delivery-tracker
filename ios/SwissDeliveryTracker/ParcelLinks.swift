import Foundation

extension Parcel {
    /// A parcel read through a link, as the card and the journal draw it. A hidden number stays empty.
    init(shared package: PublicPackage) {
        let data = package.carrierData
        self.init(
            id: package.id,
            trackingNumber: package.trackingNumber ?? "",
            label: package.label,
            carrier: package.carrier,
            createdAt: package.createdAt,
            expectedDelivery: package.expectedDelivery,
            lastStatusText: package.lastStatusText,
            lastSyncedAt: package.lastSyncedAt,
            syncStatus: package.syncStatus,
            syncError: package.syncError,
            trackingURL: package.trackingURL,
            dpdPostcode: package.dpdPostcode,
            carrierData: CarrierData(
                activeTrackingCarrier: data.activeTrackingCarrier,
                activeTrackingNumber: data.activeTrackingNumber,
                originalCarrier: data.originalCarrier,
                originalTrackingNumber: data.originalTrackingNumber,
                trackingProvider: data.trackingProvider,
                carrierAnswered: data.carrierAnswered,
                autoChangedFrom: data.autoChangedFrom,
                autoChangedTo: data.autoChangedTo,
                autoChangedAt: data.autoChangedAt,
                senderName: data.senderName,
                swissPostReady: data.swissPostReady,
                expectedDeliveryFrom: data.expectedDeliveryFrom,
                pickupPoint: data.pickupPoint,
                dimensionsText: data.dimensionsText,
                weightKg: data.weightKg,
                destinationCountry: data.destinationCountry
            ),
            archivedAt: package.archivedAt,
            notificationsMuted: package.notificationsMuted,
            trackingEvents: package.trackingEvents
        )
    }
}

extension ParcelNumberHint {
    /// How a hidden tracking number reads: "1234 ••• 899".
    var masked: String { "\(head) ••• \(tail)" }
}

/// How keeping a shared parcel ended.
enum ParcelLinkClaim: Equatable, Sendable {
    /// The parcel is in the account now.
    case added(UUID?)
    /// The account already follows this parcel.
    case already(UUID?)
    /// The account holds as many parcels as it may.
    case full
    case unavailable

    /// Nil when the answer says nothing about this link.
    init?(response: ClaimParcelsResponse, linkID: String) {
        guard let result = response.results.first(where: { $0.id == linkID }) else { return nil }
        switch result.outcome {
        case .kept: self = .added(result.packageID)
        case .already: self = .already(result.packageID)
        case .quota: self = .full
        case .unavailable: self = .unavailable
        }
    }
}

/// Why a link could not be read just now. The link itself may be fine.
enum ParcelLinkFailure: Equatable, Sendable {
    case rateLimited, offline, service

    /// Nil for a read that was cancelled.
    init?(_ error: Error) {
        if error is CancellationError { return nil }
        if let error = error as? URLError {
            if error.code == .cancelled { return nil }
            self = .offline
        } else if case DeliveryAPIError.rateLimited = error {
            self = .rateLimited
        } else {
            self = .service
        }
    }

    var messageKey: String {
        switch self {
        case .rateLimited: "error.rateLimited"
        case .offline: "error.connection"
        case .service: "native.error.serviceFailed"
        }
    }
}

/// The parcel link on screen. Anyone may look at it; a signed-in person keeps the parcel with
/// one tap. A link opened before signing in is remembered on this device for up to seven days.
@MainActor
final class ParcelLinkStore: ObservableObject {
    enum Phase: Equatable {
        case loading
        case shown(PublicParcelResponse)
        /// Forgotten, stopped or unknown: the link never says which.
        case unavailable
        case failed(ParcelLinkFailure)
    }

    /// What the deliveries list does once the sheet has closed.
    enum Arrival: Equatable {
        case added(UUID?)
        case open(UUID)
    }

    typealias Reader = @MainActor (String) async throws -> PublicParcelResponse?

    @Published private(set) var route: ParcelLinkRoute?
    @Published private(set) var presentationID = UUID()
    @Published private(set) var phase = Phase.loading
    /// A later read failed; the parcel read before stays on screen.
    @Published private(set) var refreshFailure: ParcelLinkFailure?
    /// An answer the sheet shows instead of closing: already followed, or no room.
    @Published private(set) var claim: ParcelLinkClaim?
    @Published private(set) var arrival: Arrival?

    private let defaults: UserDefaults
    private let read: Reader?
    private let now: () -> Date
    private let storageKey = "sdt.pendingParcelLink.v1"
    private var queuedArrival: Arrival?
    private var generation = 0
    private struct Pending: Codable { let id: String; let name: String?; let receivedAt: Date }

    /// A build without a server never reads a link: every link is unavailable there.
    init(defaults: UserDefaults = .standard, configuration: AppConfiguration = .current,
         now: @escaping () -> Date = Date.init, read: Reader? = nil) {
        self.defaults = defaults
        self.now = now
        if let read {
            self.read = read
        } else if configuration.mode == .api {
            self.read = { linkID in try await DeliveryAPIClient.publicParcel(linkID: linkID, configuration: configuration) }
        } else {
            self.read = nil
        }
    }

    func open(_ link: ParcelLinkRoute) {
        generation += 1
        route = link
        presentationID = UUID()
        phase = .loading
        refreshFailure = nil
        claim = nil
    }

    /// Reads the link, again when asked to refresh.
    func load() async {
        guard let route else { return }
        guard let read else { gone(); return }
        generation += 1
        let current = generation
        do {
            let response = try await read(route.id)
            guard current == generation, !Task.isCancelled else { return }
            refreshFailure = nil
            if let response { phase = .shown(response) } else { gone() }
        } catch {
            guard current == generation, !Task.isCancelled, let failure = ParcelLinkFailure(error) else { return }
            if case .shown = phase { refreshFailure = failure } else { phase = .failed(failure) }
        }
    }

    /// Keeps the link across sign-in. The sheet closes; `resume` opens it again.
    func rememberForSignIn() {
        guard let route else { return }
        let pending = Pending(id: route.id, name: route.name, receivedAt: now())
        if let data = try? JSONEncoder().encode(pending) { defaults.set(data, forKey: storageKey) }
        generation += 1
        self.route = nil
    }

    /// Opens the remembered link again, once someone is signed in.
    func resume() {
        guard route == nil, let link = remembered else { return }
        open(link)
    }

    /// The link kept for after sign-in, while it is still fresh.
    var remembered: ParcelLinkRoute? {
        guard let data = defaults.data(forKey: storageKey) else { return nil }
        guard let pending = try? JSONDecoder().decode(Pending.self, from: data), ParcelLinkRoute.validID(pending.id),
              now().timeIntervalSince(pending.receivedAt) >= 0, now().timeIntervalSince(pending.receivedAt) < 604_800 else {
            defaults.removeObject(forKey: storageKey)
            return nil
        }
        return ParcelLinkRoute(id: pending.id, name: pending.name)
    }

    /// Acts on how keeping the parcel ended. An added parcel closes the sheet, and the list shows it.
    func resolve(_ claim: ParcelLinkClaim) {
        switch claim {
        case .added(let id):
            forget()
            queuedArrival = .added(id)
            route = nil
        case .already:
            forget()
            self.claim = claim
        case .full:
            self.claim = claim
        case .unavailable:
            gone()
        }
    }

    /// Closes the sheet and has the list open the parcel the account already follows.
    func openExisting(_ parcelID: UUID) {
        queuedArrival = .open(parcelID)
        route = nil
    }

    /// The person closed the sheet.
    func close() {
        forget()
        generation += 1
        route = nil
    }

    /// The sheet has left the screen, so the list may take over.
    func dismissed() {
        guard let queuedArrival else { return }
        self.queuedArrival = nil
        arrival = queuedArrival
    }

    func consumeArrival() { arrival = nil }

    private func gone() {
        forget()
        phase = .unavailable
        refreshFailure = nil
        claim = nil
    }

    /// A remembered link is dropped once this link is settled; another link's stays.
    private func forget() {
        guard let route, remembered?.id == route.id else { return }
        defaults.removeObject(forKey: storageKey)
    }

    #if DEBUG
    /// Set by `debugPreview`: the sheet shows what a signed-in person sees.
    var previewsSignedIn = false
    #endif
}

#if DEBUG
extension ParcelLinkStore {
    /// Opens the link sheet at launch without a server, to look at it in the simulator:
    /// `-sdt.debug.parcelLink fixture` (the contract fixture: a viewer, number hidden),
    /// `route` (a demo parcel with a route, which may be kept) or `gone`.
    /// `-sdt.debug.parcelLink.signedIn YES` shows it as a signed-in person sees it.
    static func debugPreview(defaults: UserDefaults = .standard) -> ParcelLinkStore? {
        guard let variant = defaults.string(forKey: "sdt.debug.parcelLink") else { return nil }
        struct Fixtures: Decodable { let publicParcel: PublicParcelResponse }
        var response = Bundle.main.url(forResource: "ContractFixtures", withExtension: "json")
            .flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? JSONDecoder.deliveryTracker.decode(Fixtures.self, from: $0) }?.publicParcel
        if variant == "route", let parcel = DemoRepository().list().first(where: { $0.isActive && $0.trackingEvents.contains { $0.place != nil } }) {
            response?.link.numberShown = true
            response?.link.canKeep = true
            response?.package = PublicPackage(
                id: parcel.id, trackingNumber: parcel.trackingNumber, label: "", carrier: parcel.carrier, createdAt: parcel.createdAt,
                expectedDelivery: parcel.expectedDelivery, lastStatusText: parcel.lastStatusText, lastSyncedAt: parcel.lastSyncedAt,
                syncStatus: parcel.syncStatus,
                carrierData: PublicPackageCarrierData(senderName: parcel.carrierData?.senderName, destinationCountry: parcel.carrierData?.destinationCountry),
                notificationsMuted: false, trackingEvents: parcel.trackingEvents
            )
        }
        let shown = variant == "gone" ? nil : response
        let store = ParcelLinkStore(defaults: defaults, read: { _ in shown })
        store.previewsSignedIn = defaults.bool(forKey: "sdt.debug.parcelLink.signedIn")
        store.open(ParcelLinkRoute(id: shown?.link.id ?? "22222222222A"))
        return store
    }
}
#endif
