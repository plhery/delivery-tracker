import SwiftUI
import UserNotifications
import XCTest
@testable import SwissDeliveryTracker

final class NotificationLogicTests: XCTestCase {
    func testPresetsMatchStageSetsRegardlessOfOrder() {
        XCTAssertEqual(NotificationPreset.matching(NotificationPreset.all.stages.reversed()), .all)
        XCTAssertEqual(NotificationPreset.matching(NotificationPreset.important.stages.shuffled()), .important)
        XCTAssertEqual(NotificationPreset.matching(NotificationPreset.deliveryDay.stages.reversed()), .deliveryDay)
    }

    func testUnknownStageCombinationFallsBackToAllPreset() {
        XCTAssertEqual(NotificationPreset.matching([.customs, .delivered]), .all)
    }

    func testSavingPresetClearsRetiredQuietHours() {
        let original = NotificationPreferences(
            enabledStages: NotificationPreset.important.stages,
            quietHoursStart: "23:15", quietHoursEnd: "06:45", timezone: "Europe/Zurich"
        )
        var draft = NotificationPreferencesDraft(preferences: original)
        XCTAssertEqual(draft.preset, .important)
        draft.preset = .deliveryDay
        let saved = draft.preferences(timezone: original.timezone)
        XCTAssertEqual(saved.enabledStages, NotificationPreset.deliveryDay.stages)
        XCTAssertNil(saved.quietHoursStart)
        XCTAssertNil(saved.quietHoursEnd)
        XCTAssertEqual(saved.timezone, original.timezone)
    }

    func testDeviceNotificationStateRequiresPermissionRegistrationAndNoOptOut() {
        XCTAssertTrue(NotificationDevicePolicy.isEnabled(
            isDemo: false,
            status: .authorized,
            optedOut: false,
            nativePushRegistered: true,
            demoNotificationsEnabled: false
        ))
        XCTAssertFalse(NotificationDevicePolicy.isEnabled(
            isDemo: false,
            status: .denied,
            optedOut: false,
            nativePushRegistered: true,
            demoNotificationsEnabled: false
        ))
        XCTAssertFalse(NotificationDevicePolicy.isEnabled(
            isDemo: false,
            status: .authorized,
            optedOut: true,
            nativePushRegistered: true,
            demoNotificationsEnabled: false
        ))
        XCTAssertFalse(NotificationDevicePolicy.isEnabled(
            isDemo: false,
            status: .authorized,
            optedOut: false,
            nativePushRegistered: false,
            demoNotificationsEnabled: false
        ))
    }

    func testDemoNotificationStateDoesNotDependOnAPNS() {
        XCTAssertTrue(NotificationDevicePolicy.isEnabled(
            isDemo: true,
            status: .denied,
            optedOut: true,
            nativePushRegistered: false,
            demoNotificationsEnabled: true
        ))
        XCTAssertFalse(NotificationDevicePolicy.isEnabled(
            isDemo: true,
            status: .authorized,
            optedOut: false,
            nativePushRegistered: true,
            demoNotificationsEnabled: false
        ))
    }

    func testRemoteRegistrationPolicyAcceptsProvisionalPermission() {
        XCTAssertTrue(NotificationDevicePolicy.shouldRegisterForRemoteNotifications(
            status: .provisional,
            optedOut: false
        ))
        XCTAssertFalse(NotificationDevicePolicy.shouldRegisterForRemoteNotifications(
            status: .notDetermined,
            optedOut: false
        ))
        XCTAssertFalse(NotificationDevicePolicy.shouldRegisterForRemoteNotifications(
            status: .authorized,
            optedOut: true
        ))
    }

    func testInvitationWaitsForPermissionCheckAndARealAccountWithParcels() {
        XCTAssertTrue(invitation())
        XCTAssertFalse(invitation(status: nil))
        XCTAssertFalse(invitation(isAuthenticated: false))
        XCTAssertFalse(invitation(isDemo: true))
        XCTAssertFalse(invitation(hasParcels: false))
    }

    func testInvitationRespectsPermissionAndPreviousChoices() {
        XCTAssertFalse(invitation(status: .denied))
        XCTAssertFalse(invitation(status: .ephemeral))
        XCTAssertFalse(invitation(enabled: true))
        XCTAssertFalse(invitation(optedOut: true))
        XCTAssertFalse(invitation(dismissed: true))
        // Permission alone does not mean the server has a working push registration.
        XCTAssertTrue(invitation(status: .authorized))
        XCTAssertTrue(invitation(status: .provisional))
    }

    func testInvitationDismissalPersistsPerAccount() {
        let suite = "NotificationInvitationTests.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let user = UUID()
        XCTAssertFalse(NotificationInvitationPreference.isDismissed(for: user, defaults: defaults))
        NotificationInvitationPreference.dismiss(for: user, defaults: defaults)
        XCTAssertTrue(NotificationInvitationPreference.isDismissed(
            for: user, defaults: UserDefaults(suiteName: suite)!
        ))
        XCTAssertFalse(NotificationInvitationPreference.isDismissed(for: UUID(), defaults: defaults))
    }

    func testInvitationPreservesPreviousOnboardingChoice() {
        let suite = "NotificationInvitationTests.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: "sdt.notificationOnboardingCompleted.v1")
        XCTAssertTrue(NotificationInvitationPreference.isDismissed(for: UUID(), defaults: defaults))
    }

    @MainActor func testPopupFitsNarrowScreensInEveryLanguageAndLargeType() throws {
        let localizer = Localizer()
        let previousLanguage = localizer.language
        defer { localizer.language = previousLanguage }
        let session = SessionStore()
        let store = ParcelStore(session: session, localizer: localizer)
        for language in AppLanguage.allCases {
            localizer.language = language
            for largeType in [false, true] {
                let content = NotificationPromptView()
                    .environmentObject(store)
                    .environmentObject(localizer)
                    .environment(\.dynamicTypeSize, largeType ? .accessibility3 : .large)
                    .environment(\.colorScheme, largeType ? .dark : .light)
                    .frame(width: 343)
                    .padding(16)
                    .background(Brand.cream)
                let renderer = ImageRenderer(content: content)
                renderer.scale = 2
                let image = try XCTUnwrap(renderer.uiImage)
                XCTAssertEqual(image.size.width, 375, accuracy: 1)
                XCTAssertLessThan(image.size.height, 650)
                let attachment = XCTAttachment(image: image)
                attachment.name = "notification-popup-\(language.rawValue)-\(largeType ? "large-dark" : "regular-light")"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    private func invitation(
        isAuthenticated: Bool = true,
        isDemo: Bool = false,
        hasParcels: Bool = true,
        status: UNAuthorizationStatus? = .notDetermined,
        enabled: Bool = false,
        optedOut: Bool = false,
        dismissed: Bool = false
    ) -> Bool {
        NotificationInvitationPolicy.shouldPresent(
            isAuthenticated: isAuthenticated, isDemo: isDemo, hasParcels: hasParcels,
            status: status, enabled: enabled, optedOut: optedOut, dismissed: dismissed
        )
    }
}
