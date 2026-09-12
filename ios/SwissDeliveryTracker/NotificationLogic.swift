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

    init(preferences: NotificationPreferences? = nil) {
        preset = preferences.map { NotificationPreset.matching($0.enabledStages) } ?? .all
    }

    func preferences(timezone: String) -> NotificationPreferences {
        NotificationPreferences(
            enabledStages: preset.stages,
            quietHoursStart: nil,
            quietHoursEnd: nil,
            timezone: timezone
        )
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
