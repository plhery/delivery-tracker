import XCTest
import UIKit
@testable import SwissDeliveryTracker

final class ParcelLogicTests: XCTestCase {
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

    func testArchiveReleaseKeepsTheFingerPositionUntilTheSettleAnimation() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -120, height: 3), width: 360)

        XCTAssertEqual(swipe.release(predictedTranslation: -125, width: 360), .revealed)
        // Releasing used to reset the displayed translation to zero for a frame.
        XCTAssertEqual(swipe.offset, -120)
        XCTAssertNil(swipe.cancel())
        XCTAssertEqual(swipe.offset, -120)
        swipe.settle(at: -88)

        swipe.drag(translation: CGSize(width: -12, height: 0), width: 360)
        XCTAssertEqual(swipe.offset, -100)
    }

    func testShortArchiveSwipeClosesFromTheReleasePosition() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -25, height: 0), width: 360)
        XCTAssertEqual(swipe.release(predictedTranslation: -28, width: 360), .closed)
        XCTAssertEqual(swipe.offset, -25)
    }

    func testReversingAnOpenArchiveSwipeClosesIt() {
        var swipe = ArchiveSwipeState()
        swipe.settle(at: -88)
        swipe.drag(translation: CGSize(width: 65, height: 2), width: 360)
        XCTAssertEqual(swipe.offset, -23)
        XCTAssertEqual(swipe.release(predictedTranslation: 90, width: 360), .closed)
        XCTAssertEqual(swipe.offset, -23)
    }

    func testArchiveRequiresActualDistanceNotJustFlingVelocity() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -30, height: 0), width: 360)
        XCTAssertEqual(swipe.release(predictedTranslation: -400, width: 360), .revealed)

        swipe.settle(at: 0)
        swipe.drag(translation: CGSize(width: -210, height: 1), width: 360)
        XCTAssertEqual(swipe.release(predictedTranslation: -210, width: 360), .archive)
        XCTAssertEqual(swipe.offset, -210)
    }

    func testVerticalScrollDoesNotBecomeAnArchiveSwipe() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -3, height: -18), width: 360)
        swipe.drag(translation: CGSize(width: -200, height: -25), width: 360)
        XCTAssertEqual(swipe.offset, 0)
        XCTAssertNil(swipe.release(predictedTranslation: -250, width: 360))
    }

    func testCancelledSwipeSettlesWithoutArchivingOrResettingItsPosition() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: -220, height: 0), width: 360)
        XCTAssertEqual(swipe.cancel(), .revealed)
        XCTAssertEqual(swipe.offset, -220)
        XCTAssertNil(swipe.cancel())
    }

    func testArchiveSwipeStaysWithinCardBounds() {
        var swipe = ArchiveSwipeState()
        swipe.drag(translation: CGSize(width: 50, height: 0), width: 360)
        XCTAssertEqual(swipe.offset, 0)
        swipe.drag(translation: CGSize(width: -500, height: 0), width: 360)
        XCTAssertEqual(swipe.offset, -360)
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
        ] {
            var parcel = makeParcel(id: id, events: [event(id, stage, "2026-09-06T10:00:00Z")])
            parcel.syncStatus = .error
            XCTAssertEqual(parcel.attention(), attention)
            XCTAssertEqual(parcel.currentStage, stage)
        }
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
    func testEstimatesKeepUsefulWindowsAndHideObsoleteOrRedundantDates() {
        let id = UUID()
        let now = DateParser.date("2026-09-07T12:00:00Z")!
        let localizer = Localizer()
        localizer.language = .fr
        for stage in [TrackingStage.delivered, .returned, .failedAttempt, .readyForPickup] {
            var parcel = makeParcel(id: id, events: [event(id, stage, "2026-09-07T10:00:00Z")])
            parcel.expectedDelivery = "2026-09-07"
            XCTAssertNil(localizer.parcelDeliveryEstimate(parcel, now: now))
        }
        var parcel = makeParcel(id: id, events: [event(id, .outForDelivery, "2026-09-07T10:00:00Z")])
        parcel.expectedDelivery = "2026-09-07"
        XCTAssertNil(localizer.parcelDeliveryEstimate(parcel, now: now))
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
    @MainActor private func authorize(_ session: SessionStore, id: UUID = UUID(), expired: Bool = false) async throws {
        let value = AuthSession(accessToken: "token-" + id.uuidString, tokenType: "bearer", expiresIn: 3600, expiresAt: Int(Date().timeIntervalSince1970) + (expired ? -120 : 3600), refreshToken: "refresh", user: AuthUser(id: id, email: "test@example.com", isAnonymous: false))
        respond(try JSONEncoder.deliveryTracker.encode(value))
        try await session.verifyCode(email: "test@example.com", code: "123456")
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
