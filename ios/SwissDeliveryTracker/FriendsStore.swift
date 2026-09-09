import Foundation
import UserNotifications

@MainActor
final class FriendInvitationStore: ObservableObject {
    @Published private(set) var isPresenting = false
    @Published private(set) var presentationID = UUID()
    @Published private(set) var code: String?
    @Published private(set) var nickname: String?
    @Published private(set) var errorKey: String?
    @Published private(set) var loading = false
    @Published private(set) var completed = 0
    @Published private(set) var receipt: FriendsActionResponse?
    @Published var opened = false { didSet { persist() } }
    private let defaults: UserDefaults
    private let storageKey = "sdt.pendingFriendInvitation.v1"
    private var receivedAt = Date()
    private var generation = 0
    private struct Pending: Codable { let code: String; let opened: Bool; let receivedAt: Date }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: storageKey), let pending = try? JSONDecoder().decode(Pending.self, from: data),
           FriendInvitationLink.validCode(pending.code),
           Date().timeIntervalSince(pending.receivedAt) >= 0, Date().timeIntervalSince(pending.receivedAt) < 604_800 {
            code = pending.code; opened = pending.opened; receivedAt = pending.receivedAt; isPresenting = true
        } else { defaults.removeObject(forKey: storageKey) }
    }

    func open(_ url: URL) {
        guard FriendInvitationLink.isInvitation(url) else { return }
        clearPreview(); receipt = nil
        code = FriendInvitationLink.code(from: url.absoluteString)
        presentationID = UUID(); receivedAt = .now; isPresenting = true; opened = false
        if code == nil { errorKey = "friends.inviteUnavailable"; defaults.removeObject(forKey: storageKey) }
        persist()
    }

    func loadPreview(session: SessionStore? = nil) async {
        guard isPresenting, receipt == nil else { return }
        guard let code else { errorKey = "friends.inviteUnavailable"; return }
        generation += 1; let current = generation
        loading = true; errorKey = nil
        defer { if generation == current { loading = false } }
        do {
            let name: String
            do { name = try await DeliveryAPIClient.invitationPreview(code: code) }
            catch DeliveryAPIError.service("Invitation unavailable") {
                // A consumed link has no public preview. Recover it only for
                // the authenticated recipient, without revealing its state yet.
                guard let session, session.user != nil else { throw DeliveryAPIError.service("Invitation unavailable") }
                let preview = try await DeliveryAPIClient(configuration: .current, session: session)
                    .friendsAction(FriendsActionRequest(action: .previewInvite, code: code))
                guard let nickname = preview.previewNickname, !nickname.isEmpty else { throw DeliveryAPIError.invalidResponse }
                name = nickname
            }
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
    func receive(_ result: FriendsActionResponse) {
        // The invitation was consumed on the server. Never restore it after a crash.
        receipt = result
        defaults.removeObject(forKey: storageKey)
    }
    func dismiss() { isPresenting = false; code = nil; opened = false; receipt = nil; clearPreview(); defaults.removeObject(forKey: storageKey) }
    func finish() { completed += 1; dismiss() }
    private func persist() {
        guard isPresenting, receipt == nil, let code else { return }
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

    func seed(_ value: FriendsSnapshot) { snapshot = value }

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
                    : message == "Cannot accept your own invitation" ? "friends.selfInvitation"
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
        let stats = PassportStatistics(parcels: parcels, timeZone: TimeZone(secondsFromGMT: 0)!)
        var stamps: [FriendStamp] = []
        if stats.deliveredCount >= 1 { stamps.append(.first) }
        if stats.deliveredCount >= 10 { stamps.append(.ten) }
        if Set(parcels.map(\.carrier)).count >= 3 { stamps.append(.connected) }
        if let fastest = stats.fastestDelivery, fastest.duration <= 172_800 { stamps.append(.express) }
        if stats.crossBorderCount >= 1 { stamps.append(.acrossBorders) }
        if stats.originCountries.count >= 5 { stamps.append(.aroundWorld) }
        if stats.deliveredCount >= 25 { stamps.append(.theRegular) }
        if stats.domesticDeliveryCount >= 1 { stamps.append(.rightNextDoor) }
        if stats.longWaitDeliveryCount >= 1 { stamps.append(.worthTheWait) }
        if stats.maxDeliveriesInOneDay >= 3 { stamps.append(.busyDoorstep) }
        if stats.pickupDeliveryCount >= 1 { stamps.append(.pickedUp) }
        if stats.decemberDeliveryCount >= 1 { stamps.append(.homeForHolidays) }
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
        switch self { case .first: "passport.firstArrival"; case .ten: "passport.doubleDigits"; case .connected: "passport.wellConnected"; case .express: "passport.expressArrival"; case .acrossBorders: "passport.acrossBorders"; case .aroundWorld: "passport.aroundWorld"; case .theRegular: "passport.theRegular"; case .rightNextDoor: "passport.rightNextDoor"; case .worthTheWait: "passport.worthTheWait"; case .busyDoorstep: "passport.busyDoorstep"; case .pickedUp: "passport.pickedUp"; case .homeForHolidays: "passport.homeForHolidays" }
    }
    var explanationKey: String {
        switch self { case .first: "friends.firstStampDetail"; case .ten: "friends.tenStampDetail"; case .connected: "friends.connectedStampDetail"; case .express: "friends.expressStampDetail"; case .acrossBorders: "passport.acrossExplanation"; case .aroundWorld: "passport.aroundExplanation"; case .theRegular: "passport.regularExplanation"; case .rightNextDoor: "passport.domesticExplanation"; case .worthTheWait: "passport.waitExplanation"; case .busyDoorstep: "friends.busyStampDetail"; case .pickedUp: "passport.pickupExplanation"; case .homeForHolidays: "friends.holidayStampDetail" }
    }
    var symbol: String {
        switch self { case .first: "shippingbox"; case .ten: "seal"; case .connected: "globe"; case .express: "bolt"; case .acrossBorders: "globe.europe.africa"; case .aroundWorld: "map"; case .theRegular: "25.circle"; case .rightNextDoor: "house"; case .worthTheWait: "hourglass"; case .busyDoorstep: "shippingbox"; case .pickedUp: "storefront"; case .homeForHolidays: "gift" }
    }
}

/// Shared, memory-only presentation state for a received friendship and sender notices.
@MainActor
final class FriendsActivityStore: ObservableObject {
    @Published private(set) var updates: [FriendUpdate] = []
    @Published private(set) var focusID: UUID?
    @Published private(set) var presentationID = UUID()
    private(set) var arrivalSnapshot: FriendsSnapshot?
    private var dismissed: Set<UUID> = []
    private var generation = 0

    func refresh(session: SessionStore) async {
        guard session.user != nil else { clear(); return }
        let current = generation
        do {
            let next = try await DeliveryAPIClient(configuration: .current, session: session).friendsActivity()
            guard current == generation, !Task.isCancelled else { return }
            updates = next.updates.filter { !dismissed.contains($0.friendID) }
        } catch { /* Keep an existing notice on transient network failures. */ }
    }

    func reveal(_ friendID: UUID, snapshot: FriendsSnapshot? = nil) {
        focusID = friendID; arrivalSnapshot = snapshot; presentationID = UUID()
    }

    func acknowledge(_ friendID: UUID, session: SessionStore) async {
        guard !dismissed.contains(friendID) else { return }
        dismissed.insert(friendID); updates.removeAll { $0.friendID == friendID }
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        center.removeDeliveredNotifications(withIdentifiers: delivered.filter {
            NativeRoute(remoteNotification: $0.request.content.userInfo) == .friend(friendID)
        }.map { $0.request.identifier })
        _ = try? await DeliveryAPIClient(configuration: .current, session: session)
            .friendsAction(FriendsActionRequest(action: .acknowledgeFriend, friendID: friendID))
    }

    func consumeArrival() { arrivalSnapshot = nil }
    func consumeFocus(_ friendID: UUID) { if focusID == friendID { focusID = nil } }
    func hidePrivateContent() { generation += 1; updates = []; arrivalSnapshot = nil }
    func clear() { hidePrivateContent(); dismissed = []; focusID = nil; presentationID = UUID() }
}
