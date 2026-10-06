import Combine
import XCTest
import UIKit
@testable import PeekDeliveryTracker

final class ParcelLogicTests: XCTestCase {
    func testPickupPointSplitsNameFromAddressAndOpensAppleMaps() {
        let shop = PickupPoint(" Corner shop & café \n12 Main Street\n\n1000 Town ")
        XCTAssertEqual(shop?.name, "Corner shop & café")
        XCTAssertEqual(shop?.address, "12 Main Street, 1000 Town")
        XCTAssertEqual(shop?.query, "Corner shop & café, 12 Main Street, 1000 Town")
        XCTAssertEqual(shop?.mapsURL?.absoluteString,
                       "https://maps.apple.com/?daddr=Corner%20shop%20%26%20caf%C3%A9,%2012%20Main%20Street,%201000%20Town")
        let office = PickupPoint("Post office 42")
        XCTAssertNil(office?.address)
        XCTAssertEqual(office?.mapsURL?.absoluteString, "https://maps.apple.com/?q=Post%20office%2042")
        XCTAssertNil(PickupPoint(nil))
        XCTAssertNil(PickupPoint(" \n "))
    }

    func testAutomaticCarrierNoticeExpiresAndDoesNotSurviveManualSelection() {
        let at = DateParser.date("2026-09-10T12:00:00Z")!
        var parcel = DemoRepository.seed(now: at)[0]
        parcel.carrier = .ups
        parcel.carrierData = CarrierData(autoChangedFrom: .dhl, autoChangedTo: .ups, autoChangedAt: DateParser.isoString(at))
        XCTAssertEqual(parcel.automaticallyChangedFrom(at: at), .dhl)
        XCTAssertEqual(parcel.automaticallyChangedFrom(at: at.addingTimeInterval(43_199)), .dhl)
        XCTAssertNil(parcel.automaticallyChangedFrom(at: at.addingTimeInterval(43_200)))
        XCTAssertNil(parcel.automaticallyChangedFrom(at: at.addingTimeInterval(-1)))
        parcel.carrier = .fedex
        XCTAssertNil(parcel.automaticallyChangedFrom(at: at))
    }

    func testAutomaticCarrierNoticeIgnoresParcelsFiledWithoutCarrier() {
        let at = DateParser.date("2026-09-10T12:00:00Z")!
        var parcel = DemoRepository.seed(now: at)[0]
        parcel.carrier = .ups
        for from in [CarrierID.unknown, .internationalPost] {
            parcel.carrierData = CarrierData(autoChangedFrom: from, autoChangedTo: .ups, autoChangedAt: DateParser.isoString(at))
            XCTAssertNil(parcel.automaticallyChangedFrom(at: at))
        }
    }

    func testSharedDemoCatalogHasVariedHistoriesAndRelativeDates() {
        let now = DateParser.date("2026-09-09T12:00:00Z")!
        let parcels = DemoRepository.seed(now: now)
        XCTAssertEqual(parcels.count, 17)
        XCTAssertEqual(Set(parcels.map(\.trackingNumber)).count, 17)
        XCTAssertEqual(parcels.filter(\.isActive).count, 7)
        XCTAssertEqual(parcels.filter(\.isDelivered).count, 10)
        XCTAssertEqual(parcels.filter(\.isArchived).count, 5)
        XCTAssertEqual(ParcelOrganizer.nextDelivery(from: parcels, now: now)?.label, "New sneakers 👟")
        XCTAssertTrue(parcels.contains { $0.expectedDelivery != nil })
        XCTAssertTrue(parcels.contains { $0.currentStage == .inTransit && $0.expectedDelivery == nil })
        for parcel in parcels {
            XCTAssertTrue(CarrierID.allCases.contains(parcel.carrier))
            let dates = parcel.trackingEvents.compactMap { DateParser.date($0.occurredAt) }
            XCTAssertEqual(dates.count, parcel.trackingEvents.count)
            XCTAssertEqual(dates, dates.sorted())
            XCTAssertTrue(dates.allSatisfy { $0 <= now })
            XCTAssertTrue(parcel.trackingEvents.allSatisfy { $0.packageID == parcel.id })
        }
    }

    func testDemoUpgradePreservesEditsAndOnlyAddsExamplesOnce() throws {
        let suite = "demo-catalog-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var coffee = try XCTUnwrap(DemoRepository.seed().first { $0.trackingNumber == "993412345678901234" })
        coffee.label = "My edited coffee"
        coffee.archivedAt = DateParser.isoString(Date())
        defaults.set(try JSONEncoder.deliveryTracker.encode([coffee]), forKey: "sdt.native.demo.parcels.v1")
        let repo = DemoRepository(defaults: defaults, language: { .en })
        let upgraded = repo.list()
        XCTAssertEqual(upgraded.count, 17)
        XCTAssertEqual(upgraded.first { $0.id == coffee.id }?.label, "My edited coffee")
        XCTAssertTrue(try XCTUnwrap(upgraded.first { $0.id == coffee.id }).isArchived)
        let lamp = try XCTUnwrap(upgraded.first { $0.label == "Moon lamp 🌙" })
        try repo.permanentlyDelete(id: lamp.id)
        XCTAssertEqual(DemoRepository(defaults: defaults).list().count, 16)
        defaults.set(try JSONEncoder.deliveryTracker.encode([Parcel]()), forKey: "sdt.native.demo.parcels.v1")
        defaults.removeObject(forKey: "sdt.native.demo.catalog.v2")
        XCTAssertTrue(DemoRepository(defaults: defaults).list().isEmpty)
    }

    func testDemoIsWrittenInTheAppLanguageAndKeepsEditedNames() throws {
        let suite = "demo-language-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var language = AppLanguage.en
        let repo = DemoRepository(defaults: defaults, language: { language })
        let coffee = try XCTUnwrap(repo.list().first { $0.label == "Coffee beans ☕" })
        _ = try repo.rename(id: coffee.id, label: "My own coffee")

        language = .fr
        let french = repo.list()
        XCTAssertEqual(french.first { $0.id == coffee.id }?.label, "My own coffee")
        let sneakers = try XCTUnwrap(french.first { $0.trackingNumber == "1234567899" })
        XCTAssertEqual(sneakers.label, "Nouvelles baskets 👟")
        XCTAssertEqual(sneakers.pickupPlace, "Kiosk im Hauptbahnhof")
        XCTAssertTrue(sneakers.trackingEvents.contains { $0.description == "Personne à la maison. Sans doute parti courir." })
        XCTAssertEqual(sneakers.lastStatusText, "T’attend au point de retrait")
        // A refresh adds its scan in the same language.
        let collected = try repo.refresh(id: sneakers.id)
        XCTAssertEqual(collected.currentEvent?.description, "Livré dans ta boîte aux lettres")
        XCTAssertEqual(collected.currentEvent?.location, "Domicile")
        XCTAssertNil(collected.pickupPlace)

        language = .de
        let german = repo.list()
        XCTAssertEqual(german.first { $0.id == sneakers.id }?.label, "Neue Sneaker 👟")
        XCTAssertEqual(german.first { $0.id == sneakers.id }?.currentEvent?.description, "In deinen Briefkasten zugestellt")
        XCTAssertEqual(german.first { $0.id == coffee.id }?.label, "My own coffee")
        // Another launch, and a reset, keep the chosen language.
        let later = DemoRepository(defaults: defaults, language: { .de })
        XCTAssertEqual(later.list().first { $0.id == sneakers.id }?.label, "Neue Sneaker 👟")
        later.reset()
        XCTAssertTrue(later.list().contains { $0.label == "Kaffeebohnen ☕" })

        language = .en
        XCTAssertEqual(Set(repo.list().map(\.label)), Set(DemoRepository.seed().map(\.label)))
    }

    func testArrivalTiltFiltersJitterAndBoundsLargeMovements() {
        var tilt = ArrivalTilt()
        tilt.follow(roll: 0.44, pitch: -0.44)
        XCTAssertEqual(tilt.x, 0.22, accuracy: 0.0001)
        XCTAssertEqual(tilt.y, -0.22, accuracy: 0.0001)
        for _ in 0..<100 { tilt.follow(roll: 50, pitch: -50) }
        XCTAssertLessThanOrEqual(tilt.x, 1)
        XCTAssertGreaterThanOrEqual(tilt.y, -1)
        let prior = tilt
        tilt.follow(roll: .nan, pitch: .infinity)
        XCTAssertEqual(tilt, prior)
    }

    func testArrivalTiltFollowsScreenOrientationAndSettlesAtRest() {
        var portrait = ArrivalTilt()
        var landscape = ArrivalTilt()
        portrait.follow(roll: 0.44, pitch: 0)
        landscape.follow(roll: 0.44, pitch: 0, quarterTurns: 1)
        XCTAssertEqual(landscape.x, 0, accuracy: 0.0001)
        XCTAssertEqual(landscape.y, -portrait.x, accuracy: 0.0001)
        for _ in 0..<40 { landscape.follow(roll: 0, pitch: 0) }
        XCTAssertEqual(landscape.y, 0, accuracy: 0.0001)
    }

    func testArrivalTiltRespondsGentlyToAccelerationAndRejectsInvalidSamples() {
        var tilt = ArrivalTilt()
        tilt.follow(roll: 0, pitch: 0, accelerationX: 0.35, accelerationY: 0.35)
        XCTAssertGreaterThan(tilt.x, 0)
        XCTAssertLessThan(tilt.y, 0)
        XCTAssertLessThan(abs(tilt.x) + abs(tilt.y), 0.1)
        let previous = tilt
        tilt.follow(roll: 0, pitch: 0, accelerationX: .nan)
        XCTAssertEqual(tilt, previous)
        for _ in 0..<60 { tilt.follow(roll: 0, pitch: 0) }
        XCTAssertEqual(tilt.x, 0, accuracy: 0.0001)
        XCTAssertEqual(tilt.y, 0, accuracy: 0.0001)
    }

    @MainActor
    func testArchiveRecognizerDeclinesVerticalDragsBeforeTheyCanBlockScrolling() {
        let delegate = ArchivePanGestureDelegate()
        let recognizer = StubArchivePanGestureRecognizer()
        for translation in [CGPoint(x: -3, y: -18), CGPoint(x: 4, y: 24)] {
            recognizer.testTranslation = translation
            XCTAssertFalse(delegate.gestureRecognizerShouldBegin(recognizer))
        }
    }

    @MainActor
    func testArchiveRecognizerLeavesAmbiguousDiagonalDragsToScrolling() {
        let delegate = ArchivePanGestureDelegate()
        let recognizer = StubArchivePanGestureRecognizer()
        for translation in [CGPoint(x: -20, y: -20), CGPoint(x: -20, y: 18), .zero] {
            recognizer.testTranslation = translation
            XCTAssertFalse(delegate.gestureRecognizerShouldBegin(recognizer))
        }
    }

    @MainActor
    func testArchiveRecognizerAllowsHorizontalRevealAndReverseDrags() {
        let delegate = ArchivePanGestureDelegate()
        let recognizer = StubArchivePanGestureRecognizer()
        for translation in [CGPoint(x: -20, y: 3), CGPoint(x: 20, y: -3)] {
            recognizer.testTranslation = translation
            XCTAssertTrue(delegate.gestureRecognizerShouldBegin(recognizer))
        }
    }

    @MainActor
    func testArchiveRecognizerLetsTheListScrollUntilTheDragShowsItsDirection() {
        let delegate = ArchivePanGestureDelegate()
        let recognizer = ArchivePanGestureRecognizer()
        let list = UIScrollView()
        XCTAssertTrue(delegate.gestureRecognizer(recognizer, shouldRecognizeSimultaneouslyWith: list.panGestureRecognizer))
        XCTAssertTrue(recognizer.scroll === list.panGestureRecognizer)
        XCTAssertFalse(delegate.gestureRecognizer(recognizer, shouldRecognizeSimultaneouslyWith: UIPanGestureRecognizer()))
        XCTAssertFalse(delegate.gestureRecognizer(recognizer, shouldRecognizeSimultaneouslyWith: UITapGestureRecognizer()))
    }

    func testArchiveReleaseKeepsTheFingerPositionUntilTheSettleAnimation() {
        var swipe = ArchiveSwipeState()
        // The first 8 points only pick the direction, so the card starts without a jump.
        swipe.drag(translation: CGSize(width: -60, height: 3), width: 360)
        XCTAssertEqual(swipe.reveal, 52, accuracy: 0.001)

        XCTAssertEqual(swipe.release(velocity: -300, width: 360), .revealed)
        // Releasing used to reset the displayed translation to zero for a frame.
        XCTAssertEqual(swipe.reveal, 52, accuracy: 0.001)
        XCTAssertNil(swipe.cancel())
        swipe.settle(at: 88)

        // Past the action the card resists the finger.
        swipe.drag(translation: CGSize(width: -12, height: 0), width: 360)
        XCTAssertEqual(swipe.reveal, 91.2, accuracy: 0.001)
    }

    func testArchiveSwipeThatStartsAtZeroFollowsTheFingerOneToOne() {
        // iOS 27 reports a recognized pan at zero before it moves.
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: .zero, width: 360)
        swipe.drag(translation: CGSize(width: -15.5, height: -2), width: 360)
        XCTAssertEqual(swipe.reveal, 15.5, accuracy: 0.001)
        swipe.drag(translation: CGSize(width: -48, height: -5), width: 360)
        XCTAssertEqual(swipe.reveal, 48, accuracy: 0.001)
        XCTAssertEqual(swipe.release(velocity: -600, width: 360), .revealed)

        swipe.settle(at: 0)
        swipe.drag(translation: .zero, width: 360)
        swipe.drag(translation: CGSize(width: -3, height: -18), width: 360)
        swipe.drag(translation: CGSize(width: -120, height: -20), width: 360)
        XCTAssertEqual(swipe.reveal, 0)
        XCTAssertNil(swipe.release(velocity: -900, width: 360))
    }

    func testShortArchiveSwipeClosesFromTheReleasePosition() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -25, height: 0), width: 360)
        XCTAssertEqual(swipe.release(velocity: 0, width: 360), .closed)
        XCTAssertEqual(swipe.reveal, 17, accuracy: 0.001)
    }

    func testReversingAnOpenArchiveSwipeClosesIt() {
        var swipe = ArchiveSwipeState()
        swipe.settle(at: 88)
        swipe.drag(translation: CGSize(width: 65, height: 2), width: 360)
        XCTAssertEqual(swipe.reveal, 31, accuracy: 0.001)
        XCTAssertEqual(swipe.release(velocity: 400, width: 360), .closed)
        XCTAssertEqual(swipe.reveal, 31, accuracy: 0.001)
    }

    func testArchiveNeedsTheCommitPointOrAThrowPastTheAction() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -30, height: 0), width: 360)
        XCTAssertEqual(swipe.release(velocity: -2000, width: 360), .revealed)

        swipe.settle(at: 0)
        swipe.drag(translation: CGSize(width: -120, height: 1), width: 360)
        XCTAssertEqual(swipe.release(velocity: -500, width: 360), .revealed)
        swipe.settle(at: 0)
        swipe.drag(translation: CGSize(width: -120, height: 1), width: 360)
        XCTAssertEqual(swipe.release(velocity: -1500, width: 360), .archive)

        swipe.settle(at: 0)
        swipe.drag(translation: CGSize(width: -230, height: 1), width: 360)
        XCTAssertGreaterThanOrEqual(swipe.reveal, ArchiveSwipeState.commitPoint(width: 360))
        XCTAssertEqual(swipe.release(velocity: 0, width: 360), .archive)
    }

    func testVerticalScrollDoesNotBecomeAnArchiveSwipe() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -3, height: -18), width: 360)
        swipe.drag(translation: CGSize(width: -200, height: -25), width: 360)
        XCTAssertEqual(swipe.reveal, 0)
        XCTAssertNil(swipe.release(velocity: -900, width: 360))
    }

    func testCancelledSwipeSettlesWithoutArchivingOrResettingItsPosition() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -220, height: 0), width: 360)
        let reveal = swipe.reveal
        XCTAssertEqual(swipe.cancel(), .revealed)
        XCTAssertEqual(swipe.reveal, reveal)
        XCTAssertNil(swipe.cancel())
    }

    func testArchiveSwipeStaysWithinCardBounds() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: 50, height: 0), width: 360)
        XCTAssertLessThan(swipe.reveal, 0)
        XCTAssertGreaterThan(swipe.reveal, -44)
        swipe.drag(translation: CGSize(width: -500, height: 0), width: 360)
        XCTAssertLessThan(swipe.reveal, 360)
    }

    func testArchiveSwipeTravelIsContinuousAndInvertible() {
        let knee = 88 + (ArchiveSwipeState.commitPoint(width: 360) - 88) / 0.8
        for travel: CGFloat in [-120, -1, 0, 30, 88, 120, knee - 1, knee + 1, 260, 400] {
            let reveal = ArchiveSwipeState.reveal(forTravel: travel, width: 360)
            XCTAssertEqual(ArchiveSwipeState.travel(forReveal: reveal, width: 360), travel, accuracy: 0.0001)
        }
        for edge: CGFloat in [0, 88, knee] {
            let step = ArchiveSwipeState.reveal(forTravel: edge + 0.0001, width: 360) - ArchiveSwipeState.reveal(forTravel: edge - 0.0001, width: 360)
            XCTAssertLessThan(step, 0.001)
        }
        XCTAssertEqual(ArchiveSwipeState.commitPoint(width: 360), 180)
        XCTAssertEqual(ArchiveSwipeState.commitPoint(width: 200), 144)
    }

    func testSwipeSpringStartsWithItsReleaseSpeedAndSettlesOnTarget() {
        let start = SwipeSpring.fling.state(from: 40, to: 88, velocity: 600, at: 0)
        XCTAssertEqual(start.value, 40, accuracy: 0.0001)
        XCTAssertEqual(start.velocity, 600, accuracy: 0.0001)
        let rest = SwipeSpring.snap.state(from: 40, to: 88, velocity: 600, at: 1.5)
        XCTAssertEqual(rest.value, 88, accuracy: 0.01)
        let samples = (0..<120).map { SwipeSpring.snap.state(from: 0, to: 100, velocity: 0, at: Double($0) / 120).value }
        XCTAssertLessThanOrEqual(samples.max() ?? 0, 100)
        let settle = SwipeSpring.snap.settleTime(from: 0, to: 100, velocity: 0)
        XCTAssertGreaterThan(settle, 0.25)
        XCTAssertLessThan(settle, 0.6)
    }

    func testArchiveSwipeMotionHandsOverItsPositionAndSpeed() {
        let began = Date(timeIntervalSinceReferenceDate: 0)
        let motion = ArchiveSwipeMotion(
            from: ArchiveSwipePose(reveal: 150), to: ArchiveSwipePose(reveal: 360, spread: 1, land: 1),
            velocity: ArchiveSwipePose(reveal: 900), spring: .exit, reduceMotion: false, began: began
        )
        XCTAssertEqual(motion.pose(at: began).reveal, 150, accuracy: 0.001)
        XCTAssertEqual(motion.velocity(at: began).reveal, 900, accuracy: 0.001)
        let midway = began.addingTimeInterval(0.1)
        XCTAssertGreaterThan(motion.pose(at: midway).reveal, 150)
        XCTAssertGreaterThan(motion.pose(at: midway).land, 0)
        XCTAssertEqual(motion.pose(at: began.addingTimeInterval(motion.duration + 0.1)), motion.target)
        let leave = motion.time { $0.reveal >= 358 && $0.land >= 0.92 }
        XCTAssertGreaterThan(leave, 0.1)
        XCTAssertLessThan(leave, motion.duration)

        // A throw from beside the action: the gap to the card only closes on the way out.
        let exit = ArchiveSwipeMotion(
            from: ArchiveSwipePose(reveal: 106), to: ArchiveSwipePose(reveal: 370, spread: 1, land: 1),
            velocity: ArchiveSwipePose(reveal: 2000), spring: .exit, reduceMotion: false, glued: true, began: began
        )
        var gap: CGFloat = 18.001
        for step in 0...60 {
            let pose = exit.pose(at: began.addingTimeInterval(Double(step) / 120))
            let next = (1 - pose.spread) * max(0, min(pose.reveal, 370) - 88)
            XCTAssertLessThanOrEqual(next, gap + 0.001)
            gap = next
        }

        let still = ArchiveSwipeMotion(from: ArchiveSwipePose(reveal: 150), to: ArchiveSwipePose(),
                                       velocity: ArchiveSwipePose(reveal: 900), spring: .fling, reduceMotion: true, began: began)
        XCTAssertEqual(still.velocity, ArchiveSwipePose())
        XCTAssertEqual(still.revealSpring, .reduced)
    }

    func testInternationalPostWaitsForItsAutomaticLookup() {
        let id = UUID()
        var parcel = makeParcel(id: id, events: [])
        parcel.carrier = .internationalPost
        parcel.syncStatus = .pending
        XCTAssertEqual(parcel.displayStatus.key, "status.syncing")
        XCTAssertTrue(parcel.displayStatus.syncing)
    }

    @MainActor
    func testRetryAfterSupportsBothHeaderFormats() {
        let now = DateParser.date("2026-09-06T12:00:00Z")!
        XCTAssertEqual(DeliveryAPIClient.retryAfterSeconds("12", now: now), 12)
        XCTAssertEqual(DeliveryAPIClient.retryAfterSeconds("Sun, 06 Sep 2026 12:00:12 GMT", now: now), 12)
        XCTAssertEqual(DeliveryAPIClient.retryAfterSeconds("invalid", now: now), 0)
        XCTAssertEqual(DeliveryAPIClient.retryAfterSeconds(nil, now: now), 0)
    }

    func testPickupAndDeliveryActionsSurviveSyncErrors() {
        let id = UUID()
        for (stage, attention) in [
            (TrackingStage.readyForPickup, ParcelAttention.readyForPickup),
            (.failedAttempt, .failedAttempt),
            (.customs, .customs),
            (.exception, .exception),
        ] {
            var parcel = makeParcel(id: id, events: [event(id, stage, "2026-09-06T10:00:00Z")])
            parcel.syncStatus = .error
            XCTAssertEqual(parcel.attention(), attention)
            XCTAssertEqual(parcel.currentStage, stage)
        }
    }

    func testSenderMetadataDecodesWithoutRequiringItOnOlderResponses() throws {
        let sender = try JSONDecoder.deliveryTracker.decode(
            CarrierData.self, from: Data(#"{"sender_name":"Example sender"}"#.utf8)
        )
        XCTAssertEqual(sender.senderName, "Example sender")
        let older = try JSONDecoder.deliveryTracker.decode(CarrierData.self, from: Data("{}".utf8))
        XCTAssertNil(older.senderName)
    }

    func testDecodesRoutingInputNeededAndPromptsOnlyWhileAnotherCarrierWaits() throws {
        let packageID = UUID()
        let json = """
        {
          "packages": [{
            "id": "\(packageID.uuidString)",
            "tracking_number": "12345678901",
            "label": "Test parcel",
            "carrier": "gls-de",
            "created_at": "2026-08-01T10:00:00Z",
            "sync_status": "ok",
            "carrier_data": { "routing": { "input_needed": { "carrier": "gls-ch", "field": "dpdPostcode" } } },
            "notifications_muted": false,
            "tracking_events": [{
              "id": "\(UUID().uuidString)",
              "package_id": "\(packageID.uuidString)",
              "stage": "in_transit",
              "description": "In transit",
              "location": null,
              "occurred_at": "2026-08-09T10:00:00Z"
            }]
          }]
        }
        """
        let parcel = try XCTUnwrap(JSONDecoder.deliveryTracker.decode(PackageListResponse.self, from: Data(json.utf8)).packages.first)
        XCTAssertEqual(parcel.inputNeeded, CarrierInputNeeded(carrier: .glsCh, field: .dpdPostcode))
        XCTAssertEqual(parcel.inputNeededPrompt?.carrier, .glsCh)

        var sameCarrier = parcel
        sameCarrier.carrier = .glsCh
        XCTAssertNil(sameCarrier.inputNeededPrompt)
        var archived = parcel
        archived.archivedAt = "2026-08-10T10:00:00Z"
        XCTAssertNil(archived.inputNeededPrompt)
        for stage in [TrackingStage.delivered, .returned] {
            var finished = parcel
            finished.trackingEvents.append(event(packageID, stage, "2026-08-10T10:00:00Z"))
            XCTAssertNil(finished.inputNeededPrompt, stage.rawValue)
        }
        let trackingURLNeeded = try JSONDecoder.deliveryTracker.decode(
            CarrierInputNeeded.self, from: Data(#"{"carrier":"gls-ch","field":"trackingUrl"}"#.utf8)
        )
        XCTAssertEqual(trackingURLNeeded.field, .trackingURL)
        var link = parcel
        link.carrierData?.routing?.inputNeeded = trackingURLNeeded
        XCTAssertNil(link.inputNeededPrompt)

        let older = try JSONDecoder.deliveryTracker.decode(CarrierData.self, from: Data(#"{"sender_name":"Example sender"}"#.utf8))
        XCTAssertNil(older.routing)
        var untouched = parcel
        untouched.carrierData = older
        XCTAssertNil(untouched.inputNeeded)
        XCTAssertNil(untouched.inputNeededPrompt)
    }

    func testDecodesSharedAPIContractFixture() throws {
        struct Fixture: Decodable {
            let packageList: PackageListResponse
            let queue: QueueResponse
            let job: SyncJobResponse
        }
        let url = try XCTUnwrap(Bundle.main.url(forResource: "ContractFixtures", withExtension: "json"))
        let fixture = try JSONDecoder.deliveryTracker.decode(
            Fixture.self,
            from: Data(contentsOf: url)
        )

        XCTAssertEqual(fixture.packageList.packages.first?.carrier, .swissPost)
        XCTAssertEqual(fixture.packageList.packages.first?.trackingEvents.first?.stage, .inTransit)
        XCTAssertEqual(fixture.queue.jobIDs.count, 1)
        XCTAssertEqual(fixture.job.status, .succeeded)
        XCTAssertEqual(fixture.job.result?.checked, 1)
    }

    func testDecodesProductionPackagePayload() throws {
        let packageID = UUID()
        let eventID = UUID()
        let json = """
        {
          "packages": [{
            "id": "\(packageID.uuidString)",
            "tracking_number": "1Z999AA10123456784",
            "label": "Test parcel",
            "carrier": "ups",
            "created_at": "2026-08-01T10:00:00Z",
            "expected_delivery": null,
            "last_status_text": "In transit",
            "last_synced_at": "2026-08-09T10:00:00Z",
            "sync_status": "ok",
            "sync_error": null,
            "tracking_url": "https://www.ups.com/track?tracknum=1Z999AA10123456784",
            "dpd_postcode": null,
            "carrier_data": null,
            "archived_at": null,
            "notifications_muted": false,
            "tracking_events": [{
              "id": "\(eventID.uuidString)",
              "package_id": "\(packageID.uuidString)",
              "stage": "in_transit",
              "description": "In transit",
              "location": null,
              "occurred_at": "2026-08-09T10:00:00Z"
            }]
          }]
        }
        """

        let response = try JSONDecoder.deliveryTracker.decode(
            PackageListResponse.self,
            from: Data(json.utf8)
        )

        XCTAssertEqual(response.packages.first?.trackingURL, "https://www.ups.com/track?tracknum=1Z999AA10123456784")
        XCTAssertEqual(response.packages.first?.trackingEvents.first?.packageID, packageID)
    }

    func testDecodesNullTrackingEventsAsEmptyHistory() throws {
        let json = """
        {
          "packages": [{
            "id": "\(UUID().uuidString)",
            "tracking_number": "999999999999999999",
            "label": "New parcel",
            "carrier": "swiss-post",
            "created_at": "2026-08-09T10:00:00Z",
            "expected_delivery": null,
            "last_status_text": null,
            "last_synced_at": null,
            "sync_status": "waiting",
            "sync_error": null,
            "tracking_url": null,
            "dpd_postcode": null,
            "archived_at": null,
            "notifications_muted": false,
            "tracking_events": null
          }]
        }
        """

        let response = try JSONDecoder.deliveryTracker.decode(
            PackageListResponse.self,
            from: Data(json.utf8)
        )

        XCTAssertEqual(response.packages.first?.trackingEvents, [])
    }

    func testGeneratedRequestModelsEncodeAPIFieldNamesAndEnumValues() throws {
        let packageRequest = CreatePackageRequest(
            trackingNumber: "99.34.123456.12345678",
            carrier: .swissPost,
            trackingURL: "https://service.post.ch/parcel/123"
        )
        let packageJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.deliveryTracker.encode(packageRequest)
            ) as? [String: Any]
        )

        XCTAssertEqual(packageJSON["trackingNumber"] as? String, packageRequest.trackingNumber)
        XCTAssertEqual(packageJSON["carrier"] as? String, "swiss-post")
        XCTAssertEqual(packageJSON["trackingUrl"] as? String, packageRequest.trackingURL)
        XCTAssertNil(packageJSON["trackingURL"])

        let carrierRequest = ChangePackageCarrierRequest(
            carrier: .mondialRelay,
            dpdPostcode: "59650"
        )
        let carrierJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.deliveryTracker.encode(carrierRequest)
            ) as? [String: Any]
        )
        XCTAssertEqual(carrierJSON["carrier"] as? String, "mondial-relay")
        XCTAssertEqual(carrierJSON["dpdPostcode"] as? String, "59650")

        let pushRequest = NativePushDeviceRequest(
            token: "device-token",
            environment: .production,
            locale: .fr,
            deviceName: "iPhone",
            sendTest: true
        )
        let pushJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.deliveryTracker.encode(pushRequest)
            ) as? [String: Any]
        )

        XCTAssertEqual(pushJSON["environment"] as? String, "production")
        XCTAssertEqual(pushJSON["locale"] as? String, "fr")
        XCTAssertEqual(pushJSON["sendTest"] as? Bool, true)

        let installationID = UUID()
        let parcelID = UUID()
        let liveRequest = LiveActivityUpdateTokenRequest(
            installationID: installationID,
            activityID: "activity-1",
            parcelID: parcelID,
            token: "ab".repeated(32),
            environment: .development,
            locale: .de
        )
        let liveJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.deliveryTracker.encode(liveRequest)
            ) as? [String: Any]
        )
        XCTAssertEqual(liveJSON["installationId"] as? String, installationID.uuidString)
        XCTAssertEqual(liveJSON["parcelId"] as? String, parcelID.uuidString)
        XCTAssertEqual(liveJSON["activityId"] as? String, "activity-1")
    }

    func testDuplicateErrorDecodesItsExistingParcelLink() throws {
        let packageID = UUID()
        let error = try JSONDecoder.deliveryTracker.decode(
            ErrorResponse.self,
            from: Data("""
            {
              "error": "This tracking number is already in your delivery box",
              "packageId": "\(packageID.uuidString)"
            }
            """.utf8)
        )

        XCTAssertEqual(error.packageID, packageID)
    }

    func testFutureCarrierIdentifierDecodesAndEncodesWithoutAnAppRelease() throws {
        let packageID = UUID()
        let response = try JSONDecoder.deliveryTracker.decode(
            PackageListResponse.self,
            from: Data("""
            {
              "packages": [{
                "id": "\(packageID.uuidString)",
                "tracking_number": "FX12345678",
                "label": "Future parcel",
                "carrier": "future-express",
                "created_at": "2026-09-01T09:00:00Z",
                "sync_status": "waiting",
                "notifications_muted": false,
                "tracking_events": []
              }]
            }
            """.utf8)
        )
        let futureCarrier = try XCTUnwrap(response.packages.first?.carrier)
        XCTAssertEqual(futureCarrier.rawValue, "future-express")
        XCTAssertFalse(CarrierID.allCases.contains(futureCarrier))

        let request = CreatePackageRequest(
            trackingNumber: "FX12345678",
            carrier: futureCarrier
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: JSONEncoder.deliveryTracker.encode(request)
            ) as? [String: Any]
        )
        XCTAssertEqual(object["carrier"] as? String, "future-express")
    }

    func testWidgetPrioritizesOutForDeliveryThenKeepsNextUp() {
        let nextUp = widgetParcel(label: "Next up", outForDelivery: false)
        let outForDelivery = widgetParcel(label: "Courier", outForDelivery: true)
        let later = widgetParcel(label: "Later", outForDelivery: false)

        XCTAssertEqual(
            DeliveryWidgetSelection.displayParcels(from: [nextUp, outForDelivery, later]),
            [outForDelivery, nextUp]
        )
    }

    func testWidgetShowsTwoOutForDeliveryParcelsBeforeOtherCandidates() {
        let nextUp = widgetParcel(label: "Next up", outForDelivery: false)
        let first = widgetParcel(label: "Courier one", outForDelivery: true)
        let second = widgetParcel(label: "Courier two", outForDelivery: true)

        XCTAssertEqual(
            DeliveryWidgetSelection.displayParcels(from: [nextUp, first, second]),
            [first, second]
        )
        XCTAssertEqual(
            DeliveryWidgetSelection.displayParcels(from: [nextUp]),
            [nextUp]
        )
    }

    func testDisablingWidgetRemovesSharedParcelSnapshot() throws {
        let suiteName = "DeliveryWidgetSharedStoreTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = DeliveryWidgetSharedStore(defaults: defaults)
        let snapshot = DeliveryWidgetSnapshot(
            generatedAt: Date(timeIntervalSince1970: 1_700_000_000),
            languageCode: "fr",
            parcels: [widgetParcel(label: "Private parcel", outForDelivery: true)]
        )

        XCTAssertTrue(store.isEnabled)
        store.setLanguageCode("fr")
        store.setLiveActivitiesEnabled(true)
        XCTAssertTrue(store.save(snapshot))
        XCTAssertEqual(store.snapshot, snapshot)

        store.setEnabled(false)

        XCTAssertFalse(store.isEnabled)
        XCTAssertTrue(store.liveActivitiesEnabled)
        XCTAssertNil(store.snapshot)
        XCTAssertEqual(store.languageCode, "fr")
    }

    func testDeliveryLiveActivityOnlyStartsForDeliveryDay() {
        XCTAssertNil(TrackingStage.pending.deliveryActivityPhase)
        XCTAssertNil(TrackingStage.registered.deliveryActivityPhase)
        XCTAssertNil(TrackingStage.accepted.deliveryActivityPhase)
        XCTAssertNil(TrackingStage.inTransit.deliveryActivityPhase)
        XCTAssertNil(TrackingStage.customs.deliveryActivityPhase)
        XCTAssertEqual(TrackingStage.outForDelivery.deliveryActivityPhase, .outForDelivery)
        XCTAssertEqual(TrackingStage.delivered.deliveryActivityPhase, .delivered)
        XCTAssertEqual(TrackingStage.failedAttempt.deliveryActivityPhase, .failedAttempt)
        XCTAssertEqual(TrackingStage.readyForPickup.deliveryActivityPhase, .readyForPickup)
        XCTAssertEqual(TrackingStage.returned.deliveryActivityPhase, .returned)
        // A reported problem ends a running activity, like a failed attempt.
        XCTAssertEqual(TrackingStage.exception.deliveryActivityPhase, .exception)
    }

    func testLiveActivityPayloadUsesParcelAsStableIdentity() throws {
        let parcelID = UUID()
        let attributes = DeliveryActivityAttributes(parcelID: parcelID)
        let state = DeliveryActivityAttributes.ContentState(
            parcel: DeliveryActivityParcel(
                id: parcelID,
                label: "Running shoes",
                carrier: "Swiss Post",
                status: "Out for delivery",
                detail: "Today, 14:00–16:00",
                phase: .outForDelivery
            ),
            languageCode: "en"
        )
        let attributesJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(attributes)) as? [String: Any]
        )
        let stateJSON = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any]
        )
        let parcelJSON = try XCTUnwrap(stateJSON["parcel"] as? [String: Any])

        XCTAssertEqual(attributesJSON["parcelID"] as? String, parcelID.uuidString)
        XCTAssertEqual(parcelJSON["id"] as? String, parcelID.uuidString)
        XCTAssertEqual(parcelJSON["phase"] as? String, "out_for_delivery")
        XCTAssertEqual(stateJSON["languageCode"] as? String, "en")
        XCTAssertNil(parcelJSON["trackingNumber"])
    }

    func testPendingEventDoesNotOverrideCarrierProgress() {
        let id = UUID()
        let parcel = makeParcel(
            id: id,
            events: [
                event(id, .inTransit, "2026-08-08T10:00:00Z"),
                event(id, .pending, "2026-08-09T10:00:00Z"),
            ]
        )
        XCTAssertEqual(parcel.currentStage, .inTransit)
        XCTAssertEqual(parcel.currentEvent?.stage, .inTransit)
    }

    func testEventOrderingUsesInstantsAndStableTieBreakers() {
        let id = UUID()
        let accepted = event(id, .accepted, "2026-08-08T10:00:00Z")
        var transit = event(id, .inTransit, "2026-08-08T12:00:00.000+02:00")
        transit.id = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        var tied = transit
        tied.id = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
        let older = event(id, .registered, "2026-08-08T09:59:59.999Z")
        let invalid = event(id, .delivered, "invalid")
        let pending = event(id, .pending, "2026-08-09T10:00:00Z")
        let events = [older, tied, invalid, pending, accepted, transit]
        let expected = [pending, tied, transit, accepted, older, invalid].map(\.id)
        for offset in events.indices {
            let reordered = Array(events[offset...] + events[..<offset])
            let parcel = makeParcel(id: id, events: reordered)
            XCTAssertEqual(parcel.sortedEvents.map(\.id), expected)
            XCTAssertEqual(parcel.currentEvent?.id, tied.id)
        }
    }

    func testCurrentEventHandlesEmptyPendingAndUpdatedHistories() {
        let id = UUID()
        var parcel = makeParcel(id: id)
        XCTAssertNil(parcel.currentEvent)
        let pending = event(id, .pending, "2026-08-09T10:00:00Z")
        parcel.trackingEvents = [pending, event(id, .pending, "2026-08-08T10:00:00Z")]
        XCTAssertEqual(parcel.currentEvent?.id, pending.id)
        let accepted = event(id, .accepted, "2026-08-07T10:00:00Z")
        parcel.trackingEvents.append(accepted)
        XCTAssertEqual(parcel.currentEvent?.id, accepted.id)
        parcel.trackingEvents = [event(id, .delivered, "2026-08-10T10:00:00Z")]
        XCTAssertEqual(parcel.currentStage, .delivered)
    }

    func testRepeatedTimestampParsingPreservesFormatsAndInvalidValues() throws {
        let expected = try XCTUnwrap(DateParser.date("2026-08-08T10:00:00Z"))
        for _ in 0..<3 {
            XCTAssertEqual(DateParser.date("2026-08-08T12:00:00.000+02:00"), expected)
            XCTAssertEqual(DateParser.date("2026-08-08T10:00:00.123456Z")!.timeIntervalSince(expected), 0.123456, accuracy: 0.001)
            XCTAssertEqual(DateParser.date("2026-08-08T10:00:00Z"), expected)
            XCTAssertNil(DateParser.date("invalid"))
            XCTAssertNil(DateParser.date(""))
        }
    }

    func testParcelStatusLookupPerformance() {
        let parcels = (0..<30).map { index in
            let id = UUID()
            return makeParcel(id: id, events: (0..<20).map { day in
                event(id, .inTransit, String(format: "2026-08-%02dT%02d:00:00.000Z", day + 1, index % 24))
            })
        }
        measure {
            var count = 0
            // List grouping and card rendering repeatedly inspect each parcel's status.
            for parcel in parcels {
                for _ in 0..<20 {
                    if parcel.currentStage == .inTransit { count += 1 }
                }
            }
            XCTAssertEqual(count, 600)
        }
    }

    func testAttentionRulesMatchWebApp() {
        let now = DateParser.date("2026-08-09T12:00:00Z")!
        let id = UUID()
        let stalled = makeParcel(
            id: id,
            events: [event(id, .inTransit, "2026-08-04T10:00:00Z")]
        )
        XCTAssertEqual(stalled.attention(now: now), .stalled)

        var failed = stalled
        failed.syncStatus = .error
        XCTAssertEqual(failed.attention(now: now), .syncError)

        let announcedID = UUID()
        let announced = makeParcel(
            id: announcedID,
            events: [event(announcedID, .pending, "2026-08-01T08:00:00Z")]
        )
        XCTAssertNil(announced.attention(now: now))

        var oldUnannounced = announced
        oldUnannounced.syncStatus = .waiting
        XCTAssertEqual(oldUnannounced.displayStatus.key, "status.unannounced")
        XCTAssertEqual(oldUnannounced.attention(now: now), .notAnnounced)

        var recentUnannounced = oldUnannounced
        recentUnannounced.createdAt = "2026-08-08T12:01:00Z"
        XCTAssertNil(recentUnannounced.attention(now: now))
    }

    func testFiltersSearchCompactTrackingNumbers() {
        let parcel = makeParcel(trackingNumber: "99.34.123456.12345678")
        let result = ParcelOrganizer.visible(
            [parcel],
            query: "9934 123456",
            status: .all,
            carrier: nil,
            sort: .priority
        )
        XCTAssertEqual(result.map(\.id), [parcel.id])
    }

    func testArchivedParcelsAreNotActive() {
        var parcel = makeParcel()
        parcel.archivedAt = "2026-08-09T12:00:00Z"
        XCTAssertFalse(parcel.isActive)
        XCTAssertTrue(ParcelOrganizer.sections(from: [parcel]).contains { $0.kind == .archived })
    }

    func testPastDeliveriesSortByCompletionInsteadOfETAOrCreationOrder() {
        let olderID = UUID(), newerID = UUID()
        var older = makeParcel(id: olderID, events: [event(olderID, .delivered, "2026-09-06T12:00:00Z")])
        older.createdAt = "2026-09-07T12:00:00Z"
        older.expectedDelivery = "2026-09-12"
        var newer = makeParcel(id: newerID, events: [event(newerID, .delivered, "2026-09-07T12:00:00Z")])
        newer.createdAt = "2026-09-01T12:00:00Z"
        newer.expectedDelivery = "2026-09-14"
        let past = ParcelOrganizer.sections(from: [older, newer]).first { $0.kind == .delivered }
        XCTAssertEqual(past?.parcels.map(\.id), [newerID, olderID])
    }

    func testArchivedParcelsAreOrderedByNewestDisplayedDate() {
        let olderID = UUID()
        var older = makeParcel(
            id: olderID,
            events: [event(olderID, .delivered, "2026-08-05T12:00:00Z")]
        )
        older.archivedAt = "2026-08-10T12:00:00Z"

        let newerID = UUID()
        var newer = makeParcel(
            id: newerID,
            events: [event(newerID, .delivered, "2026-08-07T12:00:00Z")]
        )
        newer.archivedAt = "2026-08-09T12:00:00Z"

        let archived = ParcelOrganizer.sections(from: [older, newer])
            .first(where: { $0.kind == .archived })

        XCTAssertEqual(archived?.parcels.map(\.id), [newerID, olderID])
    }

    @MainActor
    func testEstimatesKeepTodayAndWindowsWhileOutForDeliveryAndHideObsoleteDates() {
        let id = UUID()
        let now = DateParser.date("2026-09-07T12:00:00Z")!
        let localizer = Localizer()
        localizer.language = .fr
        for stage in [TrackingStage.delivered, .returned, .failedAttempt, .readyForPickup, .exception] {
            var parcel = makeParcel(id: id, events: [event(id, stage, "2026-09-07T10:00:00Z")])
            parcel.expectedDelivery = "2026-09-07"
            XCTAssertNil(localizer.parcelDeliveryEstimate(parcel, now: now))
        }
        var parcel = makeParcel(id: id, events: [event(id, .outForDelivery, "2026-09-07T10:00:00Z")])
        parcel.expectedDelivery = "2026-09-07"
        XCTAssertEqual(localizer.parcelDeliveryEstimate(parcel, now: now), "aujourd’hui")
        parcel.expectedDelivery = "2026-09-07 14:00–16:00"
        XCTAssertEqual(localizer.parcelDeliveryEstimate(parcel, now: now), "aujourd’hui, 14:00–16:00")
        parcel.expectedDelivery = "2026-09-07T12:30:00Z"
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        let time = formatter.string(from: DateParser.date(parcel.expectedDelivery!)!)
        XCTAssertEqual(localizer.parcelDeliveryEstimate(parcel, now: now), "aujourd’hui, \(time)")
        parcel.expectedDelivery = "2026-09-06"
        XCTAssertNil(localizer.parcelDeliveryEstimate(parcel, now: now))
    }

    @MainActor
    func testCompletionDatesUseRelativeLabelsForFinalEvents() throws {
        let localizer = Localizer()
        localizer.language = .en
        let now = try XCTUnwrap(DateParser.deliveryDate("2026-09-09"))
        let id = UUID()
        for stage in [TrackingStage.delivered, .returned] {
            for (value, expected) in [("2026-09-08", "yesterday"), ("2026-09-09", "today"), ("2026-09-10", "tomorrow"), ("2026-09-12", "Sat 12 sep")] {
                let day = try XCTUnwrap(DateParser.deliveryDate(value))
                let late = try XCTUnwrap(Calendar.current.date(bySettingHour: 23, minute: 55, second: 0, of: day))
                let parcel = makeParcel(id: id, events: [event(id, stage, DateParser.isoString(late))])
                XCTAssertEqual(localizer.parcelCompletionDate(parcel, now: now), expected)
            }
        }
        XCTAssertNil(localizer.parcelCompletionDate(makeParcel(id: id, events: [event(id, .inTransit, DateParser.isoString(now))]), now: now))
        XCTAssertNil(localizer.parcelCompletionDate(makeParcel(id: id, events: [event(id, .delivered, "invalid")]), now: now))
    }

    @MainActor
    func testALinksCardSaysWhenAParcelArrivesAndAGiftNoMoreThanThat() {
        let localizer = Localizer()
        localizer.language = .en
        let id = UUID()
        let now = Date()
        let today = DateFormatter()
        today.dateFormat = "yyyy-MM-dd"

        // On its way: the estimate is a line of its own, and a gift only says when it arrives.
        var moving = makeParcel(id: id, events: [event(id, .outForDelivery, DateParser.isoString(now))])
        XCTAssertNil(localizer.sharedParcelDetail(moving))
        XCTAssertNil(localizer.giftDetail(moving, opened: false))
        moving.expectedDelivery = today.string(from: now)
        XCTAssertEqual(localizer.sharedParcelDetail(moving), "Today")
        XCTAssertEqual(localizer.giftDetail(moving, opened: false), "Arrives today")

        // Arrived: the day on the usual card, the day and the time for a gift that is opened.
        let arrived = makeParcel(id: id, events: [event(id, .delivered, DateParser.isoString(now))])
        XCTAssertEqual(localizer.sharedParcelDetail(arrived), "Today")
        XCTAssertEqual(localizer.giftDetail(arrived, opened: true), "Delivered today at \(localizer.clockTime(now))")
        XCTAssertNil(localizer.giftDetail(moving, opened: true))
    }

    func testPassportNewStampsUseExplicitScansAndLocalCompletionDates() throws {
        func shipment(_ scans: [(TrackingStage, String, String?)]) -> Parcel {
            let id = UUID()
            return makeParcel(id: id, events: scans.map { stage, date, location in
                var scan = event(id, stage, date)
                scan.location = location
                return scan
            })
        }
        var international = shipment([
            (.accepted, "2026-10-31T12:00:00Z", "Berlin, Germany"),
            (.readyForPickup, "2026-11-30T12:00:00Z", "Zurich, Switzerland"),
            (.delivered, "2026-12-01T08:00:00Z", "Zurich, Switzerland"),
            (.delivered, "2026-12-01T08:10:00Z", "Zurich, Switzerland"),
        ])
        international.archivedAt = "2026-12-02T12:00:00Z"
        let parcels = [international,
            shipment([(.accepted, "2026-11-29T12:00:00Z", "CH"), (.delivered, "2026-12-01T09:00:00Z", "CH")]),
            shipment([(.delivered, "2026-11-30T23:30:00Z", nil)]),
        ]
        let stats = PassportStatistics(parcels: parcels, timeZone: try XCTUnwrap(TimeZone(identifier: "Europe/Zurich")))
        XCTAssertEqual(stats.crossBorderCount, 1)
        XCTAssertEqual(stats.domesticDeliveryCount, 1)
        XCTAssertEqual(stats.longWaitDeliveryCount, 1)
        XCTAssertEqual(stats.pickupDeliveryCount, 1)
        XCTAssertEqual(stats.decemberDeliveryCount, 3)
        XCTAssertEqual(stats.maxDeliveriesInOneDay, 3)
        let utc = PassportStatistics(parcels: parcels, timeZone: try XCTUnwrap(TimeZone(secondsFromGMT: 0)))
        XCTAssertEqual(utc.decemberDeliveryCount, 2)
        XCTAssertEqual(utc.maxDeliveriesInOneDay, 2)
    }

    func testPassportNewStampsRejectUnprovenJourneys() throws {
        func shipment(_ scans: [(TrackingStage, String, String?)]) -> Parcel {
            let id = UUID()
            return makeParcel(id: id, events: scans.map { stage, date, location in
                var scan = event(id, stage, date)
                scan.location = location
                return scan
            })
        }
        let stats = PassportStatistics(parcels: [
            shipment([(.registered, "2026-11-01T00:00:00Z", "DE"), (.accepted, "2026-11-02T00:00:00Z", nil), (.delivered, "2026-11-03T00:00:00Z", "CH")]),
            shipment([(.accepted, "2026-11-01T00:00:00Z", "Wilmington, DE"), (.delivered, "2026-11-03T00:00:00Z", "Geneva, GE")]),
            shipment([(.accepted, "2026-11-01T00:00:00Z", "DE"), (.readyForPickup, "2026-11-01T00:00:00Z", "CH"), (.delivered, "2026-11-01T00:00:00Z", "CH")]),
            shipment([(.accepted, "2026-11-01T00:00:00Z", "DE"), (.readyForPickup, "2026-12-02T00:00:00Z", "CH")]),
            shipment([(.accepted, "2026-11-01T00:00:00Z", "DE"), (.delivered, "2026-12-02T00:00:00Z", "CH"), (.returned, "2026-12-03T00:00:00Z", nil)]),
            shipment([(.accepted, "invalid", "DE"), (.delivered, "2026-12-02T00:00:00Z", "CH")]),
        ], timeZone: try XCTUnwrap(TimeZone(secondsFromGMT: 0)))
        XCTAssertEqual(stats.crossBorderCount, 0)
        XCTAssertEqual(stats.domesticDeliveryCount, 0)
        XCTAssertEqual(stats.longWaitDeliveryCount, 0)
        XCTAssertEqual(stats.pickupDeliveryCount, 0)
        XCTAssertEqual(stats.decemberDeliveryCount, 0)
    }

    func testPassportWaitingStampRequiresMoreThanThirtyDays() {
        let id = UUID()
        let start = event(id, .accepted, "2026-11-01T00:00:00Z")
        let exact = makeParcel(id: id, events: [start, event(id, .delivered, "2026-12-01T00:00:00Z")])
        let longer = makeParcel(id: id, events: [start, event(id, .delivered, "2026-12-01T00:00:00.001Z")])
        XCTAssertEqual(PassportStatistics(parcels: [exact]).longWaitDeliveryCount, 0)
        XCTAssertEqual(PassportStatistics(parcels: [longer]).longWaitDeliveryCount, 1)
    }

    func testEmptyPassportHasNoInventedRecordsOrCountries() {
        let statistics = PassportStatistics(parcels: [])
        XCTAssertEqual(statistics.trackedCount, 0)
        XCTAssertEqual(statistics.deliveredCount, 0)
        XCTAssertEqual(statistics.activeCount, 0)
        XCTAssertEqual(statistics.durationSampleCount, 0)
        XCTAssertNil(statistics.averageDeliveryDuration)
        XCTAssertNil(statistics.fastestDelivery)
        XCTAssertTrue(statistics.originCountries.isEmpty)
        XCTAssertEqual(statistics.unknownOriginCount, 0)
        XCTAssertEqual(statistics.nextMilestoneCount, 1)
        XCTAssertEqual(statistics.milestoneProgress, 0)
    }

    func testPassportUsesCarrierJourneyTimesAndIncludesArchivedDeliveries() throws {
        let firstID = UUID()
        var first = makeParcel(id: firstID, events: [
            event(firstID, .registered, "2026-08-01T10:00:00Z"),
            event(firstID, .accepted, "2026-08-06T10:00:00Z"),
            event(firstID, .delivered, "2026-08-08T10:00:00Z"),
        ])
        first.archivedAt = "2026-08-09T10:00:00Z"
        let secondID = UUID()
        var second = makeParcel(id: secondID, events: [
            event(secondID, .inTransit, "2026-08-07T10:00:00Z"),
            event(secondID, .delivered, "2026-08-08T10:00:00Z"),
            event(secondID, .pending, "2026-08-09T10:00:00Z"),
        ])
        // A parcel added after delivery still has a valid carrier journey.
        second.createdAt = "2026-08-10T10:00:00Z"
        let returnedID = UUID()
        let returned = makeParcel(id: returnedID, events: [
            event(returnedID, .accepted, "2026-08-05T10:00:00Z"),
            event(returnedID, .delivered, "2026-08-06T10:00:00Z"),
            event(returnedID, .returned, "2026-08-08T10:00:00Z"),
        ])
        let statistics = PassportStatistics(parcels: [first, second, returned, makeParcel()])
        XCTAssertEqual(statistics.trackedCount, 4)
        XCTAssertEqual(statistics.deliveredCount, 2)
        XCTAssertEqual(statistics.activeCount, 1)
        XCTAssertEqual(statistics.durationSampleCount, 2)
        XCTAssertEqual(try XCTUnwrap(statistics.averageDeliveryDuration), 36 * 3_600, accuracy: 0.001)
        XCTAssertEqual(statistics.fastestDelivery?.parcelID, secondID)
        XCTAssertEqual(statistics.fastestDelivery?.duration, 24 * 3_600)
        XCTAssertEqual(statistics.fastestDelivery?.deliveredAt, DateParser.date("2026-08-08T10:00:00Z"))
    }

    func testPassportOrdersActualInstantsAcrossTimeZones() throws {
        let id = UUID()
        let parcel = makeParcel(id: id, events: [
            // Lexical order incorrectly puts the accepted scan last.
            event(id, .accepted, "2026-08-08T12:00:00+03:00"),
            event(id, .delivered, "2026-08-08T11:00:00Z"),
        ])
        let statistics = PassportStatistics(parcels: [parcel])
        XCTAssertEqual(statistics.deliveredCount, 1)
        XCTAssertEqual(statistics.activeCount, 0)
        XCTAssertEqual(try XCTUnwrap(statistics.averageDeliveryDuration), 2 * 3_600, accuracy: 0.001)
    }

    func testPassportDoesNotInventDurationsFromPartialOrInvalidHistories() {
        let histories: [[(TrackingStage, String)]] = [
            [(.delivered, "2026-08-08T10:00:00Z")],
            [(.registered, "2026-08-07T10:00:00Z"), (.delivered, "2026-08-08T10:00:00Z")],
            [(.outForDelivery, "2026-08-08T09:00:00Z"), (.delivered, "2026-08-08T10:00:00Z")],
            [(.accepted, "invalid"), (.delivered, "2026-08-08T10:00:00Z")],
            [(.accepted, "2026-08-08T10:00:00Z"), (.delivered, "invalid")],
            [(.accepted, "2026-08-09T10:00:00Z"), (.delivered, "2026-08-08T10:00:00Z")],
            [(.accepted, "2026-08-08T10:00:00Z"), (.delivered, "2026-08-08T10:00:00Z")],
        ]
        for history in histories {
            let id = UUID()
            let parcel = makeParcel(id: id, events: history.map { event(id, $0.0, $0.1) })
            let statistics = PassportStatistics(parcels: [parcel])
            XCTAssertEqual(statistics.durationSampleCount, 0, "Unexpected duration for \(history)")
            XCTAssertNil(statistics.averageDeliveryDuration)
            XCTAssertNil(statistics.fastestDelivery)
        }
    }

    func testPassportCountryRanksRequireExplicitFirstPhysicalScanCountry() {
        func originParcel(_ location: String?) -> Parcel {
            let id = UUID()
            var scan = event(id, .accepted, "2026-08-06T10:00:00Z")
            scan.location = location
            // Neither the international identifier nor UPS's headquarters is evidence.
            return makeParcel(id: id, trackingNumber: "RR123456785US", events: [scan])
        }
        let statistics = PassportStatistics(parcels: [
            originParcel("Milano, IT"), originParcel("Roma, Italy"),
            originParcel("Berlin (Germany)"), originParcel("Paris, France"),
            originParcel("Buchs AG"), originParcel(nil), originParcel("Europe"),
        ])
        XCTAssertEqual(statistics.originCountries.map(\.code), ["IT", "DE", "FR"])
        XCTAssertEqual(statistics.originCountries.map(\.count), [2, 1, 1])
        XCTAssertEqual(statistics.originCountries.first?.flag, "🇮🇹")
        XCTAssertEqual(statistics.knownOriginCount, 4)
        XCTAssertEqual(statistics.unknownOriginCount, 3)
    }

    func testPassportNeverPromotesLaterDestinationScanToOrigin() {
        let id = UUID()
        var registered = event(id, .registered, "2026-08-05T10:00:00Z")
        registered.location = "London, GB"
        let accepted = event(id, .accepted, "2026-08-06T10:00:00Z")
        var transit = event(id, .inTransit, "2026-08-07T10:00:00Z")
        transit.location = "Zürich, CH"
        let unknown = PassportStatistics(parcels: [makeParcel(id: id, events: [registered, accepted, transit])])
        XCTAssertTrue(unknown.originCountries.isEmpty)
        XCTAssertEqual(unknown.unknownOriginCount, 1)

        // Registration's location is ignored; the first physical scan supplies evidence.
        var locatedAccepted = accepted
        locatedAccepted.location = "Paris, Frankreich"
        let known = PassportStatistics(parcels: [makeParcel(id: id, events: [registered, locatedAccepted, transit])])
        XCTAssertEqual(known.originCountries.map(\.code), ["FR"])

        var customs = event(id, .customs, "2026-08-06T10:00:00Z")
        customs.location = "Basel, CH"
        XCTAssertTrue(PassportStatistics(parcels: [makeParcel(id: id, events: [customs, transit])]).originCountries.isEmpty)
    }

    func testPassportDoesNotMistakeStateOrCantonCodesForCountries() {
        for location in ["Los Angeles, CA", "Bern, BE", "Dover, DE", "Fribourg (FR)", "St. John's, NL"] {
            let id = UUID()
            var scan = event(id, .accepted, "2026-08-06T10:00:00Z")
            scan.location = location
            let statistics = PassportStatistics(parcels: [makeParcel(id: id, events: [scan])])
            XCTAssertTrue(statistics.originCountries.isEmpty, "Ambiguous address: \(location)")
        }
        for (location, code) in [("Toronto, Canada", "CA"), ("Brussels, Belgium", "BE"), ("DE", "DE")] {
            let id = UUID()
            var scan = event(id, .accepted, "2026-08-06T10:00:00Z")
            scan.location = location
            let statistics = PassportStatistics(parcels: [makeParcel(id: id, events: [scan])])
            XCTAssertEqual(statistics.originCountries.first?.code, code)
        }
    }

    func testPassportTiesAndMilestonesAreStableWhenParcelOrderChanges() {
        let parcels = (1...5).map { index in
            let id = UUID(uuidString: "00000000-0000-0000-0000-\(String(format: "%012d", index))")!
            return makeParcel(id: id, events: [
                event(id, .accepted, "2026-08-06T10:00:00Z"),
                event(id, .delivered, "2026-08-07T10:00:00Z"),
            ])
        }
        let forward = PassportStatistics(parcels: parcels)
        let reverse = PassportStatistics(parcels: parcels.reversed())
        XCTAssertEqual(forward.fastestDelivery, reverse.fastestDelivery)
        XCTAssertEqual(forward.fastestDelivery?.parcelID, parcels.first?.id)
        XCTAssertEqual(forward.nextMilestoneCount, 10)
        XCTAssertEqual(forward.milestoneProgress, 0.5)
    }

    @MainActor
    func testFriendsPreviewSharesOnlyChosenRoundedSummary() throws {
        let id = UUID()
        let parcel = makeParcel(id: id, events: [
            event(id, .accepted, "2026-09-06T10:00:00Z"),
            event(id, .delivered, "2026-09-07T11:00:00Z"),
        ])
        let now = DateParser.date("2026-09-08T12:00:00Z")!
        var profile = FriendProfile(nickname: "My nickname", shareStats: true, shareArrival: false)
        let card = FriendsStore.ownCard(parcels: [parcel], profile: profile, now: now)
        XCTAssertEqual(card.stats?.deliveredCount, 1)
        XCTAssertEqual(card.stats?.averageDays, 2)
        XCTAssertEqual(card.stats?.stamps, [.first, .express])
        XCTAssertNil(card.arrivedThisWeek)
        let encoded = String(data: try JSONEncoder().encode(card), encoding: .utf8)!
        for secret in [parcel.trackingNumber, parcel.label, id.uuidString, "occurredAt", "trackingEvents", "carrier"] {
            XCTAssertFalse(encoded.contains(secret))
        }
        profile.shareStats = false
        profile.shareArrival = true
        let privateCard = FriendsStore.ownCard(parcels: [parcel], profile: profile, now: now)
        XCTAssertNil(privateCard.stats)
        XCTAssertEqual(privateCard.arrivedThisWeek, true)
        var returned = parcel
        returned.trackingEvents.append(event(id, .returned, "2026-09-08T10:00:00Z"))
        XCTAssertEqual(FriendsStore.ownCard(parcels: [returned], profile: profile, now: now).arrivedThisWeek, false)
    }

    @MainActor
    func testFriendsWeekUsesFirstDeliveryAndUTCBoundary() {
        let id = UUID()
        let parcel = makeParcel(id: id, events: [
            event(id, .accepted, "2026-09-04T10:00:00Z"),
            event(id, .delivered, "2026-09-06T23:59:00Z"),
            event(id, .delivered, "2026-09-07T11:00:00Z"),
        ])
        let profile = FriendProfile(nickname: "Test", shareStats: false, shareArrival: true)
        let now = DateParser.date("2026-09-08T12:00:00Z")!
        XCTAssertEqual(FriendsStore.ownCard(parcels: [parcel], profile: profile, now: now).arrivedThisWeek, false)
    }

    func testSharedFriendsFixtureDecodesIncludingHiddenStatistics() throws {
        let url = Bundle.main.url(forResource: "FriendsDemo", withExtension: "json")!
        let snapshot = try JSONDecoder().decode(FriendsSnapshot.self, from: Data(contentsOf: url))
        XCTAssertEqual(snapshot.friends.count, 3)
        XCTAssertEqual(snapshot.friends.first?.stats?.stamps, [.first, .ten, .connected, .express])
        XCTAssertNil(snapshot.friends.last?.stats)
        XCTAssertNil(snapshot.friends.last?.arrivedThisWeek)
        XCTAssertEqual(snapshot.profile?.shareArrival, false)
    }

    func testNextDeliveryKeepsIssuesSeparateAndPrioritizesPickup() {
        let now = DateParser.date("2026-09-09T12:00:00Z")!
        func shipment(_ stage: TrackingStage) -> Parcel {
            let id = UUID()
            return makeParcel(id: id, events: [event(id, stage, "2026-09-09T08:00:00Z")])
        }
        let customs = shipment(.customs)
        let failed = shipment(.failedAttempt)
        var delivery = shipment(.outForDelivery)
        delivery.syncStatus = .error
        let pickup = shipment(.readyForPickup)
        XCTAssertEqual(ParcelOrganizer.nextDelivery(from: [customs, failed, delivery], now: now)?.id, delivery.id)
        XCTAssertEqual(ParcelOrganizer.nextDelivery(from: [customs, delivery, pickup], now: now)?.id, pickup.id)
        XCTAssertNil(ParcelOrganizer.nextDelivery(from: [customs, failed], now: now))
        XCTAssertNil(ParcelOrganizer.nextDelivery(from: [shipment(.delivered), shipment(.returned)], now: now))
        var archived = delivery
        archived.archivedAt = "2026-09-09T10:00:00Z"
        XCTAssertNil(ParcelOrganizer.nextDelivery(from: [archived], now: now))
    }

    func testNextDeliveryPrefersAParcelWhoseRouteCanBeDrawnOnTheSameDay() {
        let now = DateParser.date("2026-09-09T12:00:00Z")!
        let zurich = EventPlace(latitude: 47.37, longitude: 8.54, precision: .city, country: "CH", name: "Zürich")
        func shipment(_ stage: TrackingStage, at occurredAt: String, place: EventPlace? = nil, expected: String? = nil) -> Parcel {
            let id = UUID()
            var parcel = makeParcel(id: id, events: [TrackingEvent(
                id: UUID(), packageID: id, stage: stage, description: "Update", location: nil, occurredAt: occurredAt, place: place
            )])
            parcel.expectedDelivery = expected
            return parcel
        }
        // Without a date on either, the newer update used to win; the map now decides first.
        let newer = shipment(.inTransit, at: "2026-09-09T09:00:00Z")
        let placed = shipment(.inTransit, at: "2026-09-09T07:00:00Z", place: zurich)
        XCTAssertEqual(ParcelOrganizer.nextDelivery(from: [newer, placed], now: now)?.id, placed.id)
        let datedNewer = shipment(.inTransit, at: "2026-09-09T09:00:00Z", expected: "2026-09-10")
        let datedPlaced = shipment(.inTransit, at: "2026-09-09T07:00:00Z", place: zurich, expected: "2026-09-10")
        XCTAssertEqual(ParcelOrganizer.nextDelivery(from: [datedNewer, datedPlaced], now: now)?.id, datedPlaced.id)
        // An earlier day or a more urgent stage still comes first.
        let sooner = shipment(.inTransit, at: "2026-09-09T06:00:00Z", expected: "2026-09-09")
        XCTAssertEqual(ParcelOrganizer.nextDelivery(from: [sooner, datedPlaced], now: now)?.id, sooner.id)
        let pickup = shipment(.readyForPickup, at: "2026-09-09T06:00:00Z")
        XCTAssertEqual(ParcelOrganizer.nextDelivery(from: [pickup, placed], now: now)?.id, pickup.id)
    }

    func testStampNamesTheFirstPlacedCountryAndIsDatedOnlyOnceDelivered() {
        func scan(_ day: Int, _ stage: TrackingStage, _ place: EventPlace?) -> TrackingEvent {
            TrackingEvent(id: UUID(), packageID: UUID(), stage: stage, description: "Update", location: nil,
                          occurredAt: "2026-09-\(day)T12:00:00Z", place: place)
        }
        let kyoto = EventPlace(latitude: 35.01, longitude: 135.77, precision: .city, country: "JP", name: "Kyoto")
        let zurich = EventPlace(latitude: 47.37, longitude: 8.54, precision: .city, country: "CH", name: "Zürich")
        // Scans arrive in no particular order; the origin is the earliest one with a place.
        let scans = [scan(20, .outForDelivery, zurich), scan(10, .registered, nil), scan(11, .accepted, kyoto)]
        let travelling = makeParcel(events: scans)
        XCTAssertEqual(travelling.stampOrigin, "JP")
        XCTAssertNil(travelling.stampDeliveryDate)

        let arrived = makeParcel(events: scans + [scan(21, .delivered, zurich)])
        XCTAssertEqual(arrived.stampOrigin, "JP")
        XCTAssertEqual(arrived.stampDeliveryDate, "21.09")

        let unplaced = makeParcel(events: [scan(10, .registered, nil)])
        XCTAssertNil(unplaced.stampOrigin)
    }

    func testJustDeliveredAreTheParcelsShownOnTheirWayThatHaveArrived() {
        let tea = UUID(), lamp = UUID(), book = UUID()
        let shown = [
            makeParcel(id: tea, events: [event(tea, .outForDelivery, "2026-09-02T08:00:00Z")]),
            makeParcel(id: lamp, events: [event(lamp, .inTransit, "2026-09-02T08:00:00Z")]),
            makeParcel(id: book, events: [event(book, .delivered, "2026-09-01T08:00:00Z")]),
        ]
        var now = shown
        now[0].trackingEvents.append(event(tea, .delivered, "2026-09-03T08:00:00Z"))
        now[1].trackingEvents.append(event(lamp, .outForDelivery, "2026-09-03T08:00:00Z"))
        // The parcel comes back as the list showed it: that is the place it keeps.
        XCTAssertEqual(ParcelOrganizer.justDelivered(shown: shown, now: now), [shown[0]])
        // One archived in the meantime, or gone, has no card to move.
        now[0].archivedAt = "2026-09-03T09:00:00Z"
        XCTAssertTrue(ParcelOrganizer.justDelivered(shown: shown, now: now).isEmpty)
        XCTAssertTrue(ParcelOrganizer.justDelivered(shown: shown, now: []).isEmpty)
    }

    func testDeliveredHoldKeepsTheListAsItWasUntilItsCardsLeave() {
        let tea = UUID(), lamp = UUID()
        // Scanned in the last hours: neither parcel has been still for long enough to be flagged.
        let earlier = DateParser.isoString(Date().addingTimeInterval(-7_200))
        let lately = DateParser.isoString(Date().addingTimeInterval(-600))
        let shown = [
            makeParcel(id: tea, events: [event(tea, .outForDelivery, earlier)]),
            makeParcel(id: lamp, events: [event(lamp, .inTransit, earlier)]),
        ]
        var now = shown
        now[0].trackingEvents.append(event(tea, .delivered, lately))
        // The same news makes the lamp the most urgent parcel: on its own, that would move the tea out of its place.
        now[1].trackingEvents.append(event(lamp, .readyForPickup, lately))
        func layout(_ parcels: [Parcel]) -> DeliveryListLayout {
            DeliveryListLayout(parcels: parcels, query: "", status: .all, carrier: nil, sort: .priority, featuresNext: true)
        }

        var hold = DeliveredHold()
        hold.receive(shown: shown, next: now, watching: true)
        XCTAssertEqual(hold.ids, [tea])
        XCTAssertTrue(hold.holds(tea))
        let held = layout(hold.arranged(now))
        XCTAssertEqual(held.next?.id, tea)
        XCTAssertEqual(held.kind(of: lamp), .onTheWay)
        XCTAssertEqual(held.active.count, 2)

        // Let go, the tea joins the past deliveries and the lamp becomes Next up: those two cards are others.
        let after = layout(now)
        let changes = held.changing(into: after)
        XCTAssertEqual(Set(changes.keys), [tea, lamp])
        XCTAssertEqual(changes[tea]?.was, .next)
        XCTAssertEqual(changes[tea]?.becomes, .past)
        XCTAssertEqual(changes[lamp]?.becomes, .next)

        // More news for a held parcel keeps it held; archiving it lets it go, and it is arranged as it is.
        hold.receive(shown: now, next: now, watching: true)
        XCTAssertEqual(hold.ids, [tea])
        var archived = now
        archived[0].archivedAt = lately
        XCTAssertTrue(hold.arranged(archived)[0].isArchived)
        hold.receive(shown: now, next: archived, watching: true)
        XCTAssertTrue(hold.isEmpty)
        XCTAssertEqual(hold.arranged(now), now)

        // A list that nobody is looking at holds nothing, and one that stops being looked at lets go.
        var unseen = DeliveredHold()
        unseen.receive(shown: shown, next: now, watching: false)
        XCTAssertTrue(unseen.isEmpty)
        unseen.receive(shown: shown, next: now, watching: true)
        XCTAssertFalse(unseen.isEmpty)
        unseen.release()
        XCTAssertTrue(unseen.isEmpty)
        XCTAssertEqual(unseen, DeliveredHold())
    }

    func testDeliveredConfettiPopsOutOfItsOriginAndFallsAway() throws {
        let origin = CGPoint(x: 200, y: 300)
        let burst = DeliveredConfetti(origin: origin, count: DeliveredConfetti.next, seed: 7)
        // A burst follows from its seed.
        XCTAssertEqual(burst, DeliveredConfetti(origin: origin, count: DeliveredConfetti.next, seed: 7))
        XCTAssertNotEqual(burst.pieces, DeliveredConfetti(origin: origin, count: DeliveredConfetti.next, seed: 8).pieces)
        XCTAssertEqual(burst.pieces.count, 58)
        XCTAssertEqual(DeliveredConfetti(origin: origin, count: DeliveredConfetti.other, seed: 7).pieces.count, 38)
        XCTAssertEqual(burst.glints.count, 6)
        XCTAssertGreaterThan(burst.duration, 1.5)
        XCTAssertLessThanOrEqual(burst.duration, 2.4)
        XCTAssertGreaterThan(Set(burst.pieces.map(\.tone)).count, 4)

        for piece in burst.pieces {
            XCTAssertTrue((0..<DeliveredConfetti.tones).contains(piece.tone))
            // Not there before it is thrown, nor once it has gone.
            XCTAssertNil(burst.pose(of: piece, at: piece.delay - 0.001))
            XCTAssertNil(burst.pose(of: piece, at: piece.delay + piece.life + 0.001))
            let start = try XCTUnwrap(burst.pose(of: piece, at: piece.delay))
            XCTAssertEqual(start.center.x, origin.x, accuracy: 0.001)
            XCTAssertEqual(start.center.y, origin.y, accuracy: 0.001)
            XCTAssertEqual(start.opacity, 0, accuracy: 0.001)
            // Up out of the box, then down, a long way below its highest point, and faint by the end.
            let heights = stride(from: 0.0, to: piece.life, by: 0.02).compactMap { burst.pose(of: piece, at: piece.delay + $0)?.center.y }
            let top = try XCTUnwrap(heights.min())
            XCTAssertLessThan(top, origin.y - 5)
            XCTAssertGreaterThan(try XCTUnwrap(heights.last), top + 100)
            XCTAssertEqual(try XCTUnwrap(burst.pose(of: piece, at: piece.delay + 0.3)).opacity, 1, accuracy: 0.001)
            XCTAssertLessThan(try XCTUnwrap(burst.pose(of: piece, at: piece.delay + piece.life - 0.01)).opacity, 0.05)
        }
        for glint in burst.glints {
            XCTAssertNil(burst.pose(of: glint, at: glint.delay + glint.life + 0.001))
            let start = try XCTUnwrap(burst.pose(of: glint, at: glint.delay))
            XCTAssertEqual(start.center.x, origin.x, accuracy: 0.001)
            XCTAssertEqual(start.scale.width, 0, accuracy: 0.001)
            // It flies out as far as it reaches, shrinking to nothing.
            let end = try XCTUnwrap(burst.pose(of: glint, at: glint.delay + glint.life - 0.0001))
            XCTAssertEqual(hypot(end.center.x - origin.x, end.center.y - origin.y), glint.reach, accuracy: 0.5)
            XCTAssertLessThan(end.scale.width, 0.01)
        }
        // The paper's colours: the card's ink, its carrier's and the app's yellow, one for each tone.
        XCTAssertEqual(DeliveredPaperBurst.colors(ink: .black, surface: .white, brand: .red).count, DeliveredConfetti.tones)
    }

    @MainActor func testDeliveredFlightFoldsEarlyGrowsLateAndKeepsTheNamesOnOneLine() {
        let high = DeliveryCardPlaces.Place(frame: CGRect(x: 16, y: 62, width: 370, height: 242), title: 166)
        let low = DeliveryCardPlaces.Place(frame: CGRect(x: 16, y: 474, width: 370, height: 102), title: 54)
        func falling(_ progress: CGFloat) -> DeliveredFlightPose {
            DeliveredFlightPose(from: high, to: low, was: .next, becomes: .past, lifted: true, progress: progress)
        }
        XCTAssertEqual(falling(0).frame, high.frame)
        XCTAssertEqual(falling(0).cornerRadius, 24)
        XCTAssertEqual(falling(0).leaving, 0)
        XCTAssertEqual(falling(0).arriving, 112)
        XCTAssertEqual(falling(0).arrival, 0)
        XCTAssertEqual(falling(0).shadow, 0)
        // A card that shrinks is small well before it lands, and casts its shadow on the way.
        XCTAssertEqual(falling(0.72).frame.height, 102, accuracy: 0.001)
        XCTAssertEqual(falling(0.72).frame.minY, 62 + 412 * 0.72, accuracy: 0.001)
        XCTAssertEqual(falling(0.5).shadow, 1)
        XCTAssertEqual(falling(1).frame, low.frame)
        XCTAssertEqual(falling(1).cornerRadius, 16)
        XCTAssertEqual(falling(1).leaving, -112)
        XCTAssertEqual(falling(1).arriving, 0)
        XCTAssertEqual(falling(1).arrival, 1)
        XCTAssertEqual(falling(1).shadow, 0)
        // Past its place, as a spring goes, the card moves on but keeps its shape.
        XCTAssertEqual(falling(1.02).frame.height, 102, accuracy: 0.001)
        XCTAssertGreaterThan(falling(1.02).frame.minY, 474)

        // The card that takes the place grows late, and is not lifted.
        let rising = DeliveredFlightPose(from: low, to: high, was: .onTheWay, becomes: .next, lifted: false, progress: 0.28)
        XCTAssertEqual(rising.frame.height, 102, accuracy: 0.001)
        XCTAssertEqual(rising.arrival, 0)
        XCTAssertEqual(rising.shadow, 0)
        XCTAssertEqual(DeliveredFlightPose(from: low, to: high, was: .onTheWay, becomes: .next, lifted: false, progress: 1).frame, high.frame)
    }

    private func makeParcel(
        id: UUID = UUID(),
        trackingNumber: String = "1Z999AA10123456784",
        events: [TrackingEvent] = []
    ) -> Parcel {
        Parcel(
            id: id,
            trackingNumber: trackingNumber,
            label: "Test parcel",
            carrier: .ups,
            createdAt: "2026-08-01T10:00:00Z",
            expectedDelivery: nil,
            lastStatusText: nil,
            lastSyncedAt: nil,
            syncStatus: .ok,
            syncError: nil,
            trackingURL: nil,
            dpdPostcode: nil,
            carrierData: nil,
            archivedAt: nil,
            notificationsMuted: false,
            trackingEvents: events
        )
    }

    private func event(_ packageID: UUID, _ stage: TrackingStage, _ occurredAt: String) -> TrackingEvent {
        TrackingEvent(
            id: UUID(), packageID: packageID, stage: stage,
            description: "Update", location: nil, occurredAt: occurredAt
        )
    }

    private func widgetParcel(label: String, outForDelivery: Bool) -> DeliveryWidgetParcel {
        DeliveryWidgetParcel(
            id: UUID(),
            label: label,
            carrier: "Swiss Post",
            trackingNumber: "99.34.123456.12345678",
            detail: "Today",
            isOutForDelivery: outForDelivery
        )
    }
}

private extension String {
    func repeated(_ count: Int) -> String {
        String(repeating: self, count: count)
    }
}

@MainActor
private final class StubArchivePanGestureRecognizer: UIPanGestureRecognizer {
    var testTranslation: CGPoint = .zero

    override func translation(in view: UIView?) -> CGPoint { testTranslation }
    override func velocity(in view: UIView?) -> CGPoint { .zero }
}

private final class MemorySessionPersistence: SessionPersistence {
    var data: Data?
    func save<T: Encodable>(_ value: T) throws { data = try JSONEncoder.deliveryTracker.encode(value) }
    func load<T: Decodable>() -> T? { data.flatMap { try? JSONDecoder.deliveryTracker.decode(T.self, from: $0) } }
    func delete() { data = nil }
}

private final class SessionTestURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest, @escaping (Result<(Int, Data), Error>) -> Void) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "session.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.handler?(request) { result in
            switch result {
            case .success(let (status, data)):
                self.client?.urlProtocol(self, didReceive: HTTPURLResponse(url: self.request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                self.client?.urlProtocol(self, didLoad: data)
                self.client?.urlProtocolDidFinishLoading(self)
            case .failure(let error): self.client?.urlProtocol(self, didFailWithError: error)
            }
        }
    }
    override func stopLoading() {}
}

@MainActor
private final class StubAppleSignIn: AppleSignInAuthorizing {
    var nonces: [String] = []
    var result: Result<String, Error> = .success("apple-identity-token")
    var beforeReturning: (() -> Void)?
    func identityToken(nonce: String) async throws -> String {
        nonces.append(nonce)
        beforeReturning?()
        return try result.get()
    }
}

final class SessionIsolationTests: XCTestCase {
    @MainActor private var configuration: AppConfiguration {
        AppConfiguration(mode: .api, apiBaseURL: URL(string: "https://session.test")!, supabaseURL: URL(string: "https://session.test")!, supabasePublishableKey: "public", googleAuthEnabled: false, appleAuthEnabled: true, emailOTPEnabled: true, appGroupIdentifier: "session.test")
    }
    private func transport() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SessionTestURLProtocol.self]
        return URLSession(configuration: config)
    }
    private func respond(_ data: Data, status: Int = 200) {
        SessionTestURLProtocol.handler = { _, complete in complete(.success((status, data))) }
    }
    private func offline() {
        SessionTestURLProtocol.handler = { _, complete in complete(.failure(URLError(.notConnectedToInternet))) }
    }
    @MainActor private func authorize(_ session: SessionStore, id: UUID = UUID(), expired: Bool = false, email: String = "test@example.com") async throws {
        let value = AuthSession(accessToken: "token-" + id.uuidString, tokenType: "bearer", expiresIn: 3600, expiresAt: Int(Date().timeIntervalSince1970) + (expired ? -120 : 3600), refreshToken: "refresh", user: AuthUser(id: id, email: email, isAnonymous: false))
        respond(try JSONEncoder.deliveryTracker.encode(value))
        try await session.verifyCode(email: email, code: "123456")
    }
    @MainActor private func store(_ session: SessionStore, _ transport: URLSession) -> ParcelStore {
        let store = ParcelStore(configuration: configuration, session: session, localizer: Localizer(), transport: transport)
        store.setDeliveryWidgetEnabled(false)
        store.setDeliveryLiveActivitiesEnabled(false)
        return store
    }
    private func parcel() -> Parcel {
        Parcel(id: UUID(), trackingNumber: "12345678", label: "Private account A parcel", carrier: .unknown, createdAt: "2026-09-08T00:00:00Z", syncStatus: .ok, notificationsMuted: false)
    }

    @MainActor func testAppleExchangesIdentityTokenWithOriginalNonceAndPersistsSession() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let apple = StubAppleSignIn()
        let persistence = MemorySessionPersistence()
        let session = SessionStore(configuration: configuration, persistence: persistence, transport: transport, appleSignIn: apple)
        defer { session.forceSignOut() }
        let user = AuthUser(id: UUID(), email: "private@privaterelay.appleid.com", isAnonymous: false)
        let response = try JSONEncoder.deliveryTracker.encode(AuthSession(accessToken: "access", tokenType: "bearer", expiresIn: 3600,
            expiresAt: Int(Date().timeIntervalSince1970) + 3600, refreshToken: "refresh", user: user))
        nonisolated(unsafe) var receivedNonces: [String] = []
        SessionTestURLProtocol.handler = { request, complete in
            XCTAssertEqual(request.url?.path, "/auth/v1/token")
            XCTAssertEqual(request.url?.query, "grant_type=id_token")
            XCTAssertEqual(request.httpMethod, "POST")
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open()
                var bytes = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable {
                    let count = stream.read(&bytes, maxLength: bytes.count)
                    if count <= 0 { break }
                    data.append(contentsOf: bytes.prefix(count))
                }
                stream.close()
            }
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            XCTAssertEqual(body?["provider"], "apple")
            XCTAssertEqual(body?["id_token"], "apple-identity-token")
            receivedNonces.append(body?["nonce"] ?? "")
            complete(.success((200, response)))
        }
        try await session.signInWithApple()
        XCTAssertEqual(session.user, user)
        XCTAssertNotNil(persistence.data)
        try await session.signInWithApple()
        XCTAssertEqual(receivedNonces.count, 2)
        XCTAssertEqual(Set(receivedNonces).count, 2)
        XCTAssertTrue(receivedNonces.allSatisfy { $0.count == 64 })
        XCTAssertEqual(apple.nonces, receivedNonces.map(AppleSignInNonce.digest))
        XCTAssertNotEqual(apple.nonces, receivedNonces)
    }

    @MainActor func testCancelledAppleSignInDoesNotCallTheServerOrSaveASession() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let apple = StubAppleSignIn()
        apple.result = .failure(AuthenticationError.oauthCancelled)
        let persistence = MemorySessionPersistence()
        let session = SessionStore(configuration: configuration, persistence: persistence, transport: transport, appleSignIn: apple)
        SessionTestURLProtocol.handler = { _, complete in
            XCTFail("Cancelled Apple sign-in reached the server")
            complete(.failure(URLError(.cancelled)))
        }
        do { try await session.signInWithApple(); XCTFail("Expected cancellation") }
        catch AuthenticationError.oauthCancelled { }
        XCTAssertNil(session.user)
        XCTAssertNil(persistence.data)
    }

    @MainActor func testAppleAuthorizationCannotRestoreASessionAfterSignOut() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let apple = StubAppleSignIn()
        let persistence = MemorySessionPersistence()
        let session = SessionStore(configuration: configuration, persistence: persistence, transport: transport, appleSignIn: apple)
        try await authorize(session)
        apple.beforeReturning = { [weak session] in session?.forceSignOut() }
        SessionTestURLProtocol.handler = { _, complete in
            XCTFail("Stale Apple sign-in reached the server")
            complete(.failure(URLError(.cancelled)))
        }
        do { try await session.signInWithApple(); XCTFail("Expected cancellation") }
        catch is CancellationError { }
        XCTAssertNil(session.user)
        XCTAssertNil(persistence.data)
    }
    @MainActor func testParcelStoreKeepsSessionAliveForDeferredDeliveryCleanup() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        var session: SessionStore? = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        try await authorize(session!)
        weak var retainedSession = session
        defer { retainedSession?.forceSignOut() }
        let store = store(session!, transport)
        session = nil
        // Disabling Live Activities queues cleanup that reads the session later.
        guard retainedSession != nil else { XCTFail("Delivery cleanup lost its session"); return }
        let parcel = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel])))
        await store.load()
        XCTAssertEqual(store.parcels.map(\.id), [parcel.id])
        retainedSession?.forceSignOut()
        XCTAssertTrue(store.parcels.isEmpty)
    }
    @MainActor func testAPIClientKeepsSessionAliveWithoutCreatingARetainCycle() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        var session: SessionStore? = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        try await authorize(session!)
        weak var retainedSession = session
        var client: DeliveryAPIClient? = DeliveryAPIClient(configuration: configuration, session: session!, transport: transport)
        session = nil
        guard retainedSession != nil else { XCTFail("API client lost its session"); return }
        let parcel = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel])))
        let loaded = try await client!.listPackages()
        XCTAssertEqual(loaded.map(\.id), [parcel.id])
        retainedSession?.forceSignOut()
        client = nil
        XCTAssertNil(retainedSession)
    }
    @MainActor func testForcedSignOutClearsParcelsBeforeNextAccountLoads() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        let parcel = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel])))
        await store.load()
        store.undoParcel = parcel
        XCTAssertEqual(store.parcels.map(\.id), [parcel.id])
        session.forceSignOut()
        XCTAssertTrue(store.parcels.isEmpty)
        XCTAssertNil(store.undoParcel)
        let nextUser = UUID()
        try await authorize(session, id: nextUser)
        offline()
        await store.load()
        XCTAssertEqual(session.user?.id, nextUser)
        XCTAssertTrue(store.parcels.isEmpty)
    }
    @MainActor func testSuccessfulDeleteIsReflectedInOfflineCache() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        let parcel = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel])))
        await store.load()
        respond(Data("{\"ok\":true}".utf8))
        try await store.permanentlyDelete(parcel)
        offline()
        let relaunchedStore = self.store(session, transport)
        await relaunchedStore.load()
        XCTAssertTrue(relaunchedStore.parcels.isEmpty)
        XCTAssertTrue(relaunchedStore.usingCachedData)
    }
    @MainActor func testSuccessfulRenamePersistsForOfflineLaunch() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        var parcel = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel])))
        await store.load()
        parcel.label = "Updated label"
        respond(try JSONEncoder.deliveryTracker.encode(parcel))
        try await store.rename(parcel, label: parcel.label)
        offline()
        let relaunchedStore = self.store(session, transport)
        await relaunchedStore.load()
        XCTAssertEqual(relaunchedStore.parcels.first?.label, "Updated label")
    }
    @MainActor func testOfflineAndServerErrorPreserveExpiredRefreshableSession() async throws {
        for serverError in [false, true] {
            let transport = transport()
            defer { transport.invalidateAndCancel() }
            let persistence = MemorySessionPersistence()
            let session = SessionStore(configuration: configuration, persistence: persistence, transport: transport)
            try await authorize(session, expired: true)
            if serverError { respond(Data("{\"message\":\"Unavailable\"}".utf8), status: 503) } else { offline() }
            let relaunched = SessionStore(configuration: configuration, persistence: persistence, transport: transport)
            await relaunched.bootstrap()
            XCTAssertEqual(relaunched.user?.id, session.user?.id)
            XCTAssertNotNil(persistence.data)
            relaunched.forceSignOut()
        }
    }
    @MainActor func testInvalidRefreshTokenClearsSavedSession() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let persistence = MemorySessionPersistence()
        let session = SessionStore(configuration: configuration, persistence: persistence, transport: transport)
        try await authorize(session, expired: true)
        respond(Data("{\"code\":\"refresh_token_not_found\",\"message\":\"Invalid refresh token\"}".utf8), status: 400)
        let relaunched = SessionStore(configuration: configuration, persistence: persistence, transport: transport)
        await relaunched.bootstrap()
        XCTAssertNil(relaunched.user)
        XCTAssertNil(persistence.data)
    }
    @MainActor func testLateUnauthorizedResponseCannotSignOutNextAccount() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        let started = expectation(description: "Old account request started")
        nonisolated(unsafe) var complete: ((Result<(Int, Data), Error>) -> Void)?
        SessionTestURLProtocol.handler = { request, callback in
            if request.url?.path == "/api/packages", request.httpMethod == "GET" {
                complete = callback
                started.fulfill()
            } else { callback(.success((200, Data("{}".utf8)))) }
        }
        let pending = Task { await store.load() }
        await fulfillment(of: [started], timeout: 2)
        session.forceSignOut()
        let nextUser = UUID()
        try await authorize(session, id: nextUser)
        complete?(.success((401, Data("{}".utf8))))
        await pending.value
        XCTAssertEqual(session.user?.id, nextUser)
        XCTAssertTrue(store.parcels.isEmpty)
        XCTAssertNil(store.errorMessage)
    }
    @MainActor func testListStartedBeforeDeleteCannotRestoreDeletedParcel() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        let parcel = parcel()
        let data = try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel]))
        respond(data)
        await store.load()
        let started = expectation(description: "Stale collection request started")
        nonisolated(unsafe) var complete: ((Result<(Int, Data), Error>) -> Void)?
        SessionTestURLProtocol.handler = { request, callback in
            if request.url?.path == "/api/packages", request.httpMethod == "GET" {
                complete = callback
                started.fulfill()
            } else { callback(.success((200, Data("{}".utf8)))) }
        }
        let pending = Task { await store.load() }
        await fulfillment(of: [started], timeout: 2)
        respond(Data("{\"ok\":true}".utf8))
        try await store.permanentlyDelete(parcel)
        complete?(.success((200, data)))
        await pending.value
        XCTAssertTrue(store.parcels.isEmpty)
        offline()
        let relaunchedStore = self.store(session, transport)
        await relaunchedStore.load()
        XCTAssertTrue(relaunchedStore.parcels.isEmpty)
    }
}

extension SessionIsolationTests {
    @MainActor func testLiveActivityRevocationSurvivesOfflineSignOutAndRestart() async throws {
        let persistence = MemorySessionPersistence()
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let original = LiveActivityRevocations(configuration: configuration, transport: transport, persistence: persistence)
        let installationID = UUID()
        let old = try original.registration(ownerID: UUID(), installationID: installationID)
        try original.queue()
        offline()
        await original.drain()
        let saved: [LiveActivityRevocations.Registration]? = persistence.load()
        XCTAssertEqual(saved?.first?.pending, true)

        let restarted = LiveActivityRevocations(configuration: configuration, transport: transport, persistence: persistence)
        let new = try restarted.registration(ownerID: UUID(), installationID: installationID)
        XCTAssertNotEqual(new.revocationToken, old.revocationToken)
        SessionTestURLProtocol.handler = { request, complete in
            XCTAssertEqual(request.url?.path, "/api/live-activities/revoke")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            complete(.success((200, Data("{\"ok\":true}".utf8))))
        }
        await restarted.drain()
        let remaining: [LiveActivityRevocations.Registration]? = persistence.load()
        XCTAssertEqual(remaining, [new])
    }

    @MainActor func testAuthOutageDoesNotForceSignOut() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        try await authorize(session)
        let store = store(session, transport)
        respond(Data("{\"error\":\"Authentication temporarily unavailable\"}".utf8), status: 503)
        await store.load()
        XCTAssertNotNil(session.user)
        XCTAssertFalse(store.authenticationRequired)
    }

    func testEqualTimeEventsPreferDeliveryProgressRegardlessOfUUIDOrTimeZone() {
        var value = parcel()
        value.trackingEvents = [
            TrackingEvent(id: UUID(uuidString: "ffffffff-ffff-4fff-8fff-ffffffffffff")!, packageID: value.id, stage: .inTransit, description: "Transit", occurredAt: "2026-09-08T12:00:00+02:00"),
            TrackingEvent(id: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!, packageID: value.id, stage: .delivered, description: "Delivered", occurredAt: "2026-09-08T10:00:00Z")
        ]
        XCTAssertEqual(value.currentStage, .delivered)
    }
}

extension SessionIsolationTests {
    @MainActor func testUnchangedPollKeepsTheListWithoutRepublishing() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel()])))
        await store.load()
        var republished = 0
        let observation = store.$parcels.dropFirst().sink { _ in republished += 1 }
        defer { observation.cancel() }
        await store.load()
        XCTAssertEqual(republished, 0)
        XCTAssertEqual(store.parcels.count, 1)
    }

    @MainActor func testReopenedAccountShowsItsSavedParcelsBeforeTheServerAnswers() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let persistence = MemorySessionPersistence()
        let session = SessionStore(configuration: configuration, persistence: persistence, transport: transport)
        try await authorize(session)
        let saved = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [saved])))
        await store(session, transport).load()

        let relaunched = SessionStore(configuration: configuration, persistence: persistence, transport: transport)
        defer { relaunched.forceSignOut() }
        let relaunchedStore = store(relaunched, transport)
        offline()
        await relaunched.bootstrap()
        XCTAssertEqual(relaunchedStore.parcels.map(\.id), [saved.id])
        XCTAssertFalse(relaunchedStore.loading)
        await relaunchedStore.load()
        XCTAssertEqual(relaunchedStore.parcels.map(\.id), [saved.id])
        XCTAssertTrue(relaunchedStore.usingCachedData)
    }

    @MainActor func testArchivedParcelLeavesTheListBeforeTheServerAnswers() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        let parcel = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel])))
        await store.load()
        for accepted in [false, true] {
            let started = expectation(description: "Archive request started")
            nonisolated(unsafe) var complete: ((Result<(Int, Data), Error>) -> Void)?
            SessionTestURLProtocol.handler = { request, callback in
                if request.httpMethod == "DELETE" {
                    complete = callback
                    started.fulfill()
                } else { callback(.success((200, Data("{}".utf8)))) }
            }
            let archiving = Task { try await store.archive(parcel) }
            await fulfillment(of: [started], timeout: 2)
            XCTAssertEqual(store.parcels.first?.isArchived, true)
            XCTAssertNil(store.undoParcel)
            if accepted {
                complete?(.success((200, Data("{\"ok\":true}".utf8))))
                try await archiving.value
                XCTAssertEqual(store.parcels.first?.isArchived, true)
                XCTAssertEqual(store.undoParcel?.id, parcel.id)
            } else {
                complete?(.success((500, Data("{\"error\":\"Archive unavailable\"}".utf8))))
                do { try await archiving.value; XCTFail("Expected the refusal") } catch {}
                XCTAssertEqual(store.parcels.first?.isArchived, false)
            }
        }
    }

    @MainActor func testRefreshReturnsOnceQueuedAndReportsCompletion() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session)
        let store = store(session, transport)
        let job = UUID()
        let parcel = parcel()
        let queued = try JSONEncoder.deliveryTracker.encode(QueueResponse(queued: true, pending: 1, jobIDs: [job]))
        let jobs = try JSONEncoder.deliveryTracker.encode(SyncJobListResponse(jobs: [
            SyncJobResponse(id: job, status: .succeeded, requestedAt: "2026-09-25T10:00:00Z"),
        ]))
        let list = try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel]))
        let jobsRequested = expectation(description: "Job status requested")
        nonisolated(unsafe) var completeJobs: ((Result<(Int, Data), Error>) -> Void)?
        SessionTestURLProtocol.handler = { request, callback in
            switch (request.httpMethod, request.url?.path) {
            case ("POST", "/api/sync"): callback(.success((202, queued)))
            case ("GET", "/api/sync/jobs"):
                completeJobs = callback
                jobsRequested.fulfill()
            default: callback(.success((200, list)))
            }
        }
        let start = try await store.refreshAll()
        XCTAssertEqual(start, .queued)
        XCTAssertTrue(store.refreshing)
        await fulfillment(of: [jobsRequested], timeout: 2)
        XCTAssertTrue(store.refreshing)
        let finished = expectation(description: "Refresh finished")
        let observation = store.$refreshOutcome.dropFirst().sink { if $0 != nil { finished.fulfill() } }
        defer { observation.cancel() }
        completeJobs?(.success((200, jobs)))
        await fulfillment(of: [finished], timeout: 2)
        XCTAssertFalse(store.refreshing)
        // The parcel was not on the list before the check.
        XCTAssertEqual(store.refreshOutcome?.result, .updated)
        XCTAssertEqual(store.parcels.map(\.id), [parcel.id])
    }

    func testRefreshReportsNewTrackingOnlyWhenTheTimelineStatusOrDeliveryDateChanged() {
        let checked = parcel()
        var rechecked = checked
        rechecked.lastSyncedAt = "2026-09-25T10:05:00Z"
        rechecked.syncStatus = .ok
        XCTAssertFalse(Parcel.trackingChanged(from: [checked], to: [rechecked]))

        var status = checked
        status.lastStatusText = "Sorted at the depot"
        XCTAssertTrue(Parcel.trackingChanged(from: [checked], to: [status]))
        var delivery = checked
        delivery.expectedDelivery = "2026-09-27"
        XCTAssertTrue(Parcel.trackingChanged(from: [checked], to: [delivery]))
        var scanned = checked
        scanned.trackingEvents.append(TrackingEvent(
            id: UUID(), packageID: checked.id, stage: .inTransit,
            description: "Sorted at the depot", occurredAt: "2026-09-25T10:00:00Z"
        ))
        XCTAssertTrue(Parcel.trackingChanged(from: [checked], to: [scanned]))

        // A delivery partner's parcel continues the one it replaced.
        var handoff = checked
        handoff.id = UUID()
        handoff.carrierData = CarrierData(originalPackageID: checked.id)
        XCTAssertFalse(Parcel.trackingChanged(from: [checked], to: [handoff]))
    }
}

/// What the requests of a test carried, in the order they were made.
private final class RequestLog: @unchecked Sendable {
    var requests: [(method: String, path: String, body: [String: Any])] = []

    func record(_ request: URLRequest) {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                data.append(contentsOf: bytes.prefix(count))
            }
        }
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        requests.append((request.httpMethod ?? "", request.url?.path ?? "", body))
    }
}

extension SessionIsolationTests {
    private func respond(_ data: Data, status: Int = 200, recording log: RequestLog) {
        SessionTestURLProtocol.handler = { request, complete in
            log.record(request)
            complete(.success((status, data)))
        }
    }

    /// An account the server can email, which has never chosen.
    private var emailPreferences: NotificationPreferences {
        NotificationPreferences(
            enabledStages: NotificationPreset.important.stages, quietHoursStart: "22:00", quietHoursEnd: "07:00",
            timezone: "Pacific/Auckland", emailOnDelivery: nil, emailAvailable: true
        )
    }

    /// A parcel as the server answers it, with its two mutes.
    private func row(_ parcel: Parcel, muted: Bool, emailMuted: Bool) -> Data {
        Data("""
        {"id":"\(parcel.id.uuidString)","tracking_number":"\(parcel.trackingNumber)","label":"\(parcel.label)",
         "carrier":"\(parcel.carrier.rawValue)","created_at":"\(parcel.createdAt)","sync_status":"ok",
         "notifications_muted":\(muted),"email_muted":\(emailMuted),"tracking_events":[]}
        """.utf8)
    }

    @MainActor func testEmailSwitchSendsTheSavedPreferencesAndShowsTheServersAnswer() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session, email: "alex@example.com")
        let store = store(session, transport)
        XCTAssertNil(store.deliveryEmail)
        let saved = emailPreferences
        respond(try JSONEncoder.deliveryTracker.encode(saved))
        await store.loadNotificationPreferences()
        let offered = try XCTUnwrap(store.deliveryEmail)
        XCTAssertEqual(offered.address, "alex@example.com")
        XCTAssertNil(offered.choice)

        var answer = saved
        answer.emailOnDelivery = true
        let log = RequestLog()
        respond(try JSONEncoder.deliveryTracker.encode(answer), recording: log)
        try await store.setEmailOnDelivery(true)
        XCTAssertEqual(log.requests.map(\.method), ["PATCH"])
        XCTAssertEqual(log.requests.first?.path, "/api/push/preferences")
        let sent = try XCTUnwrap(log.requests.first?.body)
        // What was last saved goes back with the choice; what only the server knows stays out.
        XCTAssertEqual(Set(sent.keys), ["enabledStages", "quietHoursStart", "quietHoursEnd", "timezone", "emailOnDelivery"])
        XCTAssertEqual(sent["emailOnDelivery"] as? Bool, true)
        XCTAssertEqual(sent["enabledStages"] as? [String], saved.enabledStages.map(\.rawValue))
        XCTAssertEqual(sent["quietHoursStart"] as? String, "22:00")
        XCTAssertEqual(sent["timezone"] as? String, TimeZone.current.identifier)
        XCTAssertEqual(store.deliveryEmail?.isOn, true)

        // Saving a preset afterwards carries the choice along unchanged.
        var draft = NotificationPreferencesDraft(preferences: store.notificationPreferences)
        draft.preset = .deliveryDay
        var presetAnswer = draft.preferences(timezone: "Europe/Zurich")
        presetAnswer.emailAvailable = true
        respond(try JSONEncoder.deliveryTracker.encode(presetAnswer), recording: log)
        try await store.saveNotificationPreferences(draft.preferences(timezone: "Europe/Zurich"))
        let preset = try XCTUnwrap(log.requests.last?.body)
        XCTAssertEqual(Set(preset.keys), ["enabledStages", "timezone", "emailOnDelivery"])
        XCTAssertEqual(preset["emailOnDelivery"] as? Bool, true)
        XCTAssertEqual(store.notificationPreferences?.enabledStages, NotificationPreset.deliveryDay.stages)
        XCTAssertEqual(store.deliveryEmail?.isOn, true)

        // A refusal leaves what was saved.
        respond(Data("{\"error\":\"This account cannot be emailed\"}".utf8), status: 409)
        do { try await store.setEmailOnDelivery(false); XCTFail("Expected the refusal") } catch {}
        XCTAssertEqual(store.deliveryEmail?.isOn, true)

        // The state is the server's answer, whatever was asked.
        presetAnswer.emailOnDelivery = false
        respond(try JSONEncoder.deliveryTracker.encode(presetAnswer))
        try await store.setEmailOnDelivery(true)
        XCTAssertEqual(try XCTUnwrap(store.deliveryEmail).choice, false)

        // Once the server cannot email the account, there is nothing to switch.
        presetAnswer.emailAvailable = false
        respond(try JSONEncoder.deliveryTracker.encode(presetAnswer))
        await store.loadNotificationPreferences()
        XCTAssertNil(store.deliveryEmail)
        let silent = RequestLog()
        respond(Data("{}".utf8), recording: silent)
        try await store.setEmailOnDelivery(true)
        XCTAssertTrue(silent.requests.isEmpty)
    }

    @MainActor func testAReadThatBeganBeforeTheEmailWasSwitchedCannotUndoIt() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session, email: "alex@example.com")
        let store = store(session, transport)
        let saved = emailPreferences
        let stale = try JSONEncoder.deliveryTracker.encode(saved)
        respond(stale)
        await store.loadNotificationPreferences()
        var answer = saved
        answer.emailOnDelivery = true
        let answered = try JSONEncoder.deliveryTracker.encode(answer)
        let started = expectation(description: "Read started")
        nonisolated(unsafe) var completeRead: ((Result<(Int, Data), Error>) -> Void)?
        SessionTestURLProtocol.handler = { request, callback in
            if request.httpMethod == "GET" {
                completeRead = callback
                started.fulfill()
            } else { callback(.success((200, answered))) }
        }
        let reading = Task { await store.loadNotificationPreferences() }
        await fulfillment(of: [started], timeout: 2)
        try await store.setEmailOnDelivery(true)
        completeRead?(.success((200, stale)))
        await reading.value
        XCTAssertEqual(store.deliveryEmail?.isOn, true)
    }

    @MainActor func testReturningToTheAppReadsTheEmailChoiceAgain() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session, email: "alex@example.com")
        let store = store(session, transport)
        var saved = emailPreferences
        saved.emailOnDelivery = true
        respond(try JSONEncoder.deliveryTracker.encode(saved))
        await store.loadNotificationPreferences()
        XCTAssertEqual(store.deliveryEmail?.isOn, true)

        // Meanwhile the email was switched off from a link in an email.
        saved.emailOnDelivery = false
        let switchedOff = try JSONEncoder.deliveryTracker.encode(saved)
        let list = try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: []))
        let log = RequestLog()
        SessionTestURLProtocol.handler = { request, complete in
            log.record(request)
            complete(.success((200, request.url?.path == "/api/push/preferences" ? switchedOff : list)))
        }
        let read = expectation(description: "Choice read again")
        let observation = store.$notificationPreferences.dropFirst().sink { if $0?.emailOnDelivery == false { read.fulfill() } }
        defer { observation.cancel() }
        // The launch loads the preferences itself: only a return reads them again.
        store.setActive(true)
        store.setActive(false)
        store.setActive(true)
        await fulfillment(of: [read], timeout: 5)
        XCTAssertEqual(try XCTUnwrap(store.deliveryEmail).choice, false)
        XCTAssertEqual(log.requests.filter { $0.path == "/api/push/preferences" }.map(\.method), ["GET"])
    }

    @MainActor func testAParcelsAlertsAreSavedOneFieldAtATimeAndKeptForAnOfflineLaunch() async throws {
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, persistence: MemorySessionPersistence(), transport: transport)
        defer { session.forceSignOut() }
        try await authorize(session, email: "alex@example.com")
        let store = store(session, transport)
        let parcel = parcel()
        respond(try JSONEncoder.deliveryTracker.encode(PackageListResponse(packages: [parcel])))
        await store.load()
        XCTAssertNil(store.parcels.first?.emailMuted)

        let log = RequestLog()
        respond(row(parcel, muted: false, emailMuted: true), recording: log)
        try await store.setEmailMuted(parcel, muted: true)
        XCTAssertEqual(log.requests.map(\.method), ["PATCH"])
        XCTAssertEqual(log.requests.first?.path, "/api/packages/\(parcel.id.uuidString)/notifications")
        XCTAssertEqual(log.requests.first?.body as NSDictionary?, ["emailMuted": true])
        XCTAssertEqual(store.parcels.first?.emailMuted, true)
        XCTAssertEqual(store.parcels.first?.notificationsMuted, false)

        respond(row(parcel, muted: true, emailMuted: true), recording: log)
        try await store.setMuted(parcel, muted: true)
        XCTAssertEqual(log.requests.last?.body as NSDictionary?, ["muted": true])
        XCTAssertEqual(store.parcels.first?.allAlertsMuted, true)

        // A refusal leaves the parcel as it was.
        respond(Data("{\"error\":\"Alerts unavailable\"}".utf8), status: 502)
        do { try await store.setEmailMuted(parcel, muted: false); XCTFail("Expected the refusal") } catch {}
        XCTAssertEqual(store.parcels.first?.emailMuted, true)

        offline()
        let relaunchedStore = self.store(session, transport)
        await relaunchedStore.load()
        XCTAssertEqual(relaunchedStore.parcels.first?.emailMuted, true)
        XCTAssertEqual(relaunchedStore.parcels.first?.notificationsMuted, true)
    }

    @MainActor func testDemoHasNoDeliveryEmail() async throws {
        let suite = "demo-email-store-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let transport = transport()
        defer { transport.invalidateAndCancel() }
        let session = SessionStore(configuration: configuration, defaults: defaults, persistence: MemorySessionPersistence(), transport: transport)
        session.enterDemo()
        let store = store(session, transport)
        let silent = RequestLog()
        respond(try JSONEncoder.deliveryTracker.encode(emailPreferences), recording: silent)
        await store.loadNotificationPreferences()
        XCTAssertNotNil(store.notificationPreferences)
        XCTAssertNil(store.deliveryEmail)
        try await store.setEmailOnDelivery(true)
        XCTAssertNil(store.notificationPreferences?.emailOnDelivery)
        XCTAssertTrue(silent.requests.isEmpty)
    }
}

extension ParcelLogicTests {
    func testDeliveryListLayoutFeaturesOneArrivalAndKeepsIssuesOnTheirOwnCards() {
        let now = DateParser.date("2026-09-09T12:00:00Z")!
        let parcels = DemoRepository.seed(now: now)
        let layout = DeliveryListLayout(parcels: parcels, query: "", status: .all, carrier: nil, sort: .priority, featuresNext: true, now: now)
        let next = try? XCTUnwrap(layout.next)
        XCTAssertEqual(next?.label, "New sneakers 👟")
        XCTAssertEqual(Set(layout.active.map(\.id)), Set(parcels.filter(\.isActive).map(\.id)))
        XCTAssertEqual(Set(layout.attention.map(\.id) + layout.remaining.map(\.id) + [next?.id].compactMap { $0 }),
                       Set(layout.active.map(\.id)))
        XCTAssertFalse(layout.attention.contains { $0.id == next?.id } || layout.remaining.contains { $0.id == next?.id })
        XCTAssertTrue(layout.attention.allSatisfy { $0.attention(now: now) != nil })
        XCTAssertTrue(layout.remaining.allSatisfy { $0.attention(now: now) == nil })
        XCTAssertEqual(layout.sections.map(\.kind), [.delivered, .archived])
        let searched = DeliveryListLayout(parcels: parcels, query: "sneakers", status: .all, carrier: nil, sort: .priority, featuresNext: false, now: now)
        XCTAssertNil(searched.next)
        XCTAssertEqual(searched.visible.map(\.label), ["New sneakers 👟"])
    }

    func testLatestEventFollowsAChangedHistory() {
        let now = DateParser.date("2026-09-09T12:00:00Z")!
        var parcel = DemoRepository.seed(now: now).first { $0.label == "New sneakers 👟" }!
        let before = parcel.currentStage
        XCTAssertEqual(before, .readyForPickup)
        parcel.trackingEvents.append(TrackingEvent(
            id: UUID(), packageID: parcel.id, stage: .delivered,
            description: "Delivered", occurredAt: DateParser.isoString(now)
        ))
        XCTAssertEqual(parcel.currentStage, .delivered)
        parcel.trackingEvents.removeLast()
        XCTAssertEqual(parcel.currentStage, before)
    }

    @MainActor func testDayKeysAndEstimatesAreStableAcrossRepeatedFormatting() throws {
        let localizer = Localizer()
        localizer.language = .en
        let day = try XCTUnwrap(DateParser.deliveryDate("2026-09-12"))
        XCTAssertEqual(ParcelOrganizer.dayKey(day), "2026-09-12")
        XCTAssertNil(DateParser.date("2026-09-12"))
        XCTAssertEqual(DateParser.deliveryDate("2026-09-12"), day)
        for _ in 0..<3 {
            XCTAssertEqual(localizer.shortDate(day), "Sat 12 sep")
            XCTAssertEqual(localizer.dateTime(DateParser.isoString(day)), "Sat 12 sep, 00:00")
        }
    }
}
