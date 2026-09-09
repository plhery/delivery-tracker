import Foundation
import UserNotifications

enum NotificationPreset: String, CaseIterable, Identifiable {
    case all, important, deliveryDay

    var id: String { rawValue }

    var stages: [NotificationStage] {
        switch self {
        case .all:
            [.registered, .accepted, .inTransit, .customs, .outForDelivery,
             .failedAttempt, .readyForPickup, .delivered, .returned]
        case .important:
            [.customs, .outForDelivery, .failedAttempt, .readyForPickup, .delivered, .returned]
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

enum NotificationOnboardingPolicy {
    static func shouldPresent(
        isAuthenticated: Bool,
        isDemo: Bool,
        completed: Bool
    ) -> Bool {
        isAuthenticated && !isDemo && !completed
    }
}
