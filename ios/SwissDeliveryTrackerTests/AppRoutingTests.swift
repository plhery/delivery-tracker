import XCTest
@testable import SwissDeliveryTracker

final class AppRoutingTests: XCTestCase {
    @MainActor
    func testLeavingDemoReturnsToTheUnopenedWelcome() {
        let preference = "sdt.native.experience.v1"
        let suite = "SessionRoutingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = SessionStore(defaults: defaults)
        session.enterDemo()
        session.showWelcome()

        guard case .welcome = session.state else { return XCTFail("Expected the unopened welcome") }
        XCTAssertNil(defaults.object(forKey: preference))
    }

    @MainActor
    func testSigningOutRestartsTheWelcomeForTheNextVisit() async throws {
        let preference = "sdt.native.experience.v1"
        let suite = "SessionRoutingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = SessionStore(defaults: defaults)
        session.showSignIn()
        try await session.signOut()

        guard case .welcome = session.state else { return XCTFail("Expected the unopened welcome") }
        XCTAssertNil(defaults.object(forKey: preference))
    }

    func testInvitationLinksKeepTheTokenOutOfHTTPPathsAndQueries() {
        let code = String(repeating: "a", count: 32)
        let base = URL(string: "https://delivery.plhery.com")!
        let url = FriendInvitationLink.url(code: code, baseURL: base)
        XCTAssertEqual(url.path, "/invite")
        XCTAssertNil(url.query)
        XCTAssertEqual(url.fragment, code)
        XCTAssertEqual(FriendInvitationLink.code(from: url.absoluteString, baseURL: base), code)
        XCTAssertEqual(FriendInvitationLink.code(from: "swissdeliverytracker://invite#" + code), code)
        for text in ["https://evil.example/invite#" + code, "https://delivery.plhery.com/invite?name=Paul#" + code,
                     "https://user@delivery.plhery.com/invite#" + code, "https://delivery.plhery.com/invite#short",
                     "http://delivery.plhery.com/invite#" + code, "swissdeliverytracker://auth-callback#" + code] {
            XCTAssertNil(FriendInvitationLink.code(from: text, baseURL: base))
        }
    }

    @MainActor
    func testPendingInvitationSurvivesAuthenticationButNotDismissalOrInvalidReplacement() async {
        let suite = "InvitationRoutingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = FriendInvitationStore(defaults: defaults)
        store.open(URL(string: "swissdeliverytracker://invite#" + String(repeating: "a", count: 32))!)
        store.opened = true
        let restored = FriendInvitationStore(defaults: defaults)
        XCTAssertTrue(restored.isPresenting)
        XCTAssertTrue(restored.opened)
        XCTAssertEqual(restored.code, store.code)
        XCTAssertNil(restored.nickname)
        restored.open(OAuthFlow.callbackURL)
        XCTAssertEqual(restored.code, store.code)
        restored.dismiss()
        XCTAssertFalse(FriendInvitationStore(defaults: defaults).isPresenting)
        store.open(URL(string: "swissdeliverytracker://invite#" + String(repeating: "b", count: 32))!)
        store.open(URL(string: "swissdeliverytracker://invite#invalid")!)
        store.clearPreview()
        await store.loadPreview()
        XCTAssertEqual(store.errorKey, "friends.inviteUnavailable")
        XCTAssertFalse(FriendInvitationStore(defaults: defaults).isPresenting)
    }

    @MainActor
    func testReceivedFriendshipCannotRestoreAConsumedInvitation() {
        let suite = "FriendshipReceiptTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = FriendInvitationStore(defaults: defaults)
        store.open(URL(string: "swissdeliverytracker://invite#" + String(repeating: "a", count: 32))!)
        store.opened = true
        let friend = FriendCard(id: UUID(), nickname: "Paul")
        store.receive(FriendsActionResponse(acceptedFriend: friend))
        XCTAssertTrue(store.isPresenting)
        XCTAssertEqual(store.receipt?.acceptedFriend?.id, friend.id)
        XCTAssertFalse(FriendInvitationStore(defaults: defaults).isPresenting)
        store.finish()
        XCTAssertEqual(store.completed, 1)
        XCTAssertNil(store.receipt)
    }

    func testFriendNotificationsAndLinksOpenOnlyValidProfileIdentifiers() {
        let friendID = UUID()
        XCTAssertEqual(NativeRoute(remoteNotification: ["kind": "friend_accepted", "friend_id": friendID.uuidString]), .friend(friendID))
        XCTAssertEqual(NativeRoute(url: URL(string: "swissdeliverytracker://friend/\(friendID.uuidString)")!), .friend(friendID))
        XCTAssertNil(NativeRoute(remoteNotification: ["kind": "friend_accepted", "friend_id": "invalid"]))
        XCTAssertNil(NativeRoute(remoteNotification: ["friend_id": friendID.uuidString]))
    }

    func testParsesParcelDeepLink() {
        let parcelID = UUID()
        let url = URL(string: "swissdeliverytracker://parcel/\(parcelID.uuidString)")!

        XCTAssertEqual(NativeRoute(url: url), .parcel(parcelID))
    }

    func testParsesAddDeepLinkAndDecodesTrackingInput() {
        let url = URL(string: "swissdeliverytracker://add?tracking=1Z999%20AA")!

        XCTAssertEqual(NativeRoute(url: url), .add(trackingInput: "1Z999 AA"))
    }

    func testRejectsMalformedOrUnrelatedDeepLinks() {
        XCTAssertNil(NativeRoute(url: URL(string: "https://parcel/not-ours")!))
        XCTAssertNil(NativeRoute(url: URL(string: "swissdeliverytracker://parcel/not-a-uuid")!))
        XCTAssertNil(NativeRoute(url: OAuthFlow.callbackURL))
    }

    func testParsesParcelNotificationPayload() {
        let parcelID = UUID()

        XCTAssertEqual(
            NativeRoute(remoteNotification: ["parcel_id": parcelID.uuidString]),
            .parcel(parcelID)
        )
        XCTAssertNil(NativeRoute(remoteNotification: ["parcel_id": "not-a-uuid"]))
        XCTAssertNil(NativeRoute(remoteNotification: ["other": parcelID.uuidString]))
    }

    func testGoogleAuthorizationURLReturnsToNativeAppWithPKCE() throws {
        let url = try XCTUnwrap(OAuthFlow.authorizationURL(
            baseURL: URL(string: "https://example.supabase.co")!,
            provider: "google",
            codeChallenge: "challenge-value"
        ))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) })

        XCTAssertEqual(components.path, "/auth/v1/authorize")
        XCTAssertEqual(query["provider"]!, "google")
        XCTAssertEqual(query["redirect_to"]!, OAuthFlow.callbackURL.absoluteString)
        XCTAssertEqual(query["code_challenge"]!, "challenge-value")
        XCTAssertEqual(query["code_challenge_method"]!, "s256")
    }

    func testOAuthCodeOnlyAcceptsTheExpectedNativeCallback() {
        XCTAssertEqual(
            OAuthFlow.authorizationCode(
                from: URL(string: "swissdeliverytracker://auth-callback?code=valid-code")!
            ),
            "valid-code"
        )
        XCTAssertNil(OAuthFlow.authorizationCode(
            from: URL(string: "swissdeliverytracker://other?code=valid-code")!
        ))
        XCTAssertNil(OAuthFlow.authorizationCode(
            from: URL(string: "https://auth-callback?code=valid-code")!
        ))
        XCTAssertNil(OAuthFlow.authorizationCode(
            from: URL(string: "swissdeliverytracker://auth-callback?code=")!
        ))
    }
}
