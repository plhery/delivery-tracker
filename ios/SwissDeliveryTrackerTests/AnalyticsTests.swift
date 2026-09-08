import XCTest
@testable import SwissDeliveryTracker

final class AnalyticsTests: XCTestCase {
    func testSharedCatalogExcludesPollingAndPrivateInputs() throws {
        let catalog = try XCTUnwrap(AnalyticsCatalog.bundled)
        XCTAssertEqual(catalog.event(path: "/api/packages/private-id?token=secret", method: "PATCH", body: nil), "parcel-rename")
        XCTAssertNil(catalog.event(path: "/api/sync/jobs?ids=private", method: "GET", body: nil))
        XCTAssertNil(catalog.event(path: "/api/push/devices", method: "POST", body: Data("{\"token\":\"secret\"}".utf8)))
        XCTAssertEqual(catalog.event(path: "/api/friends", method: "POST", body: Data("{\"action\":\"accept_invite\",\"code\":\"secret\"}".utf8)), "friend-invite-accept")
        XCTAssertNil(catalog.event(path: "/api/friends", method: "POST", body: Data("{\"action\":\"private nickname\"}".utf8)))
        for operation in catalog.operations { XCTAssertTrue(catalog.actions.contains(operation.event)) }
    }

    @MainActor func testPayloadContainsOnlyFixedNamesAndDeviceMetadata() throws {
        let configuration = DeliveryAnalytics.Configuration(endpoint: URL(string: "https://analytics.example/api/send")!, hostname: "delivery.example", iosWebsite: UUID().uuidString)
        let payload = DeliveryAnalytics.payload(.init(screen: "parcel", name: "parcel-add", outcome: .success, mode: .account), configuration: configuration)
        XCTAssertEqual(payload["url"] as? String, "/parcel")
        XCTAssertEqual(payload["name"] as? String, "parcel-add")
        XCTAssertEqual((payload["data"] as? [String: String])?["platform"], "ios")
        for key in ["id", "referrer", "userID", "email", "trackingNumber", "token"] { XCTAssertNil(payload[key]) }
        XCTAssertTrue(configuration.valid(for: URL(string: "https://delivery.example")!))
        XCTAssertFalse(configuration.valid(for: URL(string: "https://another.example")!))
    }

    @MainActor func testConfigurationRejectsCredentialsAndUnencryptedCollection() {
        for endpoint in ["http://analytics.example/api/send", "https://secret@analytics.example/api/send", "https://analytics.example/api/send?token=secret"] {
            let configuration = DeliveryAnalytics.Configuration(endpoint: URL(string: endpoint)!, hostname: "delivery.example", iosWebsite: UUID().uuidString)
            XCTAssertFalse(configuration.valid(for: URL(string: "https://delivery.example")!))
        }
    }
}
