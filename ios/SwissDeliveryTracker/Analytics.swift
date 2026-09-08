import Foundation
import UIKit
import SwiftUI

/// One catalog shared with the web app; only these names can leave the device.
struct AnalyticsCatalog: Decodable {
    struct Operation: Decodable { let method: String; let path: String; let event: String }
    let screens: [String]
    let actions: [String]
    let operations: [Operation]
    let friendActions: [String: String]

    static let bundled: AnalyticsCatalog? = {
        guard let url = Bundle.main.url(forResource: "Analytics", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(AnalyticsCatalog.self, from: data)
    }()

    func event(path: String, method: String, body: Data?) -> String? {
        let path = String(path.prefix { $0 != "?" && $0 != "#" })
        if path == "/api/friends", method == "POST" {
            guard let body, let value = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let action = value["action"] as? String else { return nil }
            return friendActions[action]
        }
        return operations.first { $0.method == method && path.range(of: $0.path, options: .regularExpression) != nil }?.event
    }
}

@MainActor
final class DeliveryAnalytics {
    static let shared = DeliveryAnalytics()
    static let preferenceKey = "sdt.analytics.enabled"
    private var enabled: Bool { UserDefaults.standard.object(forKey: Self.preferenceKey) as? Bool ?? true }
    func setEnabled(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: Self.preferenceKey)
        if !value { queue.removeAll(); cache = nil }
        else { disabled = false; lastView = ""; Task { await start(); view(screen) } }
    }
    struct Configuration: Decodable {
        let endpoint: URL
        let hostname: String
        let iosWebsite: String

        func valid(for origin: URL) -> Bool {
            endpoint.scheme == "https" && endpoint.host != nil && endpoint.user == nil && endpoint.password == nil
                && endpoint.path == "/api/send" && endpoint.query == nil && endpoint.fragment == nil
                && origin.scheme == "https" && hostname == origin.host && UUID(uuidString: iosWebsite) != nil
        }
    }
    enum Outcome: String { case success, error, started, accepted }
    enum Mode: String { case anonymous, demo, account }
    struct Event {
        let screen: String
        let name: String?
        let outcome: Outcome?
        let mode: Mode
    }
    private let transport = URLSession(configuration: .ephemeral)
    private var configuration: Configuration?
    private var starting = false
    private var disabled = false
    private var started = false
    private var sending = false
    private var cache: String?
    private var queue: [Event] = []
    private(set) var screen = "welcome"
    private var mode: Mode = .anonymous
    private var lastView = ""

    func start(configuration app: AppConfiguration = .current) async {
        guard enabled, !starting, !started else { return }
        #if targetEnvironment(simulator)
        disabled = true
        queue.removeAll()
        return
        #else
        guard app.mode == .api else { disabled = true; queue.removeAll(); return }
        starting = true
        defer { starting = false }
        do {
            let request = URLRequest(url: app.apiBaseURL.appending(path: "api/analytics/config"),
                                     cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
            let (data, response) = try await transport.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let value = try JSONDecoder().decode(Configuration?.self, from: data),
                  value.valid(for: app.apiBaseURL) else { disabled = true; queue.removeAll(); return }
            configuration = value
            disabled = false
            started = true
            action("app-open")
            flush()
        } catch { queue.removeAll() /* Try configuration again on next foreground. */ }
        #endif
    }

    func view(_ next: String, mode nextMode: Mode? = nil) {
        guard AnalyticsCatalog.bundled?.screens.contains(next) == true else { return }
        screen = next
        if let nextMode { mode = nextMode }
        let key = "\(mode.rawValue):\(next)"
        guard key != lastView else { return }
        lastView = key
        enqueue(Event(screen: screen, name: nil, outcome: nil, mode: mode))
    }

    func action(_ name: String, _ outcome: Outcome? = nil) {
        guard AnalyticsCatalog.bundled?.actions.contains(name) == true else { return }
        enqueue(Event(screen: screen, name: name, outcome: outcome, mode: mode))
    }

    private func enqueue(_ event: Event) {
        guard enabled, !disabled, queue.count < 30 else { return }
        queue.append(event)
        flush()
    }

    /// No account IDs, device IDs, tokens, query strings, referrers or user-entered text.
    static func payload(_ event: Event, configuration: Configuration) -> [String: Any] {
        var properties = ["platform": "ios", "mode": event.mode.rawValue]
        if let outcome = event.outcome { properties["outcome"] = outcome.rawValue }
        var result: [String: Any] = [
            "website": configuration.iosWebsite, "hostname": configuration.hostname,
            "url": "/\(event.screen)", "title": event.screen,
            "language": Locale.preferredLanguages.first ?? "en",
            "browser": "Delivery iOS", "os": "iOS", "device": "mobile", "data": properties
        ]
        if let name = event.name { result["name"] = name }
        return result
    }

    private func flush() {
        guard !sending, configuration != nil else { return }
        sending = true
        Task {
            defer { sending = false }
            while enabled, !queue.isEmpty, let configuration {
                let event = queue.removeFirst()
                do {
                    var request = URLRequest(url: configuration.endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    // Umami filters bare app user agents as bots. Keep the app suffix
                    // on a standard iOS-compatible agent; explicit payload fields identify native.
                    let osVersion = UIDevice.current.systemVersion.replacingOccurrences(of: ".", with: "_")
                    request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS \(osVersion) like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 DeliveryTracker/1.0", forHTTPHeaderField: "User-Agent")
                    if let cache { request.setValue(cache, forHTTPHeaderField: "x-umami-cache") }
                    request.httpBody = try JSONSerialization.data(withJSONObject: ["type": "event", "payload": Self.payload(event, configuration: configuration)])
                    let (data, response) = try await transport.data(for: request)
                    if (response as? HTTPURLResponse)?.statusCode == 200,
                       let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        cache = value["cache"] as? String
                    }
                } catch { /* Drop failures; never block delivery actions or persist analytics. */ }
            }
        }
    }
}

/// Keep telemetry observation separate from the main app's lifecycle expressions.
struct AnalyticsLifecycleObserver: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var invitation: FriendInvitationStore
    @EnvironmentObject private var localizer: Localizer
    @Environment(\.scenePhase) private var phase

    private var mode: DeliveryAnalytics.Mode {
        if session.isDemo { return .demo }
        return session.user == nil ? .anonymous : .account
    }
    private var screen: String {
        if invitation.isPresenting { return "invitation" }
        switch session.state {
        case .loading, .welcome: return "welcome"
        case .signedOut, .unconfigured: return "sign-in"
        case .demo, .signedIn: return "deliveries"
        }
    }
    var body: some View {
        Color.clear.frame(width: 0, height: 0)
            .task { await DeliveryAnalytics.shared.start() }
            .onChange(of: screen + mode.rawValue, initial: true) { _, _ in
                DeliveryAnalytics.shared.view(screen, mode: mode)
            }
            .onChange(of: phase) { _, phase in
                if phase == .active {
                    DeliveryAnalytics.shared.action("app-foreground")
                    Task { await DeliveryAnalytics.shared.start() }
                }
            }
            .onChange(of: localizer.language) { _, _ in DeliveryAnalytics.shared.action("language-change") }
            .onOpenURL { _ in DeliveryAnalytics.shared.action("deep-link-open") }
            .onReceive(NotificationCenter.default.publisher(for: .didOpenFriendNotification)) { _ in
                DeliveryAnalytics.shared.action("notification-open")
            }
    }
}
