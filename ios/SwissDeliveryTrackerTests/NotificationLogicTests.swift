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

    func testOnboardingOnlyAppearsForNewSignedInAccounts() {
        XCTAssertTrue(NotificationOnboardingPolicy.shouldPresent(
            isAuthenticated: true,
            isDemo: false,
            completed: false
        ))
        XCTAssertFalse(NotificationOnboardingPolicy.shouldPresent(
            isAuthenticated: false,
            isDemo: false,
            completed: false
        ))
        XCTAssertFalse(NotificationOnboardingPolicy.shouldPresent(
            isAuthenticated: true,
            isDemo: true,
            completed: false
        ))
        XCTAssertFalse(NotificationOnboardingPolicy.shouldPresent(
            isAuthenticated: true,
            isDemo: false,
            completed: true
        ))
    }

}
