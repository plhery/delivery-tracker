import XCTest
@testable import SwissDeliveryTracker

final class ParcelShareTests: XCTestCase {
    private let linkID = "g8Rn3yJe2SuX"
    private let base = URL(string: "https://peektracker.com")!

    private struct Fixture: Decodable {
        let publicParcel: PublicParcelResponse
        let publicLookup: PublicLookupResponse
        let publicGiftParcel: PublicParcelResponse
        let parcelShare: ParcelShareResponse
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "ContractFixtures", withExtension: "json"))
        return try JSONDecoder.deliveryTracker.decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func defaults() -> (UserDefaults, String) {
        let suite = "ParcelShareTests.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suite)!, suite)
    }

    private func event(_ stage: TrackingStage, _ description: String, _ location: String?, at time: String) -> TrackingEvent {
        TrackingEvent(id: UUID(), packageID: UUID(), stage: stage, description: description, location: location, occurredAt: time)
    }

    // MARK: - Contract

    func testDecodesTheGiftAndShareFixtures() throws {
        let fixture = try fixture()

        let gift = fixture.publicGiftParcel
        XCTAssertEqual(gift.link.id, linkID)
        XCTAssertEqual(gift.link.role, .viewer)
        XCTAssertEqual(gift.link.kind, .shared)
        XCTAssertEqual(gift.link.gift, true)
        XCTAssertEqual(gift.link.shared, true)
        XCTAssertEqual(gift.link.alerts?.available, true)
        XCTAssertNil(gift.link.forgetAt)
        XCTAssertFalse(gift.link.numberShown)
        XCTAssertFalse(gift.link.canKeep)
        XCTAssertNil(gift.package.trackingNumber)
        XCTAssertEqual(gift.package.numberHint?.masked, "••• 6789")
        XCTAssertNil(gift.package.lastStatusText)
        XCTAssertNil(gift.package.carrierData.senderName)
        XCTAssertEqual(gift.package.trackingEvents.map(\.description),
                       ["With the courier for delivery", "Left the sender", "Left the sender"])
        XCTAssertEqual(gift.package.trackingEvents.last?.location, "DE")
        XCTAssertEqual(gift.package.trackingEvents.last?.place?.precision, .country)

        XCTAssertEqual(fixture.parcelShare.link, ParcelShare(id: linkID, showNumber: false, gift: true, createdAt: "2026-10-01T08:00:00.000Z"))
        XCTAssertNil(try JSONDecoder.deliveryTracker.decode(ParcelShareResponse.self, from: Data(#"{"link":null}"#.utf8)).link)

        // A lookup's owner reads whether viewers see the whole number; older answers say nothing.
        XCTAssertEqual(fixture.publicLookup.link.showNumber, false)
        XCTAssertNil(fixture.publicParcel.link.showNumber)
        XCTAssertNil(fixture.publicParcel.link.gift)
    }

    func testShareRequestsSendOnlyTheTwoSwitches() throws {
        let both = try JSONEncoder.deliveryTracker.encode(ShareParcelRequest(showNumber: true, gift: false))
        XCTAssertEqual(String(decoding: both, as: UTF8.self), #"{"gift":false,"showNumber":true}"#)
        XCTAssertEqual(String(decoding: try JSONEncoder.deliveryTracker.encode(ShareParcelRequest()), as: UTF8.self), "{}")
    }

    @MainActor func testTheBlurredDescriptionIsTranslated() {
        let localizer = Localizer()
        localizer.language = .en
        XCTAssertEqual(localizer.eventDescription(TrackingEvent.giftOriginDescription), "Left the sender")
        XCTAssertEqual(localizer.eventDescription(TrackingEvent.giftOriginDescription), localizer.text("event.gift.leftSender"))
        for language in AppLanguage.allCases where language != .en {
            localizer.language = language
            let said = localizer.eventDescription(TrackingEvent.giftOriginDescription)
            XCTAssertEqual(said, localizer.text("event.gift.leftSender"), language.rawValue)
            XCTAssertNotEqual(said, "Left the sender", language.rawValue)
            XCTAssertNotEqual(said, "event.gift.leftSender", language.rawValue)
        }
    }

    // MARK: - The link's words

    func testALinkCarriesItsNameNoteAndSignatureAfterTheHash() {
        func route(_ fragment: String) -> ParcelLinkRoute? {
            ParcelLinkRoute(url: URL(string: "https://peektracker.com/p/" + linkID + fragment)!, baseURL: base)
        }
        XCTAssertEqual(route("#n=New%20sneakers&g=Happy%20birthday%2C%20Alex!&f=Sam"),
                       ParcelLinkRoute(id: linkID, name: "New sneakers", note: "Happy birthday, Alex!", from: "Sam"))
        XCTAssertEqual(route("#f=Sam&g=Enjoy"), ParcelLinkRoute(id: linkID, note: "Enjoy", from: "Sam"))
        XCTAssertEqual(route("#g=Caf%C3%A9%20%E2%98%95"), ParcelLinkRoute(id: linkID, note: "Café ☕"))
        XCTAssertEqual(route("#n=Lamp&g=&f=%20"), ParcelLinkRoute(id: linkID, name: "Lamp"))
        // A part that cannot be decoded is left out; the others stay.
        XCTAssertEqual(ParcelLinkWords(fragment: "g=%ZZ&f=Sam"), ParcelLinkWords(from: "Sam"))
        XCTAssertEqual(route("?g=Query&f=Query"), ParcelLinkRoute(id: linkID))
        XCTAssertEqual(ParcelLinkRoute(url: URL(string: "swissdeliverytracker://p/" + linkID + "#g=Hi&f=Sam")!, baseURL: base),
                       ParcelLinkRoute(id: linkID, note: "Hi", from: "Sam"))
        // Longer keys are someone else's.
        XCTAssertEqual(route("#gift=1&from=Sam&note=x"), ParcelLinkRoute(id: linkID))
    }

    func testTheWordsAreCleanedToWhatALinkMayCarry() {
        // One line, without control characters, runs of blanks told once.
        XCTAssertEqual(ParcelLinkWords(fragment: "g=%20Line%0Aone%09%09two%20%20three%20").note, "Line one two three")
        XCTAssertEqual(ParcelLinkWords(fragment: "f=Sam%E2%80%8B%00Lee").from, "Sam Lee")
        // A note holds 280 characters and a signature 60, as the site counts them.
        XCTAssertEqual(ParcelLinkWords(fragment: "g=" + String(repeating: "a", count: 400)).note, String(repeating: "a", count: 280))
        XCTAssertEqual(ParcelLinkWords(fragment: "f=" + String(repeating: "b", count: 100)).from, String(repeating: "b", count: 60))
        XCTAssertEqual(ParcelLinkWords(fragment: "f=" + String(repeating: "%F0%9F%8E%81", count: 80)).from, String(repeating: "🎁", count: 60))
        XCTAssertEqual(ParcelLinkWords(fragment: "g=" + String(repeating: "%C3%A9", count: 300)).note?.count, 280)
        // A cut never leaves a blank at the end.
        XCTAssertEqual(ParcelLinkWords(fragment: "f=" + String(repeating: "c", count: 59) + "%20dd").from, String(repeating: "c", count: 59))
        // The name keeps its own measure: what an account's parcel name holds.
        XCTAssertEqual(ParcelLinkWords(fragment: "n=" + String(repeating: "%F0%9F%93%A6", count: 50)).name?.utf16.count, 80)
        XCTAssertEqual(ParcelLinkWords.cleanName("  Moon \n lamp "), "Moon lamp")
        XCTAssertNil(ParcelLinkWords.clean(" \n\t ", limit: 10))
        XCTAssertEqual(ParcelLinkWords(fragment: nil), ParcelLinkWords())
        XCTAssertEqual(ParcelLinkWords(fragment: ""), ParcelLinkWords())
    }

    func testTheAddressIsBuiltOnTheSiteAsTheSiteBuildsIt() {
        XCTAssertEqual(ParcelLinkRoute.address(id: linkID, baseURL: base).absoluteString, "https://peektracker.com/p/g8Rn3yJe2SuX")
        let words = ParcelLinkWords(name: "New sneakers 👟", note: "Happy birthday, Alex! (It's me) & co #1 100%", from: "Sam & Léa")
        let address = ParcelLinkRoute.address(id: linkID, words: words, baseURL: base)
        // The same escapes as JavaScript's encodeURIComponent, in the order n, g, f.
        XCTAssertEqual(address.absoluteString,
                       "https://peektracker.com/p/g8Rn3yJe2SuX#n=New%20sneakers%20%F0%9F%91%9F"
                       + "&g=Happy%20birthday%2C%20Alex!%20(It's%20me)%20%26%20co%20%231%20100%25&f=Sam%20%26%20L%C3%A9a")
        // What is written is what is read back.
        XCTAssertEqual(ParcelLinkRoute(url: address, baseURL: base),
                       ParcelLinkRoute(id: linkID, name: words.name, note: words.note, from: words.from))
        // Words are cleaned on their way out, and empty ones left out.
        XCTAssertEqual(ParcelLinkRoute.address(id: linkID, words: ParcelLinkWords(name: " ", note: "a\nb", from: ""), baseURL: base).absoluteString,
                       "https://peektracker.com/p/g8Rn3yJe2SuX#g=a%20b")
        // A development site keeps its port; a query never travels.
        XCTAssertEqual(ParcelLinkRoute.address(id: linkID, words: ParcelLinkWords(name: "Lamp"), baseURL: URL(string: "http://localhost:3000")!).absoluteString,
                       "http://localhost:3000/p/g8Rn3yJe2SuX#n=Lamp")
    }

    func testAMadeUpIdHasTheFormatOfARealOne() {
        var generator = SystemRandomNumberGenerator()
        let ids = (0..<50).map { _ in ParcelLinkRoute.madeUpID(using: &generator) }
        XCTAssertTrue(ids.allSatisfy(ParcelLinkRoute.validID))
        XCTAssertEqual(Set(ids).count, ids.count)
    }

    func testAHiddenNumberShowsOnlyItsEndByTheServicesRule() {
        XCTAssertEqual(ParcelNumberHint(hiding: "1234567890899").masked, "••• 899")
        XCTAssertEqual(ParcelNumberHint(hiding: "TESTPARCEL123456").masked, "••• 3456")
        XCTAssertEqual(ParcelNumberHint(hiding: "TESTPARCEL1234567890").masked, "••• 7890")
        XCTAssertEqual(ParcelNumberHint(hiding: "1234567899").masked, "••• 99")
        XCTAssertEqual(ParcelNumberHint(hiding: "ABCDE"), ParcelNumberHint(head: "", tail: "E"))
        XCTAssertEqual(ParcelNumberHint(hiding: "AB"), ParcelNumberHint(head: "", tail: ""))
        // An answer from a service that still shows the start reads as it did.
        XCTAssertEqual(ParcelNumberHint(head: "123", tail: "99").masked, "123 ••• 99")
    }

    // MARK: - A gift

    func testAGiftIsWrappedUntilItIsDeliveredExceptForItsSender() throws {
        var link = try fixture().publicGiftParcel.link
        for stage in TrackingStage.allCases where stage != .delivered {
            XCTAssertEqual(ParcelLinkGift(link: link, stage: stage), .wrapped, stage.rawValue)
        }
        XCTAssertEqual(ParcelLinkGift(link: link, stage: nil), .wrapped)
        XCTAssertEqual(ParcelLinkGift(link: link, stage: .delivered), .opened)

        link.role = .owner
        XCTAssertEqual(ParcelLinkGift(link: link, stage: .inTransit), .own)
        XCTAssertEqual(ParcelLinkGift(link: link, stage: .delivered), .own)

        // A link that is no gift, or says nothing about it, shows none of this.
        link.role = .viewer
        link.gift = false
        XCTAssertNil(ParcelLinkGift(link: link, stage: .inTransit))
        link.gift = nil
        XCTAssertNil(ParcelLinkGift(link: link, stage: .delivered))
    }

    func testTheAnswerSaysHowItsGiftIsShown() throws {
        var answer = try fixture().publicGiftParcel
        XCTAssertEqual(answer.gift, .wrapped)

        let packageID = answer.package.id
        answer.package.trackingEvents.insert(TrackingEvent(
            id: UUID(), packageID: packageID, stage: .delivered, description: "Delivered",
            location: "Zürich, CH", occurredAt: "2026-10-02T12:12:00+00:00"), at: 0)
        XCTAssertEqual(answer.gift, .opened)

        answer.link.role = .owner
        XCTAssertEqual(answer.gift, .own)
        XCTAssertNil(try fixture().publicParcel.gift)
    }

    func testBlurredRowsThatFollowOneAnotherAreToldOnce() throws {
        let fixture = try fixture().publicGiftParcel.package.trackingEvents
        let collapsed = fixture.collapsingGiftRows()
        XCTAssertEqual(collapsed.map(\.id), [fixture[0].id, fixture[1].id], "The newest of the run stays, in the order given")
        XCTAssertEqual(collapsed.map(\.stage), [.outForDelivery, .inTransit])

        let blurred = TrackingEvent.giftOriginDescription
        let journey = [
            event(.accepted, blurred, "DE", at: "2026-10-01T08:00:00Z"),
            event(.inTransit, blurred, "DE", at: "2026-10-01T10:00:00Z"),
            event(.inTransit, blurred, nil, at: "2026-10-01T12:00:00Z"),
            event(.inTransit, blurred, nil, at: "2026-10-01T13:00:00Z"),
            event(.customs, "Cleared customs", "Basel, CH", at: "2026-10-01T20:00:00Z"),
            event(.inTransit, blurred, "DE", at: "2026-10-01T21:00:00Z"),
            event(.outForDelivery, "Out for delivery", "Zürich, CH", at: "2026-10-02T06:00:00Z"),
            event(.outForDelivery, "Out for delivery", "Zürich, CH", at: "2026-10-02T07:00:00Z"),
        ]
        // Runs are found in the order of the journey, whatever order the answer came in.
        for order in [journey, journey.reversed(), [journey[3], journey[0], journey[6], journey[1], journey[7], journey[5], journey[2], journey[4]]] {
            let kept = Set(order.collapsingGiftRows().map(\.id))
            XCTAssertEqual(kept, Set([journey[1], journey[3], journey[4], journey[5], journey[6], journey[7]].map(\.id)))
            XCTAssertEqual(order.collapsingGiftRows().map(\.id), order.map(\.id).filter(kept.contains))
        }
        // Nothing blurred, nothing dropped.
        XCTAssertEqual(Array(journey[6...]).collapsingGiftRows(), Array(journey[6...]))
        XCTAssertEqual([TrackingEvent]().collapsingGiftRows(), [])
    }

    // MARK: - A stopped link

    @MainActor func testALinkWhoseSharingStoppedSaysSo() async throws {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let shown = try fixture().publicGiftParcel
        var answer: Result<PublicParcelResponse?, Error> = .failure(ParcelLinkStopped())
        let store = ParcelLinkStore(defaults: defaults, read: { _ in try answer.get() })
        let link = ParcelLinkRoute(id: linkID, name: "Lamp", note: "Enjoy", from: "Sam")

        store.open(link)
        await store.load()
        XCTAssertEqual(store.phase, .stopped)
        XCTAssertNotEqual(store.phase, .unavailable, "A stopped link is not a forgotten one")
        XCTAssertNil(store.refreshFailure)
        XCTAssertNotNil(store.route, "The sheet stays to say so")

        // A parcel on screen makes way when its sharing stops.
        answer = .success(shown)
        store.open(link)
        await store.load()
        XCTAssertEqual(store.phase, .shown(shown))
        answer = .failure(ParcelLinkStopped())
        await store.load()
        XCTAssertEqual(store.phase, .stopped)

        // A link kept for after sign-in is settled by it, with the words it carried.
        store.open(link)
        store.rememberForSignIn()
        XCTAssertEqual(store.remembered, link)
        store.resume()
        XCTAssertEqual(store.route, link)
        await store.load()
        XCTAssertEqual(store.phase, .stopped)
        XCTAssertNil(store.remembered)
    }

    @MainActor func testTheServiceAnswersGoneForAStoppedLink() async throws {
        let transport = ShareTestURLProtocol.transport()
        defer { transport.invalidateAndCancel() }
        ShareTestURLProtocol.handler = { _ in (410, Data(#"{"error":"Parcel not shared"}"#.utf8)) }
        do {
            _ = try await DeliveryAPIClient.publicParcel(linkID: linkID, configuration: ShareTestURLProtocol.configuration, transport: transport)
            XCTFail("Expected a stopped link")
        } catch {
            XCTAssertTrue(error is ParcelLinkStopped)
        }
        ShareTestURLProtocol.handler = { _ in (404, Data(#"{"error":"Parcel unavailable"}"#.utf8)) }
        let gone = try await DeliveryAPIClient.publicParcel(linkID: linkID, configuration: ShareTestURLProtocol.configuration, transport: transport)
        XCTAssertNil(gone)
    }

    // MARK: - The share sheet

    /// A parcel's link as a service would keep it, with every call noted.
    @MainActor private final class Service {
        var link: ParcelShare?
        var calls: [String] = []
        var failure: Error?
        /// Holds the next change until the test lets it through.
        var gate: CheckedContinuation<Void, Never>?
        var gated = false
        private var made = 0

        var client: ParcelShareModel.Client {
            ParcelShareModel.Client(
                current: { [self] in
                    calls.append("GET")
                    if let failure { throw failure }
                    return link
                },
                share: { [self] settings in
                    calls.append("PUT \(settings.showNumber) \(settings.gift)")
                    if gated { await withCheckedContinuation { gate = $0 } }
                    if let failure { throw failure }
                    if link == nil {
                        made += 1
                        link = ParcelShare(id: "2222222222\(made)A".replacingOccurrences(of: "1", with: "B"), showNumber: false, gift: false, createdAt: "2026-10-02T08:00:00.000Z")
                    }
                    link?.showNumber = settings.showNumber
                    link?.gift = settings.gift
                    return link!
                },
                stop: { [self] in
                    calls.append("DELETE")
                    if let failure { throw failure }
                    link = nil
                }
            )
        }
    }

    @MainActor private func model(_ service: Service, parcelID: UUID = UUID(), name: String? = "New sneakers", defaults: UserDefaults) -> ParcelShareModel {
        ParcelShareModel(parcelID: parcelID, name: name, client: service.client, notes: ParcelShareNotes(defaults: defaults), baseURL: base)
    }

    @MainActor func testTheLinkIsMadeOnTheFirstShareOrCopy() async {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let service = Service()
        let model = model(service, defaults: defaults)
        XCTAssertTrue(model.loading)

        await model.load()
        XCTAssertFalse(model.loading)
        XCTAssertNil(model.link)
        XCTAssertNil(model.address)
        XCTAssertEqual(service.calls, ["GET"], "Opening the sheet makes nothing")

        // Before there is a link, the switches only say what the next one will show.
        await model.set(.showNumber, to: true)
        await model.set(.gift, to: true)
        model.words.name = true
        model.words.note = "Enjoy"
        XCTAssertEqual(model.shown, ParcelShareModel.Settings(showNumber: true, gift: true))
        XCTAssertEqual(service.calls, ["GET"])
        XCTAssertNil(ParcelShareNotes(defaults: defaults).words(for: model.parcelID), "Words are kept once a link carries them")

        let address = await model.addressToHandOut()
        XCTAssertEqual(service.calls, ["GET", "PUT true true"])
        XCTAssertEqual(address?.absoluteString, "https://peektracker.com/p/2222222222BA#n=New%20sneakers&g=Enjoy")
        XCTAssertEqual(model.address, address)
        XCTAssertEqual(ParcelShareNotes(defaults: defaults).words(for: model.parcelID), ParcelShareWords(name: true, note: "Enjoy", from: ""))

        // The same link is handed out from then on.
        let again = await model.addressToHandOut()
        XCTAssertEqual(again, address)
        XCTAssertEqual(service.calls.count, 2)
    }

    @MainActor func testASwitchIsShownAtOnceAndPutBackWhenTheServiceRefuses() async {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let service = Service()
        service.link = ParcelShare(id: linkID, showNumber: false, gift: false, createdAt: "2026-10-01T08:00:00.000Z")
        let model = model(service, defaults: defaults)
        await model.load()
        XCTAssertEqual(model.link?.id, linkID)
        XCTAssertEqual(model.shown, ParcelShareModel.Settings())

        // On its way: shown, and marked as saving.
        service.gated = true
        let saving = Task { await model.set(.showNumber, to: true) }
        while service.gate == nil { await Task.yield() }
        XCTAssertTrue(model.shown.showNumber)
        XCTAssertTrue(model.isSaving(.showNumber))
        XCTAssertFalse(model.isSaving(.gift))
        service.gated = false
        service.gate?.resume()
        service.gate = nil
        await saving.value
        XCTAssertTrue(model.shown.showNumber)
        XCTAssertFalse(model.isSaving(.showNumber))
        XCTAssertNil(model.failureKey)
        XCTAssertEqual(service.calls.last, "PUT true false", "Both switches are sent, as the sheet shows them")

        // Refused: put back, with a message.
        for (error, key) in [
            (URLError(.notConnectedToInternet) as Error, "error.connection"),
            (DeliveryAPIError.rateLimited(10), "error.rateLimited"),
            (DeliveryAPIError.serviceFailed(502), "share.failed"),
            (DeliveryAPIError.service("Package not found"), "share.failed"),
        ] {
            service.failure = error
            await model.set(.gift, to: true)
            XCTAssertFalse(model.shown.gift)
            XCTAssertTrue(model.shown.showNumber, "The other switch keeps what was saved")
            XCTAssertFalse(model.isSaving(.gift))
            XCTAssertEqual(model.failureKey, key)
        }
        XCTAssertEqual(service.link?.gift, false)

        // The next change clears the message.
        service.failure = nil
        await model.set(.gift, to: true)
        XCTAssertNil(model.failureKey)
        XCTAssertEqual(model.shown, ParcelShareModel.Settings(showNumber: true, gift: true))
        XCTAssertEqual(service.link?.gift, true)

        // A read that was cancelled says nothing.
        service.failure = CancellationError()
        await model.set(.gift, to: false)
        XCTAssertNil(model.failureKey)
        XCTAssertTrue(model.shown.gift)
    }

    @MainActor func testTheLinkCarriesTheNameOnlyWhenAskedAndAGiftsWordsOnlyForAGift() async {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let service = Service()
        service.link = ParcelShare(id: linkID, showNumber: true, gift: false, createdAt: "2026-10-01T08:00:00.000Z")
        let model = model(service, defaults: defaults)
        await model.load()
        XCTAssertEqual(model.address?.absoluteString, "https://peektracker.com/p/g8Rn3yJe2SuX")

        model.words.name = true
        XCTAssertEqual(model.address?.absoluteString, "https://peektracker.com/p/g8Rn3yJe2SuX#n=New%20sneakers")

        // A note typed for a gift stays off the link until the link is a gift.
        model.words.note = "Happy birthday! "
        model.words.from = " Sam"
        XCTAssertEqual(model.address?.absoluteString, "https://peektracker.com/p/g8Rn3yJe2SuX#n=New%20sneakers")
        await model.set(.gift, to: true)
        XCTAssertEqual(model.address?.absoluteString, "https://peektracker.com/p/g8Rn3yJe2SuX#n=New%20sneakers&g=Happy%20birthday!&f=Sam")
        XCTAssertEqual(model.words.note, "Happy birthday! ", "What is being typed keeps its spaces")

        model.words.name = false
        XCTAssertEqual(model.address?.absoluteString, "https://peektracker.com/p/g8Rn3yJe2SuX#g=Happy%20birthday!&f=Sam")

        // What is typed stays within what a link may carry.
        model.words.note = String(repeating: "a", count: 300)
        XCTAssertEqual(model.words.note.count, 280)
        model.words.from = String(repeating: "🎁", count: 70)
        XCTAssertEqual(model.words.from.count, 60)
        XCTAssertEqual(ParcelShareNotes(defaults: defaults).words(for: model.parcelID)?.note.count, 280)

        // A parcel without a name has none to carry.
        let unnamed = self.model(service, name: "  ", defaults: defaults)
        await unnamed.load()
        unnamed.words.name = true
        XCTAssertNil(unnamed.name)
        XCTAssertNil(unnamed.carried.name)
    }

    @MainActor func testTheWordsOfALinkAreKeptOnTheDeviceAndShownAgain() async {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let notes = ParcelShareNotes(defaults: defaults)
        let service = Service()
        service.link = ParcelShare(id: linkID, showNumber: false, gift: true, createdAt: "2026-10-01T08:00:00.000Z")
        let parcelID = UUID()

        let first = model(service, parcelID: parcelID, defaults: defaults)
        await first.load()
        XCTAssertEqual(first.words, ParcelShareWords())
        first.words.name = true
        first.words.note = "Enjoy  the trails\n"
        first.words.from = "Sam"
        XCTAssertEqual(notes.words(for: parcelID), ParcelShareWords(name: true, note: "Enjoy the trails", from: "Sam"), "Kept clean")

        // Opened again: the same words, and the same address.
        let second = model(service, parcelID: parcelID, defaults: defaults)
        await second.load()
        XCTAssertEqual(second.words, ParcelShareWords(name: true, note: "Enjoy the trails", from: "Sam"))
        XCTAssertEqual(second.address, first.address)
        XCTAssertEqual(second.shown.gift, true)

        // Another parcel has its own.
        let other = model(service, parcelID: UUID(), defaults: defaults)
        await other.load()
        XCTAssertEqual(other.words, ParcelShareWords())

        // Without an answer the sheet shows what the device kept.
        service.failure = URLError(.timedOut)
        let offline = model(service, parcelID: parcelID, defaults: defaults)
        await offline.load()
        XCTAssertFalse(offline.loading)
        XCTAssertNil(offline.link)
        XCTAssertEqual(offline.words.note, "Enjoy the trails")
        service.failure = nil

        // Words emptied are no longer kept.
        second.words = ParcelShareWords()
        XCTAssertNil(notes.words(for: parcelID))

        // A link stopped elsewhere takes its words with it.
        notes.remember(ParcelShareWords(name: true, note: "Old", from: ""), for: parcelID)
        service.link = nil
        let later = model(service, parcelID: parcelID, defaults: defaults)
        await later.load()
        XCTAssertEqual(later.words, ParcelShareWords())
        XCTAssertNil(notes.words(for: parcelID))
    }

    @MainActor func testStoppingForgetsTheWordsAndSharingAgainMakesANewLink() async {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let notes = ParcelShareNotes(defaults: defaults)
        let service = Service()
        let model = model(service, defaults: defaults)
        await model.load()
        await model.set(.gift, to: true)
        model.words = ParcelShareWords(name: true, note: "Enjoy", from: "Sam")
        let first = await model.addressToHandOut()
        XCTAssertNotNil(notes.words(for: model.parcelID))

        // A refusal leaves everything as it was.
        service.failure = DeliveryAPIError.serviceFailed(502)
        await model.stop()
        XCTAssertFalse(model.stopped)
        XCTAssertEqual(model.failureKey, "share.failed")
        XCTAssertEqual(model.address, first)
        XCTAssertNotNil(notes.words(for: model.parcelID))
        service.failure = nil

        await model.stop()
        XCTAssertTrue(model.stopped)
        XCTAssertNil(model.failureKey)
        XCTAssertNil(model.link)
        XCTAssertNil(model.address)
        XCTAssertEqual(model.words, ParcelShareWords())
        XCTAssertNil(notes.words(for: model.parcelID))
        XCTAssertNil(service.link)
        XCTAssertFalse(model.working)

        service.failure = URLError(.timedOut)
        await model.shareAgain()
        XCTAssertTrue(model.stopped)
        XCTAssertEqual(model.failureKey, "error.connection")
        service.failure = nil

        await model.shareAgain()
        XCTAssertFalse(model.stopped)
        XCTAssertNil(model.failureKey)
        XCTAssertNotNil(model.link)
        XCTAssertNotEqual(model.address, first, "A new link, with a new id")
        XCTAssertEqual(model.address?.fragment, nil, "It carries nothing the old one did")
        XCTAssertEqual(model.shown.gift, true, "The switches stay as they were")
    }

    func testTheDevicesWordsAreKeptPerParcelAndForgotten() {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let notes = ParcelShareNotes(defaults: defaults)
        let one = UUID(), two = UUID()
        let start = Date(timeIntervalSince1970: 1_790_000_000)

        XCTAssertNil(notes.words(for: one))
        notes.remember(ParcelShareWords(name: true, note: " Hello\nthere ", from: "Sam"), for: one, now: start)
        notes.remember(ParcelShareWords(name: false, note: "", from: "Léa"), for: two, now: start)
        XCTAssertEqual(notes.words(for: one), ParcelShareWords(name: true, note: "Hello there", from: "Sam"))
        XCTAssertEqual(notes.words(for: two), ParcelShareWords(name: false, note: "", from: "Léa"))

        notes.forget(one)
        XCTAssertNil(notes.words(for: one))
        XCTAssertNotNil(notes.words(for: two))
        notes.forget(one)

        // Words that say nothing are not kept.
        notes.remember(ParcelShareWords(), for: two)
        XCTAssertNil(notes.words(for: two))
        XCTAssertNil(defaults.object(forKey: "sdt.parcelShareWords.v1"))

        // Only the latest links stay.
        let ids = (0..<70).map { _ in UUID() }
        for (index, id) in ids.enumerated() {
            notes.remember(ParcelShareWords(name: true), for: id, now: start.addingTimeInterval(Double(index)))
        }
        XCTAssertEqual(ids.filter { notes.words(for: $0) != nil }, Array(ids.suffix(60)))

        notes.forgetAll()
        XCTAssertTrue(ids.allSatisfy { notes.words(for: $0) == nil })
        // Damaged notes are no notes.
        defaults.set(Data("nonsense".utf8), forKey: "sdt.parcelShareWords.v1")
        XCTAssertNil(notes.words(for: one))
    }

    func testTheDemoMakesItsOwnLinksOnThisDevice() {
        let (defaults, suite) = defaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let shares = DemoParcelShares(defaults: defaults)
        let parcel = UUID()

        XCTAssertNil(shares.link(for: parcel))
        let made = shares.share(parcel, showNumber: true, gift: false)
        XCTAssertTrue(ParcelLinkRoute.validID(made.id))
        XCTAssertEqual(shares.link(for: parcel), made)

        let changed = shares.share(parcel, showNumber: false, gift: true)
        XCTAssertEqual(changed.id, made.id, "A change keeps the link")
        XCTAssertEqual(changed.createdAt, made.createdAt)
        XCTAssertEqual(DemoParcelShares(defaults: defaults).link(for: parcel), ParcelShare(id: made.id, showNumber: false, gift: true, createdAt: made.createdAt))

        shares.stop(parcel)
        XCTAssertNil(shares.link(for: parcel))
        XCTAssertNotEqual(shares.share(parcel, showNumber: false, gift: false).id, made.id, "Sharing again makes a new link")

        _ = shares.share(UUID(), showNumber: true, gift: true)
        shares.reset()
        XCTAssertNil(shares.link(for: parcel))
    }

    // MARK: - The service

    @MainActor func testSharingGoesThroughTheAccountAndForgetsTheWordsOfADeletedParcel() async throws {
        let transport = ShareTestURLProtocol.transport()
        defer { transport.invalidateAndCancel() }
        let configuration = ShareTestURLProtocol.configuration
        let user = AuthUser(id: UUID(), email: "test@example.com", isAnonymous: false)
        let signedIn = try JSONEncoder.deliveryTracker.encode(AuthSession(
            accessToken: "access", tokenType: "bearer", expiresIn: 3600,
            expiresAt: Int(Date().timeIntervalSince1970) + 3600, refreshToken: "refresh", user: user
        ))
        let parcel = Parcel(id: UUID(), trackingNumber: "TESTPARCEL123456", label: "Moon lamp", carrier: .dpd,
                            createdAt: "2026-10-02T08:00:00Z", syncStatus: .ok, notificationsMuted: false)
        let path = "/api/packages/\(parcel.id.uuidString)/share"
        let shared = try JSONEncoder.deliveryTracker.encode(try fixture().parcelShare)
        nonisolated(unsafe) var requests: [(method: String, path: String, authorization: String?, body: String)] = []
        nonisolated(unsafe) var link: Data? = nil
        ShareTestURLProtocol.handler = { request in
            let method = request.httpMethod ?? ""
            let asked = request.url?.path ?? ""
            if asked == "/auth/v1/verify" { return (200, signedIn) }
            requests.append((method, asked, request.value(forHTTPHeaderField: "Authorization"),
                             String(decoding: ShareTestURLProtocol.body(of: request), as: UTF8.self)))
            if asked == path {
                switch method {
                case "GET": return (200, link ?? Data(#"{"link":null}"#.utf8))
                case "PUT": link = shared; return (200, shared)
                case "DELETE": link = nil; return (204, Data())
                default: break
                }
            }
            if method == "DELETE", asked == "/api/packages/\(parcel.id.uuidString)/permanent" { return (200, Data(#"{"ok":true}"#.utf8)) }
            return (404, Data(#"{"error":"Package not found"}"#.utf8))
        }
        let session = SessionStore(configuration: configuration, persistence: ShareTestSessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        let store = ParcelStore(configuration: configuration, session: session, localizer: Localizer(), transport: transport)
        store.setDeliveryWidgetEnabled(false)
        store.setDeliveryLiveActivitiesEnabled(false)
        let client = store.shareClient(for: parcel)

        do {
            _ = try await client.current()
            XCTFail("Sharing needs an account")
        } catch {
            XCTAssertTrue(requests.isEmpty)
        }

        try await session.verifyCode(email: "test@example.com", code: "123456")
        let none = try await client.current()
        XCTAssertNil(none)
        XCTAssertEqual(requests.last?.method, "GET")
        XCTAssertEqual(requests.last?.path, path)
        XCTAssertEqual(requests.last?.authorization, "Bearer access")

        let made = try await client.share(ParcelShareModel.Settings(showNumber: false, gift: true))
        XCTAssertEqual(made.id, linkID)
        XCTAssertEqual(requests.last?.method, "PUT")
        XCTAssertEqual(requests.last?.body, #"{"gift":true,"showNumber":false}"#, "Never a name, a note or a signature")
        let found = try await client.current()
        XCTAssertEqual(found, made)

        try await client.stop()
        XCTAssertEqual(requests.last?.method, "DELETE")
        XCTAssertEqual(requests.last?.path, path)
        let stopped = try await client.current()
        XCTAssertNil(stopped)

        // Another account's parcel reads as missing.
        let other = store.shareClient(for: Parcel(id: UUID(), trackingNumber: "TESTPARCEL654321", label: "", carrier: .dpd,
                                                  createdAt: "2026-10-02T08:00:00Z", syncStatus: .ok, notificationsMuted: false))
        do {
            _ = try await other.share(ParcelShareModel.Settings())
            XCTFail("Expected a refusal")
        } catch DeliveryAPIError.service(let message) {
            XCTAssertEqual(message, "Package not found")
        }

        // Deleting the parcel drops what its link carried.
        let notes = ParcelShareNotes()
        notes.remember(ParcelShareWords(name: true, note: "Enjoy", from: "Sam"), for: parcel.id)
        defer { notes.forget(parcel.id) }
        try await store.permanentlyDelete(parcel)
        XCTAssertNil(notes.words(for: parcel.id))
    }

    func testSharingIsCountedOnceUnderTheCatalogsNames() throws {
        let catalog = try XCTUnwrap(AnalyticsCatalog.bundled)
        let path = "/api/packages/43000000-0000-0000-0000-000000000006/share"
        XCTAssertEqual(catalog.event(path: path, method: "PUT", body: nil), "parcel-link-share-change")
        XCTAssertEqual(catalog.event(path: path, method: "DELETE", body: nil), "parcel-link-share-stop")
        XCTAssertNil(catalog.event(path: path, method: "GET", body: nil), "Opening the sheet is not an action")
        XCTAssertEqual(catalog.event(path: "/api/packages/claim", method: "POST", body: nil), "parcel-link-keep")
        XCTAssertTrue(catalog.screens.contains("parcel-link"))
        for action in ["parcel-link-share", "parcel-link-sign-in", "parcel-link-open-existing"] {
            XCTAssertTrue(catalog.actions.contains(action), action)
            XCTAssertFalse(catalog.operations.contains { $0.event == action }, "\(action) is counted where it happens")
        }
    }
}

private final class ShareTestSessionPersistence: SessionPersistence {
    var data: Data?
    func save<T: Encodable>(_ value: T) throws { data = try JSONEncoder.deliveryTracker.encode(value) }
    func load<T: Decodable>() -> T? { data.flatMap { try? JSONDecoder.deliveryTracker.decode(T.self, from: $0) } }
    func delete() { data = nil }
}

private final class ShareTestURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?

    @MainActor static var configuration: AppConfiguration {
        AppConfiguration(mode: .api, apiBaseURL: URL(string: "https://share.test")!, supabaseURL: URL(string: "https://share.test")!,
                         supabasePublishableKey: "public", googleAuthEnabled: false, appleAuthEnabled: false, emailOTPEnabled: true,
                         appGroupIdentifier: "share.test")
    }

    static func transport() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ShareTestURLProtocol.self]
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

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "share.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, data) = Self.handler?(request) ?? (500, Data())
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                                              headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
