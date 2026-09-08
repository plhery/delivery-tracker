import SwiftUI

@main
struct SwissDeliveryTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var session: SessionStore
    @StateObject private var parcels: ParcelStore
    @StateObject private var localizer: Localizer
    @StateObject private var invitation = FriendInvitationStore()
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system

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
                .environmentObject(session)
                .environmentObject(parcels)
                .environmentObject(localizer)
                .environmentObject(invitation)
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
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("sdt.notificationOnboardingCompleted.v1") private var notificationOnboardingCompleted = false
    @State private var showingNotificationOnboarding = false
    @State private var selectedTab = 0
    private let carrierCatalog = CarrierCatalog.shared

    var body: some View {
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
        .task {
            if await carrierCatalog.refresh(from: AppConfiguration.current.apiBaseURL) == .updated {
                parcels.refreshDeliverySurfaces()
            }
        }
        .task(id: sessionIdentity + (invitation.isPresenting ? "-invitation" : "")) {
            guard session.isAuthenticated else {
                showingNotificationOnboarding = false
                switch session.state {
                case .loading: break
                default: parcels.clearDeliverySurfaces()
                }
                return
            }
            showingNotificationOnboarding = NotificationOnboardingPolicy.shouldPresent(
                isAuthenticated: session.isAuthenticated,
                isDemo: session.isDemo,
                completed: notificationOnboardingCompleted
            ) && !invitation.isPresenting
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
        .onOpenURL { invitation.open($0) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { if let url = $0.webpageURL { invitation.open(url) } }
        .sensoryFeedback(.success, trigger: invitation.completed)
        .onChange(of: invitation.completed) { _, _ in selectedTab = 2 }
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
        .fullScreenCover(isPresented: $showingNotificationOnboarding) {
            NotificationOnboardingView {
                notificationOnboardingCompleted = true
                showingNotificationOnboarding = false
            }
            .environmentObject(parcels)
            .environmentObject(localizer)
            .interactiveDismissDisabled()
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
