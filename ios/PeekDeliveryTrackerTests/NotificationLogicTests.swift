import SwiftUI
import UserNotifications
import XCTest
@testable import PeekDeliveryTracker

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

    func testSavingPresetKeepsTheEmailChoice() {
        for choice in [true, false, nil] as [Bool?] {
            let saved = preferences(email: choice)
            var draft = NotificationPreferencesDraft(preferences: saved)
            XCTAssertEqual(draft.preset, .important)
            draft.preset = .deliveryDay
            let next = draft.preferences(timezone: saved.timezone)
            XCTAssertEqual(next.enabledStages, NotificationPreset.deliveryDay.stages)
            XCTAssertEqual(next.emailOnDelivery, choice)
            // Whether the server can email the account is not the app's to send.
            XCTAssertNil(next.emailAvailable)
        }
        XCTAssertNil(NotificationPreferencesDraft().preferences(timezone: "Europe/Zurich").emailOnDelivery)
    }

    func testRequestsLeaveOutWhatTheyDoNotChange() throws {
        func object<T: Encodable>(_ value: T) throws -> [String: Any] {
            try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder.deliveryTracker.encode(value)) as? [String: Any])
        }
        let notifications = try object(PackageNotificationRequest(muted: true))
        XCTAssertEqual(Set(notifications.keys), ["muted"])
        XCTAssertEqual(notifications["muted"] as? Bool, true)
        let email = try object(PackageNotificationRequest(emailMuted: false))
        XCTAssertEqual(Set(email.keys), ["emailMuted"])
        XCTAssertEqual(email["emailMuted"] as? Bool, false)

        // An account that never chose sends no choice, as a released app does.
        let unchosen = try object(NotificationPreferencesDraft(preferences: preferences(email: nil)).preferences(timezone: "Europe/Zurich"))
        XCTAssertEqual(Set(unchosen.keys), ["enabledStages", "timezone"])
        let declined = try object(NotificationPreferencesDraft(preferences: preferences(email: false)).preferences(timezone: "Europe/Zurich"))
        XCTAssertEqual(Set(declined.keys), ["enabledStages", "timezone", "emailOnDelivery"])
        XCTAssertEqual(declined["emailOnDelivery"] as? Bool, false)
    }

    func testNothingAboutEmailShowsInTheDemoOrUntilTheServerCanWriteToTheAccount() {
        let address = "alex@example.com"
        let email = DeliveryEmail(isDemo: false, preferences: preferences(email: true), address: " \(address)\n")
        XCTAssertEqual(email?.address, address)
        XCTAssertEqual(email?.isOn, true)
        XCTAssertNil(DeliveryEmail(isDemo: true, preferences: preferences(email: true), address: address))
        XCTAssertNil(DeliveryEmail(isDemo: false, preferences: nil, address: address))
        XCTAssertNil(DeliveryEmail(isDemo: false, preferences: preferences(email: true, available: false), address: address))
        // A server from before the email says nothing about it.
        XCTAssertNil(DeliveryEmail(isDemo: false, preferences: preferences(email: nil, available: nil), address: address))
        XCTAssertNil(DeliveryEmail(isDemo: false, preferences: preferences(email: true), address: nil))
        XCTAssertNil(DeliveryEmail(isDemo: false, preferences: preferences(email: true), address: "  "))
    }

    func testBellOpensAlertsOnlyWhileTheEmailIsOnAndTheParcelIsOnItsWay() throws {
        let on = try email(true), off = try email(false), unchosen = try email(nil)
        for stage in TrackingStage.allCases {
            let parcel = parcel(stage)
            XCTAssertEqual(on.bellOpensAlerts(for: parcel), stage != .delivered && stage != .returned, stage.rawValue)
            XCTAssertFalse(off.bellOpensAlerts(for: parcel), stage.rawValue)
            XCTAssertFalse(unchosen.bellOpensAlerts(for: parcel), stage.rawValue)
        }
        // A parcel no carrier has announced yet is still on its way.
        XCTAssertTrue(on.bellOpensAlerts(for: parcel(nil)))
    }

    func testEmailIsOfferedOnlyOnADeliveredParcelWhileTheAccountHasNeverChosen() throws {
        let on = try email(true), off = try email(false), unchosen = try email(nil)
        for stage in TrackingStage.allCases {
            let parcel = parcel(stage)
            XCTAssertEqual(unchosen.isOffered(on: parcel), stage == .delivered, stage.rawValue)
            XCTAssertFalse(on.isOffered(on: parcel), stage.rawValue)
            XCTAssertFalse(off.isOffered(on: parcel), stage.rawValue)
        }
        XCTAssertFalse(unchosen.isOffered(on: parcel(nil)))
    }

    func testBellOfAParcelWithAlertsIsStruckThroughOnlyWhenBothAreOff() {
        var parcel = parcel(.inTransit)
        XCTAssertFalse(parcel.allAlertsMuted)
        parcel.notificationsMuted = true
        // No email mute from the server or a saved list counts as not muted.
        XCTAssertNil(parcel.emailMuted)
        XCTAssertFalse(parcel.allAlertsMuted)
        parcel.emailMuted = false
        XCTAssertFalse(parcel.allAlertsMuted)
        parcel.emailMuted = true
        XCTAssertTrue(parcel.allAlertsMuted)
        parcel.notificationsMuted = false
        XCTAssertFalse(parcel.allAlertsMuted)
    }

    func testExampleEmailOpensOnTheSiteInTheAppLanguage() throws {
        let site = try XCTUnwrap(URL(string: "https://peek.example"))
        XCTAssertEqual(DeliveryEmail.exampleURL(site: site, language: .de)?.absoluteString, "https://peek.example/email/example?lang=de")
        XCTAssertEqual(DeliveryEmail.exampleURL(site: try XCTUnwrap(URL(string: "http://localhost:3000/")), language: .en)?.absoluteString,
                       "http://localhost:3000/email/example?lang=en")
        // The in-app browser opens web addresses only.
        for other in ["peek.example", "file:///private/example", "swissdeliverytracker://p/example"] {
            XCTAssertNil(DeliveryEmail.exampleURL(site: try XCTUnwrap(URL(string: other)), language: .en), other)
        }
    }

    func testParcelsSavedBeforeTheEmailKeepDecoding() throws {
        var parcel = parcel(.inTransit)
        let saved = try JSONEncoder.deliveryTracker.encode([parcel])
        XCTAssertFalse(String(decoding: saved, as: UTF8.self).contains("emailMuted"))
        let restored = try XCTUnwrap(JSONDecoder.deliveryTracker.decode([Parcel].self, from: saved).first)
        XCTAssertNil(restored.emailMuted)
        XCTAssertFalse(restored.isEmailMuted)
        XCTAssertEqual(restored, parcel)

        parcel.emailMuted = true
        let muted = try JSONDecoder.deliveryTracker.decode([Parcel].self, from: JSONEncoder.deliveryTracker.encode([parcel]))
        XCTAssertEqual(muted.first?.emailMuted, true)

        let row = """
        {"id":"\(parcel.id.uuidString)","tracking_number":"1Z999AA10123456784","label":"Test parcel","carrier":"ups",
         "created_at":"2026-08-01T10:00:00Z","sync_status":"ok","notifications_muted":false,"email_muted":true}
        """
        XCTAssertTrue(try JSONDecoder.deliveryTracker.decode(Parcel.self, from: Data(row.utf8)).isEmailMuted)
    }

    func testDemoParcelsKeepDecodingWithAnEmailMute() throws {
        let suite = "demo-email-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let repo = DemoRepository(defaults: defaults, language: { .en })
        let parcels = repo.list()
        XCTAssertTrue(parcels.allSatisfy { $0.emailMuted == nil })
        let first = try XCTUnwrap(parcels.first)
        XCTAssertEqual(try repo.setEmailMuted(id: first.id, muted: true).emailMuted, true)
        let reopened = DemoRepository(defaults: defaults, language: { .en }).list()
        XCTAssertEqual(reopened.count, parcels.count)
        XCTAssertEqual(reopened.first { $0.id == first.id }?.emailMuted, true)
        // The demo's preferences say nothing about email, so nothing about it shows there.
        XCTAssertNil(repo.notificationPreferences.emailAvailable)
        XCTAssertNil(repo.notificationPreferences.emailOnDelivery)
    }

    @MainActor func testEmailSettingsFitNarrowScreensInEveryLanguageAndLargeType() throws {
        // At large type the group also says a save failed: the tallest it gets.
        try renderInEveryLanguage(named: "email-settings", width: 327, maximumHeight: (270, 1_060)) { largeType in
            DeliveryEmailSettings(
                address: "alex@example.com", isOn: .constant(true), failed: largeType,
                privacy: URL(string: "https://peek.example/privacy.html")!, showExample: {}
            )
        }
    }

    @MainActor func testParcelAlertsFitNarrowScreensInEveryLanguageAndLargeType() throws {
        let parcel = parcel(.outForDelivery, label: "New sneakers")
        let email = try email(true)
        try renderInEveryLanguage(named: "parcel-alerts", width: 375, padding: 0, maximumHeight: (440, 1_200)) { _ in
            ParcelAlertSwitches(parcel: parcel, email: email, preset: .important) { _, _ in }
        }
    }

    @MainActor func testEmailOfferFitsNarrowScreensInEveryLanguageAndLargeType() throws {
        for (phase, name) in [(DeliveryEmailOffer.Phase.open, "open"), (.saving(true), "saving"), (.failed, "failed"), (.accepted, "accepted")] {
            try renderInEveryLanguage(named: "email-offer-\(name)", width: 307, maximumHeight: (330, 820)) { _ in
                DeliveryEmailOffer(address: "alex@example.com", phase: phase, turnOn: {}, notNow: {})
            }
        }
    }

    /// Renders a view at a phone's content width in every language, at regular type in
    /// light and at large type in dark, and keeps each picture with the test's results.
    @MainActor private func renderInEveryLanguage<Content: View>(
        named name: String,
        width: CGFloat,
        padding: CGFloat = 16,
        maximumHeight: (regular: CGFloat, large: CGFloat),
        @ViewBuilder content: (_ largeType: Bool) -> Content
    ) throws {
        let localizer = Localizer()
        let previousLanguage = localizer.language
        defer { localizer.language = previousLanguage }
        for language in AppLanguage.allCases {
            localizer.language = language
            for largeType in [false, true] {
                let view = content(largeType)
                    .frame(width: width)
                    .padding(padding)
                    .background(Brand.background)
                    .environmentObject(localizer)
                    .environment(\.dynamicTypeSize, largeType ? .accessibility3 : .large)
                    .environment(\.colorScheme, largeType ? .dark : .light)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                let image = try XCTUnwrap(renderer.uiImage)
                XCTAssertEqual(image.size.width, width + 2 * padding, accuracy: 1, "\(name) \(language.rawValue)")
                XCTAssertLessThan(image.size.height, largeType ? maximumHeight.large : maximumHeight.regular,
                                  "\(name) \(language.rawValue) \(largeType ? "large" : "regular")")
                let attachment = XCTAttachment(image: image)
                attachment.name = "\(name)-\(language.rawValue)-\(largeType ? "large-dark" : "regular-light")"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    private func preferences(email: Bool?, available: Bool? = true) -> NotificationPreferences {
        NotificationPreferences(
            enabledStages: NotificationPreset.important.stages, timezone: "Europe/Zurich",
            emailOnDelivery: email, emailAvailable: available
        )
    }

    private func email(_ choice: Bool?) throws -> DeliveryEmail {
        try XCTUnwrap(DeliveryEmail(isDemo: false, preferences: preferences(email: choice), address: "alex@example.com"))
    }

    /// A made-up parcel whose latest scan is at the given stage, or with no scan at all.
    private func parcel(_ stage: TrackingStage?, label: String = "Test parcel") -> Parcel {
        let id = UUID()
        let events = stage.map { [TrackingEvent(id: UUID(), packageID: id, stage: $0, description: "Update", occurredAt: "2026-09-06T10:00:00Z")] } ?? []
        return Parcel(
            id: id, trackingNumber: "1Z999AA10123456784", label: label, carrier: .ups,
            createdAt: "2026-08-01T10:00:00Z", syncStatus: .ok, notificationsMuted: false, trackingEvents: events
        )
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
