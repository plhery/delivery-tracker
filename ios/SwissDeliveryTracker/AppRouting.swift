import Foundation
import CryptoKit

enum FriendInvitationLink {
    static func isInvitation(_ url: URL, baseURL: URL = AppConfiguration.current.apiBaseURL) -> Bool {
        guard url.user == nil, url.password == nil else { return false }
        if url.scheme?.lowercased() == OAuthFlow.callbackScheme { return url.host?.lowercased() == "invite" && url.path.isEmpty }
        return url.scheme == baseURL.scheme && url.host?.lowercased() == baseURL.host?.lowercased()
            && url.port == baseURL.port && (url.path == "/invite" || url.path.hasPrefix("/i/"))
    }

    static func code(from text: String, baseURL: URL = AppConfiguration.current.apiBaseURL) -> String? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              isInvitation(url, baseURL: baseURL),
              let code = url.fragment, code.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else { return nil }
        if url.path.hasPrefix("/i/") {
            guard validPreviewID(String(url.path.dropFirst(3))), url.query == nil else { return nil }
        } else if url.query != nil {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard items.count == 1, items[0].name == "preview", items[0].value == previewHash(code) else { return nil }
        }
        return code
    }

    private static func validPreviewID(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{16}$", options: .regularExpression) != nil
    }

    private static func previewHash(_ code: String) -> String {
        SHA256.hash(data: Data(code.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func url(code: String, previewId: String? = nil, baseURL: URL = AppConfiguration.current.apiBaseURL) -> URL {
        if let previewId, validPreviewID(previewId) {
            var components = URLComponents(url: baseURL.appending(path: "i").appending(path: previewId), resolvingAgainstBaseURL: false)!
            components.query = nil
            components.fragment = code
            return components.url!
        }
        // Compatibility with servers that have not started returning short IDs.
        var components = URLComponents(url: baseURL.appending(path: "invite"), resolvingAgainstBaseURL: false)!
        // Fragments never travel in HTTP requests or Referer headers.
        components.queryItems = [URLQueryItem(name: "preview", value: previewHash(code))]
        components.fragment = code
        return components.url!
    }
}

enum NativeRoute: Equatable {
    case parcel(UUID)
    case friend(UUID)
    case add(trackingInput: String)

    init?(url: URL) {
        guard url.scheme?.lowercased() == OAuthFlow.callbackScheme else { return nil }
        switch url.host?.lowercased() {
        case "friend":
            guard let raw = url.pathComponents.last, let friendID = UUID(uuidString: raw) else { return nil }
            self = .friend(friendID)
        case "parcel":
            guard let raw = url.pathComponents.last,
                  let parcelID = UUID(uuidString: raw) else { return nil }
            self = .parcel(parcelID)
        case "add":
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let tracking = components?.queryItems?.first(where: { $0.name == "tracking" })?.value ?? ""
            self = .add(trackingInput: tracking)
        default:
            return nil
        }
    }

    init?(remoteNotification payload: [AnyHashable: Any]) {
        if payload["kind"] as? String == "friend_accepted", let raw = payload["friend_id"] as? String,
           let friendID = UUID(uuidString: raw) { self = .friend(friendID); return }
        guard let raw = payload["parcel_id"] as? String,
              let parcelID = UUID(uuidString: raw) else { return nil }
        self = .parcel(parcelID)
    }
}

enum OAuthFlow {
    static let callbackScheme = "swissdeliverytracker"
    static let callbackHost = "auth-callback"

    static var callbackURL: URL {
        URL(string: "\(callbackScheme)://\(callbackHost)")!
    }

    static func authorizationURL(
        baseURL: URL,
        provider: String,
        codeChallenge: String
    ) -> URL? {
        guard var components = URLComponents(
            url: baseURL.appending(path: "auth/v1/authorize"),
            resolvingAgainstBaseURL: false
        ) else { return nil }
        components.queryItems = [
            URLQueryItem(name: "provider", value: provider),
            URLQueryItem(name: "redirect_to", value: callbackURL.absoluteString),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        return components.url
    }

    static func authorizationCode(from callback: URL) -> String? {
        guard callback.scheme?.lowercased() == callbackScheme,
              callback.host?.lowercased() == callbackHost,
              let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
              !code.isEmpty else { return nil }
        return code
    }
}
