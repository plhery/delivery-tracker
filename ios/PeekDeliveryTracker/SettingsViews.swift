import SafariServices
import SwiftUI
import UIKit

struct NotificationPromptView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @State private var errorMessage: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "bell.badge.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Brand.onAccent)
                        .frame(width: 44, height: 44)
                        .background(Brand.accent, in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(localizer.text("notifications.prompt.title"))
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text(localizer.text("notifications.prompt.description"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(Brand.warning)
                    .accessibilityIdentifier("notifications.prompt.error")
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { enableButton; dismissButton }
                VStack(spacing: 4) { enableButton; dismissButton }
            }
        }
        .padding(16)
        .foregroundStyle(Brand.ink)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 22))
        .overlay { RoundedRectangle(cornerRadius: 22).stroke(Brand.ink.opacity(0.1), lineWidth: 1) }
        .shadow(color: .black.opacity(0.1), radius: 16, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notifications.prompt")
    }

    private var enableButton: some View {
        Button {
            guard !store.notificationEnableInProgress else { return }
            errorMessage = nil
            Task {
                do { _ = try await store.enableNotifications(language: localizer.language) }
                catch { errorMessage = localizer.text("notifications.error.enable") }
            }
        } label: {
            HStack(spacing: 8) {
                if store.notificationEnableInProgress { ProgressView().tint(Brand.onAccent) }
                Text(localizer.text(store.notificationEnableInProgress ? "notifications.enabling" : "notifications.enable"))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(Brand.onAccent)
            .background(Brand.accent, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(store.notificationEnableInProgress)
        .accessibilityIdentifier("notifications.prompt.enable")
    }

    private var dismissButton: some View {
        Button {
            DeliveryAnalytics.shared.action("notifications-defer")
            store.dismissNotificationInvitation()
        } label: {
            Text(localizer.text("onboarding.notifications.notNow"))
                .font(.subheadline.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(store.notificationEnableInProgress)
        .accessibilityIdentifier("notifications.prompt.dismiss")
    }
}

struct NotificationSettingsView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @State private var draft = NotificationPreferencesDraft()
    @State private var working = false
    @State private var notice: String?
    @State private var errorMessage: String?
    /// The position the email switch was flipped to, until the server has answered.
    @State private var emailChoice: Bool?
    @State private var emailFailed = false
    @State private var showingEmailExample = false

    var embedded = false

    var body: some View {
        Group {
            if embedded { content }
            else { NavigationStack { content } }
        }
        .tint(Brand.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SettingsGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(systemStatusText).font(.subheadline).foregroundStyle(.secondary)
                        if store.notificationStatus == .denied && !store.isDemo {
                            Button(localizer.text("native.openSettings"), systemImage: "gear") {
                                UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
                            }
                        } else {
                            Toggle(localizer.text("settings.deliveryUpdates"), isOn: Binding(
                                get: { store.notificationsEnabledOnDevice },
                                set: { enabled in
                                    run {
                                        if enabled {
                                            let welcomeSent = try await store.enableNotifications(language: localizer.language)
                                            notice = welcomeSent ? nil : localizer.text("notifications.error.welcome")
                                        } else {
                                            try await store.disableNotifications()
                                            notice = nil
                                        }
                                    }
                                }
                            ))
                            .tint(settingsGreen)
                        }
                    }
                    .padding(15)
                }
                if store.notificationPreferences != nil {
                    SettingsGroup(title: localizer.text("notifications.preferencesTitle")) {
                        ForEach(NotificationPreset.allCases) { option in
                            if option != NotificationPreset.allCases.first { settingsDivider }
                            Button { draft.preset = option; notice = nil } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: draft.preset == option ? "largecircle.fill.circle" : "circle")
                                        .font(.system(size: 16, weight: .regular))
                                        .foregroundStyle(draft.preset == option ? settingsGreen : .secondary)
                                        .padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(localizer.text(option.titleKey)).font(.subheadline)
                                        Text(localizer.text(option.descriptionKey)).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(15).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(draft.preset == option ? .isSelected : [])
                        }
                    }
                    Button { savePreferences() } label: {
                        HStack {
                            if working { ProgressView() }
                            Text(localizer.text(working ? "notifications.saving" : "notifications.save"))
                        }
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity).padding(14)
                        .foregroundStyle(Brand.onAccent)
                        .background(Brand.accent, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                if let notice { Text(notice).font(.caption).foregroundStyle(settingsGreen) }
                if let error = errorMessage ?? store.notificationError {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
                if let email = store.deliveryEmail {
                    DeliveryEmailSettings(
                        address: email.address,
                        isOn: Binding(get: { emailChoice ?? email.isOn }, set: setEmail),
                        saving: emailChoice != nil,
                        failed: emailFailed,
                        privacy: store.configuration.privacyURL,
                        showExample: emailExampleURL == nil ? nil : {
                            DeliveryAnalytics.shared.action("email-example-open")
                            showingEmailExample = true
                        }
                    )
                }
                Text(localizer.text("notifications.schedule")).font(.caption).foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(Brand.background)
        // One save at a time: a preset saved while the email switch waits could undo its answer.
        .disabled(working || emailChoice != nil)
        .navigationTitle(localizer.text("settings.deliveryUpdates"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !embedded {
                ToolbarItem(placement: .confirmationAction) {
                    Button(localizer.text("common.close")) { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showingEmailExample) {
            if let emailExampleURL { SafariPage(url: emailExampleURL).ignoresSafeArea() }
        }
        .task {
            // What is already loaded shows at once; a change the reload brings follows below.
            hydrate()
            await store.refreshNotificationState()
            await store.loadNotificationPreferences()
        }
        .onChange(of: store.notificationPreferences) { old, new in
            // The email switch saves on its own: a preset picked but not saved yet stays picked.
            if let old, let new, old.enabledStages == new.enabledStages {
                draft.emailOnDelivery = new.emailOnDelivery
            } else {
                hydrate()
            }
            // The choice changed after all, here or from a link in an email: the failure is old news.
            if old?.emailOnDelivery != new?.emailOnDelivery { emailFailed = false }
        }
    }

    private var emailExampleURL: URL? {
        DeliveryEmail.exampleURL(site: store.configuration.apiBaseURL, language: localizer.language)
    }

    private var systemStatusText: String {
        if store.notificationsEnabledOnDevice { return localizer.text("notifications.state.enabled") }
        switch store.notificationStatus {
        case .denied: return localizer.text("notifications.state.blocked")
        case .authorized, .provisional, .ephemeral: return localizer.text("notifications.state.prompt")
        case .notDetermined: return localizer.text("notifications.state.prompt")
        @unknown default: return localizer.text("notifications.state.checking")
        }
    }

    private func hydrate() {
        guard let preferences = store.notificationPreferences else { return }
        draft = NotificationPreferencesDraft(preferences: preferences)
    }

    private func savePreferences() {
        let value = draft.preferences(timezone: TimeZone.current.identifier)
        run {
            try await store.saveNotificationPreferences(value)
            notice = localizer.text("notifications.saved")
        }
    }

    /// Saves the email switch at once. It shows the server's answer, and goes back to
    /// what was saved when the server cannot be reached.
    private func setEmail(_ enabled: Bool) {
        guard emailChoice == nil else { return }
        emailChoice = enabled
        emailFailed = false
        notice = nil
        Task {
            do {
                try await store.setEmailOnDelivery(enabled)
                DeliveryAnalytics.shared.action("email-delivery-change", .success)
            } catch {
                emailFailed = true
                DeliveryAnalytics.shared.action("email-delivery-change", .error)
                AccessibilityNotification.Announcement(localizer.text("email.setting.failed")).post()
            }
            emailChoice = nil
        }
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !working else { return }
        working = true
        errorMessage = nil
        Task {
            do { try await operation() }
            catch { errorMessage = localizer.errorMessage(error) }
            working = false
        }
    }
}

/// "By email": the switch for the account's delivery email, with what the email looks
/// like and the privacy notice a tap away.
struct DeliveryEmailSettings: View {
    let address: String
    @Binding var isOn: Bool
    /// The switch waits for the server's answer before it can be flipped again.
    var saving = false
    var failed = false
    let privacy: URL
    /// Opens the example email. Nil when there is no page to open.
    var showExample: (() -> Void)?

    @EnvironmentObject private var localizer: Localizer

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            SettingsGroup(title: localizer.text("email.section"), badge: localizer.text("email.new")) {
                Toggle(isOn: $isOn) {
                    SettingsRow(title: localizer.text("email.setting.title"), symbol: "envelope",
                                detail: localizer.text("email.setting.body", ["email": address]), padded: false)
                }
                .padding(15)
                .disabled(saving)
                .accessibilityIdentifier("settings.deliveryEmail")
            }
            .tint(settingsGreen)
            if failed {
                Text(localizer.text("email.setting.failed")).font(.caption).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("settings.deliveryEmail.error")
            }
            // Quiet links, each with a full-height touch target that takes no extra room.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 20) { links }
                VStack(alignment: .leading, spacing: 0) { links }
            }
            .buttonStyle(.plain)
            .padding(.leading, 2)
            .padding(.vertical, -10)
        }
    }

    @ViewBuilder private var links: some View {
        if let showExample {
            Button(action: showExample) { quietLink("email.setting.example") }
                .accessibilityIdentifier("settings.deliveryEmail.example")
        }
        Link(destination: privacy) { quietLink("auth.privacyLink") }
            .accessibilityIdentifier("settings.deliveryEmail.privacy")
    }

    private func quietLink(_ key: String) -> some View {
        Text(localizer.text(key)).font(.caption)
            .underline(color: Color(uiColor: .tertiaryLabel))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }
}

struct AccountView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.defaultValue
    @State private var working = false
    @State private var exportURL: URL?
    @State private var showingShareSheet = false
    @State private var confirmingDeletion = false
    @State private var confirmingDemoReset = false
    @State private var confirmingForget = false
    @State private var confirmation = ""
    @State private var errorMessage: String?
    @State private var showingHomePage = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    profile
                    SettingsGroup(title: localizer.text("native.deliveries")) {
                        // Alerts and Live Activities are kept up to date by pushes, which need an account.
                        if !store.isGuest {
                            NavigationLink {
                                NotificationSettingsView(embedded: true)
                            } label: {
                                SettingsRow(title: localizer.text("settings.deliveryUpdates"), symbol: "bell", value: notificationSummary, chevron: true)
                            }
                            .buttonStyle(.plain)
                            settingsDivider
                        }
                        Toggle(isOn: Binding(get: { store.deliveryWidgetEnabled }, set: { store.setDeliveryWidgetEnabled($0) })) {
                            SettingsRow(title: localizer.text("widget.settingTitle"), symbol: "rectangle.3.group", detail: localizer.text("widget.settingDescription"), padded: false)
                        }
                        .padding(15)
                        .accessibilityIdentifier("settings.widgets")
                        if !store.isGuest {
                            settingsDivider
                            Toggle(isOn: Binding(get: { store.deliveryLiveActivitiesEnabled }, set: { store.setDeliveryLiveActivitiesEnabled($0) })) {
                                SettingsRow(title: localizer.text("liveActivity.settingTitle"), symbol: "wave.3.right", detail: localizer.text("liveActivity.settingDescription"), padded: false)
                            }
                            .padding(15)
                            .accessibilityIdentifier("settings.liveActivities")
                        }
                    }
                    .tint(settingsGreen)
                    if let error = store.deliveryLiveActivityError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                    SettingsGroup(title: localizer.text("settings.preferences")) {
                        SettingsAppearancePicker(appearance: $appearance)
                        settingsDivider
                        HStack {
                            Text(localizer.text("language.label")).font(.subheadline)
                            Spacer()
                            Picker(localizer.text("language.label"), selection: $localizer.language) {
                                ForEach(AppLanguage.allCases) { language in Text(language.nativeName).tag(language) }
                            }
                            .labelsHidden().pickerStyle(.menu).tint(.secondary)
                        }
                        .frame(minHeight: 54)
                        .padding(.horizontal, 15)
                    }
                    SettingsGroup {
                        NavigationLink { accountPage } label: {
                            SettingsRow(title: accountTitle, chevron: true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("settings.accountData")
                        settingsDivider
                        // The site's landing, which the app itself never shows.
                        Button { showingHomePage = true } label: {
                            SettingsRow(title: localizer.text("app.homePage"), value: session.configuration.homePageURL.host(), chevron: true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("settings.homePage")
                    }
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .background(Brand.background)
            .navigationTitle(localizer.text("settings.title"))
            .navigationBarTitleDisplayMode(.large)
            .sheet(isPresented: $showingHomePage) {
                SafariPage(url: session.configuration.homePageURL).ignoresSafeArea()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(localizer.text("common.close")) { dismiss() }.disabled(working)
                }
            }
            .task {
                await store.refreshNotificationState()
                await store.loadNotificationPreferences()
            }
        }
        .interactiveDismissDisabled(working)
        .sensoryFeedback(.selection, trigger: appearance)
        .sheet(isPresented: $showingShareSheet) {
            if let exportURL { ActivityShareSheet(items: [exportURL]) }
        }
        .alert(forgetQuestion, isPresented: $confirmingForget) {
            Button(localizer.text("common.cancel"), role: .cancel) {}
            Button(localizer.text("door.recents.forget.yes"), role: .destructive) {
                run { try await store.forgetDeviceParcels() }
            }
        }
        .alert(localizer.text("native.resetDemoQuestion"), isPresented: $confirmingDemoReset) {
            Button(localizer.text("common.cancel"), role: .cancel) {}
            Button(localizer.text("native.resetDemo")) {
                run {
                    await store.resetDemoData()
                    dismiss()
                }
            }
        } message: {
            Text(localizer.text("native.resetDemoDescription"))
        }
        .alert(localizer.text("account.deleteQuestion"), isPresented: $confirmingDeletion) {
            if !store.isDemo {
                TextField(
                    localizer.text("account.typeToConfirm", ["email": session.user?.email ?? ""]),
                    text: $confirmation
                )
                .textInputAutocapitalization(.never)
            }
            Button(localizer.text("common.cancel"), role: .cancel) {}
            Button(localizer.text("account.deletePermanent")) {
                run {
                    try await store.deleteAccount(confirmation: confirmation)
                    dismiss()
                }
            }
            .disabled(!store.isDemo && confirmation.cleaned != (session.user?.email ?? "").cleaned)
        } message: {
            Text(localizer.text("account.deleteDescription"))
        }
        .tint(Brand.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var accountTitle: String {
        localizer.text(store.isDemo ? "settings.demoData" : store.isGuest ? "peek.onThisDevice" : "settings.accountData")
    }

    /// "Forget this parcel?", or how many.
    private var forgetQuestion: String {
        localizer.text("door.recents.forget.many", ["count": store.parcels.count])
    }

    private var notificationSummary: String {
        guard store.notificationsEnabledOnDevice else { return localizer.text("settings.off") }
        guard let preferences = store.notificationPreferences else { return "" }
        return localizer.text(NotificationPreset.matching(preferences.enabledStages).titleKey)
    }

    @ViewBuilder private var profile: some View {
        if store.isGuest { signInOffer } else { account }
    }

    /// Nobody is signed in: what an account adds, and the way to one.
    private var signInOffer: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(localizer.text("link.account.title")).font(.headline)
                Text(localizer.text("link.keep.body")).font(.subheadline).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            Button { dismiss(); session.showSignIn() } label: {
                FirstParcelPrimaryLabel(title: localizer.text("arrival.signInTitle"), symbol: nil)
            }
            .buttonStyle(TactileButtonStyle())
            .accessibilityIdentifier("settings.signIn")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.separator.opacity(0.3), lineWidth: 0.75) }
    }

    private var account: some View {
        HStack(spacing: 11) {
            Text(accountInitial)
                .font(.caption.weight(.semibold))
                .frame(width: 37, height: 37)
                .foregroundStyle(Brand.color(light: "#695824", dark: "#E2D08D"))
                .background(Brand.color(light: "#F7EFC9", dark: "#49452A"), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) {
                Text(session.user?.email ?? localizer.text("app.demo")).font(.subheadline.weight(.medium)).textSelection(.enabled)
                if !store.isDemo { Text(localizer.text("account.signedIn")).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(.bottom, 2)
    }

    private var accountPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(store.isGuest ? localizer.text("native.guest.kept") : session.user?.email ?? localizer.text("app.demo"))
                    .font(.subheadline).foregroundStyle(.secondary)
                SettingsGroup(title: localizer.text("settings.yourData")) {
                    Button {
                        run { exportURL = try await store.exportAccount(); showingShareSheet = true }
                    } label: { SettingsRow(title: localizer.text("account.export"), symbol: "square.and.arrow.up") }
                    settingsDivider
                    Link(destination: session.configuration.privacyURL) {
                        SettingsRow(title: localizer.text("account.privacy"), symbol: "hand.raised", chevron: true)
                    }
                }
                if store.isDemo {
                    SettingsGroup(title: localizer.text("app.demo")) {
                        Button { confirmingDemoReset = true } label: {
                            SettingsRow(title: localizer.text("native.resetDemo"), chevron: true)
                        }
                        settingsDivider
                        Button { session.showWelcome(); dismiss() } label: {
                            SettingsRow(title: localizer.text("native.exitDemo"))
                        }
                    }
                } else if store.isGuest {
                    if !store.parcels.isEmpty {
                        SettingsGroup {
                            Button { confirmingForget = true } label: {
                                SettingsRow(title: localizer.text("door.recents.forgetAll"))
                            }
                            .accessibilityIdentifier("settings.forgetAll")
                        }
                    }
                } else {
                    SettingsGroup {
                        Button { run { try await store.signOut(); dismiss() } } label: {
                            SettingsRow(title: localizer.text("account.signOut"))
                        }
                    }
                    Button { confirmation = ""; confirmingDeletion = true } label: {
                        Text(localizer.text("account.delete"))
                            .font(.caption).foregroundStyle(Brand.warning)
                            .frame(minHeight: 44)
                    }
                }
                if let errorMessage { Text(errorMessage).font(.subheadline).foregroundStyle(.red) }
            }
            .buttonStyle(.plain)
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(Brand.background)
        .disabled(working)
        .interactiveDismissDisabled(working)
        .navigationTitle(accountTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if working { ToolbarItem(placement: .topBarTrailing) { ProgressView() } } }
    }

    private var accountInitial: String {
        String((session.user?.email ?? "D").first ?? "D").uppercased()
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !working else { return }
        working = true
        errorMessage = nil
        Task {
            do { try await operation() }
            catch { errorMessage = localizer.errorMessage(error) }
            working = false
        }
    }
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

/// A web page a list or a row leads to, shown in a sheet.
struct SitePage: Identifiable {
    let url: URL
    var id: URL { url }
}

/// A page of the site, read without leaving the app. It opens web addresses only.
struct SafariPage: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        return controller
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

private extension String {
    var cleaned: String { trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
}


private let settingsGreen = Brand.color(light: "#688363", dark: "#97B084")
private var settingsDivider: some View { Rectangle().fill(Brand.separator.opacity(0.25)).frame(height: 0.5) }

private struct SettingsGroup<Content: View>: View {
    var title: String? = nil
    /// A word beside the title, such as "New".
    var badge: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let title {
                HStack(spacing: 8) {
                    Text(title.uppercased()).font(.caption2.weight(.medium)).tracking(1)
                        .foregroundStyle(.secondary)
                    if let badge {
                        Text(badge.uppercased()).font(.caption2.weight(.bold)).tracking(0.4)
                            .foregroundStyle(ExperimentalPalette.ochre)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(ExperimentalPalette.ochreSurface, in: RoundedRectangle(cornerRadius: 7))
                    }
                }
                .padding(.leading, 2)
                .accessibilityElement(children: .combine)
            }
            VStack(spacing: 0) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.paper, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Brand.separator.opacity(0.25), lineWidth: 0.5))
        }
    }
}

private struct SettingsRow: View {
    let title: String
    var symbol: String? = nil
    var detail: String? = nil
    var value: String? = nil
    var chevron = false
    var padded = true

    var body: some View {
        HStack(spacing: 11) {
            if let symbol {
                Image(systemName: symbol).font(.system(size: 15, weight: .light))
                    .foregroundStyle(.secondary).frame(width: 17)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline).foregroundStyle(Brand.ink)
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 4)
            if let value, !value.isEmpty { Text(value).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.trailing) }
            if chevron { Image(systemName: "chevron.right").font(.system(size: 10, weight: .light)).foregroundStyle(.secondary) }
        }
        .padding(padded ? 15 : 0)
        .frame(minHeight: padded ? 54 : nil, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct SettingsAppearancePicker: View {
    @EnvironmentObject private var localizer: Localizer
    @Binding var appearance: AppAppearance

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text(localizer.text("native.appearance.title")).font(.subheadline)
            HStack(spacing: 8) {
                ForEach(AppAppearance.allCases) { option in
                    Button {
                        appearance = option
                        DeliveryAnalytics.shared.action("appearance-change")
                    } label: {
                        VStack(spacing: 8) {
                            miniature(option).frame(width: 60, height: 43)
                            Text(localizer.text(option.titleKey)).font(.caption)
                                .foregroundStyle(appearance == option ? Brand.ink : .secondary)
                        }
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity)
                        .background(Brand.background, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(appearance == option ? settingsGreen : Brand.separator.opacity(0.25), lineWidth: appearance == option ? 1.5 : 0.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(localizer.text(option.titleKey))
                    .accessibilityAddTraits(appearance == option ? .isSelected : [])
                    .accessibilityIdentifier("settings.appearance.\(option.rawValue)")
                }
            }
        }
        .padding(15)
        .accessibilityIdentifier("settings.appearance")
    }

    private func miniature(_ option: AppAppearance) -> some View {
        let light = Color(hex: "#F2F4EB"), dark = Color(hex: "#30392D")
        let lightLine = Color(hex: "#DCE2D1"), darkLine = Color(hex: "#69755C")
        return ZStack(alignment: .top) {
            HStack(spacing: 0) {
                (option == .dark ? dark : light)
                (option == .light ? light : dark)
            }
            VStack(spacing: 4) {
                ForEach(0..<2) { _ in
                    HStack(spacing: 0) {
                        (option == .dark ? darkLine : lightLine)
                        (option == .light ? lightLine : darkLine)
                    }
                    .frame(height: 6).clipShape(RoundedRectangle(cornerRadius: 2))
                }
            }.padding(7)
        }
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color(hex: "#69755C").opacity(0.35), lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}
