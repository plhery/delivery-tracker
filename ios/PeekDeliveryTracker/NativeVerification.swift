import CryptoKit
import DeviceCheck
import Foundation
import UIKit
import WebKit

struct NativeVerificationFailed: Error {}

/// Apple keeps the private key on the device. These closures also let tests sign synthetic requests.
struct NativeAttestProvider: Sendable {
    var supported: @Sendable () -> Bool
    var generateKey: @Sendable () async throws -> String
    var attest: @Sendable (String, Data) async throws -> Data
    var assert: @Sendable (String, Data) async throws -> Data

    static let live = NativeAttestProvider(
        supported: {
            Bundle.main.object(forInfoDictionaryKey: "SDTAppAttestEnabled") as? String == "YES"
                && DCAppAttestService.shared.isSupported
        },
        generateKey: { try await DCAppAttestService.shared.generateKey() },
        attest: { try await DCAppAttestService.shared.attestKey($0, clientDataHash: $1) },
        assert: { try await DCAppAttestService.shared.generateAssertion($0, clientDataHash: $1) }
    )
}

struct NativeAttestRecord: Codable, Sendable {
    let keyID: String
    let appID: String
    var registered: Bool
}

/// Serialize signing through the response: assertions arriving out of order invalidate their counters.
actor NativeVerification {
    static let shared = NativeVerification()
    typealias Send = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
    typealias Present = @Sendable (URL) async throws -> String
    private struct Configuration: Decodable { let appAttestAppId: String?; let turnstile: Bool }
    private struct Challenge: Decodable { let challenge: String }
    private struct Proof: Decodable { let proof: String; let expiresAt: Double }

    private let provider: NativeAttestProvider
    private let present: Present
    private let save: @Sendable ([String: NativeAttestRecord]) -> Void
    private var records: [String: NativeAttestRecord]
    private var configurations: [String: (Configuration, Date)] = [:]
    private var proofs: [String: Proof] = [:]
    private var pauseAttestUntil: [String: Date] = [:]
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(provider: NativeAttestProvider = .live,
         present: @escaping Present = { try await NativeTurnstilePresenter.shared.token(at: $0) },
         records: [String: NativeAttestRecord]? = nil,
         save: @escaping @Sendable ([String: NativeAttestRecord]) -> Void = {
             try? KeychainStore(service: "com.plhery.SwissDeliveryTracker.appAttest").save($0)
         }) {
        self.provider = provider
        self.present = present
        self.records = records ?? KeychainStore(service: "com.plhery.SwissDeliveryTracker.appAttest").load() ?? [:]
        self.save = save
    }

    private func acquire() async {
        if busy { await withCheckedContinuation { waiters.append($0) } }
        else { busy = true }
    }
    private func release() {
        if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
    }

    func prepare(baseURL: URL) async {
        guard provider.supported() else { return }
        await acquire()
        defer { release() }
        let transport: Send = { request in
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw DeliveryAPIError.invalidResponse }
            return (data, response)
        }
        do {
            let config = try await configuration(baseURL, using: transport)
            if let appID = config.appAttestAppId { _ = try await registeredKey(baseURL, appID: appID, using: transport) }
        } catch { pauseAttestUntil[baseURL.absoluteString] = Date().addingTimeInterval(600) }
    }

    func send(_ original: URLRequest, baseURL: URL, allowPresentation: Bool = true, using transport: @escaping Send) async throws -> (Data, HTTPURLResponse) {
        await acquire()
        defer { release() }
        try Task.checkCancellation()
        let base = baseURL.absoluteString
        var request = original
        request.setValue("1", forHTTPHeaderField: "X-Native-Verification")
        if let proof = proofs[base], proof.expiresAt > Date().timeIntervalSince1970 * 1000 + 5_000 {
            request.setValue(proof.proof, forHTTPHeaderField: "X-Lookup-Proof")
        }
        if let appID = configurations[base]?.0.appAttestAppId, records[base]?.appID == appID,
           records[base]?.registered == true, provider.supported(), (pauseAttestUntil[base] ?? .distantPast) <= Date() {
            do { request = try await signed(request, baseURL: baseURL, appID: appID, using: transport) }
            catch is CancellationError { throw CancellationError() }
            catch { pauseAttestUntil[base] = Date().addingTimeInterval(600) }
        }
        // The initial probe also lets installations work when protection is disabled.
        let first = try await transport(request)
        guard Self.needsVerification(first.1) else { return first }
        proofs[base] = nil
        request.setValue(nil, forHTTPHeaderField: "X-Lookup-Proof")
        let config = try await configuration(baseURL, using: transport)
        if provider.supported(), let appID = config.appAttestAppId,
           (pauseAttestUntil[base] ?? .distantPast) <= Date() {
            do {
                request = try await signed(request, baseURL: baseURL, appID: appID, using: transport)
                let result = try await transport(request)
                if !Self.needsVerification(result.1) { return result }
                // A reinstall, expired registry entry or rejected key gets a new key after a short backoff.
                records[base] = nil
                save(records)
            } catch is CancellationError { throw CancellationError() }
            catch {
                if let error = error as? DCError, error.code == .invalidKey { records[base] = nil; save(records) }
                // Apple or the network can be unavailable; the browser check remains usable.
            }
            pauseAttestUntil[base] = Date().addingTimeInterval(600)
        }
        // Detection runs while typing; only an explicit lookup may interrupt with a sheet.
        guard config.turnstile, allowPresentation else { throw NativeVerificationFailed() }
        for name in ["X-App-Attest-Key-Id", "X-App-Attest-Challenge", "X-App-Attest-Assertion"] {
            request.setValue(nil, forHTTPHeaderField: name)
        }
        var components = URLComponents(url: baseURL.appending(path: "api/public/native/turnstile"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "language", value: await MainActor.run { AppLanguage.current.rawValue })]
        let token = try await present(components.url!)
        try Task.checkCancellation()
        let proofData = try await api(baseURL, path: "api/public/verification", body: ["token": token], using: transport)
        let proof = try JSONDecoder().decode(Proof.self, from: proofData)
        proofs[base] = proof
        request.setValue(proof.proof, forHTTPHeaderField: "X-Lookup-Proof")
        let result = try await transport(request)
        if Self.needsVerification(result.1) { proofs[base] = nil; throw NativeVerificationFailed() }
        return result
    }

    private func signed(_ original: URLRequest, baseURL: URL, appID: String, using transport: Send) async throws -> URLRequest {
        var request = original
        let key = try await registeredKey(baseURL, appID: appID, using: transport)
        let challenge = try await challenge(baseURL, key: key, purpose: "assertion", using: transport)
        let payload = Self.payload(request, challenge: challenge)
        let assertion = try await provider.assert(key, Data(SHA256.hash(data: Data(payload.utf8))))
        request.setValue(key, forHTTPHeaderField: "X-App-Attest-Key-Id")
        request.setValue(challenge, forHTTPHeaderField: "X-App-Attest-Challenge")
        request.setValue(assertion.base64EncodedString(), forHTTPHeaderField: "X-App-Attest-Assertion")
        return request
    }

    static func payload(_ request: URLRequest, challenge: String) -> String {
        let hash = SHA256.hash(data: request.httpBody ?? Data()).map { String(format: "%02x", $0) }.joined()
        return "native-request-v1\n\(challenge)\n\(request.httpMethod ?? "GET")\n\(request.url!.path)\n\(hash)"
    }
    private static func needsVerification(_ response: HTTPURLResponse) -> Bool {
        response.statusCode == 403 && response.value(forHTTPHeaderField: "X-Lookup-Verification") == "required"
    }
    private func configuration(_ baseURL: URL, using transport: Send) async throws -> Configuration {
        let base = baseURL.absoluteString
        if let saved = configurations[base], saved.1 > Date() { return saved.0 }
        let data = try await api(baseURL, path: "api/public/native/verification", using: transport)
        let config = try JSONDecoder().decode(Configuration.self, from: data)
        configurations[base] = (config, Date().addingTimeInterval(600))
        return config
    }
    private func registeredKey(_ baseURL: URL, appID: String, using transport: Send) async throws -> String {
        let base = baseURL.absoluteString
        if records[base]?.appID != appID { records[base] = nil }
        if records[base] == nil {
            records[base] = NativeAttestRecord(keyID: try await provider.generateKey(), appID: appID, registered: false)
            save(records)
        }
        guard var record = records[base] else { throw NativeVerificationFailed() }
        if !record.registered {
            let nonce = try await challenge(baseURL, key: record.keyID, purpose: "attestation", using: transport)
            let attestation = try await provider.attest(record.keyID, Data(SHA256.hash(data: Data(nonce.utf8))))
            _ = try await api(baseURL, path: "api/public/native/verification", body: [
                "keyId": record.keyID, "challenge": nonce, "attestation": attestation.base64EncodedString(),
            ], using: transport)
            record.registered = true
            records[base] = record
            save(records)
        }
        return record.keyID
    }
    private func challenge(_ baseURL: URL, key: String, purpose: String, using transport: Send) async throws -> String {
        let data = try await api(baseURL, path: "api/public/native/challenge", body: ["keyId": key, "purpose": purpose], using: transport)
        return try JSONDecoder().decode(Challenge.self, from: data).challenge
    }
    private func api(_ baseURL: URL, path: String, body: [String: String]? = nil, using transport: Send) async throws -> Data {
        var request = URLRequest(url: baseURL.appending(path: path), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 15)
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await transport(request)
        guard (200..<300).contains(response.statusCode) else { throw NativeVerificationFailed() }
        return data
    }
}

/// Present above the add-parcel sheet, and accept messages only from the hosted verification page.
@MainActor
final class NativeTurnstilePresenter: NSObject, WKScriptMessageHandler, WKNavigationDelegate, UIAdaptivePresentationControllerDelegate {
    static let shared = NativeTurnstilePresenter()
    private var pending: CheckedContinuation<String, Error>?
    private var navigation: UINavigationController?
    private var webView: WKWebView?
    private var page: URL?
    private var timeout: Task<Void, Never>?

    func token(at url: URL) async throws -> String {
        try Task.checkCancellation()
        guard pending == nil, url.scheme == "https" else { throw NativeVerificationFailed() }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard var parent = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                    .first(where: { $0.activationState == .foregroundActive })?.windows.first(where: \.isKeyWindow)?.rootViewController
                else { continuation.resume(throwing: NativeVerificationFailed()); return }
                while let presented = parent.presentedViewController { parent = presented }
                pending = continuation
                page = url
                let localizer = Localizer()
                let configuration = WKWebViewConfiguration()
                configuration.websiteDataStore = .default()
                configuration.userContentController.add(self, name: "peekVerification")
                let web = WKWebView(frame: .zero, configuration: configuration)
                web.navigationDelegate = self
                let controller = UIViewController()
                controller.view = web
                controller.title = localizer.text("native.verification.title")
                controller.navigationItem.leftBarButtonItem = UIBarButtonItem(title: localizer.text("common.cancel"), style: .plain, target: self, action: #selector(cancel))
                let nav = UINavigationController(rootViewController: controller)
                nav.modalPresentationStyle = .pageSheet
                navigation = nav
                webView = web
                parent.present(nav, animated: true) {
                    nav.presentationController?.delegate = self
                    web.load(URLRequest(url: url))
                }
                timeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(90))
                    guard !Task.isCancelled else { return }
                    self?.finish(.failure(NativeVerificationFailed()))
                }
            }
        } onCancel: { Task { @MainActor in self.finish(.failure(CancellationError())) } }
    }
    @objc private func cancel() { finish(.failure(CancellationError())) }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { cancel() }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let page, message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == page.scheme,
              message.frameInfo.securityOrigin.host == page.host,
              message.frameInfo.request.url?.path == page.path,
              let body = message.body as? [String: Any] else { return }
        if body["type"] as? String == "token", let token = body["token"] as? String, !token.isEmpty, token.count <= 2048 {
            finish(.success(token))
        } else if body["type"] as? String == "error" { finish(.failure(NativeVerificationFailed())) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let page else { decisionHandler(.cancel); return }
        let own = url.scheme == page.scheme && url.host == page.host && url.port == page.port && url.path == page.path
        let child = navigationAction.targetFrame?.isMainFrame == false
            && ((url.scheme == "https" && url.host == "challenges.cloudflare.com") || url.scheme == "about")
        decisionHandler(own || child ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(NativeVerificationFailed())) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(NativeVerificationFailed())) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(NativeVerificationFailed())) }
    private func finish(_ result: Result<String, Error>) {
        guard let continuation = pending else { return }
        pending = nil
        timeout?.cancel()
        timeout = nil
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "peekVerification")
        webView?.navigationDelegate = nil
        navigation?.dismiss(animated: true)
        navigation = nil
        webView = nil
        page = nil
        continuation.resume(with: result)
    }
}
