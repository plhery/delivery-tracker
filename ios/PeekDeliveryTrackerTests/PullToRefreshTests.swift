import XCTest
@testable import PeekDeliveryTracker

@MainActor
final class PullToRefreshTests: XCTestCase {
    func testPullIsMeasuredFromTheRestingInsetWhileTheSystemHoldsItsGap() {
        let model = PullToRefreshModel()
        model.track(PullGeometry(overscroll: 0, inset: 164, height: 874))
        XCTAssertEqual(model.threshold, 174.8, accuracy: 0.01)
        model.track(PullGeometry(overscroll: 87.4, inset: 164, height: 874))
        XCTAssertEqual(model.progress, 0.5, accuracy: 0.001)

        // The system starts refreshing mid-pull and adds its gap to the inset,
        // sometimes before the refresh action has run.
        model.track(PullGeometry(overscroll: 118.7, inset: 224, height: 874))
        XCTAssertEqual(model.distance, 178.7, accuracy: 0.01)
        model.begin(label: "Checking for updates…")
        model.track(PullGeometry(overscroll: 110, inset: 224, height: 874))
        XCTAssertEqual(model.distance, 170, accuracy: 0.01)
        XCTAssertEqual(model.holdDistance, 60)
        XCTAssertEqual(model.progress, 1)

        // After the finger lifts, the gap stays open at its held height.
        model.track(PullGeometry(overscroll: 0, inset: 224, height: 874))
        XCTAssertEqual(model.distance, 60)
    }

    func testResultAppearsOnlyAtTheEndAndClearsOnceSettled() async throws {
        let model = PullToRefreshModel()
        model.begin(label: "Checking for updates…")
        XCTAssertEqual(model.phase, .refreshing)
        XCTAssertEqual(model.starts, 1)
        XCTAssertNil(model.result)

        model.update(label: "Still checking. Updates will appear here.")
        XCTAssertEqual(model.label, "Still checking. Updates will appear here.")
        XCTAssertNil(model.result)

        model.finish(succeeded: true, label: "Tracking updated")
        XCTAssertEqual(model.result, .succeeded)
        model.update(label: "Still checking. Updates will appear here.")
        XCTAssertEqual(model.label, "Tracking updated")

        model.settle()
        XCTAssertEqual(model.phase, .settling)
        XCTAssertEqual(model.result, .succeeded, "the result fades out with the seal")
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertEqual(model.phase, .idle)
        XCTAssertNil(model.result)
        XCTAssertNil(model.label)
        XCTAssertEqual(model.distance, 0)
    }

    func testSealStaysHiddenUntilTheContentReturnsToTheTopAfterARefresh() async throws {
        let model = PullToRefreshModel()
        model.track(PullGeometry(overscroll: 0, inset: 164, height: 874))
        model.track(PullGeometry(overscroll: 180, inset: 164, height: 874))
        model.begin(label: "Checking for updates…")
        model.finish(succeeded: true, label: "Tracking updated")
        model.settle()
        // The finger still holds the content down when the refresh ends.
        model.track(PullGeometry(overscroll: 150, inset: 164, height: 874))
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertEqual(model.phase, .idle)
        XCTAssertTrue(model.awaitingRest)
        model.track(PullGeometry(overscroll: 90, inset: 164, height: 874))
        XCTAssertTrue(model.awaitingRest)
        model.track(PullGeometry(overscroll: 0, inset: 164, height: 874))
        XCTAssertFalse(model.awaitingRest)
        model.track(PullGeometry(overscroll: 40, inset: 164, height: 874))
        XCTAssertEqual(model.distance, 40)
        XCTAssertFalse(model.awaitingRest)
    }

    func testRefreshStartedWhileSettlingIsNotResetByTheEarlierOne() async throws {
        let model = PullToRefreshModel()
        model.begin(label: "Checking for updates…")
        model.finish(succeeded: false, label: "Couldn’t check. Try again.")
        XCTAssertEqual(model.result, .failed)
        model.settle()
        model.begin(label: "Checking for updates…")
        XCTAssertNil(model.result)
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertEqual(model.phase, .refreshing)
        XCTAssertEqual(model.label, "Checking for updates…")
        XCTAssertEqual(model.starts, 2)
    }
}
