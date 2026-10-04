import XCTest
@testable import PeekDeliveryTracker

final class ParcelLinkTests: XCTestCase {
    private let linkID = "k7Qm2xHd9RtW"

    private struct Fixture: Decodable {
        let publicParcel: PublicParcelResponse
        let publicLookup: PublicLookupResponse
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "ContractFixtures", withExtension: "json"))
        return try JSONDecoder.deliveryTracker.decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func defaults() -> (UserDefaults, String) {
        let suite = "ParcelLinkTests.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suite)!, suite)
    }

    // MARK: - Contract

    func testDecodesThePublicParcelFixtures() throws {
        let fixture = try fixture()

        let viewed = fixture.publicParcel
        XCTAssertEqual(viewed.link.id, linkID)
        XCTAssertEqual(viewed.link.role, .viewer)
        XCTAssertEqual(viewed.link.kind, .lookup)
        XCTAssertFalse(viewed.link.numberShown)
        XCTAssertFalse(viewed.link.canKeep)
        XCTAssertNotNil(viewed.link.forgetAt)
        XCTAssertNil(viewed.package.trackingNumber)
        XCTAssertEqual(viewed.package.numberHint, ParcelNumberHint(head: "", tail: "3456"))
        XCTAssertEqual(viewed.package.carrier, .dpd)
        XCTAssertEqual(viewed.package.carrierData.senderName, "Example Shop")
        XCTAssertEqual(viewed.package.carrierData.weightKg, 1.2)
        XCTAssertEqual(viewed.package.trackingEvents.first?.stage, .inTransit)

        let looked = fixture.publicLookup
        XCTAssertEqual(looked.link.role, .owner)
        XCTAssertTrue(looked.link.numberShown)
        XCTAssertTrue(looked.link.canKeep)
        XCTAssertEqual(looked.key.count, 43)
        XCTAssertEqual(looked.package.trackingNumber, "TESTPARCEL123456")
        XCTAssertNil(looked.package.numberHint)
        XCTAssertEqual(looked.package.carrierData, PublicPackageCarrierData())
    }

    func testClaimRequestSendsOnlyTheLinkAndItsSuggestedName() throws {
        let named = try JSONEncoder.deliveryTracker.encode(ClaimParcelsRequest(links: [ClaimParcelLink(id: linkID, label: "Moon lamp")]))
        XCTAssertEqual(String(decoding: named, as: UTF8.self), #"{"links":[{"id":"k7Qm2xHd9RtW","label":"Moon lamp"}]}"#)
        let plain = try JSONEncoder.deliveryTracker.encode(ClaimParcelsRequest(links: [ClaimParcelLink(id: linkID)]))
        XCTAssertEqual(String(decoding: plain, as: UTF8.self), #"{"links":[{"id":"k7Qm2xHd9RtW"}]}"#)
    }

    // MARK: - The app's parcel

    func testAHiddenNumberStaysHiddenOnTheAppsParcel() throws {
        let package = try fixture().publicParcel.package
        let parcel = Parcel(shared: package)

        XCTAssertEqual(parcel.id, package.id)
        XCTAssertEqual(parcel.trackingNumber, "")
        XCTAssertEqual(package.numberHint?.masked, "••• 3456")
        XCTAssertEqual(parcel.label, "")
        XCTAssertEqual(parcel.carrier, .dpd)
        XCTAssertEqual(parcel.expectedDelivery, "2026-10-03")
        XCTAssertEqual(parcel.lastSyncedAt, "2026-10-02T08:05:00+00:00")
        XCTAssertEqual(parcel.syncStatus, .ok)
        XCTAssertNil(parcel.trackingURL)
        XCTAssertNil(parcel.dpdPostcode)
        XCTAssertFalse(parcel.isArchived)
        XCTAssertFalse(parcel.notificationsMuted)
        XCTAssertEqual(parcel.carrierData?.senderName, "Example Shop")
        XCTAssertEqual(parcel.carrierData?.weightKg, 1.2)
        XCTAssertEqual(parcel.carrierData?.destinationCountry, "CH")
        XCTAssertEqual(parcel.trackingEvents, package.trackingEvents)
        XCTAssertEqual(parcel.currentStage, .inTransit)
        XCTAssertEqual(parcel.displayStatus.key, "stage.in_transit")
    }

    func testAShownNumberIsTheAppsParcelNumber() throws {
        let parcel = Parcel(shared: try fixture().publicLookup.package)

        XCTAssertEqual(parcel.trackingNumber, "TESTPARCEL123456")
        XCTAssertEqual(parcel.trackingNumbers.map(\.number), ["TESTPARCEL123456"])
        XCTAssertEqual(parcel.currentStage, .pending)
        XCTAssertTrue(parcel.displayStatus.syncing)
    }

    func testPlacesAndTheSharedCarrierDataReachTheAppsParcel() throws {
        let json = """
        {
          "id": "43000000-0000-0000-0000-000000000005",
          "tracking_number": "TESTPARCEL654321",
          "number_hint": null,
          "label": "",
          "carrier": "asendia",
          "created_at": "2026-10-01T08:00:00+00:00",
          "expected_delivery": "2026-10-04",
          "last_status_text": "Out for delivery",
          "last_synced_at": "2026-10-02T08:05:00+00:00",
          "sync_status": "ok",
          "sync_error": null,
          "tracking_url": null,
          "dpd_postcode": null,
          "carrier_data": {
            "active_tracking_carrier": "swiss-post",
            "active_tracking_number": "990000000000000001",
            "original_carrier": "asendia",
            "original_tracking_number": "TESTPARCEL654321",
            "tracking_provider": "ParcelsApp",
            "carrier_answered": true,
            "auto_changed_from": "unknown",
            "auto_changed_to": "asendia",
            "auto_changed_at": "2026-10-01T09:00:00+00:00",
            "sender_name": "Example Shop",
            "swiss_post_ready": true,
            "expected_delivery_from": "2026-10-03",
            "pickup_point": "Example Kiosk\\nBahnhofstrasse 1, 8000 Zürich",
            "dimensions_text": "30 × 20 × 10 cm",
            "weight_kg": 0.8,
            "destination_country": "CH",
            "receiver_name": "Never shared",
            "routing": { "input_needed": { "carrier": "dpd", "field": "dpdPostcode" } }
          },
          "archived_at": null,
          "notifications_muted": false,
          "tracking_events": [{
            "id": "44000000-0000-0000-0000-000000000005",
            "package_id": "43000000-0000-0000-0000-000000000005",
            "stage": "out_for_delivery",
            "description": "Out for delivery",
            "location": "Zürich, CH",
            "occurred_at": "2026-10-02T08:05:00+00:00",
            "place": { "latitude": 47.37, "longitude": 8.54, "precision": "city", "country": "CH", "name": "Zürich" }
          }]
        }
        """
        let package = try JSONDecoder.deliveryTracker.decode(PublicPackage.self, from: Data(json.utf8))
        let parcel = Parcel(shared: package)
        let data = try XCTUnwrap(parcel.carrierData)

        XCTAssertEqual(parcel.trackingEvents.first?.place, EventPlace(latitude: 47.37, longitude: 8.54, precision: .city, country: "CH", name: "Zürich"))
        XCTAssertEqual(parcel.currentStage, .outForDelivery)
        XCTAssertEqual(parcel.activeTrackingCarrier, .swissPost)
        XCTAssertEqual(parcel.displayedCarrier, CarrierID(rawValue: "asendia"))
        XCTAssertEqual(parcel.trackingNumbers.map(\.number), ["990000000000000001", "TESTPARCEL654321"])
        XCTAssertEqual(data.trackingProvider, "ParcelsApp")
        XCTAssertEqual(data.carrierAnswered, true)
        XCTAssertEqual(data.autoChangedFrom, .unknown)
        XCTAssertEqual(data.autoChangedTo, CarrierID(rawValue: "asendia"))
        XCTAssertEqual(data.autoChangedAt, "2026-10-01T09:00:00+00:00")
        XCTAssertEqual(data.senderName, "Example Shop")
        XCTAssertEqual(data.swissPostReady, true)
        XCTAssertEqual(data.expectedDeliveryFrom, "2026-10-03")
        XCTAssertEqual(PickupPoint(data.pickupPoint)?.name, "Example Kiosk")
        XCTAssertEqual(data.dimensionsText, "30 × 20 × 10 cm")
        XCTAssertEqual(data.weightKg, 0.8)
        XCTAssertEqual(data.destinationCountry, "CH")
        // Whatever else a response carried, the parcel shows only what a link shares.
        XCTAssertNil(data.receiverName)
        XCTAssertNil(data.routing)
        XCTAssertNil(data.originalPackageID)
        XCTAssertNil(data.originalTrackingURL)
        XCTAssertNil(data.dpdPostcodeVerified)
        XCTAssertNil(parcel.inputNeededPrompt)
    }

    // MARK: - Keeping

    func testClaimOutcomesNameWhatTheSheetDoesNext() throws {
        let kept = UUID()
        let json = """
        {"results":[
          {"id":"\(linkID)","outcome":"kept","packageId":"\(kept.uuidString)"},
          {"id":"22222222222A","outcome":"already","packageId":"\(kept.uuidString)"},
          {"id":"22222222222B","outcome":"quota"},
          {"id":"22222222222C","outcome":"unavailable"}
        ]}
        """
        let response = try JSONDecoder.deliveryTracker.decode(ClaimParcelsResponse.self, from: Data(json.utf8))

        XCTAssertEqual(ParcelLinkClaim(response: response, linkID: linkID), .added(kept))
        XCTAssertEqual(ParcelLinkClaim(response: response, linkID: "22222222222A"), .already(kept))
        XCTAssertEqual(ParcelLinkClaim(response: response, linkID: "22222222222B"), .full)
        XCTAssertEqual(ParcelLinkClaim(response: response, linkID: "22222222222C"), .unavailable)
        XCTAssertNil(ParcelLinkClaim(response: response, linkID: "22222222222D"))
        XCTAssertNil(ParcelLinkClaim(response: ClaimParcelsResponse(results: []), linkID: linkID))
    }

    @MainActor func testAnAddedParcelClosesTheSheetAndReachesTheListOnceItHasGone() throws {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ParcelLinkStore(defaults: defaults, read: { _ in nil })
        let kept = UUID()
        store.open(ParcelLinkRoute(id: linkID, name: "Moon lamp"))

        store.resolve(.added(kept))
        XCTAssertNil(store.route)
        XCTAssertNil(store.arrival, "The list waits for the sheet to leave the screen")
        store.dismissed()
        XCTAssertEqual(store.arrival, .added(kept))
        store.consumeArrival()
        XCTAssertNil(store.arrival)
        store.dismissed()
        XCTAssertNil(store.arrival, "An arrival is announced once")
    }

    @MainActor func testOtherOutcomesStayOnTheSheet() async throws {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let shown = try fixture().publicParcel
        let store = ParcelLinkStore(defaults: defaults, read: { _ in shown })
        let existing = UUID()
        store.open(ParcelLinkRoute(id: linkID))
        await store.load()
        XCTAssertEqual(store.phase, .shown(shown))

        store.resolve(.full)
        XCTAssertEqual(store.claim, .full)
        XCTAssertNotNil(store.route)

        store.resolve(.already(existing))
        XCTAssertEqual(store.claim, .already(existing))
        XCTAssertNotNil(store.route)
        store.openExisting(existing)
        XCTAssertNil(store.route)
        store.dismissed()
        XCTAssertEqual(store.arrival, .open(existing))
        store.consumeArrival()

        store.open(ParcelLinkRoute(id: linkID))
        XCTAssertNil(store.claim, "A link opened again starts afresh")
        store.resolve(.unavailable)
        XCTAssertEqual(store.phase, .unavailable)
        XCTAssertNotNil(store.route)
        store.close()
        store.dismissed()
        XCTAssertNil(store.arrival)
    }

    // MARK: - Reading

    @MainActor func testReadingALinkShowsItOrSaysWhyNot() async throws {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let shown = try fixture().publicParcel
        var answer: Result<PublicParcelResponse?, Error> = .success(shown)
        var asked: [String] = []
        let store = ParcelLinkStore(defaults: defaults, read: { id in asked.append(id); return try answer.get() })

        await store.load()
        XCTAssertTrue(asked.isEmpty, "Nothing is read until a link opens")

        store.open(ParcelLinkRoute(id: linkID, name: "Moon lamp"))
        XCTAssertEqual(store.phase, .loading)
        await store.load()
        XCTAssertEqual(store.phase, .shown(shown))
        XCTAssertEqual(asked, [linkID], "Only the id is sent, never the name")

        // A failed refresh keeps the parcel on screen.
        answer = .failure(URLError(.notConnectedToInternet))
        await store.load()
        XCTAssertEqual(store.phase, .shown(shown))
        XCTAssertEqual(store.refreshFailure, .offline)
        answer = .success(shown)
        await store.load()
        XCTAssertNil(store.refreshFailure)

        // A link that stops leading anywhere replaces it.
        answer = .success(nil)
        await store.load()
        XCTAssertEqual(store.phase, .unavailable)

        for (error, failure) in [
            (URLError(.timedOut) as Error, ParcelLinkFailure.offline),
            (DeliveryAPIError.rateLimited(30), .rateLimited),
            (DeliveryAPIError.serviceFailed(502), .service),
            (DeliveryAPIError.invalidResponse, .service),
        ] {
            store.open(ParcelLinkRoute(id: linkID))
            answer = .failure(error)
            await store.load()
            XCTAssertEqual(store.phase, .failed(failure))
        }
        XCTAssertEqual(ParcelLinkFailure.offline.messageKey, "error.connection")
        XCTAssertEqual(ParcelLinkFailure.rateLimited.messageKey, "error.rateLimited")
        XCTAssertNil(ParcelLinkFailure(CancellationError()))
        XCTAssertNil(ParcelLinkFailure(URLError(.cancelled)))
    }

    @MainActor func testABuildWithoutAServerNeverReadsALink() async {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let demo = AppConfiguration(mode: .demo, apiBaseURL: URL(string: "https://links.test")!, supabaseURL: nil, supabasePublishableKey: "",
                                    googleAuthEnabled: false, appleAuthEnabled: false, emailOTPEnabled: true, appGroupIdentifier: "links.test")
        let store = ParcelLinkStore(defaults: defaults, configuration: demo)
        store.open(ParcelLinkRoute(id: linkID))
        await store.load()
        // A request to this host would fail, and read as trouble rather than as a link that leads nowhere.
        XCTAssertEqual(store.phase, .unavailable)
    }

    @MainActor func testTheLinkIsReadWithoutSignInCookiesOrAnOwnerKey() async throws {
        let transport = LinkTestURLProtocol.transport()
        defer { transport.invalidateAndCancel() }
        let configuration = LinkTestURLProtocol.configuration
        let body = try JSONEncoder.deliveryTracker.encode(try fixture().publicParcel)
        nonisolated(unsafe) var requests: [URLRequest] = []
        nonisolated(unsafe) var answer: (Int, [String: String], Data) = (200, [:], body)
        LinkTestURLProtocol.handler = { request in requests.append(request); return answer }

        let shown = try await DeliveryAPIClient.publicParcel(linkID: linkID, configuration: configuration, transport: transport)
        XCTAssertEqual(shown?.link.id, linkID)
        XCTAssertEqual(shown?.package.numberHint?.masked, "••• 3456")
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://links.test/api/public/parcels/\(linkID)")
        XCTAssertFalse(request.httpShouldHandleCookies)
        for header in ["Authorization", "Cookie", "X-Parcel-Key"] {
            XCTAssertNil(request.value(forHTTPHeaderField: header), header)
        }

        answer = (404, [:], Data(#"{"error":"Parcel unavailable"}"#.utf8))
        let gone = try await DeliveryAPIClient.publicParcel(linkID: linkID, configuration: configuration, transport: transport)
        XCTAssertNil(gone)

        answer = (429, ["Retry-After": "12"], Data(#"{"error":"Too many requests. Try again shortly."}"#.utf8))
        do {
            _ = try await DeliveryAPIClient.publicParcel(linkID: linkID, configuration: configuration, transport: transport)
            XCTFail("Expected a rate limit")
        } catch DeliveryAPIError.rateLimited(let seconds) {
            XCTAssertEqual(seconds, 12)
        }

        for (status, data) in [(503, Data()), (200, Data("{}".utf8))] {
            answer = (status, [:], data)
            do {
                _ = try await DeliveryAPIClient.publicParcel(linkID: linkID, configuration: configuration, transport: transport)
                XCTFail("Expected a failure")
            } catch {
                XCTAssertEqual(ParcelLinkFailure(error), .service)
            }
        }
    }

    @MainActor func testKeepingSendsTheSuggestedNameUnderTheAccountAndReloadsTheList() async throws {
        let transport = LinkTestURLProtocol.transport()
        defer { transport.invalidateAndCancel() }
        let configuration = LinkTestURLProtocol.configuration
        let user = AuthUser(id: UUID(), email: "test@example.com", isAnonymous: false)
        let signedIn = try JSONEncoder.deliveryTracker.encode(AuthSession(
            accessToken: "access", tokenType: "bearer", expiresIn: 3600,
            expiresAt: Int(Date().timeIntervalSince1970) + 3600, refreshToken: "refresh", user: user
        ))
        let kept = Parcel(id: UUID(), trackingNumber: "TESTPARCEL123456", label: "Moon lamp", carrier: .dpd,
                          createdAt: "2026-10-02T08:00:00Z", syncStatus: .pending, notificationsMuted: false)
        let list = try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [kept]))
        nonisolated(unsafe) var claims: [(authorization: String?, body: String)] = []
        nonisolated(unsafe) var outcome = "kept"
        LinkTestURLProtocol.handler = { request in
            switch request.url?.path {
            case "/auth/v1/verify": return (200, [:], signedIn)
            case "/api/packages/claim":
                claims.append((request.value(forHTTPHeaderField: "Authorization"), String(decoding: LinkTestURLProtocol.body(of: request), as: UTF8.self)))
                let id = outcome == "quota" ? "" : #","packageId":"\#(kept.id.uuidString)""#
                return (200, [:], Data(#"{"results":[{"id":"k7Qm2xHd9RtW","outcome":"\#(outcome)"\#(id)}]}"#.utf8))
            case "/api/packages": return (200, [:], list)
            default: return (404, [:], Data())
            }
        }
        let session = SessionStore(configuration: configuration, persistence: LinkTestSessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        let store = ParcelStore(configuration: configuration, session: session, localizer: Localizer(), transport: transport)
        store.setDeliveryWidgetEnabled(false)
        store.setDeliveryLiveActivitiesEnabled(false)

        do {
            _ = try await store.keep(ParcelLinkRoute(id: linkID))
            XCTFail("Keeping needs an account")
        } catch {
            XCTAssertTrue(claims.isEmpty)
        }

        try await session.verifyCode(email: "test@example.com", code: "123456")
        let claim = try await store.keep(ParcelLinkRoute(id: linkID, name: "Moon lamp"))
        XCTAssertEqual(claim, .added(kept.id))
        XCTAssertEqual(claims.last?.authorization, "Bearer access")
        XCTAssertEqual(claims.last?.body, #"{"links":[{"id":"k7Qm2xHd9RtW","label":"Moon lamp"}]}"#)
        XCTAssertEqual(store.parcels.map(\.id), [kept.id], "The kept parcel is on the list before the sheet closes")

        outcome = "quota"
        let full = try await store.keep(ParcelLinkRoute(id: linkID))
        XCTAssertEqual(full, .full)
        XCTAssertEqual(claims.last?.body, #"{"links":[{"id":"k7Qm2xHd9RtW"}]}"#)
    }

    // MARK: - Across sign-in

    @MainActor func testALinkOpenedBeforeSigningInComesBackOnceForSevenDays() {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        var now = Date(timeIntervalSince1970: 1_790_000_000)
        let link = ParcelLinkRoute(id: linkID, name: "Moon lamp")
        let store = ParcelLinkStore(defaults: defaults, now: { now }, read: { _ in nil })

        store.open(link)
        store.resume()
        XCTAssertNil(store.remembered, "Looking at a link does not remember it")

        store.rememberForSignIn()
        XCTAssertNil(store.route, "The sheet makes way for sign-in")

        // The app may be relaunched by the sign-in round trip.
        now += 6 * 86_400
        let relaunched = ParcelLinkStore(defaults: defaults, now: { now }, read: { _ in nil })
        XCTAssertNil(relaunched.route, "Nothing reopens until someone is signed in")
        relaunched.resume()
        XCTAssertEqual(relaunched.route, link)
        XCTAssertEqual(relaunched.phase, .loading)

        // Added: the link is settled.
        relaunched.resolve(.added(UUID()))
        XCTAssertNil(relaunched.remembered)
        relaunched.resume()
        XCTAssertNil(relaunched.route)
    }

    @MainActor func testARememberedLinkExpiresAndIsDroppedOnceSettled() {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        var now = Date(timeIntervalSince1970: 1_790_000_000)
        let link = ParcelLinkRoute(id: linkID)
        let other = ParcelLinkRoute(id: "22222222222A")
        let store = ParcelLinkStore(defaults: defaults, now: { now }, read: { _ in nil })
        func remember() {
            store.open(link)
            store.rememberForSignIn()
            XCTAssertEqual(store.remembered, link)
        }

        remember()
        now += 7 * 86_400
        XCTAssertNil(store.remembered, "Seven days on, the link is forgotten")
        store.resume()
        XCTAssertNil(store.route)
        XCTAssertNil(defaults.object(forKey: "sdt.pendingParcelLink.v1"))

        // A clock set back does not keep a link alive.
        remember()
        now -= 60
        XCTAssertNil(store.remembered)
        now += 60

        // Closing another link leaves the remembered one alone; closing it forgets it.
        remember()
        store.open(other)
        store.close()
        XCTAssertEqual(store.remembered, link)
        store.resume()
        XCTAssertEqual(store.route, link)
        store.close()
        XCTAssertNil(store.remembered)

        // So does an answer that settles it.
        for claim in [ParcelLinkClaim.already(UUID()), .unavailable] {
            remember()
            store.resume()
            store.resolve(claim)
            XCTAssertNil(store.remembered)
            store.close()
        }
        // No room yet: the link stays for another try.
        remember()
        store.resume()
        store.resolve(.full)
        XCTAssertEqual(store.remembered, link)

        // Only a well-formed link is ever restored.
        defaults.set(Data(#"{"id":"not-a-link","receivedAt":0}"#.utf8), forKey: "sdt.pendingParcelLink.v1")
        XCTAssertNil(store.remembered)
        XCTAssertNil(defaults.object(forKey: "sdt.pendingParcelLink.v1"))
    }
}

private final class LinkTestSessionPersistence: SessionPersistence {
    var data: Data?
    func save<T: Encodable>(_ value: T) throws { data = try JSONEncoder.deliveryTracker.encode(value) }
    func load<T: Decodable>() -> T? { data.flatMap { try? JSONDecoder.deliveryTracker.decode(T.self, from: $0) } }
    func delete() { data = nil }
}

private final class LinkTestURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, [String: String], Data))?

    @MainActor static var configuration: AppConfiguration {
        AppConfiguration(mode: .api, apiBaseURL: URL(string: "https://links.test")!, supabaseURL: URL(string: "https://links.test")!,
                         supabasePublishableKey: "public", googleAuthEnabled: false, appleAuthEnabled: false, emailOTPEnabled: true,
                         appGroupIdentifier: "links.test")
    }

    static func transport() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LinkTestURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    /// A request's body reaches a URL protocol as a stream.
    static func body(of request: URLRequest) -> Data {
        var data = request.httpBody ?? Data()
        guard let stream = request.httpBodyStream else { return data }
        stream.open()
        defer { stream.close() }
        var bytes = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&bytes, maxLength: bytes.count)
            if count <= 0 { break }
            data.append(contentsOf: bytes.prefix(count))
        }
        return data
    }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "links.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, headers, data) = Self.handler?(request) ?? (500, [:], Data())
        let fields = headers.merging(["Content-Type": "application/json"]) { given, _ in given }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: fields)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
