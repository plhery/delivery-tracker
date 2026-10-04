import CryptoKit
import Foundation
import XCTest
@testable import PeekDeliveryTracker

final class NativeVerificationTests: XCTestCase {
    private let base = URL(string: "https://peek.example")!
    private func lookup() -> URLRequest {
        var request = URLRequest(url: base.appending(path: "api/public/parcels"))
        request.httpMethod = "POST"
        request.httpBody = Data("{\"trackingNumber\":\"SYNTHETIC\"}".utf8)
        return request
    }
    private let unsupported = NativeAttestProvider(supported: { false }, generateKey: { "unused" }, attest: { _, _ in Data() }, assert: { _, _ in Data() })

    func testFreeBuildExchangesTokenThroughNativeTransportAndReusesProof() async throws {
        let server = NativeTestServer()
        let verifier = NativeVerification(provider: unsupported, present: { url in
            await server.present(url)
            return "synthetic-turnstile-token"
        }, records: [:], save: { _ in })
        let first = try await verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
        let second = try await verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
        XCTAssertEqual(first.1.statusCode, 201)
        XCTAssertEqual(second.1.statusCode, 201)
        let requests = await server.requests
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/public/verification" }.count, 1)
        let presented = await server.presented
        XCTAssertEqual(presented.count, 1)
        XCTAssertEqual(requests.last?.httpBody, lookup().httpBody)
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "X-Native-Verification"), "1")
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "X-Lookup-Proof"), "synthetic-proof")
    }

    func testCancellationDoesNotRetryOrExchangeToken() async throws {
        let server = NativeTestServer()
        let verifier = NativeVerification(provider: unsupported, present: { _ in throw CancellationError() }, records: [:], save: { _ in })
        do {
            _ = try await verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
            XCTFail("Expected cancellation")
        } catch is CancellationError { }
        let requests = await server.requests
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/public/parcels" }.count, 1)
        XCTAssertFalse(requests.contains { $0.url?.path == "/api/public/verification" })
    }

    func testDisabledVerificationAndRateLimitsNeverPresent() async throws {
        for status in [201, 429, 503] {
            let server = NativeTestServer(initialStatus: status)
            let verifier = NativeVerification(provider: unsupported, present: { _ in XCTFail("Unexpected verification"); return "" }, records: [:], save: { _ in })
            let result = try await verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
            XCTAssertEqual(result.1.statusCode, status)
            let requests = await server.requests
            XCTAssertEqual(requests.count, 1)
        }
    }

    func testFailedProofDoesNotLoop() async throws {
        let server = NativeTestServer(rejectProof: true)
        let verifier = NativeVerification(provider: unsupported, present: { _ in "token" }, records: [:], save: { _ in })
        do {
            _ = try await verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
            XCTFail("Expected rejection")
        } catch is NativeVerificationFailed { }
        let requests = await server.requests
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/public/parcels" }.count, 2)
    }

    func testPaidBuildRegistersKeyAndSignsExactPayloadWithoutPresenting() async throws {
        let server = NativeTestServer(paid: true)
        let provider = NativeAttestProvider(supported: { true }, generateKey: { "synthetic-key" }, attest: { key, hash in
            XCTAssertEqual(key, "synthetic-key")
            XCTAssertEqual(hash, Data(SHA256.hash(data: Data("synthetic-attestation-challenge".utf8))))
            return Data("synthetic-attestation".utf8)
        }, assert: { key, hash in
            var req = URLRequest(url: URL(string: "https://peek.example/api/public/parcels")!)
            req.httpMethod = "POST"; req.httpBody = Data("{\"trackingNumber\":\"SYNTHETIC\"}".utf8)
            XCTAssertEqual(key, "synthetic-key")
            XCTAssertEqual(hash, Data(SHA256.hash(data: Data(NativeVerification.payload(req, challenge: "synthetic-assertion-challenge").utf8))))
            return Data("synthetic-assertion".utf8)
        })
        let verifier = NativeVerification(provider: provider, present: { _ in XCTFail("Unexpected browser check"); return "" }, records: [:], save: { _ in })
        for _ in 0..<2 {
            let result = try await verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
            XCTAssertEqual(result.1.statusCode, 201)
        }
        let requests = await server.requests
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/public/native/verification" && $0.httpMethod == "POST" }.count, 1)
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "X-App-Attest-Assertion"), Data("synthetic-assertion".utf8).base64EncodedString())
        XCTAssertNil(requests.last?.value(forHTTPHeaderField: "X-Lookup-Proof"))
    }

    func testAppleOutageFallsBackAndConcurrentRequestsShareVerification() async throws {
        let server = NativeTestServer(paid: true)
        let provider = NativeAttestProvider(supported: { true }, generateKey: { throw NativeVerificationFailed() }, attest: { _, _ in Data() }, assert: { _, _ in Data() })
        let verifier = NativeVerification(provider: provider, present: { url in await server.present(url); return "token" }, records: [:], save: { _ in })
        async let first = verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
        async let second = verifier.send(lookup(), baseURL: base, using: { try await server.send($0) })
        let results = try await [first, second]
        XCTAssertTrue(results.allSatisfy { $0.1.statusCode == 201 })
        let presented = await server.presented
        XCTAssertEqual(presented.count, 1)
        let maximum = await server.maximumConcurrent
        XCTAssertEqual(maximum, 1)
    }
}

private actor NativeTestServer {
    var requests: [URLRequest] = []
    var presented: [URL] = []
    var maximumConcurrent = 0
    private var concurrent = 0
    private let paid: Bool
    private let initialStatus: Int
    private let rejectProof: Bool
    init(paid: Bool = false, initialStatus: Int = 403, rejectProof: Bool = false) {
        self.paid = paid; self.initialStatus = initialStatus; self.rejectProof = rejectProof
    }
    func present(_ url: URL) { presented.append(url) }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        concurrent += 1; maximumConcurrent = max(concurrent, maximumConcurrent)
        defer { concurrent -= 1 }
        try await Task.sleep(for: .milliseconds(10))
        var status = 200
        var body: [String: Any] = [:]
        var headers: [String: String] = [:]
        switch request.url!.path {
        case "/api/public/native/verification":
            if request.httpMethod == "POST" { status = 204 }
            else { body = ["appAttestAppId": paid ? "TESTTEAM01.com.example.Peek" as Any : NSNull(), "turnstile": true] }
        case "/api/public/native/challenge":
            let object = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: String]
            body = ["challenge": "synthetic-\(object["purpose"]!)-challenge"]
        case "/api/public/verification":
            body = ["proof": "synthetic-proof", "expiresAt": Date().addingTimeInterval(900).timeIntervalSince1970 * 1000]
        default:
            if request.value(forHTTPHeaderField: "X-App-Attest-Assertion") != nil || (!rejectProof && request.value(forHTTPHeaderField: "X-Lookup-Proof") != nil) { status = 201 }
            else { status = initialStatus }
            if status == 403 { headers["X-Lookup-Verification"] = "required" }
        }
        return (try JSONSerialization.data(withJSONObject: body), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!)
    }
}
