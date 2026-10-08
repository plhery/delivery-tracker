import XCTest
@testable import PeekDeliveryTracker

/// The question a parcel's page asks its reader: which one, what the device remembers of it,
/// what an answer carries, and where it is sent.
@MainActor
final class ParcelFeedbackTests: XCTestCase {
    private final class Clock {
        var now = Date(timeIntervalSince1970: 1_790_000_000)
    }

    /// What a page sent, and what it showed while each answer was on its way.
    private final class Sent {
        var requests: [ParcelFeedbackRequest] = []
        var moments: [ParcelFeedbackModel.Moment] = []
        var counted: [String] = []
        var fails = false
        weak var model: ParcelFeedbackModel?

        var client: ParcelFeedbackClient {
            ParcelFeedbackClient { [self] request in
                requests.append(request)
                if let model { moments.append(model.moment) }
                if fails { throw DeliveryAPIError.serviceFailed(500) }
            }
        }
    }

    private let linkID = "22222222222A"
    private let scan = "3:2026-10-02T08:00:00Z"

    private func defaults() -> (UserDefaults, String) {
        let suite = "ParcelFeedbackTests.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suite)!, suite)
    }

    private func parcel(carrier: CarrierID = .dhl, stage: TrackingStage? = .inTransit, sync: SyncStatus = .ok, archived: Bool = false) -> Parcel {
        let id = UUID()
        return Parcel(
            id: id, trackingNumber: "TESTPARCEL123789", label: "", carrier: carrier, createdAt: "2026-10-01T08:00:00Z",
            syncStatus: sync, archivedAt: archived ? "2026-10-03T08:00:00Z" : nil, notificationsMuted: false,
            trackingEvents: stage.map { [TrackingEvent(id: UUID(), packageID: id, stage: $0, description: "", occurredAt: "2026-10-02T08:00:00Z")] } ?? []
        )
    }

    private func page(_ subject: ParcelFeedbackSubject, _ question: ParcelFeedbackQuestion = .found, scan: String? = nil) -> ParcelFeedbackModel.Page {
        ParcelFeedbackModel.Page(subject: subject, question: question, scan: scan ?? self.scan, carrier: "DHL", language: .fr)
    }

    /// A page as one visit holds it: another visit is another model over the same memory.
    private func visit(_ page: ParcelFeedbackModel.Page, _ sent: Sent, _ store: UserDefaults, _ clock: Clock) -> ParcelFeedbackModel {
        let model = ParcelFeedbackModel(memory: ParcelFeedbackMemory(defaults: store, now: { clock.now }), now: { clock.now },
                                        report: { name, outcome in sent.counted.append("\(name) \(outcome.rawValue)") })
        sent.model = model
        model.show(page, through: sent.client)
        return model
    }

    /// The reader opens a carrier's page from this one and comes back after a while.
    private func comeBack(_ model: ParcelFeedbackModel, _ clock: Clock, from site: String = "DHL", after seconds: TimeInterval = 30, busy: Bool = false) {
        model.visited(site)
        model.left()
        clock.now += seconds
        model.returned(busy: busy)
    }

    // MARK: - Which question

    func testAParcelACarrierAnswersForIsAskedWhetherItIsRight() {
        XCTAssertEqual(ParcelFeedbackQuestion(parcel: parcel(), showsHistory: true), .found)
        // Still being asked about, with what an earlier answer said on the page.
        XCTAssertEqual(ParcelFeedbackQuestion(parcel: parcel(sync: .syncing), showsHistory: true), .found)
        // A carrier answered for a parcel nobody named one for.
        XCTAssertEqual(ParcelFeedbackQuestion(parcel: parcel(carrier: .unknown), showsHistory: true), .found)
        // Announced, not scanned yet: the page shows that much.
        XCTAssertEqual(ParcelFeedbackQuestion(parcel: parcel(stage: .pending), showsHistory: true), .found)
    }

    func testAParcelNoCarrierKnowsIsAskedWhoseItIs() {
        XCTAssertEqual(ParcelFeedbackQuestion(parcel: parcel(carrier: .unknown, stage: nil), showsHistory: false), .unknown)
        XCTAssertEqual(ParcelFeedbackQuestion(parcel: parcel(carrier: .unknown, stage: .pending, sync: .waiting), showsHistory: true), .unknown)
    }

    func testNothingIsAskedOfAnArchivedParcelOrBeforeItsFirstAnswer() {
        XCTAssertNil(ParcelFeedbackQuestion(parcel: parcel(archived: true), showsHistory: true))
        XCTAssertNil(ParcelFeedbackQuestion(parcel: parcel(carrier: .unknown, stage: nil, archived: true), showsHistory: false))
        for waiting in [SyncStatus.pending, .syncing] {
            XCTAssertNil(ParcelFeedbackQuestion(parcel: parcel(stage: nil, sync: waiting), showsHistory: true))
            XCTAssertNil(ParcelFeedbackQuestion(parcel: parcel(carrier: .unknown, stage: .pending, sync: waiting), showsHistory: true))
        }
        // A carrier the page shows no history for.
        XCTAssertNil(ParcelFeedbackQuestion(parcel: parcel(stage: nil, sync: .unsupported), showsHistory: false))
    }

    func testTheScanIsWhatThePageEndsOn() {
        var parcel = parcel(stage: nil)
        XCTAssertEqual(parcel.feedbackScan, "")
        parcel.trackingEvents = [TrackingEvent(id: UUID(), packageID: parcel.id, stage: .inTransit, description: "", occurredAt: "2026-10-02T08:00:00Z")]
        XCTAssertEqual(parcel.feedbackScan, "1:2026-10-02T08:00:00Z")
        parcel.trackingEvents.append(TrackingEvent(id: UUID(), packageID: parcel.id, stage: .delivered, description: "", occurredAt: "2026-10-03T09:30:00Z"))
        XCTAssertEqual(parcel.feedbackScan, "2:2026-10-03T09:30:00Z")
    }

    // MARK: - What the device remembers

    func testAScanIsAskedAboutOnceAndAParcelAtMostOnceADay() {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let memory = ParcelFeedbackMemory(defaults: store, now: { clock.now })
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let next = "4:2026-10-03T09:30:00Z"

        XCTAssertFalse(memory.rests(subject, scan: scan))
        memory.rememberAnswer(subject, scan: scan)

        XCTAssertTrue(memory.rests(subject, scan: scan))
        XCTAssertFalse(memory.rests(.parcel(UUID()), scan: scan), "Another parcel was never answered for")
        clock.now += 2 * 3_600
        XCTAssertTrue(memory.rests(subject, scan: next), "A new scan the same day is not asked about")
        clock.now = clock.now - 2 * 3_600 + ParcelFeedbackMemory.quiet - 1
        XCTAssertTrue(memory.rests(subject, scan: next))
        clock.now += 1
        XCTAssertFalse(memory.rests(subject, scan: next), "A new scan a day later is")
        clock.now += 3_600
        XCTAssertTrue(memory.rests(subject, scan: scan), "The same scan never is again")
        clock.now += 30 * ParcelFeedbackMemory.quiet
        XCTAssertTrue(memory.rests(subject, scan: scan))
        XCTAssertFalse(memory.rests(subject, scan: next))
    }

    func testAClockSetBackHidesNoNewScan() {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let memory = ParcelFeedbackMemory(defaults: store, now: { clock.now })
        let subject = ParcelFeedbackSubject.parcel(UUID())
        memory.rememberAnswer(subject, scan: scan)

        clock.now -= 7 * ParcelFeedbackMemory.quiet

        XCTAssertFalse(memory.rests(subject, scan: "4:2026-10-03T09:30:00Z"))
        XCTAssertTrue(memory.rests(subject, scan: scan))
    }

    func testAnAnswerAboutNoScanRestsTheQuestionForADayOnly() {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let memory = ParcelFeedbackMemory(defaults: store, now: { clock.now })
        let subject = ParcelFeedbackSubject.parcel(UUID())

        memory.rememberAnswer(subject, scan: nil)

        XCTAssertTrue(memory.rests(subject, scan: ""), "A page without a scan ends on an empty one")
        XCTAssertTrue(memory.rests(subject, scan: scan))
        clock.now += ParcelFeedbackMemory.quiet
        XCTAssertFalse(memory.rests(subject, scan: ""), "Nothing was scanned, and it is asked again")
        XCTAssertFalse(memory.rests(subject, scan: scan))

        // An answer about a page without scans is one about that page: it is not asked again.
        memory.rememberAnswer(subject, scan: "")
        clock.now += 30 * ParcelFeedbackMemory.quiet
        XCTAssertTrue(memory.rests(subject, scan: ""))
        XCTAssertFalse(memory.rests(subject, scan: scan))
    }

    func testTheWayBackAsksOncePerScanAndNotAfterAnAnswer() {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let memory = ParcelFeedbackMemory(defaults: store, now: { clock.now })
        let subject = ParcelFeedbackSubject.parcel(UUID())

        XCTAssertTrue(memory.asksOnReturn(subject, scan: scan))
        memory.rememberAskedOnReturn(subject, scan: scan)
        XCTAssertFalse(memory.asksOnReturn(subject, scan: scan))
        XCTAssertFalse(memory.rests(subject, scan: scan), "Being asked is not an answer")

        let next = "4:2026-10-03T09:30:00Z"
        XCTAssertTrue(memory.asksOnReturn(subject, scan: next))
        memory.rememberAnswer(subject, scan: next)
        XCTAssertFalse(memory.asksOnReturn(subject, scan: next))
        let third = "5:2026-10-04T07:15:00Z"
        XCTAssertFalse(memory.asksOnReturn(subject, scan: third), "Not twice in a day")
        clock.now += ParcelFeedbackMemory.quiet
        XCTAssertFalse(memory.asksOnReturn(subject, scan: next), "Nor ever about the scan answered for")
        XCTAssertTrue(memory.asksOnReturn(subject, scan: third))
    }

    func testALinkIsRememberedByItsDigestOnly() throws {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let memory = ParcelFeedbackMemory(defaults: store)
        let key = ParcelFeedbackSubject.link(linkID).memoryKey

        XCTAssertEqual(key.count, 64)
        XCTAssertEqual(key, ParcelFeedbackSubject.link(linkID).memoryKey)
        XCTAssertNotEqual(key, ParcelFeedbackSubject.link("22222222222B").memoryKey)

        memory.rememberAnswer(.link(linkID), scan: scan)
        memory.rememberAskedOnReturn(.link(linkID), scan: scan)
        XCTAssertTrue(memory.rests(.link(linkID), scan: scan))
        let kept = try XCTUnwrap(store.dictionaryRepresentation().values.compactMap { $0 as? Data }.first { String(decoding: $0, as: UTF8.self).contains(key) })
        XCTAssertFalse(String(decoding: kept, as: UTF8.self).contains(linkID), "The link's id opens its parcel")

        let id = UUID()
        XCTAssertEqual(ParcelFeedbackSubject.parcel(id).memoryKey, id.uuidString)
    }

    func testOnlyTheLatestParcelsAreRemembered() {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let memory = ParcelFeedbackMemory(defaults: store, now: { clock.now })
        let subjects = (0...ParcelFeedbackMemory.limit).map { _ in ParcelFeedbackSubject.parcel(UUID()) }

        for subject in subjects {
            memory.rememberAnswer(subject, scan: scan)
            clock.now += 1
        }

        XCTAssertFalse(memory.rests(subjects[0], scan: scan), "The oldest made room")
        XCTAssertTrue(memory.rests(subjects[1], scan: scan))
        XCTAssertTrue(memory.rests(subjects[ParcelFeedbackMemory.limit], scan: scan))

        memory.forgetAll()
        XCTAssertFalse(memory.rests(subjects[1], scan: scan))
    }

    // MARK: - What an answer carries

    func testRightComesAlone() throws {
        let id = UUID()
        let request = ParcelFeedbackRequest.right(id: id, asked: .back, language: .de)

        XCTAssertEqual(request, ParcelFeedbackRequest(id: id, answer: .right, asked: .back, app: .ios, locale: .de))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder.deliveryTracker.encode(request)) as? [String: String])
        XCTAssertEqual(body, ["id": id.uuidString, "answer": "right", "asked": "back", "app": "ios", "locale": "de"])
    }

    func testWrongCarriesItsReasonsInThePagesOrderAndATrimmedNote() throws {
        let request = ParcelFeedbackRequest.wrong(reasons: [.other, .arrived, .timePlace], note: "  It came on Monday.\n", asked: .page, language: .en)

        XCTAssertEqual(request.answer, .wrong)
        XCTAssertEqual(request.reasons, [.arrived, .timePlace, .other])
        XCTAssertEqual(request.note, "It came on Monday.")
        XCTAssertNil(request.carrierName)
        XCTAssertNil(request.trackingPage)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder.deliveryTracker.encode(request)) as? [String: Any])
        XCTAssertEqual(body["reasons"] as? [String], ["arrived", "time_place", "other"])

        // Nothing is said with empty words.
        let bare = ParcelFeedbackRequest.wrong(reasons: [], note: " \n ", asked: .page, language: .en)
        XCTAssertNil(bare.reasons)
        XCTAssertNil(bare.note)
        let noteOnly = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder.deliveryTracker.encode(
            ParcelFeedbackRequest.wrong(reasons: [], note: "Two days late", asked: .back, language: .en)
        )) as? [String: Any])
        XCTAssertEqual(Set(noteOnly.keys), ["id", "answer", "note", "asked", "app", "locale"])
    }

    func testWordsStayWithinWhatAnAnswerMayCarry() {
        let long = String(repeating: "a", count: ParcelFeedbackRequest.noteLimit + 20)
        XCTAssertEqual(ParcelFeedbackRequest.wrong(reasons: [], note: long, asked: .page, language: .en).note?.count, ParcelFeedbackRequest.noteLimit)
        // A flag is two code points: it is kept whole or not at all.
        XCTAssertEqual(ParcelFeedbackRequest.limited("ab🇨🇭", to: 3), "ab")
        XCTAssertEqual(ParcelFeedbackRequest.limited("ab🇨🇭", to: 4), "ab🇨🇭")
        XCTAssertEqual(ParcelFeedbackRequest.limited("abc", to: 3), "abc")
        XCTAssertNil(ParcelFeedbackRequest.words("  \n", limit: 10))
    }

    func testFoundElsewhereCarriesANameOrItsPageAsTyped() throws {
        let request = ParcelFeedbackRequest.foundElsewhere(carrierName: " Example Parcels ", trackingPage: " example.com/track?id=TEST ", language: .pl)

        XCTAssertEqual(request.answer, .foundElsewhere)
        XCTAssertEqual(request.carrierName, "Example Parcels")
        XCTAssertEqual(request.trackingPage, "example.com/track?id=TEST")
        XCTAssertEqual(request.asked, .page)
        XCTAssertEqual(request.locale, .pl)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder.deliveryTracker.encode(request)) as? [String: String])
        XCTAssertEqual(body["answer"], "found_elsewhere")
        XCTAssertEqual(Set(body.keys), ["id", "answer", "carrierName", "trackingPage", "asked", "app", "locale"])

        let named = ParcelFeedbackRequest.foundElsewhere(carrierName: String(repeating: "n", count: 200), trackingPage: "", language: .en)
        XCTAssertEqual(named.carrierName?.count, ParcelFeedbackRequest.carrierNameLimit)
        XCTAssertNil(named.trackingPage)
        XCTAssertEqual(ParcelFeedbackRequest.foundElsewhere(carrierName: "", trackingPage: String(repeating: "p", count: 600), language: .en).trackingPage?.count,
                       ParcelFeedbackRequest.trackingPageLimit)
    }

    // MARK: - Pip asks

    func testYesIsShownAtOnceSentAndNotAskedAgainOnALaterVisit() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject), sent, store, clock)
        XCTAssertEqual(model.standing, .found)
        XCTAssertEqual(model.moment, .ask)

        await model.right()

        XCTAssertEqual(sent.moments, [.right], "The thanks do not wait for the service")
        XCTAssertEqual(sent.requests.map(\.answer), [.right])
        XCTAssertEqual(sent.requests.first?.asked, .page)
        XCTAssertEqual(sent.requests.first?.app, .ios)
        XCTAssertEqual(sent.requests.first?.locale, .fr)
        XCTAssertEqual(sent.counted, ["parcel-feedback-right success"])
        XCTAssertEqual(model.moment, .right)
        XCTAssertEqual(model.standing, .found, "On this visit the thanks stay to be read")
        XCTAssertNil(model.word)

        // Later the same day: nothing is asked, about this scan or a new one.
        let next = "4:2026-10-03T09:30:00Z"
        clock.now += 2 * 3_600
        XCTAssertNil(visit(page(subject), Sent(), store, clock).standing)
        XCTAssertNil(visit(page(subject, scan: next), Sent(), store, clock).standing)
        // A day later a new scan is something new to be right or wrong about; the same one is not.
        clock.now += 23 * 3_600
        XCTAssertNil(visit(page(subject), Sent(), store, clock).standing)
        XCTAssertEqual(visit(page(subject, scan: next), Sent(), store, clock).standing, .found)
    }

    func testAnAnswerThatCouldNotBeSentIsTakenBack() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        sent.fails = true
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject), sent, store, clock)

        await model.right()

        XCTAssertEqual(sent.moments, [.right])
        XCTAssertEqual(model.moment, .ask)
        XCTAssertEqual(model.word, .failed)
        XCTAssertEqual(sent.counted, ["parcel-feedback-right error"])
        XCTAssertEqual(visit(page(subject), Sent(), store, clock).standing, .found, "Nothing was answered")

        model.notQuite()
        await model.pick(.status)

        XCTAssertEqual(sent.moments, [.right, .sent])
        XCTAssertEqual(model.moment, .reasons, "The reasons are offered again")
        XCTAssertEqual(model.word, .failed)
        model.addNote()
        XCTAssertNil(model.words, "There is no answer to add a note to")
    }

    func testNotQuiteOffersTheReasonsAndOneTapSendsOne() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject), sent, store, clock)

        model.notQuite()
        XCTAssertEqual(model.moment, .reasons)
        XCTAssertTrue(sent.requests.isEmpty, "Nothing is sent before a reason is given")
        XCTAssertEqual(visit(page(subject), Sent(), store, clock).standing, .found, "Nor is anything answered")

        await model.pick(.steps)

        XCTAssertEqual(sent.moments, [.sent])
        XCTAssertEqual(model.moment, .sent)
        XCTAssertEqual(sent.requests.map(\.answer), [.wrong])
        XCTAssertEqual(sent.requests.first?.reasons, [.steps])
        XCTAssertNil(sent.requests.first?.note)
        XCTAssertEqual(sent.counted, ["parcel-feedback-wrong success"])
        XCTAssertNil(visit(page(subject), Sent(), store, clock).standing)

        // A note follows under the same id, with the reason given still on.
        model.addNote()
        XCTAssertEqual(model.words?.id, sent.requests.first?.id)
        XCTAssertEqual(model.words?.reasons, [.steps])
        XCTAssertEqual(model.words?.asked, .page)

        let closed = await model.sendWords([.steps, .carrier], note: " It changed hands in Lyon. ")

        XCTAssertTrue(closed)
        XCTAssertNil(model.words)
        XCTAssertEqual(model.moment, .noted, "The thanks stay, with nothing more to add")
        XCTAssertEqual(sent.requests.count, 2)
        XCTAssertEqual(sent.requests[1].id, sent.requests[0].id)
        XCTAssertEqual(sent.requests[1].reasons, [.steps, .carrier])
        XCTAssertEqual(sent.requests[1].note, "It changed hands in Lyon.")
        XCTAssertEqual(sent.requests[1].asked, .page)
        XCTAssertEqual(sent.counted, ["parcel-feedback-wrong success"], "The note is the same answer")
    }

    func testANoteThatCouldNotBeSentKeepsItsSheetOpen() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let sent = Sent()
        let model = visit(page(.parcel(UUID())), sent, store, Clock())
        model.notQuite()
        await model.pick(.other)
        model.addNote()
        sent.fails = true

        let closed = await model.sendWords([.other], note: "The box was empty")

        XCTAssertFalse(closed)
        XCTAssertNotNil(model.words)
        XCTAssertEqual(model.moment, .sent)
        XCTAssertFalse(model.sending)
        XCTAssertNil(model.word, "The sheet says it itself")
        XCTAssertEqual(sent.counted, ["parcel-feedback-wrong success"])
    }

    // MARK: - On the way back

    func testTheWayBackFromACarriersSiteAsksOncePerScan() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject), sent, store, clock)

        // Back without having left for a carrier's page.
        model.left()
        clock.now += 30
        model.returned()
        XCTAssertNil(model.word)

        comeBack(model, clock, from: "Swiss Post")
        XCTAssertEqual(model.word, .back(site: "Swiss Post"))
        XCTAssertEqual(ParcelFeedbackModel.Word.back(site: "Swiss Post").stay, .seconds(12))

        // It leaves by itself; that counts as asked.
        model.wordLeft(.failed)
        XCTAssertNotNil(model.word, "Only the word that stayed its time leaves")
        model.wordLeft(.back(site: "Swiss Post"))
        XCTAssertNil(model.word)
        comeBack(model, clock)
        XCTAssertNil(model.word)
        XCTAssertNil(comeBackOnALaterVisit(subject, store, clock), "Nor on a later visit")
        XCTAssertEqual(model.standing, .found, "Pip still asks")

        // A new scan is asked about once more.
        model.show(page(subject, scan: "4:2026-10-03T09:30:00Z"), through: sent.client)
        comeBack(model, clock)
        XCTAssertEqual(model.word, .back(site: "DHL"))
        XCTAssertTrue(sent.requests.isEmpty)
    }

    private func comeBackOnALaterVisit(_ subject: ParcelFeedbackSubject, _ store: UserDefaults, _ clock: Clock) -> ParcelFeedbackModel.Word? {
        let model = visit(page(subject), Sent(), store, clock)
        comeBack(model, clock)
        return model.word
    }

    func testTheWayBackAsksNothingWhenThereIsNothingToCompare() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()

        // A glance away is not a look at the carrier's page.
        let glance = visit(page(.parcel(UUID())), Sent(), store, clock)
        comeBack(glance, clock, after: 1)
        XCTAssertNil(glance.word)
        comeBack(glance, clock)
        XCTAssertNotNil(glance.word, "A real visit is still asked about")

        // Something else is said or asked over the page: the question waits for another visit.
        let busy = visit(page(.parcel(UUID())), Sent(), store, clock)
        comeBack(busy, clock, busy: true)
        XCTAssertNil(busy.word)
        busy.returned()
        XCTAssertNil(busy.word, "The visit was spent")
        comeBack(busy, clock)
        XCTAssertNotNil(busy.word)

        // A parcel no carrier knows has no site to compare with.
        let unknown = visit(page(.parcel(UUID()), .unknown, scan: ""), Sent(), store, clock)
        comeBack(unknown, clock)
        XCTAssertNil(unknown.word)

        // Already answered for this scan, on this visit or within the day.
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let answered = visit(page(subject), Sent(), store, clock)
        await answered.right()
        comeBack(answered, clock)
        XCTAssertNil(answered.word)
        XCTAssertNil(comeBackOnALaterVisit(subject, store, clock))

        // One of the sheets is open.
        let writing = visit(page(.parcel(UUID())), Sent(), store, clock)
        writing.notQuite()
        await writing.pick(.status)
        writing.addNote()
        comeBack(writing, clock)
        XCTAssertNil(writing.word)
    }

    func testYesOnTheWayBackThanksInBothPlaces() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let model = visit(page(.link(linkID)), sent, store, clock)
        comeBack(model, clock)

        await model.right(.back)

        XCTAssertEqual(sent.requests.map(\.answer), [.right])
        XCTAssertEqual(sent.requests.first?.asked, .back)
        XCTAssertEqual(model.word, .backRight)
        XCTAssertEqual(ParcelFeedbackModel.Word.backRight.stay, .seconds(4))
        XCTAssertEqual(model.moment, .right)
        XCTAssertEqual(sent.counted, ["parcel-feedback-right success"])
        XCTAssertNil(visit(page(.link(linkID)), Sent(), store, clock).standing)
    }

    func testNoOnTheWayBackOpensTheSheetWithNothingChosen() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject), sent, store, clock)
        comeBack(model, clock)

        model.wrongOnReturn()

        XCTAssertNil(model.word)
        XCTAssertEqual(model.words?.reasons, [])
        XCTAssertEqual(model.words?.asked, .back)
        XCTAssertTrue(sent.requests.isEmpty)

        // Closed without a word: Pip's question stands as it stood.
        model.words = nil
        XCTAssertEqual(model.moment, .ask)
        XCTAssertEqual(visit(page(subject), Sent(), store, clock).standing, .found)

        model.wrongOnReturn()
        let id = model.words?.id
        let closed = await model.sendWords([], note: "Their site says it was returned")

        XCTAssertTrue(closed)
        XCTAssertEqual(sent.requests.count, 1)
        XCTAssertEqual(sent.requests.first?.id, id)
        XCTAssertEqual(sent.requests.first?.answer, .wrong)
        XCTAssertNil(sent.requests.first?.reasons)
        XCTAssertEqual(sent.requests.first?.note, "Their site says it was returned")
        XCTAssertEqual(sent.requests.first?.asked, .back)
        XCTAssertEqual(model.word, .backSent)
        XCTAssertEqual(model.moment, .noted, "Pip thanks too, with nothing to add")
        XCTAssertEqual(sent.counted, ["parcel-feedback-wrong success"])
    }

    // MARK: - A parcel no carrier knows

    func testNotYetIsAnAnswerThatSendsNothing() {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject, .unknown, scan: ""), sent, store, clock)
        XCTAssertEqual(model.standing, .unknown)

        model.notYet()

        XCTAssertEqual(model.moment, .early)
        XCTAssertTrue(sent.requests.isEmpty)
        XCTAssertTrue(sent.counted.isEmpty)
        XCTAssertNil(visit(page(subject, .unknown, scan: ""), Sent(), store, clock).standing)
        // Tomorrow the carrier's site may show it: the row asks again although nothing was scanned.
        clock.now += 25 * 3_600
        XCTAssertEqual(visit(page(subject, .unknown, scan: ""), Sent(), store, clock).standing, .unknown)
    }

    func testNamingTheCarrierSendsItAndThanks() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject, .unknown, scan: ""), sent, store, clock)

        model.elsewhere()
        XCTAssertTrue(model.namingCarrier)
        // Closed without sending: back to the question.
        model.namingCarrier = false
        XCTAssertEqual(model.moment, .ask)
        XCTAssertEqual(model.standing, .unknown)
        XCTAssertTrue(sent.requests.isEmpty)

        model.elsewhere()
        sent.fails = true
        let refused = await model.sendCarrier(name: "Example Parcels", page: "")
        XCTAssertFalse(refused)
        XCTAssertTrue(model.namingCarrier, "What was typed stays to be sent again")
        XCTAssertEqual(model.moment, .ask)
        XCTAssertNil(model.word)

        sent.fails = false
        let closed = await model.sendCarrier(name: " Example Parcels ", page: "example.com/track")

        XCTAssertTrue(closed)
        XCTAssertFalse(model.namingCarrier)
        XCTAssertEqual(model.moment, .named)
        XCTAssertEqual(sent.requests.last?.answer, .foundElsewhere)
        XCTAssertEqual(sent.requests.last?.carrierName, "Example Parcels")
        XCTAssertEqual(sent.requests.last?.trackingPage, "example.com/track")
        XCTAssertEqual(sent.counted, ["parcel-feedback-carrier error", "parcel-feedback-carrier success"])
        XCTAssertNil(visit(page(subject, .unknown, scan: ""), Sent(), store, clock).standing)
        // The carrier was named: the row does not ask again while nothing is scanned.
        clock.now += 25 * 3_600
        XCTAssertNil(visit(page(subject, .unknown, scan: ""), Sent(), store, clock).standing)
        XCTAssertEqual(visit(page(subject, .found), Sent(), store, clock).standing, .found, "Once it is found, Pip asks about what he shows")
    }

    // MARK: - The page

    func testAnotherParcelOrACarrierFoundStartsOver() async {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let sent = Sent()
        let subject = ParcelFeedbackSubject.parcel(UUID())
        let model = visit(page(subject, .unknown, scan: ""), sent, store, clock)
        model.notYet()
        XCTAssertEqual(model.standing, .unknown)

        // A carrier answers while the page is open: the row's word goes, and Pip waits out the day.
        model.show(page(subject, .found), through: sent.client)
        XCTAssertEqual(model.moment, .ask)
        XCTAssertNil(model.standing)
        clock.now += ParcelFeedbackMemory.quiet
        model.show(page(subject, .found, scan: "4:2026-10-03T09:30:00Z"), through: sent.client)
        XCTAssertEqual(model.standing, .found)

        // A new scan leaves an answer given on this visit in place.
        await model.right()
        model.show(page(subject, .found, scan: "5:2026-10-04T07:15:00Z"), through: sent.client)
        XCTAssertEqual(model.moment, .right)
        XCTAssertEqual(model.standing, .found)

        // Another parcel has its own question, and none of the first one's sheets.
        model.words = ParcelFeedbackModel.Words(id: UUID(), reasons: [], asked: .back)
        model.show(page(.link(linkID)), through: sent.client)
        XCTAssertEqual(model.moment, .ask)
        XCTAssertNil(model.words)

        model.show(nil, through: nil)
        XCTAssertNil(model.standing)
        await model.right()
        XCTAssertEqual(sent.requests.count, 1, "A page that shows no parcel sends nothing")
    }

    // MARK: - The service

    func testAnAnswerThroughALinkCarriesTheOwnerKeyOnlyWhenThisIPhoneHoldsIt() async throws {
        let transport = FeedbackTestURLProtocol.transport()
        defer { transport.invalidateAndCancel() }
        nonisolated(unsafe) var requests: [(method: String, path: String, key: String?, authorization: String?, body: [String: Any])] = []
        nonisolated(unsafe) var status = 204
        FeedbackTestURLProtocol.handler = { request in
            let body = (try? JSONSerialization.jsonObject(with: FeedbackTestURLProtocol.body(of: request)) as? [String: Any]) ?? [:]
            requests.append((request.httpMethod ?? "", request.url?.path ?? "", request.value(forHTTPHeaderField: "X-Parcel-Key"),
                             request.value(forHTTPHeaderField: "Authorization"), body))
            return (status, status == 204 ? Data() : Data(#"{"error":"Parcel unavailable"}"#.utf8))
        }
        let followed = UUID()
        let key = String(repeating: "k", count: 43)
        let storage = FeedbackTestStorage()
        storage.keys = [linkID: key]
        storage.parcels = [DeviceParcel(linkID: linkID, label: "", archivedAt: nil, parcel: parcel(), checkedAt: Date())]
        storage.parcels[0].parcel.id = followed
        let device = DeviceParcels(client: .api(configuration: FeedbackTestURLProtocol.configuration, transport: transport), storage: storage)
        let answer = ParcelFeedbackRequest.wrong(reasons: [.status], asked: .page, language: .it)

        try await device.sendFeedback(answer, id: followed)

        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.method, "POST")
        XCTAssertEqual(requests.first?.path, "/api/public/parcels/\(linkID)/feedback")
        XCTAssertEqual(requests.first?.key, key)
        XCTAssertNil(requests.first?.authorization)
        XCTAssertEqual(requests.first?.body["id"] as? String, answer.id.uuidString)
        XCTAssertEqual(requests.first?.body["answer"] as? String, "wrong")
        XCTAssertEqual(requests.first?.body["reasons"] as? [String], ["status"])
        XCTAssertEqual(requests.first?.body["app"] as? String, "ios")
        XCTAssertEqual(requests.first?.body["locale"] as? String, "it")

        // Someone else's link: no key to send.
        try await device.sendFeedback(.right(asked: .back, language: .en), linkID: "33333333333B")
        XCTAssertEqual(requests.last?.path, "/api/public/parcels/33333333333B/feedback")
        XCTAssertNil(requests.last?.key)

        // A parcel this iPhone does not follow has no link to answer through.
        do {
            try await device.sendFeedback(answer, id: UUID())
            XCTFail("An unknown parcel was answered for")
        } catch {
            XCTAssertEqual(requests.count, 2)
        }

        // A link that is gone is a failure like any other.
        for gone in [404, 410] {
            status = gone
            do {
                try await device.sendFeedback(answer, linkID: linkID)
                XCTFail("\(gone) was taken for sent")
            } catch {}
        }
    }

    func testTheStoreSendsThroughTheAccountAndNothingInABuildWithoutAServer() async throws {
        let transport = FeedbackTestURLProtocol.transport()
        defer { transport.invalidateAndCancel() }
        let configuration = FeedbackTestURLProtocol.configuration
        let user = AuthUser(id: UUID(), email: "test@example.com", isAnonymous: false)
        let signedIn = try JSONEncoder.deliveryTracker.encode(AuthSession(
            accessToken: "access", tokenType: "bearer", expiresIn: 3600,
            expiresAt: Int(Date().timeIntervalSince1970) + 3600, refreshToken: "refresh", user: user
        ))
        let parcel = parcel()
        nonisolated(unsafe) var requests: [(method: String, path: String, authorization: String?, body: [String: Any])] = []
        FeedbackTestURLProtocol.handler = { request in
            let asked = request.url?.path ?? ""
            if asked == "/auth/v1/verify" { return (200, signedIn) }
            let body = (try? JSONSerialization.jsonObject(with: FeedbackTestURLProtocol.body(of: request)) as? [String: Any]) ?? [:]
            requests.append((request.httpMethod ?? "", asked, request.value(forHTTPHeaderField: "Authorization"), body))
            return asked.hasSuffix("/feedback") ? (204, Data()) : (404, Data(#"{"error":"Package not found"}"#.utf8))
        }
        let session = SessionStore(configuration: configuration, persistence: FeedbackTestSessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        let store = ParcelStore(configuration: configuration, session: session, localizer: Localizer(), transport: transport,
                                device: DeviceParcels(client: .api(configuration: configuration, transport: transport), storage: FeedbackTestStorage()))
        store.setDeliveryWidgetEnabled(false)
        store.setDeliveryLiveActivitiesEnabled(false)
        try await session.verifyCode(email: "test@example.com", code: "123456")
        let answer = ParcelFeedbackRequest.right(asked: .page, language: .en)

        try await store.feedbackClient(for: parcel).send(answer)

        let sent = try XCTUnwrap(requests.last { $0.path.hasSuffix("/feedback") })
        XCTAssertEqual(sent.method, "POST")
        XCTAssertEqual(sent.path, "/api/packages/\(parcel.id.uuidString)/feedback")
        XCTAssertEqual(sent.authorization, "Bearer access")
        XCTAssertEqual(sent.body["id"] as? String, answer.id.uuidString)
        XCTAssertEqual(sent.body["answer"] as? String, "right")

        // A link's parcel is answered for through the link, signed in or not.
        try await store.feedbackClient(forLink: linkID).send(answer)
        XCTAssertEqual(requests.last?.path, "/api/public/parcels/\(linkID)/feedback")
        XCTAssertNil(requests.last?.authorization)

        // The demo's parcels are made up: their answers go nowhere, and succeed.
        let count = requests.count
        let (preferences, suite) = defaults()
        defer { preferences.removePersistentDomain(forName: suite) }
        let demo = AppConfiguration(mode: .demo, apiBaseURL: URL(string: "https://feedback.test")!, supabaseURL: nil, supabasePublishableKey: "",
                                    googleAuthEnabled: false, appleAuthEnabled: false, emailOTPEnabled: false, appGroupIdentifier: "feedback.test")
        let demoSession = SessionStore(configuration: demo, defaults: preferences, persistence: FeedbackTestSessionPersistence(), transport: transport)
        let demoStore = ParcelStore(configuration: demo, session: demoSession, localizer: Localizer(), transport: transport,
                                    device: DeviceParcels(client: nil, storage: FeedbackTestStorage()))
        demoStore.setDeliveryWidgetEnabled(false)
        demoStore.setDeliveryLiveActivitiesEnabled(false)
        demoSession.enterDemo()
        XCTAssertTrue(demoStore.isDemo)
        try await demoStore.feedbackClient(for: parcel).send(answer)
        // A build without a server reads no link either.
        try await demoStore.feedbackClient(forLink: linkID).send(answer)
        XCTAssertEqual(requests.count, count)

        // Nor do their pages ask: the demo's stories are not something to judge.
        XCTAssertNil(ParcelFeedbackModel.Page(parcel: parcel, subject: .parcel(parcel.id), showsHistory: true, madeUp: demoStore.isDemo,
                                              carrier: "DHL", language: .en))
        XCTAssertNil(ParcelFeedbackModel.Page(parcel: parcel, subject: .link(linkID), showsHistory: true, madeUp: !demoStore.tracksWithoutAccount,
                                              carrier: "DHL", language: .en))
        XCTAssertNotNil(ParcelFeedbackModel.Page(parcel: parcel, subject: .parcel(parcel.id), showsHistory: true, madeUp: store.isDemo,
                                                 carrier: "DHL", language: .en))
        XCTAssertNotNil(ParcelFeedbackModel.Page(parcel: parcel, subject: .link(linkID), showsHistory: true, madeUp: !store.tracksWithoutAccount,
                                                 carrier: "DHL", language: .en))
    }

    func testAMadeUpParcelIsAskedNothing() {
        let (store, suite) = defaults()
        defer { store.removePersistentDomain(forName: suite) }
        let parcel = parcel()
        func page(_ parcel: Parcel, madeUp: Bool, showsHistory: Bool = true) -> ParcelFeedbackModel.Page? {
            ParcelFeedbackModel.Page(parcel: parcel, subject: .parcel(parcel.id), showsHistory: showsHistory, madeUp: madeUp, carrier: "DHL", language: .de)
        }

        XCTAssertEqual(page(parcel, madeUp: false),
                       ParcelFeedbackModel.Page(subject: .parcel(parcel.id), question: .found, scan: "1:2026-10-02T08:00:00Z", carrier: "DHL", language: .de))
        XCTAssertEqual(page(self.parcel(carrier: .unknown, stage: nil), madeUp: false, showsHistory: false)?.question, .unknown)
        XCTAssertEqual(page(self.parcel(carrier: .unknown, stage: nil), madeUp: false, showsHistory: false)?.scan, "")
        XCTAssertNil(page(self.parcel(archived: true), madeUp: false))

        // The demo's stories: whatever they show, nothing stands on their pages.
        XCTAssertNil(page(parcel, madeUp: true))
        XCTAssertNil(page(self.parcel(carrier: .unknown, stage: nil), madeUp: true, showsHistory: false))
        let sent = Sent()
        let clock = Clock()
        let model = visit(self.page(.parcel(parcel.id)), sent, store, clock)
        XCTAssertEqual(model.standing, .found)
        model.show(page(parcel, madeUp: true), through: sent.client)
        XCTAssertNil(model.standing)
        comeBack(model, clock)
        XCTAssertNil(model.word)
    }

    func testAnswersAreCountedWhereTheyAreGiven() throws {
        let catalog = try XCTUnwrap(AnalyticsCatalog.bundled)
        for action in ["parcel-feedback-right", "parcel-feedback-wrong", "parcel-feedback-carrier"] {
            XCTAssertTrue(catalog.actions.contains(action), action)
            XCTAssertFalse(catalog.operations.contains { $0.event == action }, "\(action) is counted where it happens")
        }
        // A note added to an answer goes over the same route: the route itself counts nothing.
        XCTAssertNil(catalog.event(path: "/api/packages/43000000-0000-0000-0000-000000000006/feedback", method: "POST", body: nil))
    }
}

private final class FeedbackTestStorage: DeviceParcelStorage {
    var parcels: [DeviceParcel] = []
    var keys: [String: String] = [:]
    func load() -> (parcels: [DeviceParcel], keys: [String: String]) { (parcels, keys) }
    func save(_ parcels: [DeviceParcel], keys: [String: String]) { self.parcels = parcels; self.keys = keys }
}

private final class FeedbackTestSessionPersistence: SessionPersistence {
    var data: Data?
    func save<T: Encodable>(_ value: T) throws { data = try JSONEncoder.deliveryTracker.encode(value) }
    func load<T: Decodable>() -> T? { data.flatMap { try? JSONDecoder.deliveryTracker.decode(T.self, from: $0) } }
    func delete() { data = nil }
}

private final class FeedbackTestURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?

    @MainActor static var configuration: AppConfiguration {
        AppConfiguration(mode: .api, apiBaseURL: URL(string: "https://feedback.test")!, supabaseURL: URL(string: "https://feedback.test")!,
                         supabasePublishableKey: "public", googleAuthEnabled: false, appleAuthEnabled: false, emailOTPEnabled: true,
                         appGroupIdentifier: "feedback.test")
    }

    static func transport() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FeedbackTestURLProtocol.self]
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

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "feedback.test" }
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
