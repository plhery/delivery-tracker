import SwiftUI

/// A parcel's alerts, opened from its bell while the account's delivery email is on.
/// The sheet is as tall as what it shows, and scrolls when that is more than the screen.
struct ParcelAlertsSheet: View {
    let parcelID: UUID

    @EnvironmentObject private var store: ParcelStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @State private var contentHeight: CGFloat = 340
    @State private var detent = PresentationDetent.height(340)

    private var fitted: PresentationDetent { .height(contentHeight) }

    /// The parcel as the store has it now: a switch shows the server's answer as it arrives.
    private var parcel: Parcel? { store.parcels.first { $0.id == parcelID } }

    /// Whether the bell would still open this sheet: the email is on and the parcel on its way.
    private var current: Bool {
        guard let parcel, let email = store.deliveryEmail else { return false }
        return email.bellOpensAlerts(for: parcel)
    }

    var body: some View {
        ScrollView {
            if let parcel, let email = store.deliveryEmail, let preferences = store.notificationPreferences {
                ParcelAlertSwitches(parcel: parcel, email: email, preset: .matching(preferences.enabledStages)) { alert, on in
                    switch alert {
                    case .notifications: try await store.setMuted(parcel, muted: !on)
                    case .email: try await store.setEmailMuted(parcel, muted: !on)
                    }
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Brand.background)
        .tint(Brand.ink)
        .environment(\.locale, localizer.language.locale)
        .presentationDetents([fitted, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationBackground(Brand.background)
        .onChange(of: fitted, initial: true) { _, fitted in
            if detent != .large { detent = fitted }
        }
        // Nothing left to switch here once the parcel has arrived or the email was switched off elsewhere.
        .onChange(of: current, initial: true) { _, current in
            if !current { dismiss() }
        }
    }
}

/// What the alerts sheet shows: notifications and the email, each switched for this
/// parcel only. A switch saves the moment it is flipped and shows what the server answered.
struct ParcelAlertSwitches: View {
    enum Alert: Hashable { case notifications, email }

    let parcel: Parcel
    let email: DeliveryEmail
    /// The account's preset, named on the notifications row.
    let preset: NotificationPreset
    /// Saves one switch for this parcel and returns once the server has answered.
    let save: (Alert, Bool) async throws -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// The switch being saved, and the position it was flipped to.
    @State private var saving: (alert: Alert, on: Bool)?
    /// "Done" was tapped while a switch was saving: the sheet closes once it is saved.
    @State private var closing = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            VStack(spacing: 7) {
                switchRow(.notifications, symbol: "bell", title: localizer.text("email.parcel.notifications"),
                          hint: localizer.text("email.parcel.notificationsBody", ["preset": localizer.text(preset.titleKey)]))
                switchRow(.email, symbol: "envelope", title: localizer.text("email.parcel.email"),
                          hint: localizer.text("email.parcel.emailBody", ["email": email.address]))
            }
            Text(localizer.text("email.parcel.note", ["place": localizer.deliveryUpdatesPlace]))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
            doneButton
        }
        .padding(.horizontal, 22)
        .padding(.top, 26)
        .padding(.bottom, 18)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .interactiveDismissDisabled(saving != nil)
        // The detail's own alert cannot show over this sheet.
        .alert(localizer.text("native.errorTitle"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(localizer.text("common.close"), role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            // A parcel without a name is "this parcel", as on its bell.
            Text(parcel.label.nonEmpty.map { localizer.text("email.parcel.title", ["name": $0]) } ?? localizer.text("email.parcel.open"))
                .font(.title2.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .background(Brand.ink.opacity(0.07), in: Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(localizer.text("common.close"))
        }
    }

    private func switchRow(_ alert: Alert, symbol: String, title: String, hint: String) -> some View {
        Toggle(isOn: Binding {
            saving?.alert == alert ? saving?.on == true : isOn(alert)
        } set: { on in
            flip(alert, to: on)
        }) {
            HStack(spacing: 12) {
                // At the largest type sizes the words need the room.
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: symbol)
                        .font(.system(size: 16))
                        .foregroundStyle(.secondary)
                        .frame(width: 22)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(hint).font(.caption).foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(ExperimentalPalette.delivered)
        .disabled(saving != nil)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 60)
        .background(Brand.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var doneButton: some View {
        Button(action: close) {
            HStack(spacing: 9) {
                if closing { ProgressView().tint(Brand.onAccent) }
                Text(localizer.text("native.done")).multilineTextAlignment(.center)
            }
            .font(.headline)
            .foregroundStyle(Brand.onAccent)
            .padding(.horizontal, 20)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Brand.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(TactileButtonStyle())
    }

    /// Whether the parcel has this alert, as last saved.
    private func isOn(_ alert: Alert) -> Bool {
        switch alert {
        case .notifications: !parcel.notificationsMuted
        case .email: !parcel.isEmailMuted
        }
    }

    private func flip(_ alert: Alert, to on: Bool) {
        guard saving == nil else { return }
        saving = (alert, on)
        Task {
            do {
                try await save(alert, on)
                saving = nil
                if closing { dismiss() }
            } catch {
                saving = nil
                closing = false
                errorMessage = localizer.errorMessage(error)
            }
        }
    }

    /// A switch that is still saving keeps the sheet open until the server has answered,
    /// so a failure is never missed.
    private func close() {
        if saving == nil { dismiss() } else { closing = true }
    }
}

/// Offered once, on a delivered parcel, to an account that has never chosen: a short
/// email when a parcel is ready to collect or delivered. Either answer is saved on the
/// server, so the offer does not come back.
struct DeliveryEmailOffer: View {
    enum Phase: Equatable {
        case open
        /// The answer is being saved: true for "Turn on".
        case saving(Bool)
        case failed
        /// The email was switched on: the card becomes one line saying so.
        case accepted
    }

    let address: String
    let phase: Phase
    let turnOn: () -> Void
    let notNow: () -> Void

    @EnvironmentObject private var localizer: Localizer
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// The card fades out faster than the rows below it move up, so the two barely overlap.
    static let leaving = AnyTransition.asymmetric(insertion: .opacity, removal: .opacity.animation(.easeOut(duration: 0.1)))

    var body: some View {
        if phase == .accepted {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(ExperimentalPalette.delivered)
                    .accessibilityHidden(true)
                Text(localizer.text("email.offer.on", ["place": localizer.deliveryUpdatesPlace]))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .font(.footnote)
            .padding(12)
            .background(Brand.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityIdentifier("detail.emailOffer.on")
            .transition(.opacity)
        } else {
            card.transition(Self.leaving)
        }
    }

    private var card: some View {
        HStack(alignment: .top, spacing: 12) {
            if !dynamicTypeSize.isAccessibilitySize {
                Image(systemName: "envelope")
                    .font(.system(size: 17))
                    .foregroundStyle(ExperimentalPalette.ochre)
                    .frame(width: 40, height: 40)
                    .background(ExperimentalPalette.ochreSurface, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(localizer.text("email.offer.title"))
                    .font(.callout.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Text(localizer.text("email.offer.body", ["email": address]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if phase == .failed {
                    Text(localizer.text("email.setting.failed"))
                        .font(.caption)
                        .foregroundStyle(Brand.warning)
                        .padding(.top, 2)
                        .accessibilityIdentifier("detail.emailOffer.error")
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { turnOnButton; notNowButton }
                    VStack(alignment: .leading, spacing: 4) { turnOnButton; notNowButton }
                }
                .padding(.top, 8)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Brand.ink.opacity(0.12)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("detail.emailOffer")
    }

    private var answering: Bool {
        if case .saving = phase { return true }
        return false
    }

    private var turnOnButton: some View {
        Button(action: turnOn) {
            answer("alerts.turnOn", saving: phase == .saving(true), tint: Brand.onAccent)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .foregroundStyle(Brand.onAccent)
                .background(Brand.accent, in: RoundedRectangle(cornerRadius: 12))
                .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(TactileButtonStyle())
        .disabled(answering)
        .accessibilityIdentifier("detail.emailOffer.turnOn")
    }

    private var notNowButton: some View {
        Button(action: notNow) {
            answer("onboarding.notifications.notNow", saving: phase == .saving(false), tint: nil)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
        }
        .buttonStyle(TactileButtonStyle())
        .disabled(answering)
        .accessibilityIdentifier("detail.emailOffer.notNow")
    }

    /// A button's words, which give their place to a spinner while the answer is saved,
    /// so the button keeps its size.
    private func answer(_ key: String, saving: Bool, tint: Color?) -> some View {
        Text(localizer.text(key))
            .fixedSize(horizontal: false, vertical: true)
            .opacity(saving ? 0 : 1)
            .overlay { if saving { ProgressView().tint(tint) } }
    }
}
