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

    func testTheFootOpensTheSitesLandingAtItsOwnAddressBesideThePrivacyNoticeAndTheCode() {
        let configuration = AppConfiguration(mode: .demo, apiBaseURL: URL(string: "https://peektracker.com")!, supabaseURL: nil, supabasePublishableKey: "",
                                             googleAuthEnabled: false, appleAuthEnabled: false, emailOTPEnabled: true, appGroupIdentifier: "routing.test")
        // `/` shows someone signed in on the web their deliveries; the landing has an address of its own.
        XCTAssertEqual(configuration.homePageURL.absoluteString, "https://peektracker.com/home")
        XCTAssertEqual(configuration.privacyURL.absoluteString, "https://peektracker.com/privacy.html")
        XCTAssertEqual(AppConfiguration.sourceURL.scheme, "https")
        XCTAssertEqual(AppConfiguration.sourceURL.host(), "github.com")
    }

    func testInvitationLinksKeepTheTokenOutOfHTTPPathsAndQueries() {
        let code = String(repeating: "a", count: 32)
        let base = URL(string: "https://peektracker.com")!
        let url = FriendInvitationLink.url(code: code, baseURL: base)
        XCTAssertEqual(url.path, "/invite")
        XCTAssertEqual(url.query, "preview=3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547")
        XCTAssertFalse(url.query!.contains(code))
        XCTAssertEqual(FriendInvitationLink.code(from: base.absoluteString + "/invite#" + code, baseURL: base), code)
        XCTAssertEqual(url.fragment, code)
        XCTAssertEqual(FriendInvitationLink.code(from: url.absoluteString, baseURL: base), code)
        XCTAssertEqual(FriendInvitationLink.code(from: "swissdeliverytracker://invite#" + code), code)
        for text in ["https://evil.example/invite#" + code, "https://peektracker.com/invite?name=Paul#" + code,
                     "https://user@peektracker.com/invite#" + code, "https://peektracker.com/invite#short",
                     "http://peektracker.com/invite#" + code, "swissdeliverytracker://auth-callback#" + code] {
            XCTAssertNil(FriendInvitationLink.code(from: text, baseURL: base))
        }
    }

    func testShortInvitationLinksAndLegacyCompatibility() {
        let code = String(repeating: "a", count: 32)
        let preview = "Ab7kP2mQ9xR4tY6n"
        let base = URL(string: "https://peektracker.com")!
        let url = FriendInvitationLink.url(code: code, previewId: preview, baseURL: base)
        XCTAssertEqual(url.absoluteString, base.absoluteString + "/i/" + preview)
        XCTAssertNil(url.query)
        XCTAssertNil(url.fragment)
        XCTAssertEqual(FriendInvitationLink.code(from: url.absoluteString, baseURL: base), preview)
        XCTAssertEqual(FriendInvitationLink.code(from: url.absoluteString + "#" + code, baseURL: base), preview)
        XCTAssertEqual(FriendInvitationLink.code(from: url.absoluteString + "?fbclid=tracking#ignored", baseURL: base), preview)
        XCTAssertEqual(FriendInvitationLink.code(from: "swissdeliverytracker://invite#" + preview), preview)
        XCTAssertEqual(FriendInvitationLink.code(from: "swissdeliverytracker://invite#" + code), code)
        for invalid in [base.absoluteString + "/i/short#" + code,
                        base.absoluteString + "/i/" + preview + "/extra#" + code,
                        "https://evil.example/i/" + preview + "#" + code] {
            XCTAssertNil(FriendInvitationLink.code(from: invalid, baseURL: base))
        }
    }

    @MainActor
    func testPendingInvitationSurvivesAuthenticationButNotDismissalOrInvalidReplacement() async {
        let suite = "InvitationRoutingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = FriendInvitationStore(defaults: defaults)
        let shortKey = "Ab7kP2mQ9xR4tY6n" // gitleaks:allow -- synthetic invitation ID used only in tests
        store.open(URL(string: AppConfiguration.current.apiBaseURL.absoluteString + "/i/" + shortKey)!)
        store.opened = true
        XCTAssertEqual(store.code, shortKey)
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

    func testParcelLinksOpenFromTheAppsOwnHostAndScheme() {
        let base = URL(string: "https://peektracker.com")!
        let id = "k7Qm2xHd9RtW"
        for text in ["https://peektracker.com/p/" + id,
                     "https://PEEKTRACKER.com/p/" + id,
                     "https://peektracker.com/p/" + id + "?utm_source=chat",
                     "https://peektracker.com/p/" + id + "/",
                     "swissdeliverytracker://p/" + id,
                     "SwissDeliveryTracker://P/" + id] {
            XCTAssertEqual(ParcelLinkRoute(url: URL(string: text)!, baseURL: base), ParcelLinkRoute(id: id), text)
        }
        // Another deployment answers on its own origin only, port included.
        let local = URL(string: "http://localhost:3000")!
        XCTAssertEqual(ParcelLinkRoute(url: URL(string: "http://localhost:3000/p/" + id)!, baseURL: local)?.id, id)
        XCTAssertNil(ParcelLinkRoute(url: URL(string: "http://localhost:4000/p/" + id)!, baseURL: local))
        XCTAssertNil(ParcelLinkRoute(url: URL(string: "https://peektracker.com/p/" + id)!, baseURL: local, linkHosts: []))

        for text in ["https://evil.example/p/" + id,
                     "https://peektracker.com.evil.example/p/" + id,
                     "https://user@peektracker.com/p/" + id,
                     "http://peektracker.com/p/" + id,
                     "https://peektracker.com:8443/p/" + id,
                     "https://peektracker.com/p/" + id + "/extra",
                     "https://peektracker.com/P/" + id,
                     "https://peektracker.com/x/p/" + id,
                     "https://peektracker.com/p/" + id + "%0A",
                     "https://peektracker.com/p/" + String(id.dropLast()),
                     "https://peektracker.com/p/" + id + "2",
                     "https://peektracker.com/p/",
                     "https://peektracker.com/i/" + id,
                     "swissdeliverytracker://parcel/" + id,
                     "swissdeliverytracker://p/" + id + "/extra",
                     "swissdeliverytracker://p",
                     "swissdeliverytracker://user@p/" + id,
                     "otherapp://p/" + id] {
            XCTAssertNil(ParcelLinkRoute(url: URL(string: text)!, baseURL: base), text)
        }
        // Lookalike characters are not in the alphabet, so a mistyped link is never sent.
        for lookalike in ["0", "1", "I", "O", "l", "-", "_", "é"] {
            XCTAssertFalse(ParcelLinkRoute.validID(String(id.dropLast()) + lookalike), lookalike)
        }
        XCTAssertTrue(ParcelLinkRoute.validID("23456789ABCD"))
        XCTAssertTrue(ParcelLinkRoute.validID("HJKLMNPQRSTU"))
        XCTAssertTrue(ParcelLinkRoute.validID("VWXYZabcdefg"))
        XCTAssertTrue(ParcelLinkRoute.validID("hijkmnopqrst"))
        XCTAssertTrue(ParcelLinkRoute.validID("uvwxyz222222"))

        // A parcel link is not an invitation, and the other routes leave it alone.
        let link = URL(string: "swissdeliverytracker://p/" + id)!
        XCTAssertNil(NativeRoute(url: link))
        XCTAssertFalse(FriendInvitationLink.isInvitation(link, baseURL: base))
        XCTAssertFalse(FriendInvitationLink.isInvitation(URL(string: "https://peektracker.com/p/" + id)!, baseURL: base))
    }

    func testLinksFromAHostTheSiteLeftStillOpenAndNothingIsBuiltOnIt() {
        let base = URL(string: "https://peektracker.com")!
        let earlier = ["delivery.plhery.com"]
        let id = "k7Qm2xHd9RtW"
        let preview = "Ab7kP2mQ9xR4tY6n"
        let code = String(repeating: "a", count: 32)

        XCTAssertEqual(ParcelLinkRoute(url: URL(string: "https://delivery.plhery.com/p/" + id + "#n=Moon%20lamp")!, baseURL: base, linkHosts: earlier),
                       ParcelLinkRoute(id: id, name: "Moon lamp"))
        XCTAssertEqual(ParcelLinkRoute(url: URL(string: "https://DELIVERY.plhery.com/p/" + id + "?utm_source=chat")!, baseURL: base, linkHosts: earlier)?.id, id)
        XCTAssertEqual(FriendInvitationLink.code(from: "https://delivery.plhery.com/i/" + preview, baseURL: base, linkHosts: earlier), preview)
        XCTAssertEqual(FriendInvitationLink.code(from: "https://delivery.plhery.com/invite#" + code, baseURL: base, linkHosts: earlier), code)
        XCTAssertTrue(FriendInvitationLink.isInvitation(URL(string: "https://delivery.plhery.com/invite")!, baseURL: base, linkHosts: earlier))
        // The site's own host opens as before.
        XCTAssertEqual(ParcelLinkRoute(url: URL(string: "https://peektracker.com/p/" + id)!, baseURL: base, linkHosts: earlier)?.id, id)
        XCTAssertEqual(FriendInvitationLink.code(from: "https://peektracker.com/i/" + preview, baseURL: base, linkHosts: earlier), preview)

        // Only the hosts named in the configuration, over HTTPS on its own port.
        for text in ["http://delivery.plhery.com", "https://delivery.plhery.com:8443", "https://user@delivery.plhery.com",
                     "https://delivery.plhery.com.evil.example", "https://old.delivery.plhery.com", "https://evil.example"] {
            XCTAssertNil(ParcelLinkRoute(url: URL(string: text + "/p/" + id)!, baseURL: base, linkHosts: earlier), text)
            XCTAssertNil(FriendInvitationLink.code(from: text + "/i/" + preview, baseURL: base, linkHosts: earlier), text)
            XCTAssertFalse(SiteLink.belongs(URL(string: text + "/")!, baseURL: base, linkHosts: earlier), text)
        }
        XCTAssertNil(ParcelLinkRoute(url: URL(string: "https://delivery.plhery.com/p/" + id)!, baseURL: base, linkHosts: []))
        XCTAssertNil(FriendInvitationLink.code(from: "https://delivery.plhery.com/i/" + preview, baseURL: base, linkHosts: []))
        // The same paths and ids as on the site's own host, nothing more.
        XCTAssertNil(ParcelLinkRoute(url: URL(string: "https://delivery.plhery.com/p/" + id + "/extra")!, baseURL: base, linkHosts: earlier))
        XCTAssertNil(FriendInvitationLink.code(from: "https://delivery.plhery.com/i/short", baseURL: base, linkHosts: earlier))
        XCTAssertFalse(FriendInvitationLink.isInvitation(URL(string: "https://delivery.plhery.com/")!, baseURL: base, linkHosts: earlier))

        // A link the app shares is always on the site's own host.
        XCTAssertEqual(FriendInvitationLink.url(code: code, previewId: preview, baseURL: base).absoluteString, "https://peektracker.com/i/" + preview)
        XCTAssertEqual(FriendInvitationLink.url(code: code, baseURL: base).host, "peektracker.com")

        XCTAssertEqual(AppConfiguration.linkHosts(in: " Delivery.plhery.com,old.example.com  third.example.com "),
                       ["delivery.plhery.com", "old.example.com", "third.example.com"])
        XCTAssertEqual(AppConfiguration.linkHosts(in: ""), [])
        XCTAssertEqual(AppConfiguration.linkHosts(in: "https://delivery.plhery.com delivery.plhery.com:443 localhost user@old.example.com *.example.com -a.example.com"), [])
    }

    func testATappedWebLinkDeliveredTwiceOpensOnce() {
        let link = URL(string: "https://peektracker.com/p/k7Qm2xHd9RtW")!
        let other = URL(string: "https://peektracker.com/i/Ab7kP2mQ9xR4tY6n")!
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var deliveries = LinkDeliveries()
        XCTAssertFalse(deliveries.isRepeat(link, now: start))
        XCTAssertTrue(deliveries.isRepeat(link, now: start.addingTimeInterval(0.05)))
        // Another link, or the same one tapped again later, opens.
        XCTAssertFalse(deliveries.isRepeat(other, now: start.addingTimeInterval(0.1)))
        XCTAssertFalse(deliveries.isRepeat(link, now: start.addingTimeInterval(0.2)))
        XCTAssertFalse(deliveries.isRepeat(link, now: start.addingTimeInterval(2)))
    }

    func testAParcelLinkCarriesItsNameOnlyAfterTheHash() {
        let base = URL(string: "https://peektracker.com")!
        let id = "k7Qm2xHd9RtW"
        func name(_ fragment: String) -> String? {
            ParcelLinkRoute(url: URL(string: "https://peektracker.com/p/" + id + fragment)!, baseURL: base)?.name
        }
        XCTAssertEqual(name("#n=New%20sneakers"), "New sneakers")
        XCTAssertEqual(name("#n=Caf%C3%A9%20%E2%98%95"), "Café ☕")
        XCTAssertEqual(name("#x=1&n=Moon%20lamp"), "Moon lamp")
        XCTAssertEqual(name("#n=a+b%26c"), "a+b&c")
        XCTAssertEqual(name("?n=Query#n=Fragment"), "Fragment")
        XCTAssertEqual(ParcelLinkRoute(url: URL(string: "swissdeliverytracker://p/" + id + "#n=Kind%20of%20Blue")!, baseURL: base),
                       ParcelLinkRoute(id: id, name: "Kind of Blue"))
        for fragment in ["", "#", "#n=", "#n=%20%20", "#name=Lamp", "#Lamp", "?n=Query"] {
            XCTAssertNil(name(fragment), fragment)
        }
        // The link opens whatever follows the hash.
        XCTAssertEqual(ParcelLinkRoute(url: URL(string: "https://peektracker.com/p/" + id + "#anything")!, baseURL: base), ParcelLinkRoute(id: id))

        // The name is cleaned to what a parcel's name may hold: one line, 80 characters.
        XCTAssertEqual(ParcelLinkRoute.name(inFragment: "n=%20Line%0Aone%09two%20"), "Line one two")
        XCTAssertEqual(ParcelLinkRoute.name(inFragment: "n=" + String(repeating: "a", count: 100)), String(repeating: "a", count: 80))
        XCTAssertEqual(ParcelLinkRoute.name(inFragment: "n=" + String(repeating: "%F0%9F%93%A6", count: 50))?.utf16.count, 80)
        XCTAssertNil(ParcelLinkRoute.name(inFragment: "n=%ZZ"))
        XCTAssertNil(ParcelLinkRoute.name(inFragment: nil))
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

final class ShareInboxTests: XCTestCase {
    func testOnlySavedFreshDraftsAreConsumedOnce() {
        let defaults = UserDefaults(suiteName: "share-inbox-tests")!
        defer { defaults.removePersistentDomain(forName: "share-inbox-tests") }
        let now = Date()
        let draft = SharedParcelDraft(trackingInput: "12345678", createdAt: now)
        XCTAssertNil(ShareInbox.consume(defaults: defaults, now: now))
        XCTAssertTrue(ShareInbox.save(draft, defaults: defaults))
        XCTAssertEqual(ShareInbox.consume(defaults: defaults, now: now), draft)
        XCTAssertNil(ShareInbox.consume(defaults: defaults, now: now))
        ShareInbox.save(draft, defaults: defaults)
        XCTAssertNil(ShareInbox.consume(defaults: defaults, now: now.addingTimeInterval(601)))
        XCTAssertNil(defaults.data(forKey: "sdt.sharedParcelDraft"))
    }

    func testDiscardLegacyUnconfirmedAndMalformedDrafts() {
        let defaults = UserDefaults(suiteName: "share-inbox-legacy-tests")!
        defer { defaults.removePersistentDomain(forName: "share-inbox-legacy-tests") }
        for data in [Data("broken".utf8), Data("{\"id\":\"00000000-0000-4000-8000-000000000001\",\"label\":\"\",\"trackingInput\":\"12345678\"}".utf8)] {
            defaults.set(data, forKey: "sdt.sharedParcelDraft")
            XCTAssertNil(ShareInbox.consume(defaults: defaults))
            XCTAssertNil(defaults.data(forKey: "sdt.sharedParcelDraft"))
        }
    }
}
