import Foundation

@MainActor
final class FriendInvitationStore: ObservableObject {
    @Published private(set) var isPresenting = false
    @Published private(set) var presentationID = UUID()
    @Published private(set) var code: String?
    @Published private(set) var nickname: String?
    @Published private(set) var errorKey: String?
    @Published private(set) var loading = false
    @Published private(set) var completed = 0
    @Published var opened = false { didSet { persist() } }
    private let defaults: UserDefaults
    private let storageKey = "sdt.pendingFriendInvitation.v1"
    private var receivedAt = Date()
    private var generation = 0
    private struct Pending: Codable { let code: String; let opened: Bool; let receivedAt: Date }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: storageKey), let pending = try? JSONDecoder().decode(Pending.self, from: data),
           pending.code.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
           Date().timeIntervalSince(pending.receivedAt) >= 0, Date().timeIntervalSince(pending.receivedAt) < 604_800 {
            code = pending.code; opened = pending.opened; receivedAt = pending.receivedAt; isPresenting = true
        } else { defaults.removeObject(forKey: storageKey) }
    }

    func open(_ url: URL) {
        guard FriendInvitationLink.isInvitation(url) else { return }
        clearPreview()
        code = FriendInvitationLink.code(from: url.absoluteString)
        presentationID = UUID(); receivedAt = .now; isPresenting = true; opened = false
        if code == nil { errorKey = "friends.inviteUnavailable"; defaults.removeObject(forKey: storageKey) }
        persist()
    }

    func loadPreview() async {
        guard isPresenting else { return }
        guard let code else { errorKey = "friends.inviteUnavailable"; return }
        generation += 1; let current = generation
        loading = true; errorKey = nil
        defer { if generation == current { loading = false } }
        do {
            let name = try await DeliveryAPIClient.invitationPreview(code: code)
            guard generation == current, !Task.isCancelled else { return }
            nickname = name
        } catch {
            guard generation == current, !Task.isCancelled else { return }
            nickname = nil
            if case DeliveryAPIError.service("Invitation unavailable") = error { errorKey = "friends.inviteUnavailable" }
            else { errorKey = "friends.unavailable" }
        }
    }

    func clearPreview() { generation += 1; nickname = nil; errorKey = nil; loading = false }
    func dismiss() { isPresenting = false; code = nil; opened = false; clearPreview(); defaults.removeObject(forKey: storageKey) }
    func finish() { completed += 1; dismiss() }
    private func persist() {
        guard isPresenting, let code else { return }
        // Only the pending link survives authentication; sender information is fetched afresh.
        let value = Pending(code: code, opened: opened, receivedAt: receivedAt)
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: storageKey) }
    }
}

@MainActor
final class FriendsStore: ObservableObject {
    @Published private(set) var snapshot: FriendsSnapshot?
    @Published private(set) var working = false
    @Published var errorKey: String?
    private var api: DeliveryAPIClient?
    private var demo = false
    private var local: FriendsSnapshot?
    private var generation = 0

    func configure(session: SessionStore) {
        demo = session.isDemo
        api = DeliveryAPIClient(configuration: .current, session: session)
        if demo && local == nil,
           let url = Bundle.main.url(forResource: "FriendsDemo", withExtension: "json"),
           let data = try? Data(contentsOf: url) {
            local = try? JSONDecoder().decode(FriendsSnapshot.self, from: data)
        }
    }

    func load(parcels: [Parcel]) async {
        guard !working else { return }
        generation += 1
        let current = generation
        do {
            let next: FriendsSnapshot
            if demo {
                guard let local else { throw DeliveryAPIError.invalidResponse }
                next = demoSnapshot(local, parcels: parcels)
            } else {
                guard let api else { return }
                next = try await api.friendsSnapshot()
            }
            guard current == generation, !Task.isCancelled else { return }
            snapshot = next
            errorKey = nil
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            snapshot = nil
            errorKey = "friends.unavailable"
        }
    }

    func act(_ request: FriendsActionRequest, parcels: [Parcel], onCommitted: ((FriendsActionResponse) -> Void)? = nil) async -> FriendsActionResponse? {
        guard !working else { return nil }
        working = true
        errorKey = nil
        generation += 1
        let current = generation
        defer { working = false }
        do {
            let result: FriendsActionResponse
            if demo {
                guard var local else { throw DeliveryAPIError.invalidResponse }
                switch request.action {
                case .saveProfile:
                    guard let name = request.nickname, let stats = request.shareStats, let arrival = request.shareArrival else { return nil }
                    local.profile = FriendProfile(nickname: name.trimmingCharacters(in: .whitespacesAndNewlines), shareStats: stats, shareArrival: arrival)
                case .disable: local = FriendsSnapshot(friends: [])
                case .removeFriend: local.friends.removeAll { $0.id == request.friendID }
                default: errorKey = "friends.demoInvites"; return nil
                }
                self.local = local
                result = FriendsActionResponse(snapshot: demoSnapshot(local, parcels: parcels))
            } else {
                guard let api else { return nil }
                result = try await api.friendsAction(request)
            }
            onCommitted?(result)
            guard current == generation, !Task.isCancelled else { return nil }
            if let next = result.snapshot { snapshot = next }
            return result
        } catch {
            guard current == generation, !Task.isCancelled else { return nil }
            if case DeliveryAPIError.service(let message) = error {
                errorKey = message == "Invitation unavailable" ? "friends.inviteUnavailable"
                    : message == "Your circle is full" ? "friends.circleFull" : "friends.actionFailed"
            } else { errorKey = "friends.actionFailed" }
            return nil
        }
    }

    func clear() {
        generation += 1
        snapshot = nil
        errorKey = nil
    }

    private func demoSnapshot(_ value: FriendsSnapshot, parcels: [Parcel]) -> FriendsSnapshot {
        var value = value
        value.ownCard = value.profile.map { Self.ownCard(parcels: parcels, profile: $0) }
        return value
    }

    static func ownCard(parcels: [Parcel], profile: FriendProfile, now: Date = Date()) -> FriendCard {
        let stats = PassportStatistics(parcels: parcels)
        var stamps: [FriendStamp] = []
        if stats.deliveredCount >= 1 { stamps.append(.first) }
        if stats.deliveredCount >= 10 { stamps.append(.ten) }
        if Set(parcels.map(\.carrier)).count >= 3 { stamps.append(.connected) }
        if let fastest = stats.fastestDelivery, fastest.duration <= 172_800 { stamps.append(.express) }
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let week = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
        let arrived = parcels.contains { parcel in
            guard parcel.currentStage == .delivered,
                  let date = parcel.trackingEvents.filter({ $0.stage == .delivered }).compactMap({ DateParser.date($0.occurredAt) }).min() else { return false }
            return date >= week && date <= now
        }
        return FriendCard(
            id: UUID(uuidString: "44000000-0000-4000-8000-000000000004")!, nickname: profile.nickname,
            stats: profile.shareStats ? FriendStats(deliveredCount: stats.deliveredCount, averageDays: stats.averageDeliveryDuration.map { max(1, Int(ceil($0 / 86400))) }, stamps: stamps) : nil,
            arrivedThisWeek: profile.shareArrival ? arrived : nil
        )
    }
}

extension FriendStamp {
    var titleKey: String {
        switch self { case .first: "passport.firstArrival"; case .ten: "passport.doubleDigits"; case .connected: "passport.wellConnected"; case .express: "passport.expressArrival" }
    }
    var explanationKey: String {
        switch self { case .first: "friends.firstStampDetail"; case .ten: "friends.tenStampDetail"; case .connected: "friends.connectedStampDetail"; case .express: "friends.expressStampDetail" }
    }
    var symbol: String {
        switch self { case .first: "shippingbox"; case .ten: "seal"; case .connected: "globe"; case .express: "bolt" }
    }
}
