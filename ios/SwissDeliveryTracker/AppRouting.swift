import Foundation
import CryptoKit

/// The web addresses whose links open in the app: the site itself, and the hosts it answered on
/// before, so links shared from there keep working. Those hosts are only ever read from an
/// incoming link. The app calls the API and builds the links it shares on the site's own host.
enum SiteLink {
    static func belongs(
        _ url: URL,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) -> Bool {
        guard url.user == nil, url.password == nil, let host = url.host?.lowercased() else { return false }
        if url.scheme == baseURL.scheme, host == baseURL.host?.lowercased(), url.port == baseURL.port { return true }
        return url.scheme == "https" && url.port == nil && linkHosts.contains(host)
    }
}

/// A tapped web link can reach the app twice, as a URL to open and as a browsing activity to
/// continue. It opens once.
struct LinkDeliveries {
    private var last: (url: URL, at: Date)?

    mutating func isRepeat(_ url: URL, now: Date = .now) -> Bool {
        defer { last = (url, now) }
        guard let last else { return false }
        return last.url == url && now.timeIntervalSince(last.at) >= 0 && now.timeIntervalSince(last.at) < 1
    }
}

enum FriendInvitationLink {
    static func isInvitation(
        _ url: URL,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) -> Bool {
        guard url.user == nil, url.password == nil else { return false }
        if url.scheme?.lowercased() == OAuthFlow.callbackScheme { return url.host?.lowercased() == "invite" && url.path.isEmpty }
        return SiteLink.belongs(url, baseURL: baseURL, linkHosts: linkHosts) && (url.path == "/invite" || url.path.hasPrefix("/i/"))
    }

    static func code(
        from text: String,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) -> String? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              isInvitation(url, baseURL: baseURL, linkHosts: linkHosts) else { return nil }
        if url.path.hasPrefix("/i/") {
            let key = String(url.path.dropFirst(3))
            return validPreviewID(key) ? key : nil
        }
        guard let code = url.fragment, validCode(code) else { return nil }
        if url.query != nil {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard items.count == 1, items[0].name == "preview", items[0].value == previewHash(code) else { return nil }
        }
        return code
    }

    static func validCode(_ value: String) -> Bool {
        validPreviewID(value) || value.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil
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
            components.fragment = nil
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

/// A parcel link, `/p/<id>`. The id is the capability. A name someone gave the parcel travels
/// only after the `#`, which never reaches a server.
struct ParcelLinkRoute: Equatable, Sendable {
    let id: String
    var name: String? = nil

    private static let alphabet = Set("23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    static func validID(_ value: String) -> Bool {
        value.count == 12 && value.allSatisfy(alphabet.contains)
    }

    init(id: String, name: String? = nil) {
        self.id = id
        self.name = name
    }

    init?(
        url: URL,
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        linkHosts: [String] = AppConfiguration.current.linkHosts
    ) {
        guard url.user == nil, url.password == nil else { return nil }
        let id: String
        if url.scheme?.lowercased() == OAuthFlow.callbackScheme {
            guard url.host?.lowercased() == "p", url.path.hasPrefix("/") else { return nil }
            id = String(url.path.dropFirst())
        } else {
            guard SiteLink.belongs(url, baseURL: baseURL, linkHosts: linkHosts), url.path.hasPrefix("/p/") else { return nil }
            id = String(url.path.dropFirst(3))
        }
        guard Self.validID(id) else { return nil }
        self.id = id
        name = Self.name(inFragment: URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedFragment)
    }

    /// `n=<percent-encoded name>`, cleaned to what a parcel's name may hold.
    static func name(inFragment fragment: String?) -> String? {
        guard let item = fragment?.split(separator: "&").first(where: { $0.hasPrefix("n=") }),
              let decoded = String(item.dropFirst(2)).removingPercentEncoding else { return nil }
        let line = decoded.unicodeScalars
            .map { CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0) ? " " : String($0) }
            .joined()
            .trimmingCharacters(in: .whitespaces)
        var name = ""
        for character in line {
            guard name.utf16.count + character.utf16.count <= 80 else { break }
            name.append(character)
        }
        return name.trimmingCharacters(in: .whitespaces).nonEmpty
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
