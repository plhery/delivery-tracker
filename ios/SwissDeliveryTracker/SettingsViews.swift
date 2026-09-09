import SwiftUI
import UIKit

struct NotificationSettingsView: View {
    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @State private var draft = NotificationPreferencesDraft()
    @State private var working = false
    @State private var notice: String?
    @State private var errorMessage: String?

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
                Text(localizer.text("notifications.schedule")).font(.caption).foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(Brand.background)
        .disabled(working)
        .navigationTitle(localizer.text("settings.deliveryUpdates"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !embedded {
                ToolbarItem(placement: .confirmationAction) {
                    Button(localizer.text("common.close")) { dismiss() }
                }
            }
        }
        .task {
            await store.refreshNotificationState()
            await store.loadNotificationPreferences()
            hydrate()
        }
        .onChange(of: store.notificationPreferences) { _, _ in hydrate() }
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
    @State private var confirmation = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    profile
                    SettingsGroup(title: localizer.text("native.deliveries")) {
                        NavigationLink {
                            NotificationSettingsView(embedded: true)
                        } label: {
                            SettingsRow(title: localizer.text("settings.deliveryUpdates"), symbol: "bell", value: notificationSummary, chevron: true)
                        }
                        .buttonStyle(.plain)
                        settingsDivider
                        Toggle(isOn: Binding(get: { store.deliveryWidgetEnabled }, set: { store.setDeliveryWidgetEnabled($0) })) {
                            SettingsRow(title: localizer.text("widget.settingTitle"), symbol: "rectangle.3.group", detail: localizer.text("widget.settingDescription"), padded: false)
                        }
                        .padding(15)
                        .accessibilityIdentifier("settings.widgets")
                        settingsDivider
                        Toggle(isOn: Binding(get: { store.deliveryLiveActivitiesEnabled }, set: { store.setDeliveryLiveActivitiesEnabled($0) })) {
                            SettingsRow(title: localizer.text("liveActivity.settingTitle"), symbol: "wave.3.right", detail: localizer.text("liveActivity.settingDescription"), padded: false)
                        }
                        .padding(15)
                        .accessibilityIdentifier("settings.liveActivities")
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
                    }
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .background(Brand.background)
            .navigationTitle(localizer.text("settings.title"))
            .navigationBarTitleDisplayMode(.large)
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

    private var accountTitle: String { localizer.text(store.isDemo ? "settings.demoData" : "settings.accountData") }

    private var notificationSummary: String {
        guard store.notificationsEnabledOnDevice else { return localizer.text("settings.off") }
        guard let preferences = store.notificationPreferences else { return "" }
        return localizer.text(NotificationPreset.matching(preferences.enabledStages).titleKey)
    }

    private var profile: some View {
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
                Text(session.user?.email ?? localizer.text("app.demo")).font(.subheadline).foregroundStyle(.secondary)
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

private extension String {
    var cleaned: String { trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
}


private let settingsGreen = Brand.color(light: "#688363", dark: "#97B084")
private var settingsDivider: some View { Rectangle().fill(Brand.separator.opacity(0.25)).frame(height: 0.5) }

private struct SettingsGroup<Content: View>: View {
    var title: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let title {
                Text(title.uppercased()).font(.caption2.weight(.medium)).tracking(1)
                    .foregroundStyle(.secondary).padding(.leading, 2)
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
