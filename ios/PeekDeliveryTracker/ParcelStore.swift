import ActivityKit
import Foundation
import Combine
import UIKit
import UserNotifications
import WidgetKit

@MainActor
final class ParcelStore: ObservableObject {
    enum RefreshStart: Equatable { case queued, completed(RefreshResult), alreadyRunning }

    /// How a check ended; a failure's message is shown as is.
    enum RefreshResult: Equatable {
        case updated, unchanged, stillChecking, failed(String)

        /// Shared with the web app's pull, refresh button and parcel check.
        var messageKey: String {
            switch self {
            case .updated: "app.refreshComplete"
            case .unchanged: "app.refreshUnchanged"
            case .stillChecking: "app.refreshTimeout"
            case .failed: "detail.checkFailed"
            }
        }
    }

    /// How a background check of every parcel ended.
    struct RefreshOutcome: Equatable {
        let id = UUID()
        let result: RefreshResult
    }

    /// Live Activities are switched off: the store ends any still showing and withdraws this
    /// iPhone's registration, so the server starts no more.
    static let offersLiveActivities = false

    @Published private(set) var parcels: [Parcel] = [] {
        didSet { if !holdingDeliverySurfaces { publishDeliverySurfaces() } }
    }
    @Published private(set) var loading = false
    @Published private(set) var refreshing = false
    @Published private(set) var refreshOutcome: RefreshOutcome?
    @Published private(set) var errorMessage: String?
    @Published private(set) var authenticationRequired = false
    @Published private(set) var usingCachedData = false
    @Published private(set) var notificationEnableInProgress = false
    @Published private(set) var notificationStateLoaded = false
    @Published private(set) var notificationInvitationDismissed = false
    @Published private(set) var notificationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var notificationsEnabledOnDevice = false
    @Published private(set) var notificationPreferences: NotificationPreferences?
    @Published private(set) var notificationError: String?
    @Published private(set) var deliveryWidgetEnabled = true
    @Published private(set) var deliveryLiveActivitiesEnabled = true
    @Published private(set) var deliveryLiveActivityError: String?
    @Published var undoParcel: Parcel?

    let configuration: AppConfiguration
    // Background delivery cleanup can outlive the screen that supplied the session.
    private let session: SessionStore
    private let localizer: Localizer
    private let api: DeliveryAPIClient
    private let liveActivityRevocations: LiveActivityRevocations
    private let demo: DemoRepository
    private let device: DeviceParcels
    private let demoShares = DemoParcelShares()
    private let shareNotes = ParcelShareNotes()
    private let deliveryWidgetStore: DeliveryWidgetSharedStore?
    private let cache = ParcelCache()
    private var pollingTask: Task<Void, Never>?
    private var jobMonitoringTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    /// Optimistic changes in flight; a list loaded meanwhile could undo them on screen.
    private var pendingMutations = Set<UUID>()
    /// A reopened account shows its saved list at once. Until the service confirms
    /// it, the widget and Live Activities keep what they last showed.
    private var holdingDeliverySurfaces = false
    private var showingSavedParcels = false
    private var cacheCurrent = false
    private var publishedWidgetState: DeliveryWidgetState?
    private var deliveryActivityTask: Task<Void, Never>?
    private var deliveryPushToStartTask: Task<Void, Never>?
    private var deliveryActivityUpdatesTask: Task<Void, Never>?
    private var deliveryActivityPushTokenTasks: [String: Task<Void, Never>] = [:]
    private var deliveryActivityStateTasks: [String: Task<Void, Never>] = [:]
    private var pendingJobIDs = Set<UUID>()
    private var isActive = true
    private var identityObservation: AnyCancellable?
    private var cacheOwnerID: UUID?
    private var mutationRevision = 0
    private var loadSequence = 0
    private var nativePushGeneration = 0
    /// Counts saved preferences: the answer to a read that began before a save is older than it.
    private var notificationPreferenceSaves = 0
    private var deliveryLiveActivityGeneration = 0
    private var deliveryLiveActivitySystemDisabled = false
    private var deliveryLiveActivityRegistrationRemovalPending = false
    private let installationID: UUID
    private let notificationOptOutKey = "sdt.notificationsDeviceOptOut"
    private let nativePushRegisteredKey = "sdt.notificationsNativePushRegistered.v1"
    private let demoNotificationsKey = "sdt.demoNotificationsEnabled"
    private static let installationIDKey = "sdt.installationID.v1"

    init(configuration: AppConfiguration = .current, session: SessionStore, localizer: Localizer, transport: URLSession = .shared,
         device: DeviceParcels? = nil) {
        self.configuration = configuration
        self.session = session
        self.localizer = localizer
        installationID = Self.installationIdentifier()
        deliveryWidgetStore = DeliveryWidgetSharedStore(
            appGroupIdentifier: configuration.appGroupIdentifier,
            fallbackToStandard: true
        )
        liveActivityRevocations = LiveActivityRevocations(configuration: configuration, transport: transport)
        api = DeliveryAPIClient(configuration: configuration, session: session, transport: transport)
        demo = DemoRepository()
        self.device = device ?? DeviceParcels(client: configuration.mode == .api ? .api(configuration: configuration, transport: transport) : nil)
        deliveryWidgetEnabled = deliveryWidgetStore?.isEnabled ?? true
        deliveryLiveActivitiesEnabled = Self.offersLiveActivities && (deliveryWidgetStore?.liveActivitiesEnabled ?? true)
        deliveryLiveActivityRegistrationRemovalPending = !deliveryLiveActivitiesEnabled
        deliveryWidgetStore?.setLiveActivitiesEnabled(deliveryLiveActivitiesEnabled)
        cacheOwnerID = session.user?.id
        notificationInvitationDismissed = session.user.map { NotificationInvitationPreference.isDismissed(for: $0.id) } ?? false
        identityObservation = session.identityChanges.sink { [weak self] in self?.resetForSessionChange() }
    }

    private func resetForSessionChange() {
        let reopening = session.reopeningSavedAccount
        pollingTask?.cancel()
        pollingTask = nil
        jobMonitoringTask?.cancel()
        jobMonitoringTask = nil
        refreshTask?.cancel()
        refreshTask = nil
        pendingMutations.removeAll()
        pendingJobIDs.removeAll()
        nativePushGeneration += 1
        deliveryLiveActivityGeneration += 1
        stopDeliveryLiveActivityObservers()
        if let cacheOwnerID {
            try? liveActivityRevocations.queue()
            liveActivityRevocations.retry()
            cache.delete(userID: cacheOwnerID)
            // The words its links carried leave the device with the account.
            shareNotes.forgetAll()
            UIApplication.shared.unregisterForRemoteNotifications()
            AppDelegate.clearDeviceToken()
            UserDefaults.standard.set(true, forKey: notificationOptOutKey)
            UserDefaults.standard.set(false, forKey: nativePushRegisteredKey)
        }
        cacheOwnerID = session.user?.id
        notificationInvitationDismissed = session.user.map { NotificationInvitationPreference.isDismissed(for: $0.id) } ?? false
        mutationRevision += 1
        loadSequence += 1
        holdingDeliverySurfaces = reopening
        cacheCurrent = false
        let saved = reopening ? session.user.flatMap { cache.load(userID: $0.id) } : nil
        showingSavedParcels = saved != nil
        // Open on content: the saved list, or the demo box, instead of an empty frame.
        parcels = saved ?? (session.isDemo ? demo.list() : session.isGuest ? device.list() : [])
        undoParcel = nil
        loading = session.isAuthenticated && parcels.isEmpty
        refreshing = false
        errorMessage = nil
        authenticationRequired = false
        usingCachedData = false
        notificationPreferences = nil
        notificationError = nil
        notificationEnableInProgress = false
        notificationsEnabledOnDevice = false
        notificationStateLoaded = false
        notificationStatus = .notDetermined
        deliveryLiveActivityError = nil
        if !reopening { clearDeliverySurfaces() }
    }

    var isDemo: Bool { session.isDemo }
    /// Nobody is signed in: the parcels are the ones this iPhone follows itself.
    var isGuest: Bool { session.isGuest }
    /// Whether tracking without an account works at all: a build without a server only has its demo.
    var tracksWithoutAccount: Bool { configuration.mode == .api }

    /// The postcodes given before, for the add sheet to suggest: the parcels' own, then the
    /// ones this iPhone remembers from lookups without an account.
    var givenPostcodes: [GivenPostcode] {
        GivenPostcode.candidates(parcels: parcels, remembered: device.postcodes.entries)
    }

    /// This iPhone stops suggesting the postcode, for every carrier.
    func forgetPostcode(_ postcode: String) {
        objectWillChange.send()
        device.postcodes.forget(postcode)
    }

    func detectCarrier(trackingNumber: String) async throws -> CarrierDetectionResponse {
        if isGuest { return try await device.detect(trackingNumber: trackingNumber) }
        return try await api.detectCarrier(trackingNumber: trackingNumber)
    }
    var activeCount: Int { parcels.filter(\.isActive).count }
    var isSynchronizing: Bool {
        parcels.contains { $0.syncStatus == .pending || $0.syncStatus == .syncing }
    }

    func setDeliveryWidgetEnabled(_ enabled: Bool) {
        DeliveryAnalytics.shared.action("widget-change")
        guard deliveryWidgetEnabled != enabled else { return }
        deliveryWidgetEnabled = enabled
        deliveryWidgetStore?.setEnabled(enabled)
        publishDeliveryWidget()
    }

    func setDeliveryLiveActivitiesEnabled(_ enabled: Bool) {
        DeliveryAnalytics.shared.action("live-activities-change")
        guard deliveryLiveActivitiesEnabled != enabled else { return }
        deliveryLiveActivitiesEnabled = enabled
        deliveryWidgetStore?.setLiveActivitiesEnabled(enabled)
        deliveryLiveActivitySystemDisabled = false
        deliveryLiveActivityRegistrationRemovalPending = !enabled
        deliveryLiveActivityError = nil
        if enabled {
            startDeliveryLiveActivityObservers()
        } else {
            try? liveActivityRevocations.queue()
            liveActivityRevocations.retry()
            stopDeliveryLiveActivityObservers()
        }
        scheduleDeliveryLiveActivities()
    }

    func refreshDeliverySurfaces() {
        publishDeliverySurfaces()
        registerCurrentDeliveryPushToStartToken()
        registerCurrentDeliveryActivityUpdateTokens()
    }

    func clearDeliverySurfaces() {
        if !session.isAuthenticated {
            try? liveActivityRevocations.queue()
            liveActivityRevocations.retry()
        }
        deliveryWidgetStore?.setLanguageCode(localizer.language.rawValue)
        deliveryWidgetStore?.clearSnapshot()
        publishedWidgetState = nil
        WidgetCenter.shared.reloadTimelines(ofKind: DeliveryWidgetSharedStore.kind)
        scheduleDeliveryLiveActivities(forceEnd: true)
    }

    func start() async {
        try? liveActivityRevocations.queue(except: session.user?.id)
        liveActivityRevocations.retry()
        pollingTask?.cancel()
        jobMonitoringTask?.cancel()
        jobMonitoringTask = nil
        pendingJobIDs.removeAll()
        let generation = session.generation
        if errorMessage != nil { errorMessage = nil }
        if authenticationRequired { authenticationRequired = false }
        if usingCachedData { usingCachedData = false }
        guard session.isAuthenticated else {
            if loading { loading = false }
            guard isGuest else {
                if !parcels.isEmpty { parcels = [] }
                return
            }
            await load()
            guard (try? session.checkGeneration(generation)) != nil else { return }
            beginDevicePolling()
            return
        }
        if !isDemo { await claimDeviceParcels() }
        guard (try? session.checkGeneration(generation)) != nil else { return }
        await load(showSpinner: true)
        guard (try? session.checkGeneration(generation)) != nil else { return }
        await refreshNotificationState()
        guard (try? session.checkGeneration(generation)) != nil else { return }
        startDeliveryLiveActivityObservers()
        if !isDemo {
            await loadNotificationPreferences()
            guard (try? session.checkGeneration(generation)) != nil else { return }
            beginPolling()
        }
    }

    func setActive(_ active: Bool) {
        let returning = active && !isActive
        isActive = active
        if active { liveActivityRevocations.retry() }
        if active && session.isAuthenticated {
            registerCurrentDeliveryPushToStartToken()
            registerCurrentDeliveryActivityUpdateTokens()
            Task {
                await refreshNotificationState()
                await load(showSpinner: false)
            }
            // The launch loads the preferences itself. A return reads them again: the email
            // can be switched off outside the app, from a link in an email.
            if returning && !isDemo { Task { await refreshNotificationPreferences() } }
        } else if active && isGuest {
            Task { await load() }
        }
    }

    func load(showSpinner: Bool = false) async {
        if isGuest { await loadDeviceParcels(); return }
        guard session.isAuthenticated else { return }
        let generation = session.generation
        let revision = mutationRevision
        let ownerID = session.user?.id
        loadSequence += 1
        let sequence = loadSequence
        if showSpinner && parcels.isEmpty && !loading { loading = true }
        defer { if generation == session.generation && sequence == loadSequence && loading { loading = false } }
        do {
            let next = try await list()
            try session.checkGeneration(generation)
            guard revision == mutationRevision, sequence == loadSequence, pendingMutations.isEmpty else { return }
            holdingDeliverySurfaces = false
            showingSavedParcels = false
            let changed = next != parcels
            if changed {
                parcels = next
            } else {
                // An unchanged poll re-renders nothing; the widget and Live Activities
                // still update if their wording changed, such as "tomorrow" becoming "today".
                publishDeliverySurfaces()
            }
            if changed || !cacheCurrent, let ownerID {
                cache.save(next, userID: ownerID)
                cacheCurrent = true
            }
            if errorMessage != nil { errorMessage = nil }
            if authenticationRequired { authenticationRequired = false }
            if usingCachedData { usingCachedData = false }
        } catch {
            guard (try? session.checkGeneration(generation)) != nil,
                  revision == mutationRevision, sequence == loadSequence,
                  !(error is CancellationError) else { return }
            let message = localizer.errorMessage(error)
            if errorMessage != message { errorMessage = message }
            var expired = false
            if let apiError = error as? DeliveryAPIError, case .authenticationExpired = apiError { expired = true }
            if authenticationRequired != expired { authenticationRequired = expired }
            if parcels.isEmpty, let ownerID, let cached = cache.load(userID: ownerID) {
                parcels = cached
                usingCachedData = true
            } else if showingSavedParcels, !usingCachedData {
                usingCachedData = true
            }
        }
    }

    @discardableResult
    func add(
        trackingNumber: String,
        label: String,
        carrier: CarrierID,
        trackingURL: String?,
        dpdPostcode: String?
    ) async throws -> Parcel {
        let generation = session.generation
        let request = CreatePackageRequest(
            trackingNumber: CarrierCatalog.normalize(trackingNumber),
            label: label.trimmingCharacters(in: .whitespacesAndNewlines),
            carrier: carrier,
            trackingURL: trackingURL?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            dpdPostcode: dpdPostcode?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            lookupCountryHint: ParcelLookupCountry.hint()
        )
        let parcel: Parcel
        if isDemo {
            parcel = try demo.add(request)
        } else if isGuest {
            parcel = try await device.add(request)
            try session.checkGeneration(generation)
            // Its carrier answers in a moment: ask again soon.
            beginDevicePolling()
        } else {
            let response = try await api.add(request)
            parcel = response.package
            try session.checkGeneration(generation)
            monitorJobs(response.jobIDs)
        }
        try session.checkGeneration(generation)
        upsert(parcel)
        return parcel
    }

    /// Keeps a parcel shared through a link in this account, under the name the link suggests.
    /// The list is then reloaded, so the parcel is on it before the sheet closes.
    func keep(_ link: ParcelLinkRoute) async throws -> ParcelLinkClaim {
        guard session.user != nil else { throw DeliveryAPIError.authenticationExpired }
        let generation = session.generation
        let response = try await api.claimParcels(ClaimParcelsRequest(links: [ClaimParcelLink(id: link.id, label: link.name)]))
        try session.checkGeneration(generation)
        guard let claim = ParcelLinkClaim(response: response, linkID: link.id) else { throw DeliveryAPIError.invalidResponse }
        switch claim {
        case .added, .already: await load()
        case .full, .unavailable: break
        }
        return claim
    }

    /// How the share sheet reaches this parcel's link: through the service, or the demo's own
    /// made-up links, which lead nowhere.
    func shareClient(for parcel: Parcel) -> ParcelShareModel.Client {
        let id = parcel.id
        return ParcelShareModel.Client(
            current: { [self] in
                if isDemo { return demoShares.link(for: id) }
                if isGuest { return try await device.share(id: id) }
                let generation = session.generation
                let link = try await api.parcelShare(id: id)
                try session.checkGeneration(generation)
                return link
            },
            share: { [self] settings in
                if isDemo { return demoShares.share(id, showNumber: settings.showNumber, gift: settings.gift, giftWords: settings.giftWords) }
                if isGuest {
                    guard let link = try await device.setShare(id: id, showNumber: settings.showNumber, gift: settings.gift, giftWords: settings.giftWords) else { throw DeliveryAPIError.invalidResponse }
                    return link
                }
                let generation = session.generation
                let link = try await api.shareParcel(id: id, ShareParcelRequest(showNumber: settings.showNumber, gift: settings.gift, giftWords: settings.giftWords))
                try session.checkGeneration(generation)
                return link
            },
            stop: { [self] in
                if isDemo { demoShares.stop(id); return }
                if isGuest { _ = try await device.setShare(id: id, showNumber: false, gift: false, shared: false); return }
                let generation = session.generation
                try await api.stopSharingParcel(id: id)
                try session.checkGeneration(generation)
            }
        )
    }

    func rename(_ parcel: Parcel, label: String) async throws {
        let generation = session.generation
        let cleaned = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let updated = isDemo ? try demo.rename(id: parcel.id, label: cleaned)
            : isGuest ? try device.rename(id: parcel.id, label: cleaned)
            : try await api.rename(id: parcel.id, label: cleaned)
        try session.checkGeneration(generation)
        upsert(updated)
    }

    func changeCarrier(
        _ parcel: Parcel,
        carrier: CarrierID,
        trackingURL: String?,
        dpdPostcode: String?,
        providerPostcode: String? = nil
    ) async throws {
        let generation = session.generation
        let cleanedURL = trackingURL?
            .trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        let cleanedPostcode = dpdPostcode?
            .trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        let updated: Parcel
        if isDemo {
            updated = try demo.changeCarrier(
                id: parcel.id,
                carrier: carrier,
                trackingURL: cleanedURL,
                dpdPostcode: cleanedPostcode
            )
        } else if isGuest {
            // A new lookup takes the old one's place, under a new id.
            _ = try await device.changeCarrier(id: parcel.id, carrier: carrier, trackingURL: cleanedURL, dpdPostcode: cleanedPostcode)
            try session.checkGeneration(generation)
            mutationRevision += 1
            parcels = device.list()
            beginDevicePolling()
            return
        } else {
            let response = try await api.changeCarrier(
                id: parcel.id,
                carrier: carrier,
                trackingURL: cleanedURL,
                dpdPostcode: cleanedPostcode,
                providerPostcode: providerPostcode
            )
            updated = response.package
            try session.checkGeneration(generation)
            monitorJobs(response.jobIDs)
        }
        try session.checkGeneration(generation)
        upsert(updated)
    }

    func setMuted(_ parcel: Parcel, muted: Bool) async throws {
        let generation = session.generation
        // A parcel followed without an account has no alerts to mute.
        guard !isGuest else { return }
        let updated = isDemo
            ? try demo.setMuted(id: parcel.id, muted: muted)
            : try await api.setMuted(id: parcel.id, muted: muted)
        try session.checkGeneration(generation)
        upsert(updated)
    }

    /// Switches the delivery email off, or back on, for this parcel only.
    func setEmailMuted(_ parcel: Parcel, muted: Bool) async throws {
        let generation = session.generation
        let updated = isDemo
            ? try demo.setEmailMuted(id: parcel.id, muted: muted)
            : try await api.setEmailMuted(id: parcel.id, muted: muted)
        try session.checkGeneration(generation)
        upsert(updated)
    }

    func archive(_ parcel: Parcel) async throws {
        let generation = session.generation
        var updated = parcel
        updated.archivedAt = DateParser.isoString(Date())
        // A swiped card leaves at once; it returns only if the service refuses.
        let mutation = UUID()
        pendingMutations.insert(mutation)
        upsert(updated)
        do {
            if isDemo { try demo.archive(id: parcel.id) }
            else if isGuest { _ = try device.setArchived(id: parcel.id, true) }
            else { try await api.archive(id: parcel.id) }
            try session.checkGeneration(generation)
        } catch {
            guard pendingMutations.remove(mutation) != nil else { throw error }
            if parcels.first(where: { $0.id == parcel.id }) == updated { upsert(parcel) }
            throw error
        }
        guard pendingMutations.remove(mutation) != nil else { return }
        // Lists requested while the change was in flight may predate it.
        mutationRevision += 1
        undoParcel = parcel
    }

    func restore(_ parcel: Parcel) async throws {
        let generation = session.generation
        let restored = isDemo ? try demo.restore(id: parcel.id)
            : isGuest ? try device.setArchived(id: parcel.id, false)
            : try await api.restore(id: parcel.id)
        try session.checkGeneration(generation)
        upsert(restored)
        if undoParcel?.id == parcel.id { undoParcel = nil }
    }

    func permanentlyDelete(_ parcel: Parcel) async throws {
        let generation = session.generation
        if isDemo {
            try demo.permanentlyDelete(id: parcel.id)
            demoShares.stop(parcel.id)
        } else if isGuest {
            try await device.forget(id: parcel.id)
        } else {
            try await api.permanentlyDelete(id: parcel.id)
        }
        try session.checkGeneration(generation)
        // What its link carried goes with the parcel.
        shareNotes.forget(parcel.id)
        mutationRevision += 1
        parcels.removeAll { $0.id == parcel.id }
        persistCache()
        if undoParcel?.id == parcel.id { undoParcel = nil }
    }

    /// Asks the service to check every parcel and returns once the check is queued,
    /// so pull-to-refresh ends quickly. `refreshing` stays on until the results
    /// are loaded, and `refreshOutcome` then reports how the check ended.
    @discardableResult
    func refreshAll() async throws -> RefreshStart {
        let generation = session.generation
        guard !refreshing else { return .alreadyRunning }
        refreshing = true
        // Compared with the list as the check began: a push may reload it first.
        let before = parcels
        if isDemo {
            parcels = demo.refreshAll()
            refreshing = false
            return .completed(Parcel.trackingChanged(from: before, to: parcels) ? .updated : .unchanged)
        }
        if isGuest {
            var trouble: Error?
            do { try await device.refresh(all: true) } catch { trouble = error }
            guard generation == session.generation else { throw CancellationError() }
            parcels = device.list()
            refreshing = false
            if let trouble { return .completed(.failed(localizer.errorMessage(trouble))) }
            return .completed(Parcel.trackingChanged(from: before, to: parcels) ? .updated : .unchanged)
        }
        let jobIDs: [UUID]
        do {
            jobIDs = try await api.queueRefreshAll()
            try session.checkGeneration(generation)
        } catch {
            if generation == session.generation { refreshing = false }
            throw error
        }
        refreshTask = Task { [weak self] in
            await self?.finishRefresh(jobIDs, since: before, generation: generation)
        }
        return .queued
    }

    private func finishRefresh(_ jobIDs: [UUID], since before: [Parcel], generation: UUID) async {
        let result: RefreshResult
        do {
            try await api.waitForJobs(jobIDs)
            try session.checkGeneration(generation)
            await load(showSpinner: false)
            result = Parcel.trackingChanged(from: before, to: parcels) ? .updated : .unchanged
        } catch DeliveryAPIError.refreshTimeout {
            // The checks keep running; their results arrive with a later load.
            result = .stillChecking
        } catch {
            guard !(error is CancellationError) else { return }
            result = .failed(localizer.errorMessage(error))
        }
        guard (try? session.checkGeneration(generation)) != nil else { return }
        refreshing = false
        refreshTask = nil
        refreshOutcome = RefreshOutcome(result: result)
    }

    func refresh(_ parcel: Parcel) async throws {
        let generation = session.generation
        if isDemo {
            try session.checkGeneration(generation)
            upsert(try demo.refresh(id: parcel.id))
        } else if isGuest {
            try await device.refresh(only: parcel.id)
            try session.checkGeneration(generation)
            parcels = device.list()
        } else {
            try await api.refresh(id: parcel.id)
            try session.checkGeneration(generation)
            await load(showSpinner: false)
        }
    }

    func exportAccount() async throws -> URL {
        let data: Data
        if isDemo || isGuest {
            data = try JSONEncoder.deliveryTracker.encode(DemoExport(
                exportedAt: DateParser.isoString(Date()),
                mode: isDemo ? "demo" : "device",
                packages: parcels
            ))
        } else {
            data = try await api.exportAccount()
        }
        let day = ParcelOrganizer.dayKey(Date())
        let url = FileManager.default.temporaryDirectory
            .appending(path: "peek-export-\(day).json")
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return url
    }

    /// The demo writes its sample parcels in the app's language.
    func demoLanguageChanged() {
        guard isDemo else { return }
        parcels = demo.list()
    }

    func resetDemoData() async {
        DeliveryAnalytics.shared.action("demo-reset")
        guard isDemo else { return }
        demo.reset()
        demoShares.reset()
        shareNotes.forgetAll()
        undoParcel = nil
        await endAllDeliveryLiveActivities()
        parcels = demo.list()
    }

    /// Forgets every parcel followed on this iPhone without an account, here and on the service.
    func forgetDeviceParcels() async throws {
        guard isGuest else { return }
        let generation = session.generation
        defer { if generation == session.generation, isGuest { mutationRevision += 1; parcels = device.list() } }
        try await device.forgetAll()
        undoParcel = nil
    }

    func deleteAccount(confirmation: String) async throws {
        let generation = session.generation
        guard !isDemo else {
            await resetDemoData()
            return
        }
        nativePushGeneration += 1
        deliveryLiveActivityGeneration += 1
        deliveryLiveActivityRegistrationRemovalPending = true
        stopDeliveryLiveActivityObservers()
        jobMonitoringTask?.cancel()
        pendingJobIDs.removeAll()
        try await api.deleteAccount(confirmation: confirmation)
        try session.checkGeneration(generation)
        await endAllDeliveryLiveActivities()
        try session.checkGeneration(generation)
        UIApplication.shared.unregisterForRemoteNotifications()
        AppDelegate.clearDeviceToken()
        UserDefaults.standard.set(true, forKey: notificationOptOutKey)
        UserDefaults.standard.set(false, forKey: nativePushRegisteredKey)
        notificationsEnabledOnDevice = false
        notificationPreferences = nil
        notificationError = nil
        if let userID = session.user?.id { cache.delete(userID: userID) }
        session.forceSignOut()
        parcels = []
    }

    func signOut() async throws {
        // Save cleanup intent before discarding the account session.
        try liveActivityRevocations.queue()
        liveActivityRevocations.retry()
        let generation = session.generation
        nativePushGeneration += 1
        deliveryLiveActivityGeneration += 1
        deliveryLiveActivityRegistrationRemovalPending = true
        jobMonitoringTask?.cancel()
        pendingJobIDs.removeAll()
        if let token = AppDelegate.currentDeviceToken, !isDemo {
            try? await api.unregisterNativePushToken(token)
        }
        try session.checkGeneration(generation)
        if !isDemo { await liveActivityRevocations.drain() }
        stopDeliveryLiveActivityObservers()
        try session.checkGeneration(generation)
        await endAllDeliveryLiveActivities()
        try session.checkGeneration(generation)
        UIApplication.shared.unregisterForRemoteNotifications()
        AppDelegate.clearDeviceToken()
        UserDefaults.standard.set(true, forKey: notificationOptOutKey)
        UserDefaults.standard.set(false, forKey: nativePushRegisteredKey)
        notificationsEnabledOnDevice = false
        notificationPreferences = nil
        notificationError = nil
        if let userID = session.user?.id { cache.delete(userID: userID) }
        try await session.signOut()
    }

    func refreshNotificationState() async {
        let generation = session.generation
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        guard (try? session.checkGeneration(generation)) != nil else { return }
        // Every foreground checks this; publish only what changed.
        if notificationStatus != status { notificationStatus = status }
        let optedOut = UserDefaults.standard.bool(forKey: notificationOptOutKey)
        let enabled = NotificationDevicePolicy.isEnabled(
            isDemo: isDemo,
            status: notificationStatus,
            optedOut: optedOut,
            nativePushRegistered: UserDefaults.standard.bool(forKey: nativePushRegisteredKey),
            demoNotificationsEnabled: UserDefaults.standard.bool(forKey: demoNotificationsKey)
        )
        if notificationsEnabledOnDevice != enabled { notificationsEnabledOnDevice = enabled }
        if !notificationStateLoaded { notificationStateLoaded = true }
        if NotificationDevicePolicy.shouldRegisterForRemoteNotifications(
            status: notificationStatus,
            optedOut: optedOut
        ) {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func enableNotifications(language: AppLanguage) async throws -> Bool {
        DeliveryAnalytics.shared.action("notifications-enable", .started)
        var succeeded = false
        defer { DeliveryAnalytics.shared.action("notifications-enable", succeeded ? .success : .error) }
        let generation = session.generation
        notificationEnableInProgress = true
        defer {
            if (try? session.checkGeneration(generation)) != nil { notificationEnableInProgress = false }
        }
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        )
        try session.checkGeneration(generation)
        await refreshNotificationState()
        try session.checkGeneration(generation)
        guard granted else {
            dismissNotificationInvitation()
            throw DeliveryAPIError.notificationsDenied
        }
        UserDefaults.standard.set(false, forKey: notificationOptOutKey)
        UIApplication.shared.registerForRemoteNotifications()
        if isDemo {
            UserDefaults.standard.set(true, forKey: demoNotificationsKey)
            notificationsEnabledOnDevice = true
            succeeded = true
            return true
        }
        guard let token = await waitForAPNSToken() else {
            throw DeliveryAPIError.pushTokenUnavailable
        }
        try session.checkGeneration(generation)
        let sent = try await api.registerNativePushToken(
            token,
            installationID: installationID,
            language: language,
            sendTest: true
        )
        try session.checkGeneration(generation)
        UserDefaults.standard.set(true, forKey: nativePushRegisteredKey)
        notificationsEnabledOnDevice = true
        dismissNotificationInvitation()
        succeeded = true
        return sent
    }

    func disableNotifications() async throws {
        DeliveryAnalytics.shared.action("notifications-disable", .started)
        dismissNotificationInvitation()
        nativePushGeneration += 1
        let token = AppDelegate.currentDeviceToken
        if let token, !isDemo { try await api.unregisterNativePushToken(token) }
        UIApplication.shared.unregisterForRemoteNotifications()
        AppDelegate.clearDeviceToken()
        UserDefaults.standard.set(true, forKey: notificationOptOutKey)
        UserDefaults.standard.set(false, forKey: nativePushRegisteredKey)
        UserDefaults.standard.set(false, forKey: demoNotificationsKey)
        notificationsEnabledOnDevice = false
        await refreshNotificationState()
        DeliveryAnalytics.shared.action("notifications-disable", .success)
    }

    var shouldInviteNotifications: Bool {
        !loading && errorMessage == nil && !authenticationRequired
            && NotificationInvitationPolicy.shouldPresent(
                isAuthenticated: session.isAuthenticated,
                isDemo: isDemo,
                hasParcels: !parcels.isEmpty,
                status: notificationStateLoaded ? notificationStatus : nil,
                enabled: notificationsEnabledOnDevice,
                optedOut: UserDefaults.standard.bool(forKey: notificationOptOutKey),
                dismissed: notificationInvitationDismissed
            )
    }

    func dismissNotificationInvitation() {
        guard !isDemo, let userID = session.user?.id else { return }
        NotificationInvitationPreference.dismiss(for: userID)
        notificationInvitationDismissed = true
    }

    func loadNotificationPreferences() async {
        // Alerts belong to an account.
        guard !isGuest else { return }
        let saves = notificationPreferenceSaves
        do {
            let loaded = isDemo
                ? demo.notificationPreferences
                : try await api.notificationPreferences()
            // A save was answered meanwhile: its answer is the newer one.
            guard saves == notificationPreferenceSaves else { return }
            notificationPreferences = loaded
            notificationError = nil
        } catch {
            notificationError = localizer.errorMessage(error)
        }
    }

    func saveNotificationPreferences(_ value: NotificationPreferences) async throws {
        let saved = isDemo
            ? demo.saveNotificationPreferences(value)
            : try await api.saveNotificationPreferences(value)
        notificationPreferenceSaves += 1
        notificationPreferences = saved
        notificationError = nil
    }

    /// The account's delivery email, when the server can write to the address it signs in with.
    var deliveryEmail: DeliveryEmail? {
        DeliveryEmail(isDemo: isDemo, preferences: notificationPreferences, address: session.user?.email)
    }

    /// Switches the account's delivery email at once and apart from the preset: the
    /// preferences go back as they were last saved, with the new choice and this
    /// device's time zone, and the server's answer becomes the state.
    func setEmailOnDelivery(_ enabled: Bool) async throws {
        // Nothing to switch in the demo, or while the server cannot email the account.
        guard deliveryEmail != nil, var value = notificationPreferences else { return }
        value.emailOnDelivery = enabled
        value.timezone = TimeZone.current.identifier
        try await saveNotificationPreferences(value)
    }

    /// Reads the preferences again without a word when that fails: what is loaded stays.
    private func refreshNotificationPreferences() async {
        let saves = notificationPreferenceSaves
        guard let loaded = try? await api.notificationPreferences(),
              saves == notificationPreferenceSaves, loaded != notificationPreferences else { return }
        notificationPreferences = loaded
    }

    func forwardNativePushToken(_ token: String, language: AppLanguage) async {
        guard !isDemo,
              session.isAuthenticated,
              !notificationEnableInProgress,
              !UserDefaults.standard.bool(forKey: notificationOptOutKey) else { return }
        let generation = nativePushGeneration
        do {
            _ = try await api.registerNativePushToken(
                token,
                installationID: installationID,
                language: language,
                sendTest: false
            )
            if generation != nativePushGeneration
                || !session.isAuthenticated
                || UserDefaults.standard.bool(forKey: notificationOptOutKey) {
                try? await api.unregisterNativePushToken(token)
                return
            }
            UserDefaults.standard.set(true, forKey: nativePushRegisteredKey)
            notificationsEnabledOnDevice = session.isAuthenticated
            notificationError = nil
        } catch {
            notificationError = localizer.errorMessage(error)
        }
    }

    private func list() async throws -> [Parcel] {
        if isDemo { return demo.list() }
        return try await api.listPackages()
    }

    private func upsert(_ parcel: Parcel) {
        mutationRevision += 1
        if let index = parcels.firstIndex(where: { $0.id == parcel.id }) { parcels[index] = parcel }
        else { parcels.append(parcel) }
        persistCache()
    }

    private func persistCache() {
        guard let userID = session.user?.id else { return }
        cache.save(parcels, userID: userID)
    }

    private func publishDeliverySurfaces() {
        publishDeliveryWidget()
        scheduleDeliveryLiveActivities()
    }

    private func publishDeliveryWidget() {
        let snapshot: DeliveryWidgetSnapshot?
        if deliveryWidgetEnabled && (session.isAuthenticated || isGuest) {
            let ordered = ParcelOrganizer.visible(
                parcels,
                query: "",
                status: .active,
                carrier: nil,
                sort: .priority
            )
            let candidates = ordered.map { parcel in
                DeliveryWidgetParcel(
                    id: parcel.id,
                    label: parcel.label.nonEmpty ?? localizer.text("common.parcel"),
                    carrier: CarrierCatalog.shared.info(for: parcel.carrier, language: localizer.language).displayName,
                    trackingNumber: CarrierCatalog.format(parcel.trackingNumber, carrier: parcel.carrier),
                    detail: localizer.parcelDeliveryEstimate(parcel)
                        ?? localizer.text(parcel.displayStatus.key),
                    isOutForDelivery: parcel.currentStage == .outForDelivery
                )
            }
            snapshot = DeliveryWidgetSnapshot(
                generatedAt: Date(),
                languageCode: localizer.language.rawValue,
                parcels: DeliveryWidgetSelection.displayParcels(from: candidates)
            )
        } else {
            snapshot = nil
        }

        // Reloads spend the widget's system budget; skip them when nothing it shows changed.
        let state = DeliveryWidgetState(
            enabled: deliveryWidgetEnabled,
            languageCode: localizer.language.rawValue,
            parcels: snapshot?.parcels
        )
        guard state != publishedWidgetState else { return }
        publishedWidgetState = state
        deliveryWidgetStore?.setLanguageCode(localizer.language.rawValue)
        deliveryWidgetStore?.setEnabled(deliveryWidgetEnabled)
        if let snapshot {
            _ = deliveryWidgetStore?.save(snapshot)
        } else {
            deliveryWidgetStore?.clearSnapshot()
        }
        WidgetCenter.shared.reloadTimelines(ofKind: DeliveryWidgetSharedStore.kind)
    }

    private func scheduleDeliveryLiveActivities(forceEnd: Bool = false) {
        deliveryActivityTask?.cancel()
        deliveryActivityTask = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            if forceEnd {
                await self.endAllDeliveryLiveActivities()
            } else {
                await self.updateDeliveryLiveActivities(parcels: self.parcels)
            }
        }
    }

    private func updateDeliveryLiveActivities(parcels: [Parcel]) async {
        guard !Task.isCancelled else { return }
        // A Live Activity is kept up to date by pushes, which need an account.
        guard !isGuest else { return }
        let activities = Activity<DeliveryActivityAttributes>.activities
        guard deliveryLiveActivitiesEnabled else {
            await endAllDeliveryLiveActivities()
            guard !Task.isCancelled, !deliveryLiveActivitiesEnabled else { return }
            await unregisterDeliveryLiveActivityDevice()
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            deliveryLiveActivitySystemDisabled = true
            let message = localizer.text("liveActivity.systemDisabled")
            if deliveryLiveActivityError != message { deliveryLiveActivityError = message }
            return
        }
        if deliveryLiveActivitySystemDisabled {
            deliveryLiveActivitySystemDisabled = false
            deliveryLiveActivityError = nil
        }

        let parcelsByID = Dictionary(uniqueKeysWithValues: parcels.map { ($0.id, $0) })
        var primaryActivityByParcel: [UUID: Activity<DeliveryActivityAttributes>] = [:]
        var duplicateActivityIDs = Set<String>()
        for activity in activities {
            let parcelID = activity.attributes.parcelID
            if primaryActivityByParcel[parcelID] == nil {
                primaryActivityByParcel[parcelID] = activity
            } else {
                duplicateActivityIDs.insert(activity.id)
            }
        }

        let orderedOutForDelivery = ParcelOrganizer.visible(
            parcels,
            query: "",
            status: .active,
            carrier: nil,
            sort: .priority
        ).filter { $0.currentStage == .outForDelivery }
        var desiredParcelIDs: [UUID] = []
        for activity in activities where !duplicateActivityIDs.contains(activity.id) {
            let parcelID = activity.attributes.parcelID
            guard parcelsByID[parcelID]?.currentStage == .outForDelivery else { continue }
            if !desiredParcelIDs.contains(parcelID) && desiredParcelIDs.count < 2 {
                desiredParcelIDs.append(parcelID)
            }
        }
        for parcel in orderedOutForDelivery
        where desiredParcelIDs.count < 2 && !desiredParcelIDs.contains(parcel.id) {
            desiredParcelIDs.append(parcel.id)
        }
        let desired = Set(desiredParcelIDs)

        for activity in activities {
            if duplicateActivityIDs.contains(activity.id) {
                await endDeliveryLiveActivity(activity)
                continue
            }
            guard let parcel = parcelsByID[activity.attributes.parcelID], !parcel.isArchived else {
                await endDeliveryLiveActivity(activity)
                continue
            }
            if parcel.currentStage == .outForDelivery && desired.contains(parcel.id) {
                let relevance = desiredParcelIDs.firstIndex(of: parcel.id) == 0 ? 1.0 : 0.8
                let content = deliveryActivityContent(
                    for: parcel,
                    phase: .outForDelivery,
                    relevanceScore: relevance
                )
                if activity.content.state != content.state || activity.content.relevanceScore != relevance {
                    await activity.update(content)
                }
                observeDeliveryLiveActivity(activity)
            } else if let phase = parcel.currentStage?.deliveryActivityPhase,
                      phase != .outForDelivery {
                let content = deliveryActivityContent(
                    for: parcel,
                    phase: phase,
                    staleDate: nil,
                    relevanceScore: 1
                )
                let grace: TimeInterval = phase == .failedAttempt || phase == .readyForPickup
                    || phase == .exception
                    ? 60 * 60
                    : 30 * 60
                await activity.end(
                    content,
                    dismissalPolicy: .after(Date().addingTimeInterval(grace))
                )
                await unregisterDeliveryLiveActivity(activityID: activity.id)
            } else {
                await endDeliveryLiveActivity(activity)
            }
        }

        let existingParcelIDs = Set(
            Activity<DeliveryActivityAttributes>.activities.map(\.attributes.parcelID)
        )
        for parcelID in desiredParcelIDs where !existingParcelIDs.contains(parcelID) {
            guard let parcel = parcelsByID[parcelID] else { continue }
            let relevance = desiredParcelIDs.firstIndex(of: parcelID) == 0 ? 1.0 : 0.8
            startDeliveryLiveActivity(for: parcel, relevanceScore: relevance)
        }
    }

    private func startDeliveryLiveActivity(for parcel: Parcel, relevanceScore: Double) {
        let attributes = DeliveryActivityAttributes(parcelID: parcel.id)
        let content = deliveryActivityContent(
            for: parcel,
            phase: .outForDelivery,
            relevanceScore: relevanceScore
        )
        let activity: Activity<DeliveryActivityAttributes>?
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: .token
            )
        } catch {
            activity = try? Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
        }
        if let activity { observeDeliveryLiveActivity(activity) }
    }

    private func deliveryActivityContent(
        for parcel: Parcel,
        phase: DeliveryActivityPhase,
        staleDate: Date? = Date().addingTimeInterval(30 * 60),
        relevanceScore: Double = 0
    ) -> ActivityContent<DeliveryActivityAttributes.ContentState> {
        let status = localizer.text(parcel.displayStatus.key)
        let detail = phase == .outForDelivery
            ? localizer.parcelDeliveryEstimate(parcel) ?? status
            : status
        let activityParcel = DeliveryActivityParcel(
            id: parcel.id,
            label: parcel.label.nonEmpty ?? localizer.text("common.parcel"),
            carrier: CarrierCatalog.shared.info(for: parcel.carrier, language: localizer.language).displayName,
            status: status,
            detail: detail,
            phase: phase
        )
        return ActivityContent(
            state: DeliveryActivityAttributes.ContentState(
                parcel: activityParcel,
                languageCode: localizer.language.rawValue
            ),
            staleDate: staleDate,
            relevanceScore: relevanceScore
        )
    }

    private func endDeliveryLiveActivity(
        _ activity: Activity<DeliveryActivityAttributes>
    ) async {
        await activity.end(nil, dismissalPolicy: .immediate)
        await unregisterDeliveryLiveActivity(activityID: activity.id)
    }

    private func endAllDeliveryLiveActivities() async {
        for activity in Activity<DeliveryActivityAttributes>.activities {
            await endDeliveryLiveActivity(activity)
        }
    }

    private func startDeliveryLiveActivityObservers() {
        stopDeliveryLiveActivityObservers()
        guard deliveryLiveActivitiesEnabled, !isDemo, session.isAuthenticated else { return }
        deliveryLiveActivityRegistrationRemovalPending = false
        let generation = deliveryLiveActivityGeneration

        for activity in Activity<DeliveryActivityAttributes>.activities {
            observeDeliveryLiveActivity(activity)
        }
        deliveryPushToStartTask = Task { [weak self] in
            guard let self else { return }
            if let token = Activity<DeliveryActivityAttributes>.pushToStartToken {
                await self.registerDeliveryPushToStartToken(token, generation: generation)
            }
            for await token in Activity<DeliveryActivityAttributes>.pushToStartTokenUpdates {
                if Task.isCancelled { return }
                await self.registerDeliveryPushToStartToken(token, generation: generation)
            }
        }
        deliveryActivityUpdatesTask = Task { [weak self] in
            guard let self else { return }
            for await activity in Activity<DeliveryActivityAttributes>.activityUpdates {
                if Task.isCancelled { return }
                self.observeDeliveryLiveActivity(activity)
                await self.trimExcessDeliveryLiveActivities()
            }
        }
    }

    private func stopDeliveryLiveActivityObservers() {
        deliveryLiveActivityGeneration += 1
        deliveryPushToStartTask?.cancel()
        deliveryPushToStartTask = nil
        deliveryActivityUpdatesTask?.cancel()
        deliveryActivityUpdatesTask = nil
        deliveryActivityPushTokenTasks.values.forEach { $0.cancel() }
        deliveryActivityPushTokenTasks.removeAll()
        deliveryActivityStateTasks.values.forEach { $0.cancel() }
        deliveryActivityStateTasks.removeAll()
    }

    private func observeDeliveryLiveActivity(
        _ activity: Activity<DeliveryActivityAttributes>
    ) {
        guard deliveryLiveActivitiesEnabled,
              !deliveryLiveActivityRegistrationRemovalPending,
              !isDemo,
              session.isAuthenticated else { return }
        let activityID = activity.id
        let generation = deliveryLiveActivityGeneration
        if deliveryActivityPushTokenTasks[activityID] == nil {
            deliveryActivityPushTokenTasks[activityID] = Task { [weak self] in
                guard let self else { return }
                if let token = activity.pushToken {
                    await self.registerDeliveryActivityUpdateToken(
                        token,
                        activity: activity,
                        generation: generation
                    )
                }
                for await token in activity.pushTokenUpdates {
                    if Task.isCancelled { return }
                    await self.registerDeliveryActivityUpdateToken(
                        token,
                        activity: activity,
                        generation: generation
                    )
                }
            }
        }
        if deliveryActivityStateTasks[activityID] == nil {
            deliveryActivityStateTasks[activityID] = Task { [weak self] in
                guard let self else { return }
                for await state in activity.activityStateUpdates {
                    if Task.isCancelled { return }
                    guard state == .ended || state == .dismissed else { continue }
                    await self.unregisterDeliveryLiveActivity(activityID: activityID)
                    self.deliveryActivityPushTokenTasks[activityID]?.cancel()
                    self.deliveryActivityPushTokenTasks[activityID] = nil
                    self.deliveryActivityStateTasks[activityID] = nil
                    return
                }
            }
        }
    }

    private func registerCurrentDeliveryPushToStartToken() {
        guard let token = Activity<DeliveryActivityAttributes>.pushToStartToken else { return }
        let generation = deliveryLiveActivityGeneration
        Task { [weak self] in
            await self?.registerDeliveryPushToStartToken(token, generation: generation)
        }
    }

    private func registerCurrentDeliveryActivityUpdateTokens() {
        let generation = deliveryLiveActivityGeneration
        for activity in Activity<DeliveryActivityAttributes>.activities {
            guard let token = activity.pushToken else { continue }
            Task { [weak self] in
                await self?.registerDeliveryActivityUpdateToken(
                    token,
                    activity: activity,
                    generation: generation
                )
            }
        }
    }

    private func registerDeliveryPushToStartToken(
        _ token: Data,
        generation: Int
    ) async {
        guard generation == deliveryLiveActivityGeneration,
              deliveryLiveActivitiesEnabled,
              !deliveryLiveActivityRegistrationRemovalPending,
              !isDemo,
              session.isAuthenticated else { return }
        do {
            guard let ownerID = session.user?.id else { return }
            let registration = try liveActivityRevocations.registration(ownerID: ownerID, installationID: installationID)
            try await api.registerLiveActivityDevice(
                token: token.hexadecimalString,
                installationID: installationID,
                language: localizer.language,
                revocationToken: registration.revocationToken
            )
            guard generation == deliveryLiveActivityGeneration else {
                if deliveryLiveActivityRegistrationRemovalPending {
                    liveActivityRevocations.retry()
                } else {
                    registerCurrentDeliveryPushToStartToken()
                }
                return
            }
            deliveryLiveActivityError = nil
        } catch {
            if generation == deliveryLiveActivityGeneration {
                deliveryLiveActivityError = localizer.errorMessage(error)
            }
        }
    }

    private func registerDeliveryActivityUpdateToken(
        _ token: Data,
        activity: Activity<DeliveryActivityAttributes>,
        generation: Int
    ) async {
        guard generation == deliveryLiveActivityGeneration,
              deliveryLiveActivitiesEnabled,
              !deliveryLiveActivityRegistrationRemovalPending,
              !isDemo,
              session.isAuthenticated else { return }
        do {
            try await api.registerLiveActivityUpdateToken(
                activityID: activity.id,
                parcelID: activity.attributes.parcelID,
                token: token.hexadecimalString,
                installationID: installationID,
                language: localizer.language
            )
            if generation == deliveryLiveActivityGeneration {
                deliveryLiveActivityError = nil
            }
        } catch {
            if generation == deliveryLiveActivityGeneration {
                deliveryLiveActivityError = localizer.errorMessage(error)
            }
        }
    }

    private func unregisterDeliveryLiveActivity(activityID: String) async {
        guard !isDemo, session.isAuthenticated else { return }
        try? await api.unregisterLiveActivityUpdateToken(
            activityID: activityID,
            installationID: installationID
        )
    }

    private func unregisterDeliveryLiveActivityDevice() async {
        guard !Task.isCancelled, !deliveryLiveActivitiesEnabled else { return }
        do {
            try liveActivityRevocations.queue()
            await liveActivityRevocations.drain()
            liveActivityRevocations.retry()
            if deliveryLiveActivityError != nil { deliveryLiveActivityError = nil }
        } catch {
            deliveryLiveActivityError = localizer.errorMessage(error)
        }
    }

    private func trimExcessDeliveryLiveActivities() async {
        var seen = Set<UUID>()
        var retained = 0
        for activity in Activity<DeliveryActivityAttributes>.activities {
            let parcelID = activity.attributes.parcelID
            guard activity.content.state.parcel.phase == .outForDelivery else { continue }
            if seen.contains(parcelID) || retained >= 2 {
                await endDeliveryLiveActivity(activity)
            } else {
                seen.insert(parcelID)
                retained += 1
            }
        }
    }

    private static func installationIdentifier(
        defaults: UserDefaults = .standard
    ) -> UUID {
        if let raw = defaults.string(forKey: installationIDKey), let value = UUID(uuidString: raw) {
            return value
        }
        let value = UUID()
        defaults.set(value.uuidString, forKey: installationIDKey)
        return value
    }

    private func beginPolling() {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled, let self else { return }
                if self.isActive { await self.load(showSpinner: false) }
            }
        }
    }

    /// Brings the device's own parcels up to date, quietly: trouble leaves the list as it is.
    private func loadDeviceParcels() async {
        let generation = session.generation
        try? await device.refresh()
        guard generation == session.generation, isGuest, pendingMutations.isEmpty else { return }
        let next = device.list()
        if next != parcels { parcels = next } else { publishDeliverySurfaces() }
    }

    /// Asks again while the list is on screen: soon and a few times while a parcel waits for its
    /// carrier's first answer, then at the pace of the signed-in list.
    private func beginDevicePolling() {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            var round = 0
            while !Task.isCancelled {
                guard let waiting = self?.device.isWaiting else { return }
                let soon = waiting && round < 6
                try? await Task.sleep(for: .seconds(soon ? 2 * pow(1.5, Double(round)) : 30))
                guard !Task.isCancelled, let self, self.isGuest else { return }
                round = soon ? round + 1 : 0
                if self.isActive { await self.loadDeviceParcels() }
            }
        }
    }

    /// The parcels followed on this iPhone before signing in join the account, under the names
    /// they had here. The device lets go of each one the account now has.
    private func claimDeviceParcels() async {
        let claims = device.claims
        guard session.user != nil, !claims.isEmpty else { return }
        let generation = session.generation
        for start in stride(from: 0, to: claims.count, by: 20) {
            let batch = Array(claims[start..<min(start + 20, claims.count)])
            guard let response = try? await api.claimParcels(ClaimParcelsRequest(links: batch)),
                  generation == session.generation else { return }
            for result in response.results where result.outcome == .kept {
                // What was archived here stays archived there.
                if let id = result.packageID, device.isArchived(linkID: result.id) { try? await api.archive(id: id) }
            }
            // A parcel the account has no room for stays on the device.
            device.release(Set(response.results.filter { $0.outcome != .quota }.map(\.id)))
        }
    }

    private func monitorJobs(_ jobIDs: [UUID]) {
        pendingJobIDs.formUnion(jobIDs)
        guard jobMonitoringTask == nil, !pendingJobIDs.isEmpty else { return }
        let generation = session.generation
        jobMonitoringTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, !self.pendingJobIDs.isEmpty {
                let current = Array(self.pendingJobIDs)
                do {
                    try await self.api.waitForJobs(current)
                    self.pendingJobIDs.subtract(current)
                    await self.load(showSpinner: false)
                } catch {
                    guard (try? self.session.checkGeneration(generation)) != nil else { return }
                    self.pendingJobIDs.subtract(current)
                    self.errorMessage = self.localizer.errorMessage(error)
                }
            }
            guard (try? self.session.checkGeneration(generation)) != nil else { return }
            self.jobMonitoringTask = nil
            if !self.pendingJobIDs.isEmpty { self.monitorJobs([]) }
        }
    }

    private func waitForAPNSToken() async -> String? {
        if let existing = AppDelegate.currentDeviceToken { return existing }
        for _ in 0..<80 {
            try? await Task.sleep(for: .milliseconds(100))
            if let token = AppDelegate.currentDeviceToken { return token }
        }
        return nil
    }
}

/// What the widget displays; the snapshot's timestamp alone never needs a reload.
private struct DeliveryWidgetState: Equatable {
    let enabled: Bool
    let languageCode: String
    let parcels: [DeliveryWidgetParcel]?
}

private struct DemoExport: Encodable {
    let exportedAt: String
    let mode: String
    let packages: [Parcel]
}

private extension Data {
    var hexadecimalString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}

/// Encoding and writing happen on one serial queue, off the main thread and in
/// call order, so a sign-out's delete always runs after any earlier save.
private final class ParcelCache: @unchecked Sendable {
    private static let queue = DispatchQueue(label: "com.plhery.SwissDeliveryTracker.parcel-cache", qos: .utility)

    func save(_ parcels: [Parcel], userID: UUID) {
        Self.queue.async {
            do {
                let data = try JSONEncoder.deliveryTracker.encode(parcels)
                try data.write(
                    to: try Self.fileURL(userID: userID),
                    options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
                )
            } catch {
                Self.remove(userID: userID)
            }
        }
    }

    /// Waits for pending writes, so it returns the latest saved list.
    func load(userID: UUID) -> [Parcel]? {
        Self.queue.sync {
            guard let url = try? Self.fileURL(userID: userID), let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder.deliveryTracker.decode([Parcel].self, from: data)
        }
    }

    func delete(userID: UUID) {
        Self.queue.async { Self.remove(userID: userID) }
    }

    private static func remove(userID: UUID) {
        guard let url = try? fileURL(userID: userID) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private static func fileURL(userID: UUID) throws -> URL {
        let manager = FileManager.default
        let directory = try manager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appending(path: "ParcelCache", directoryHint: .isDirectory)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appending(path: "\(userID.uuidString).json")
    }
}

final class DemoRepository {
    private let catalogKey = "sdt.native.demo.catalog.v2"
    private let placesKey = "sdt.native.demo.places.v1"
    private let key = "sdt.native.demo.parcels.v1"
    private let preferencesKey = "sdt.native.demo.preferences.v1"
    /// The language the saved demo text is written in; English when absent.
    private let languageKey = "sdt.native.demo.language.v1"
    private let defaults: UserDefaults
    private let language: () -> AppLanguage

    init(defaults: UserDefaults = .standard, language: @escaping () -> AppLanguage = { AppLanguage.current }) {
        self.defaults = defaults
        self.language = language
    }

    var notificationPreferences: NotificationPreferences {
        guard let data = defaults.data(forKey: preferencesKey),
              let value = try? JSONDecoder.deliveryTracker.decode(NotificationPreferences.self, from: data)
        else { return Self.defaultPreferences }
        return value
    }

    func saveNotificationPreferences(_ value: NotificationPreferences) -> NotificationPreferences {
        defaults.set(try? JSONEncoder.deliveryTracker.encode(value), forKey: preferencesKey)
        return value
    }

    func list() -> [Parcel] {
        load().sorted { $0.createdAt > $1.createdAt }
    }

    func add(_ request: CreatePackageRequest) throws -> Parcel {
        guard let carrier = request.carrier else { throw DeliveryAPIError.invalidResponse }
        var all = load()
        if let existing = all.first(where: { $0.trackingNumber == request.trackingNumber }) {
            throw DeliveryAPIError.duplicateTracking(existing.id)
        }
        let id = UUID()
        let now = DateParser.isoString(Date())
        let event = TrackingEvent(
            id: UUID(), packageID: id, stage: .pending,
            description: "Tracking added; the carrier has not announced it yet",
            location: nil, occurredAt: now
        )
        let handoff = CarrierCatalog.supportsSwissPostHandoff(request.trackingNumber)
        let parcel = Parcel(
            id: id,
            trackingNumber: request.trackingNumber,
            label: request.label ?? "",
            carrier: carrier,
            createdAt: now,
            expectedDelivery: nil,
            lastStatusText: nil,
            lastSyncedAt: now,
            syncStatus: .ok,
            syncError: nil,
            trackingURL: request.trackingURL,
            dpdPostcode: request.dpdPostcode,
            carrierData: handoff ? CarrierData(activeTrackingCarrier: .aliexpress, swissPostReady: false) : nil,
            archivedAt: nil,
            notificationsMuted: false,
            trackingEvents: [event]
        )
        all.append(parcel)
        save(all)
        return parcel
    }

    func rename(id: UUID, label: String) throws -> Parcel {
        guard label.count <= 80 else { throw DeliveryAPIError.labelTooLong }
        return try update(id: id) { $0.label = label }
    }

    func changeCarrier(
        id: UUID,
        carrier: CarrierID,
        trackingURL: String?,
        dpdPostcode: String?
    ) throws -> Parcel {
        try update(id: id) { parcel in
            let now = DateParser.isoString(Date())
            parcel.carrier = carrier
            parcel.trackingURL = trackingURL
            parcel.dpdPostcode = dpdPostcode
            parcel.expectedDelivery = nil
            parcel.lastStatusText = nil
            parcel.lastSyncedAt = nil
            parcel.syncStatus = .pending
            parcel.syncError = nil
            parcel.carrierData = CarrierCatalog.supportsSwissPostHandoff(parcel.trackingNumber)
                ? CarrierData(activeTrackingCarrier: .aliexpress, swissPostReady: false)
                : nil
            parcel.trackingEvents = [TrackingEvent(
                id: UUID(),
                packageID: id,
                stage: .pending,
                description: "Carrier changed; waiting for tracking",
                location: nil,
                occurredAt: now
            )]
        }
    }

    func setMuted(id: UUID, muted: Bool) throws -> Parcel {
        try update(id: id) { $0.notificationsMuted = muted }
    }

    func setEmailMuted(id: UUID, muted: Bool) throws -> Parcel {
        try update(id: id) { $0.emailMuted = muted }
    }

    func archive(id: UUID) throws {
        _ = try update(id: id) { $0.archivedAt = DateParser.isoString(Date()) }
    }

    func restore(id: UUID) throws -> Parcel {
        try update(id: id) { $0.archivedAt = nil }
    }

    func permanentlyDelete(id: UUID) throws {
        var all = load()
        guard all.contains(where: { $0.id == id }) else {
            throw DeliveryAPIError.parcelMissing
        }
        all.removeAll { $0.id == id }
        save(all)
    }

    func refreshAll() -> [Parcel] {
        let updated = load().map { advance($0) }
        save(updated)
        return updated.sorted { $0.createdAt > $1.createdAt }
    }

    func refresh(id: UUID) throws -> Parcel {
        try update(id: id) { $0 = advance($0) }
    }

    func reset() {
        defaults.removeObject(forKey: key)
        defaults.removeObject(forKey: preferencesKey)
        defaults.removeObject(forKey: languageKey)
    }

    /// The saved parcels with the demo's own text in the app's language. Names
    /// someone edited and text the demo did not write match nothing and stay.
    private func load() -> [Parcel] {
        let parcels = saved()
        let target = language().rawValue
        let written = defaults.string(forKey: languageKey) ?? "en"
        guard written != target else { return parcels }
        let wanted = Self.catalog.translations[target] ?? [:]
        let english = Dictionary((Self.catalog.translations[written] ?? [:]).map { ($0.value, $0.key) }, uniquingKeysWith: { first, _ in first })
        func say(_ text: String) -> String {
            let original = english[text] ?? text
            return wanted[original] ?? original
        }
        let translated = parcels.map { parcel in
            var copy = parcel
            copy.label = say(parcel.label)
            copy.lastStatusText = parcel.lastStatusText.map(say)
            copy.trackingEvents = parcel.trackingEvents.map { event in
                var scan = event
                scan.description = say(event.description)
                scan.location = event.location.map(say)
                return scan
            }
            return copy
        }
        save(translated)
        defaults.set(target, forKey: languageKey)
        return translated
    }

    /// A simulated scan's text, said in the language the demo is written in.
    private func said(_ text: String) -> String {
        Self.catalog.translations[language().rawValue]?[text] ?? text
    }

    private func saved() -> [Parcel] {
        if let data = defaults.data(forKey: key),
           let parcels = try? JSONDecoder.deliveryTracker.decode([Parcel].self, from: data) {
            if !defaults.bool(forKey: catalogKey) {
                let legacyNumbers = ["12345678901234", "993412345678901234", "1Z999AA10123456784", "RR123456785DE", "443412345678901234"]
                if parcels.contains(where: { legacyNumbers.contains($0.trackingNumber) }) {
                    let existing = Set(parcels.map(\.trackingNumber))
                    let upgraded = Self.withPlaces(parcels) + Self.seed().filter { !existing.contains($0.trackingNumber) }
                    save(upgraded)
                    return upgraded
                }
                defaults.set(true, forKey: catalogKey)
            }
            if !defaults.bool(forKey: placesKey) {
                // Demo parcels saved before scans had places get them from the same samples.
                let located = Self.withPlaces(parcels)
                save(located)
                return located
            }
            return parcels
        }
        let seeded = Self.seed()
        save(seeded)
        defaults.removeObject(forKey: languageKey)
        return seeded
    }

    private func save(_ parcels: [Parcel]) {
        defaults.set(try? JSONEncoder.deliveryTracker.encode(parcels), forKey: key)
        defaults.set(true, forKey: catalogKey)
        defaults.set(true, forKey: placesKey)
    }

    private static func withPlaces(_ parcels: [Parcel]) -> [Parcel] {
        var known: [String: EventPlace] = [:]
        for event in seed().flatMap(\.trackingEvents) {
            if let location = event.location, let place = event.place { known[location] = place }
        }
        for update in updates.values {
            if let location = update.location, let place = update.place { known[location] = place }
        }
        return parcels.map { parcel in
            var located = parcel
            located.trackingEvents = parcel.trackingEvents.map { event in
                guard event.place == nil, let location = event.location, let place = known[location] else { return event }
                var placed = event
                placed.place = place
                return placed
            }
            return located
        }
    }

    private func update(id: UUID, change: (inout Parcel) -> Void) throws -> Parcel {
        var all = load()
        guard let index = all.firstIndex(where: { $0.id == id }) else {
            throw DeliveryAPIError.parcelMissing
        }
        change(&all[index])
        save(all)
        return all[index]
    }

    private func advance(_ parcel: Parcel) -> Parcel {
        guard parcel.isActive, let stage = parcel.currentStage, let next = Self.next(stage) else { return parcel }
        var copy = parcel
        let update = Self.updates[next] ?? ("Tracking updated", nil, nil)
        let timestamp = DateParser.isoString(Date())
        let description = said(update.description)
        copy.trackingEvents.append(TrackingEvent(
            id: UUID(), packageID: copy.id, stage: next,
            description: description, location: update.location.map(said), occurredAt: timestamp, place: update.place
        ))
        copy.lastSyncedAt = timestamp
        copy.lastStatusText = description
        if CarrierCatalog.supportsSwissPostHandoff(copy.trackingNumber),
           [.inTransit, .customs, .outForDelivery, .delivered].contains(next) {
            copy.carrierData = CarrierData(activeTrackingCarrier: .swissPost, swissPostReady: true)
        }
        return copy
    }

    /// The scan each simulated refresh adds, placed where the server would place it.
    private static let updates: [TrackingStage: (description: String, location: String?, place: EventPlace?)] = {
        let zurich = EventPlace(latitude: 47.367, longitude: 8.55, precision: .city, country: "CH", name: "Zürich")
        let harkingen = EventPlace(latitude: 47.305, longitude: 7.821, precision: .city, country: "CH", name: "Härkingen")
        return [
            .registered: ("The sender announced the parcel", nil, nil),
            .accepted: ("Parcel accepted at the counter", "Zürich-Mülligen", zurich),
            .inTransit: ("Sorted at the parcel center", "Härkingen", harkingen),
            .outForDelivery: ("With the courier for delivery today", "Your neighbourhood", nil),
            .delivered: ("Delivered to your mailbox", "Home", nil),
            .readyForPickup: ("Ready for pickup at your branch", "Post branch", nil),
            .exception: ("A problem is holding up the parcel", "Härkingen", harkingen),
        ]
    }()

    private static func next(_ stage: TrackingStage) -> TrackingStage? {
        switch stage {
        case .pending: .registered
        case .registered: .accepted
        case .accepted, .customs, .exception: .inTransit
        case .inTransit: .outForDelivery
        case .outForDelivery, .readyForPickup: .delivered
        case .failedAttempt: .readyForPickup
        case .delivered, .returned: nil
        }
    }

    private static let defaultPreferences = NotificationPreferences(
        enabledStages: [.registered, .accepted, .inTransit, .customs, .exception, .outForDelivery,
                        .failedAttempt, .readyForPickup, .delivered, .returned],
        quietHoursStart: nil,
        quietHoursEnd: nil,
        timezone: TimeZone.current.identifier
    )

    /// The sample parcels, in English, and each language's translation of their text.
    private struct Catalog: Decodable {
        struct Sample: Decodable {
            struct Event: Decodable {
                let stage: TrackingStage
                let hoursAgo: Double
                let description: String
                let location: String?
                let place: EventPlace?
            }
            let label: String
            let trackingNumber: String
            let carrier: CarrierID
            let expectedInDays: Int?
            let archivedHoursAgo: Double?
            let senderName: String?
            let pickupPoint: String?
            let weightKg: Double?
            let events: [Event]
        }
        let parcels: [Sample]
        let translations: [String: [String: String]]
    }

    private static let catalog: Catalog = {
        guard let url = Bundle.main.url(forResource: "DeliveryDemo", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(Catalog.self, from: data) else { return Catalog(parcels: [], translations: [:]) }
        return catalog
    }()

    /// The sample parcels in English; `list()` writes them in the app's language.
    static func seed(now: Date = Date()) -> [Parcel] {
        func iso(_ hoursAgo: Double) -> String { DateParser.isoString(now.addingTimeInterval(-hoursAgo * 3_600)) }
        return catalog.parcels.map { sample in
            let id = UUID()
            let history = sample.events.map { event in
                TrackingEvent(id: UUID(), packageID: id, stage: event.stage,
                    description: event.description, location: event.location, occurredAt: iso(event.hoursAgo),
                    place: event.place)
            }
            let expected = sample.expectedInDays.flatMap { days in
                Calendar.current.date(byAdding: .day, value: days, to: now).map { ParcelOrganizer.dayKey($0) }
            }
            return Parcel(
                id: id, trackingNumber: sample.trackingNumber, label: sample.label, carrier: sample.carrier,
                createdAt: iso(sample.events.map(\.hoursAgo).max() ?? 0), expectedDelivery: expected,
                lastStatusText: history.sorted(by: { $0.occurredAt > $1.occurredAt }).first?.description,
                lastSyncedAt: iso(0.2), syncStatus: .ok, syncError: nil,
                trackingURL: nil, dpdPostcode: sample.carrier == .dpd ? "8000" : nil,
                carrierData: sample.senderName == nil && sample.pickupPoint == nil && sample.weightKg == nil ? nil
                    : CarrierData(senderName: sample.senderName, pickupPoint: sample.pickupPoint, weightKg: sample.weightKg),
                archivedAt: sample.archivedHoursAgo.map(iso), notificationsMuted: false,
                trackingEvents: history
            )
        }
    }
}
