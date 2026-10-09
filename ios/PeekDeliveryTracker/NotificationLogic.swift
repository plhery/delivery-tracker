import Foundation
import UserNotifications

enum NotificationPreset: String, CaseIterable, Identifiable {
    case all, important, deliveryDay

    var id: String { rawValue }

    var stages: [NotificationStage] {
        switch self {
        case .all:
            [.registered, .accepted, .inTransit, .customs, .exception, .outForDelivery,
             .failedAttempt, .readyForPickup, .delivered, .returned]
        case .important:
            [.customs, .exception, .outForDelivery, .failedAttempt, .readyForPickup, .delivered,
             .returned]
        case .deliveryDay:
            [.outForDelivery, .delivered]
        }
    }

    var titleKey: String {
        switch self {
        case .all: "notifications.preset.all"
        case .important: "notifications.preset.important"
        case .deliveryDay: "notifications.preset.deliveryDay"
        }
    }

    var descriptionKey: String { "\(titleKey)Description" }

    static func matching(_ stages: [NotificationStage]) -> NotificationPreset {
        let enabled = Set(stages)
        return allCases.first { Set($0.stages) == enabled } ?? .all
    }
}

struct NotificationPreferencesDraft: Equatable {
    var preset: NotificationPreset
    /// The account's email choice rides along as it was saved: the email switch
    /// saves on its own, so saving a preset never changes it.
    var emailOnDelivery: Bool?

    init(preferences: NotificationPreferences? = nil) {
        preset = preferences.map { NotificationPreset.matching($0.enabledStages) } ?? .all
        emailOnDelivery = preferences?.emailOnDelivery
    }

    func preferences(timezone: String) -> NotificationPreferences {
        NotificationPreferences(
            enabledStages: preset.stages,
            quietHoursStart: nil,
            quietHoursEnd: nil,
            timezone: timezone,
            emailOnDelivery: emailOnDelivery
        )
    }
}

/// The account's delivery email: a short email when a parcel is ready to collect and
/// when it is delivered, to the address it signs in with. There is none in the demo, or unless the
/// server says it can write to the account, and nothing about email shows then.
struct DeliveryEmail: Equatable {
    let address: String
    /// True when on, false when off or declined, nil while the account has never chosen.
    let choice: Bool?

    init?(isDemo: Bool, preferences: NotificationPreferences?, address: String?) {
        guard !isDemo, let preferences, preferences.emailAvailable == true,
              let address = address?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else { return nil }
        self.address = address
        choice = preferences.emailOnDelivery
    }

    var isOn: Bool { choice == true }

    /// While the email is on and the parcel is still on its way, the parcel's bell opens
    /// its alerts. Otherwise one tap mutes or unmutes its notifications.
    func bellOpensAlerts(for parcel: Parcel) -> Bool {
        isOn && parcel.currentStage?.isFinal != true
    }

    /// Offered once, on a delivered parcel, while the account has never chosen.
    func isOffered(on parcel: Parcel) -> Bool {
        choice == nil && parcel.isDelivered
    }

    /// What "See an example" opens: the example email in the app's language. Nil when the
    /// site is not a web address, which the in-app browser cannot open.
    static func exampleURL(site: URL, language: AppLanguage) -> URL? {
        guard let scheme = site.scheme?.lowercased(), scheme == "https" || scheme == "http", site.host != nil else { return nil }
        return site.appending(path: "email/example").appending(queryItems: [URLQueryItem(name: "lang", value: language.rawValue)])
    }
}

extension Parcel {
    /// Parcels saved or served before the email existed carry no mute for it.
    var isEmailMuted: Bool { emailMuted == true }

    /// The bell of a parcel whose alerts open in a sheet is struck through only when
    /// both its notifications and its email are off.
    var allAlertsMuted: Bool { notificationsMuted && isEmailMuted }
}

extension Localizer {
    /// Where the account's defaults are, as the alerts sheet and the offer name it:
    /// "Settings › Notifications".
    var deliveryUpdatesPlace: String {
        "\(text("settings.title")) › \(text("settings.deliveryUpdates"))"
    }
}

enum NotificationDevicePolicy {
    static func isAuthorized(_ status: UNAuthorizationStatus) -> Bool {
        status == .authorized || status == .provisional
    }

    static func isEnabled(
        isDemo: Bool,
        status: UNAuthorizationStatus,
        optedOut: Bool,
        nativePushRegistered: Bool,
        demoNotificationsEnabled: Bool
    ) -> Bool {
        if isDemo { return demoNotificationsEnabled }
        return isAuthorized(status) && !optedOut && nativePushRegistered
    }

    static func shouldRegisterForRemoteNotifications(
        status: UNAuthorizationStatus,
        optedOut: Bool
    ) -> Bool {
        isAuthorized(status) && !optedOut
    }
}

enum NotificationInvitationPolicy {
    static func shouldPresent(
        isAuthenticated: Bool,
        isDemo: Bool,
        hasParcels: Bool,
        status: UNAuthorizationStatus?,
        enabled: Bool,
        optedOut: Bool,
        dismissed: Bool
    ) -> Bool {
        guard isAuthenticated, !isDemo, hasParcels, !enabled, !optedOut, !dismissed,
              let status else { return false }
        return status == .notDetermined || status == .authorized || status == .provisional
    }
}

enum NotificationInvitationPreference {
    private static func key(for userID: UUID) -> String {
        "sdt.notificationInvitationDismissed.v1.\(userID.uuidString)"
    }

    static func isDismissed(for userID: UUID, defaults: UserDefaults = .standard) -> Bool {
        // Preserve choices made in the previous full-screen onboarding.
        defaults.bool(forKey: "sdt.notificationOnboardingCompleted.v1")
            || defaults.bool(forKey: key(for: userID))
    }

    static func dismiss(for userID: UUID, defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: key(for: userID))
    }
}
