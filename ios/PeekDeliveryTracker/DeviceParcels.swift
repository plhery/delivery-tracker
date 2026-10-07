import Foundation

/// A parcel followed on this iPhone without an account: the link the service made for it, the
/// key that owns the link, and what this device knows about the parcel.
struct DeviceParcel: Codable, Equatable, Sendable {
    var linkID: String
    /// The name given on this device; the service never learns it.
    var label: String
    var archivedAt: String?
    var parcel: Parcel
    var checkedAt: Date
    /// The parcel this one took the place of when its carrier was changed, so an open page keeps showing it.
    var replaced: UUID? = nil
}

/// Lookups are counted for each network; the day's count is spent.
struct DeviceLookupsSpent: Error, Equatable {}

/// How the device's parcels reach the service: no sign-in and no cookies, the link's id and
/// its owner key only.
struct DeviceParcelClient: Sendable {
    var lookup: @Sendable (PublicLookupRequest) async throws -> PublicLookupResponse
    /// Nil when the service no longer has the parcel.
    var read: @Sendable (_ linkID: String, _ key: String) async throws -> PublicParcelResponse?
    var forget: @Sendable (_ linkID: String, _ key: String) async throws -> Void
    /// Changes what the link shows to others, or stops and resumes its sharing.
    var update: @Sendable (_ linkID: String, _ key: String, UpdateParcelLinkRequest) async throws -> PublicParcelResponse
    var detect: @Sendable (_ trackingNumber: String) async throws -> CarrierDetectionResponse

    static func api(configuration: AppConfiguration, transport: URLSession = .shared, verification: NativeVerification = .shared) -> DeviceParcelClient {
        @Sendable func send(_ path: String, method: String, key: String? = nil, body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
            var request = URLRequest(url: configuration.apiBaseURL.appending(path: path),
                                     cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30)
            request.httpMethod = method
            request.httpShouldHandleCookies = false
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if let key { request.setValue(key, forHTTPHeaderField: "X-Parcel-Key") }
            if let body {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = body
            }
            let perform: NativeVerification.Send = { request in
                let (data, response) = try await transport.data(for: request)
                guard let response = response as? HTTPURLResponse else { throw DeliveryAPIError.invalidResponse }
                return (data, response)
            }
            if method == "POST", path == "api/public/parcels" || path == "api/public/detect" {
                return try await verification.send(request, baseURL: configuration.apiBaseURL, allowPresentation: path == "api/public/parcels", using: perform)
            }
            return try await perform(request)
        }
        @Sendable func failure(_ data: Data, _ response: HTTPURLResponse) -> Error {
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            if response.statusCode == 429 {
                if payload?["scope"] as? String == "daily" { return DeviceLookupsSpent() }
                return DeliveryAPIError.rateLimited(response.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init) ?? 60)
            }
            if response.statusCode == 400, let message = payload?["error"] as? String { return DeliveryAPIError.service(message) }
            return DeliveryAPIError.serviceFailed(response.statusCode)
        }
        @Sendable func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
            do { return try JSONDecoder.deliveryTracker.decode(type, from: data) }
            catch { throw DeliveryAPIError.invalidResponse }
        }
        return DeviceParcelClient(
            lookup: { request in
                let (data, response) = try await send("api/public/parcels", method: "POST", body: try JSONEncoder.deliveryTracker.encode(request))
                guard response.statusCode == 201 || response.statusCode == 200 else { throw failure(data, response) }
                return try decode(PublicLookupResponse.self, data)
            },
            read: { linkID, key in
                let (data, response) = try await send("api/public/parcels/\(linkID)", method: "GET", key: key)
                if response.statusCode == 404 || response.statusCode == 410 { return nil }
                guard response.statusCode == 200 else { throw failure(data, response) }
                return try decode(PublicParcelResponse.self, data)
            },
            forget: { linkID, key in
                let (data, response) = try await send("api/public/parcels/\(linkID)", method: "DELETE", key: key)
                guard response.statusCode == 204 || response.statusCode == 404 else { throw failure(data, response) }
            },
            update: { linkID, key, change in
                let (data, response) = try await send("api/public/parcels/\(linkID)", method: "PATCH", key: key, body: try JSONEncoder.deliveryTracker.encode(change))
                guard response.statusCode == 200 else { throw failure(data, response) }
                return try decode(PublicParcelResponse.self, data)
            },
            detect: { trackingNumber in
                let body = try JSONEncoder.deliveryTracker.encode(CarrierDetectionRequest(
                    trackingNumber: trackingNumber, lookupCountryHint: ParcelLookupCountry.hint()
                ))
                let (data, response) = try await send("api/public/detect", method: "POST", body: body)
                guard response.statusCode == 200 else { throw failure(data, response) }
                return try decode(CarrierDetectionResponse.self, data)
            }
        )
    }
}

/// Where the device's parcels are kept: what is known about each in a protected file, and the
/// owner keys, which are credentials, in the keychain.
protocol DeviceParcelStorage {
    func load() -> (parcels: [DeviceParcel], keys: [String: String])
    func save(_ parcels: [DeviceParcel], keys: [String: String])
}

struct DeviceParcelFiles: DeviceParcelStorage {
    private let keychain = KeychainStore(service: "com.plhery.SwissDeliveryTracker.deviceParcels")

    func load() -> (parcels: [DeviceParcel], keys: [String: String]) {
        let keys: [String: String] = keychain.load() ?? [:]
        guard !keys.isEmpty, let url = try? Self.fileURL(), let data = try? Data(contentsOf: url),
              let parcels = try? JSONDecoder.deliveryTracker.decode([DeviceParcel].self, from: data) else { return ([], [:]) }
        // A parcel without its key cannot be read or forgotten, and a key without its parcel opens nothing.
        let kept = parcels.filter { keys[$0.linkID] != nil }
        return (kept, keys.filter { key, _ in kept.contains { $0.linkID == key } })
    }

    func save(_ parcels: [DeviceParcel], keys: [String: String]) {
        guard let url = try? Self.fileURL() else { return }
        if parcels.isEmpty {
            keychain.delete()
            try? FileManager.default.removeItem(at: url)
            return
        }
        // The keys go first: a parcel on file always has its key.
        guard (try? keychain.save(keys)) != nil, let data = try? JSONEncoder.deliveryTracker.encode(parcels) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func fileURL() throws -> URL {
        let manager = FileManager.default
        let directory = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appending(path: "DeviceParcels", directoryHint: .isDirectory)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appending(path: "parcels.json")
    }
}

/// The parcels someone follows before signing in. They live on this iPhone; the service keeps
/// each behind a link only this device's key owns, and forgets it some time after it arrives.
@MainActor
final class DeviceParcels {
    /// How long an answer is good for: a parcel on its way moves, one that arrived rests, and
    /// one its carrier has not answered about yet is asked about again at once.
    static let fresh: TimeInterval = 5 * 60
    static let settledFresh: TimeInterval = 12 * 60 * 60
    static let waitingFresh: TimeInterval = 1.5

    private let client: DeviceParcelClient?
    private let storage: any DeviceParcelStorage
    private let now: () -> Date
    private var entries: [DeviceParcel]
    private var keys: [String: String]

    /// A build without a server follows nothing.
    init(client: DeviceParcelClient?, storage: any DeviceParcelStorage = DeviceParcelFiles(), now: @escaping () -> Date = Date.init) {
        self.client = client
        self.storage = storage
        self.now = now
        (entries, keys) = storage.load()
    }

    var isEmpty: Bool { entries.isEmpty }

    /// The parcels as the list shows them, under the names this device gave them.
    func list() -> [Parcel] { entries.map(Self.shown) }

    /// Whether a parcel still waits for its carrier's first answer, which is worth asking about again soon.
    var isWaiting: Bool { entries.contains { Self.waiting($0.parcel) } }

    func detect(trackingNumber: String) async throws -> CarrierDetectionResponse {
        guard let client else { throw DeliveryAPIError.serviceFailed(503) }
        return try await client.detect(trackingNumber)
    }

    func add(_ request: CreatePackageRequest) async throws -> Parcel {
        guard let client else { throw DeliveryAPIError.serviceFailed(503) }
        if let existing = entries.first(where: { $0.parcel.trackingNumber == request.trackingNumber && $0.parcel.carrier == request.carrier }) {
            throw DeliveryAPIError.duplicateTracking(existing.parcel.id)
        }
        let response = try await client.lookup(PublicLookupRequest(
            trackingNumber: request.trackingNumber, carrier: request.carrier,
            trackingURL: request.trackingURL, dpdPostcode: request.dpdPostcode,
            lookupCountryHint: request.lookupCountryHint
        ))
        guard ParcelLinkRoute.validID(response.link.id) else { throw DeliveryAPIError.invalidResponse }
        // The service gives one parcel one link for each lookup; a second lookup of a parcel takes the first one's place.
        if let twin = entries.firstIndex(where: { $0.parcel.id == response.package.id }) {
            let old = entries.remove(at: twin)
            if let key = keys.removeValue(forKey: old.linkID) { Task { try? await client.forget(old.linkID, key) } }
        }
        let entry = DeviceParcel(linkID: response.link.id, label: request.label ?? "", archivedAt: nil,
                                 parcel: Parcel(shared: response.package), checkedAt: now())
        entries.append(entry)
        keys[entry.linkID] = response.key
        save()
        return Self.shown(entry)
    }

    /// Reads every parcel whose answer has gone stale, or every one when `all`. A parcel the
    /// service no longer has leaves the list. The first trouble ends the round and is thrown;
    /// the list keeps what the device has.
    func refresh(all: Bool = false, only id: UUID? = nil) async throws {
        guard let client else { return }
        var trouble: Error?
        for entry in entries where id == nil || entry.parcel.id == id {
            guard let key = keys[entry.linkID] else { continue }
            let age = now().timeIntervalSince(entry.checkedAt)
            let fresh = Self.waiting(entry.parcel) ? Self.waitingFresh
                : entry.parcel.currentStage?.isFinal == true ? Self.settledFresh : Self.fresh
            guard all || id != nil || age < 0 || age >= fresh else { continue }
            do {
                let response = try await client.read(entry.linkID, key)
                guard let index = entries.firstIndex(where: { $0.linkID == entry.linkID }) else { continue }
                if let response {
                    entries[index].parcel = Parcel(shared: response.package)
                    entries[index].checkedAt = now()
                } else {
                    entries.remove(at: index)
                    keys[entry.linkID] = nil
                }
            } catch {
                trouble = error
                break
            }
        }
        save()
        if let trouble { throw trouble }
    }

    func rename(id: UUID, label: String) throws -> Parcel {
        try update(id) { $0.label = label }
    }

    func setArchived(id: UUID, _ archived: Bool) throws -> Parcel {
        try update(id) { $0.archivedAt = archived ? DateParser.isoString(self.now()) : nil }
    }

    /// The service forgets the parcel, then the device does.
    func forget(id: UUID) async throws {
        guard let index = entries.firstIndex(where: { $0.parcel.id == id }) else { return }
        let entry = entries[index]
        if let client, let key = keys[entry.linkID] { try await client.forget(entry.linkID, key) }
        entries.removeAll { $0.linkID == entry.linkID }
        keys[entry.linkID] = nil
        save()
    }

    /// Forgets every parcel. The ones the service could not be told about stay, and the trouble is thrown.
    func forgetAll() async throws {
        var trouble: Error?
        for entry in entries {
            do { try await forget(id: entry.parcel.id) } catch { trouble = error }
        }
        if let trouble { throw trouble }
    }

    /// Follows the same number with another carrier: a new lookup, which takes the old one's place and name.
    func changeCarrier(id: UUID, carrier: CarrierID, trackingURL: String?, dpdPostcode: String?) async throws -> Parcel {
        guard let entry = entries.first(where: { $0.parcel.id == id }) else { throw DeliveryAPIError.parcelMissing }
        let added = try await add(CreatePackageRequest(
            trackingNumber: entry.parcel.trackingNumber, label: entry.label, carrier: carrier,
            trackingURL: trackingURL, dpdPostcode: dpdPostcode,
            lookupCountryHint: ParcelLookupCountry.hint()
        ))
        if added.id != id {
            try? await forget(id: id)
            if let index = entries.firstIndex(where: { $0.parcel.id == added.id }) {
                entries[index].replaced = entry.replaced ?? id
                save()
                return Self.shown(entries[index])
            }
        }
        return added
    }

    /// The parcel's link as others may open it, or nil once its sharing was stopped.
    func share(id: UUID) async throws -> ParcelShare? {
        guard let client, let entry = entries.first(where: { $0.parcel.id == id }), let key = keys[entry.linkID] else { throw DeliveryAPIError.parcelMissing }
        guard let response = try await client.read(entry.linkID, key) else { throw DeliveryAPIError.parcelMissing }
        return Self.share(response.link)
    }

    /// Changes what the link shows, resuming its sharing if it was stopped; nil stops it.
    func setShare(id: UUID, showNumber: Bool, gift: Bool, shared: Bool = true, giftWords: GiftWords? = nil) async throws -> ParcelShare? {
        guard let client, let entry = entries.first(where: { $0.parcel.id == id }), let key = keys[entry.linkID] else { throw DeliveryAPIError.parcelMissing }
        let change = shared ? UpdateParcelLinkRequest(showNumber: showNumber, gift: gift, shared: true, giftWords: giftWords) : UpdateParcelLinkRequest(shared: false)
        return Self.share(try await client.update(entry.linkID, key, change).link)
    }

    private static func share(_ link: ParcelLink) -> ParcelShare? {
        guard link.shared != false else { return nil }
        return ParcelShare(id: link.id, showNumber: link.showNumber ?? false, gift: link.gift ?? false, createdAt: link.createdAt, giftWords: link.giftWords)
    }

    /// Whether any of the device's parcels is archived, for the account that takes them over.
    func isArchived(linkID: String) -> Bool { entries.first { $0.linkID == linkID }?.archivedAt != nil }

    /// What an account needs to take the device's parcels over.
    var claims: [ClaimParcelLink] {
        entries.compactMap { entry in keys[entry.linkID].map { ClaimParcelLink(id: entry.linkID, key: $0, label: entry.label.nonEmpty) } }
    }

    /// The account has these parcels now, or their links lead nowhere: the device lets go of them.
    func release(_ linkIDs: Set<String>) {
        entries.removeAll { linkIDs.contains($0.linkID) }
        for id in linkIDs { keys[id] = nil }
        save()
    }

    private func update(_ id: UUID, _ change: (inout DeviceParcel) -> Void) throws -> Parcel {
        guard let index = entries.firstIndex(where: { $0.parcel.id == id }) else { throw DeliveryAPIError.parcelMissing }
        change(&entries[index])
        save()
        return Self.shown(entries[index])
    }

    private func save() { storage.save(entries, keys: keys) }

    private static func waiting(_ parcel: Parcel) -> Bool { parcel.syncStatus == .pending || parcel.syncStatus == .syncing }

    private static func shown(_ entry: DeviceParcel) -> Parcel {
        var parcel = entry.parcel
        parcel.label = entry.label
        parcel.archivedAt = entry.archivedAt
        if let replaced = entry.replaced {
            var data = parcel.carrierData ?? CarrierData()
            data.originalPackageID = replaced
            parcel.carrierData = data
        }
        return parcel
    }
}
