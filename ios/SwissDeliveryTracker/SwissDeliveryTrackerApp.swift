import SwiftUI

@main
struct SwissDeliveryTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var session: SessionStore
    @StateObject private var parcels: ParcelStore
    @StateObject private var localizer: Localizer
    @StateObject private var invitation = FriendInvitationStore()
    @StateObject private var friendsActivity = FriendsActivityStore()
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.defaultValue

    init() {
        let localizer = Localizer()
        let session = SessionStore(configuration: .current)
        _localizer = StateObject(wrappedValue: localizer)
        _session = StateObject(wrappedValue: session)
        _parcels = StateObject(wrappedValue: ParcelStore(
            configuration: .current,
            session: session,
            localizer: localizer
        ))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .background { AnalyticsLifecycleObserver() }
                .environmentObject(session)
                .environmentObject(parcels)
                .environmentObject(localizer)
                .environmentObject(invitation)
                .environmentObject(friendsActivity)
                .environment(\.locale, localizer.language.locale)
                .background { AppWindowAppearance(appearance: appearance) }
                .tint(Brand.accent)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var parcels: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @EnvironmentObject private var invitation: FriendInvitationStore
    @EnvironmentObject private var friendsActivity: FriendsActivityStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    private let carrierCatalog = CarrierCatalog.shared

    private var sessionContent: some View {
        Group {
            if invitation.isPresenting, sessionIdentity != "loading" {
                ArrivalView().id(invitation.presentationID)
            } else {
            switch session.state {
            case .loading:
                LaunchView()
            case .welcome, .unconfigured, .signedOut:
                ArrivalView()
            case .demo, .signedIn:
                ParcelListView(selection: $selectedTab)
            }
            }
        }
        .task { await session.bootstrap() }
        .onChange(of: sessionIdentity) { _, _ in friendsActivity.clear() }
        .task(id: sessionIdentity + (scenePhase == .active ? "-active" : "-hidden")) {
            guard session.user != nil else { friendsActivity.clear(); return }
            guard scenePhase == .active else { friendsActivity.hidePrivateContent(); return }
            if let friendID = AppDelegate.consumePendingFriendID() { friendsActivity.reveal(friendID) }
            while !Task.isCancelled {
                await friendsActivity.refresh(session: session)
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
    }

    private var lifecycleContent: some View {
        sessionContent
        .overlay(alignment: .top) {
            if !invitation.isPresenting, session.user != nil, let update = friendsActivity.updates.first {
                FriendAcceptedNotice(update: update) {
                    friendsActivity.reveal(update.friendID)
                    Task { await friendsActivity.acknowledge(update.friendID, session: session) }
                } dismiss: { Task { await friendsActivity.acknowledge(update.friendID, session: session) } }
                .padding(.horizontal, 16).padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .task {
            if await carrierCatalog.refresh(from: AppConfiguration.current.apiBaseURL) == .updated {
                parcels.refreshDeliverySurfaces()
            }
        }
        .task(id: sessionIdentity + (invitation.isPresenting ? "-invitation" : "")) {
            guard session.isAuthenticated else {
                switch session.state {
                case .loading: break
                default: parcels.clearDeliverySurfaces()
                }
                return
            }
            await parcels.start()
        }
        .onChange(of: scenePhase) { _, phase in
            parcels.setActive(phase == .active)
            if phase != .active { invitation.clearPreview() }
            guard phase == .active else { return }
            Task {
                if await carrierCatalog.refresh(
                    from: AppConfiguration.current.apiBaseURL
                ) == .updated {
                    parcels.refreshDeliverySurfaces()
                }
            }
        }
    }

    private var routedContent: some View {
        lifecycleContent
        .onOpenURL { url in
            if case .friend(let friendID) = NativeRoute(url: url), session.user != nil { friendsActivity.reveal(friendID) }
            else { invitation.open(url) }
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { if let url = $0.webpageURL { invitation.open(url) } }
        .onChange(of: invitation.completed) { _, _ in selectedTab = 2 }
        .onChange(of: friendsActivity.presentationID) { _, _ in
            if friendsActivity.focusID != nil { selectedTab = 2 }
        }
        .onReceive(NotificationCenter.default.publisher(for: .didOpenFriendNotification)) { notification in
            guard session.user != nil, let friendID = notification.object as? UUID else { return }
            _ = AppDelegate.consumePendingFriendID()
            friendsActivity.reveal(friendID)
        }
        .onReceive(NotificationCenter.default.publisher(for: .didReceiveFriendActivity)) { _ in
            guard session.user != nil, scenePhase == .active else { return }
            Task { await friendsActivity.refresh(session: session) }
        }
    }

    var body: some View {
        routedContent
        .onReceive(NotificationCenter.default.publisher(for: .didReceiveAPNSToken)) { notification in
            guard let token = notification.object as? String else { return }
            Task {
                await parcels.forwardNativePushToken(token, language: localizer.language)
            }
        }
        .onChange(of: localizer.language) { _, language in
            parcels.refreshDeliverySurfaces()
            guard let token = AppDelegate.currentDeviceToken else { return }
            Task { await parcels.forwardNativePushToken(token, language: language) }
        }
    }

    private var sessionIdentity: String {
        switch session.state {
        case .loading: "loading"
        case .welcome: "welcome"
        case .demo: "demo"
        case .unconfigured: "unconfigured"
        case .signedOut: "signed-out"
        case .signedIn(let user): user.id.uuidString
        }
    }
}

private struct LaunchView: View {
    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            VStack(spacing: 20) {
                ParcelGlyph(size: 78)
                ProgressView()
                    .controlSize(.large)
                    .tint(Brand.ink)
                Text(localizer.text("auth.loading"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
